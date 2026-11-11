import type { SupabaseClient } from "@supabase/supabase-js";

import { todayInDubai } from "@/lib/amc/contracts";
import { additionalWorkRollup } from "@/lib/server/amc/additional-works";
import { isMissingTable } from "@/lib/server/amc/contracts";
import { AMC_DOCUMENTS_BUCKET } from "@/lib/server/amc/signed-archive";

/**
 * What the client profile shows across all of a client's contracts (BRD
 * 5.9): the schedule, the service history (visits done, call outs,
 * additional work), the payments received and the additional-work totals;
 * and an asset's own history (BRD 5.2). Read only. A table not migrated
 * yet reads as empty.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row | undefined) ?? null) : ((v as Row | null) ?? null));
const DONE = ["completed", "completed_with_additional_work", "partially_completed"];

async function rows(q: PromiseLike<{ data: unknown[] | null; error: { code?: string; message: string } | null }>): Promise<Row[]> {
  const { data, error } = await q;
  if (error) {
    if (!isMissingTable(error) && error.code !== "42703") console.warn("[amc:client-history]", error.message);
    return [];
  }
  return (data ?? []) as Row[];
}

async function contractsOf(admin: Admin, customerId: string) {
  const list = await rows(admin.from("amc_contracts").select("id, contract_number, proposal_number, property_label, status, start_date, end_date").eq("customer_id", customerId));
  return new Map(list.map((c) => [String(c.id), { number: String(c.contract_number ?? c.proposal_number ?? ""), propertyLabel: String(c.property_label ?? ""), status: String(c.status) }]));
}

/** The client's planned visits across their contracts: upcoming and the last ones. */
export async function clientSchedule(admin: Admin, customerId: string) {
  const contracts = await contractsOf(admin, customerId);
  const ids = [...contracts.keys()];
  if (!ids.length) return { visits: [] };
  const visits = await rows(
    admin
      .from("amc_visits")
      .select("id, contract_id, visit_no, status, window_start, window_end, target_date, scheduled_start, lines:amc_visit_lines!amc_visit_lines_visit_id_fkey(service_label, status)")
      .in("contract_id", ids)
      .neq("status", "cancelled")
      .order("target_date")
      .limit(500),
  );
  return {
    visits: visits.map((v) => ({
      id: String(v.id),
      contractId: String(v.contract_id),
      contractNumber: contracts.get(String(v.contract_id))?.number ?? "",
      propertyLabel: contracts.get(String(v.contract_id))?.propertyLabel ?? "",
      visitNo: Number(v.visit_no),
      status: String(v.status),
      windowStart: String(v.window_start),
      windowEnd: String(v.window_end),
      targetDate: String(v.target_date),
      scheduledStart: str(v.scheduled_start),
      services: ((v.lines ?? []) as Row[]).filter((l) => l.status !== "cancelled").map((l) => String(l.service_label)),
      overdue: !DONE.includes(String(v.status)) && String(v.status) !== "not_completed" && String(v.window_end) < todayInDubai(),
    })),
  };
}

/** Visits done, call outs and additional work, newest first (BRD 5.9 service history). */
export async function clientServiceHistory(admin: Admin, customerId: string) {
  const contracts = await contractsOf(admin, customerId);
  const ids = [...contracts.keys()];
  if (!ids.length) return { entries: [] };
  const [visits, callOuts, works] = await Promise.all([
    rows(
      admin
        .from("amc_visits")
        .select("id, contract_id, visit_no, status, closed_at, target_date, report_document_id, lines:amc_visit_lines!amc_visit_lines_visit_id_fkey(service_label, status, outcome_group)")
        .in("contract_id", ids)
        .in("status", [...DONE, "not_completed"])
        .limit(500),
    ),
    rows(admin.from("amc_call_outs").select("id, contract_id, call_out_no, priority, issue, status, reported_at, attended_at, coverage").in("contract_id", ids).neq("status", "cancelled").limit(500)),
    rows(admin.from("amc_additional_works").select("id, contract_id, work_no, finding, status, total, created_at").in("contract_id", ids).limit(500)),
  ]);
  const ref = (contractId: unknown) => contracts.get(String(contractId)) ?? { number: "", propertyLabel: "", status: "" };
  const entries = [
    ...visits.map((v) => ({
      kind: "visit" as const,
      id: String(v.id),
      contractId: String(v.contract_id),
      contractNumber: ref(v.contract_id).number,
      propertyLabel: ref(v.contract_id).propertyLabel,
      date: str(v.closed_at) ?? String(v.target_date),
      title: `PPM visit ${String(v.visit_no)}`,
      detail: ((v.lines ?? []) as Row[]).filter((l) => l.status !== "cancelled").map((l) => `${String(l.service_label)} (${String(l.status).replace(/_/g, " ")})`).join(", "),
      status: String(v.status),
      amount: null as number | null,
      hasReport: Boolean(v.report_document_id),
    })),
    ...callOuts.map((c) => ({
      kind: "call_out" as const,
      id: String(c.id),
      contractId: String(c.contract_id),
      contractNumber: ref(c.contract_id).number,
      propertyLabel: ref(c.contract_id).propertyLabel,
      date: str(c.attended_at) ?? String(c.reported_at),
      title: `Call out ${String(c.call_out_no)}${c.priority === "emergency" ? " (emergency)" : ""}`,
      detail: `${String(c.issue)} · ${c.coverage === "covered" ? "covered" : "chargeable"}`,
      status: String(c.status),
      amount: null as number | null,
      hasReport: false,
    })),
    ...works.map((w) => ({
      kind: "additional_work" as const,
      id: String(w.id),
      contractId: String(w.contract_id),
      contractNumber: ref(w.contract_id).number,
      propertyLabel: ref(w.contract_id).propertyLabel,
      date: String(w.created_at),
      title: `Additional work ${String(w.work_no)}`,
      detail: String(w.finding),
      status: String(w.status),
      amount: Number(w.total ?? 0),
      hasReport: false,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return { entries };
}

/** Money received from the client (payments not voided), newest first. */
export async function clientPaymentsReceived(admin: Admin, customerId: string) {
  const contracts = await contractsOf(admin, customerId);
  const ids = [...contracts.keys()];
  if (!ids.length) return { payments: [] };
  const list = await rows(
    admin
      .from("amc_payments")
      .select("id, contract_id, mode, amount, received_on, reference, receipt_no, voided_at, instalment:amc_instalments!amc_payments_instalment_id_fkey(instalment_no)")
      .in("contract_id", ids)
      .order("received_on", { ascending: false })
      .limit(500),
  );
  return {
    payments: list.map((p) => ({
      id: String(p.id),
      contractId: String(p.contract_id),
      contractNumber: contracts.get(String(p.contract_id))?.number ?? "",
      instalmentNo: one(p.instalment)?.instalment_no === undefined ? null : Number(one(p.instalment)?.instalment_no),
      mode: String(p.mode),
      amount: Number(p.amount ?? 0),
      receivedOn: String(p.received_on),
      reference: str(p.reference),
      receiptNo: str(p.receipt_no),
      voided: Boolean(p.voided_at),
    })),
  };
}

/** The client's additional-work totals across their contracts (BRD 5.14 roll-up to the client). */
export async function clientAdditionalWorkTotals(admin: Admin, customerId: string) {
  const contracts = await contractsOf(admin, customerId);
  return additionalWorkRollup(admin, [...contracts.keys()]);
}

/**
 * An asset's service history (BRD 5.2): every checklist result and photo
 * recorded against it on a job sheet, with the visit and its date, and the
 * call outs at its property for the same trade.
 */
export async function assetHistory(admin: Admin, propertyId: string, assetId: string) {
  const { data: asset } = await admin.from("amc_property_assets").select("id, trade, asset_type, location").eq("id", assetId).eq("property_id", propertyId).maybeSingle<Row>();
  if (!asset) return null;
  const [checks, photos] = await Promise.all([
    rows(
      admin
        .from("amc_visit_checklist_items")
        .select("id, label, result, note, created_at, sheet:amc_visit_job_sheets!amc_visit_checklist_items_job_sheet_id_fkey(completed_at, visit:amc_visits!amc_visit_job_sheets_visit_id_fkey(id, visit_no, contract_id))")
        .eq("asset_id", assetId)
        .order("created_at", { ascending: false })
        .limit(300),
    ),
    rows(admin.from("amc_visit_photos").select("id, kind, caption, storage_path, created_at, visit_id").eq("asset_id", assetId).order("created_at", { ascending: false }).limit(60)),
  ]);
  const urls = new Map<string, string>();
  if (photos.length) {
    const { data: signed } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrls(photos.map((p) => String(p.storage_path)), 600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  /* Call outs carry no asset; those at the property for the asset's trade are shown beside it. */
  const contractIds = (await rows(admin.from("amc_contracts").select("id").eq("property_id", propertyId))).map((c) => String(c.id));
  const callOuts = contractIds.length
    ? await rows(
        admin
          .from("amc_call_outs")
          .select("id, call_out_no, issue, status, reported_at, attended_at, resolution, trade")
          .in("contract_id", contractIds)
          .eq("trade", String(asset.trade))
          .order("reported_at", { ascending: false })
          .limit(100),
      )
    : [];
  return {
    asset: { id: String(asset.id), trade: String(asset.trade), label: [str(asset.asset_type), str(asset.location)].filter(Boolean).join(" · ") },
    checks: checks.map((c) => {
      const sheet = one(c.sheet);
      const visit = one(sheet?.visit);
      return {
        id: String(c.id),
        label: String(c.label),
        result: String(c.result),
        note: str(c.note),
        date: str(sheet?.completed_at) ?? String(c.created_at),
        visitId: str(visit?.id),
        visitNo: visit?.visit_no === undefined ? null : Number(visit.visit_no),
        contractId: str(visit?.contract_id),
      };
    }),
    photos: photos.map((p) => ({ id: String(p.id), kind: String(p.kind), caption: str(p.caption), url: urls.get(String(p.storage_path)) ?? null, date: String(p.created_at), visitId: String(p.visit_id) })),
    callOuts: callOuts.map((c) => ({
      id: String(c.id),
      number: String(c.call_out_no),
      issue: String(c.issue),
      status: String(c.status),
      date: str(c.attended_at) ?? String(c.reported_at),
      resolution: str(c.resolution),
    })),
  };
}
