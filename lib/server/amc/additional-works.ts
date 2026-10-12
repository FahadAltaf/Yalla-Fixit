import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { whatsappUrl } from "@/lib/amc/approval-ladder";
import {
  ADDITIONAL_WORK_STATUS_LABELS,
  SETTLED_ADDITIONAL_WORK,
  WORK_PARTIES,
  WORK_PARTY_LABELS,
  WORK_RISK_LABELS,
  canMoveWork,
  quotationTotals,
  type AdditionalWorkAction,
  type AdditionalWorkCreateInput,
  type AdditionalWorkStatus,
  type QuotationLine,
  type WorkParty,
  type WorkPartyValue,
  type WorkRisk,
} from "@/lib/amc/call-outs";
import type { AmcConfig } from "@/lib/amc/config";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { fail, notMigrated, one, str, workPhotos } from "@/lib/server/amc/call-outs";
import { ContractError } from "@/lib/server/amc/contracts";
import { notifyUsers } from "@/lib/server/amc/notifications";
import { recordSend } from "@/lib/server/amc/proposal-share";
import { AMC_DOCUMENTS_BUCKET, renderPdf } from "@/lib/server/amc/signed-archive";
import { recordStatusChange } from "@/lib/server/amc/status-history";
import { sendEmail } from "@/lib/server/send-email";

/**
 * Additional works on the server (Phase 11: DEV-407). Raised from a PPM
 * visit or a call out; the technical finding stays apart from the
 * commercial part, and each of the five parties is recorded. Quotation
 * with the material handling fee, shared by email (PDF) and prepared
 * WhatsApp, approved with evidence, scheduled, completed, invoiced, paid.
 * Totals roll up to the contract and the client.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

const PARTY_COLUMNS: Record<WorkParty, string> = {
  requester: "requester",
  approver: "approver",
  payer: "payer",
  invoiceRecipient: "invoice_recipient",
  reportRecipient: "report_recipient",
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const WORK_COLUMNS =
  "id, work_no, contract_id, source, visit_id, call_out_id, technician_id, trade, finding, risk, requester, approver, payer, invoice_recipient, report_recipient, status, quotation_lines, material_fee_percent, " +
  "labour_total, material_total, material_fee, subtotal, vat_amount, total, quoted_at, shared_at, approved_at, approval_evidence, rejected_at, rejection_reason, scheduled_for, completed_at, invoice_number, invoiced_at, paid_at, payment_reference, created_at, " +
  "contract:amc_contracts!amc_additional_works_contract_id_fkey(id, contract_number, proposal_number, customer_name, customer_id, property_label, customer, submission:amc_submissions!amc_contracts_submission_id_fkey(id, owner_id)), " +
  "visit:amc_visits!amc_additional_works_visit_id_fkey(visit_no), call_out:amc_call_outs!amc_additional_works_call_out_id_fkey(call_out_no, status)";

export interface AdditionalWorkRecord {
  id: string;
  workNo: string;
  contractId: string;
  contractNumber: string;
  customerName: string;
  propertyLabel: string;
  ownerId: string | null;
  source: "visit" | "call_out" | "manual";
  visitId: string | null;
  visitNo: number | null;
  callOutId: string | null;
  callOutNo: string | null;
  technicianId: string | null;
  trade: string | null;
  finding: string;
  risk: WorkRisk;
  parties: Record<WorkParty, WorkPartyValue | null>;
  status: AdditionalWorkStatus;
  quotationLines: QuotationLine[];
  materialFeePercent: number;
  totals: ReturnType<typeof quotationTotals>;
  quotedAt: string | null;
  sharedAt: string | null;
  approvedAt: string | null;
  approvalEvidence: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  scheduledFor: string | null;
  completedAt: string | null;
  invoiceNumber: string | null;
  invoicedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  createdAt: string;
}

function mapWork(r: Row): AdditionalWorkRecord {
  const c = one(r.contract) ?? {};
  return {
    id: String(r.id),
    workNo: String(r.work_no),
    contractId: String(r.contract_id),
    contractNumber: String(c.contract_number ?? c.proposal_number ?? ""),
    customerName: String(c.customer_name ?? ""),
    propertyLabel: String(c.property_label ?? ""),
    ownerId: str(one(c.submission)?.owner_id),
    source: r.source as AdditionalWorkRecord["source"],
    visitId: str(r.visit_id),
    visitNo: one(r.visit)?.visit_no === undefined ? null : Number(one(r.visit)?.visit_no),
    callOutId: str(r.call_out_id),
    callOutNo: str(one(r.call_out)?.call_out_no),
    technicianId: str(r.technician_id),
    trade: str(r.trade),
    finding: String(r.finding),
    risk: r.risk as WorkRisk,
    parties: Object.fromEntries(WORK_PARTIES.map((p) => [p, (r[PARTY_COLUMNS[p]] as WorkPartyValue | null) ?? null])) as AdditionalWorkRecord["parties"],
    status: r.status as AdditionalWorkStatus,
    quotationLines: (r.quotation_lines ?? []) as QuotationLine[],
    materialFeePercent: Number(r.material_fee_percent ?? 0),
    totals: {
      labourTotal: Number(r.labour_total ?? 0),
      materialTotal: Number(r.material_total ?? 0),
      materialFee: Number(r.material_fee ?? 0),
      subtotal: Number(r.subtotal ?? 0),
      vatAmount: Number(r.vat_amount ?? 0),
      total: Number(r.total ?? 0),
    },
    quotedAt: str(r.quoted_at),
    sharedAt: str(r.shared_at),
    approvedAt: str(r.approved_at),
    approvalEvidence: str(r.approval_evidence),
    rejectedAt: str(r.rejected_at),
    rejectionReason: str(r.rejection_reason),
    scheduledFor: str(r.scheduled_for),
    completedAt: str(r.completed_at),
    invoiceNumber: str(r.invoice_number),
    invoicedAt: str(r.invoiced_at),
    paidAt: str(r.paid_at),
    paymentReference: str(r.payment_reference),
    createdAt: String(r.created_at),
  };
}

/* ------------------------------------------------------------------ */
/* Creating                                                            */
/* ------------------------------------------------------------------ */

/** The client, as the default for every party (the coordinator changes who differs). */
function clientParty(customer: Row, name: string): WorkPartyValue {
  return {
    name: str(customer.customerName) ?? name ?? "Client",
    role: "owner",
    email: str(customer.customerEmail),
    phone: str(customer.customerPhone),
  };
}

export async function createAdditionalWork(admin: Admin, input: AdditionalWorkCreateInput, actor: Actor, config: AmcConfig) {
  const { data: contract, error: cError } = await admin
    .from("amc_contracts")
    .select("id, status, customer_name, customer, contract_number, proposal_number")
    .eq("id", input.contractId)
    .maybeSingle<Row>();
  if (cError) throw fail(cError);
  if (!contract) throw new ContractError("Contract not found.", 404);
  if (input.source === "visit") {
    const { data: v } = await admin.from("amc_visits").select("contract_id").eq("id", String(input.visitId)).maybeSingle<Row>();
    if (!v || String(v.contract_id) !== input.contractId) throw new ContractError("That visit is not on this contract.", 400);
  }
  if (input.source === "call_out") {
    const { data: co, error } = await admin.from("amc_call_outs").select("contract_id").eq("id", String(input.callOutId)).maybeSingle<Row>();
    if (error) throw fail(error);
    if (!co || String(co.contract_id) !== input.contractId) throw new ContractError("That call out is not on this contract.", 400);
  }
  const client = clientParty((contract.customer ?? {}) as Row, String(contract.customer_name ?? ""));
  const partyRow = Object.fromEntries(WORK_PARTIES.map((p) => [PARTY_COLUMNS[p], input.parties[p] ?? client]));
  const { data, error } = await admin
    .from("amc_additional_works")
    .insert({
      contract_id: input.contractId,
      source: input.source,
      visit_id: input.source === "visit" ? input.visitId : null,
      call_out_id: input.source === "call_out" ? input.callOutId : null,
      technician_id: input.technicianId,
      trade: input.trade ?? null,
      finding: input.finding,
      risk: input.risk,
      ...partyRow,
      material_fee_percent: config.additionalWork.materialHandlingFeePercent,
      created_by: actor.id,
    })
    .select("id, work_no")
    .single<Row>();
  if (error) throw fail(error);
  await recordAmcAudit(admin, {
    entityType: "additional_work",
    entityId: String(data.id),
    eventType: "additional_work_identified",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { contractId: input.contractId, source: input.source, risk: input.risk },
  });
  return { id: String(data.id), workNo: String(data.work_no) };
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export async function listAdditionalWorks(admin: Admin, filter: { contractId?: string | null; callOutId?: string | null; visitId?: string | null; ownerId?: string | null }) {
  let q = admin.from("amc_additional_works").select(WORK_COLUMNS).order("created_at", { ascending: false }).limit(500);
  if (filter.contractId) q = q.eq("contract_id", filter.contractId);
  if (filter.callOutId) q = q.eq("call_out_id", filter.callOutId);
  if (filter.visitId) q = q.eq("visit_id", filter.visitId);
  const { data, error } = await q;
  if (error) {
    if (notMigrated(error)) return { migrated: false, works: [] as AdditionalWorkRecord[] };
    throw fail(error);
  }
  let works = ((data ?? []) as unknown as Row[]).map(mapWork);
  if (filter.ownerId) works = works.filter((w) => w.ownerId === filter.ownerId);
  return { migrated: true, works };
}

async function loadWork(admin: Admin, id: string): Promise<Row> {
  const { data, error } = await admin.from("amc_additional_works").select(WORK_COLUMNS).eq("id", id).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Additional work not found.", 404);
  return data;
}

export async function additionalWorkOwner(admin: Admin, id: string): Promise<{ found: boolean; ownerId: string | null }> {
  const { data } = await admin
    .from("amc_additional_works")
    .select("id, contract:amc_contracts!amc_additional_works_contract_id_fkey(submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id))")
    .eq("id", id)
    .maybeSingle<Row>();
  if (!data) return { found: false, ownerId: null };
  return { found: true, ownerId: str(one(one(data.contract)?.submission)?.owner_id) };
}

export async function additionalWorkDetail(admin: Admin, id: string) {
  const work = mapWork(await loadWork(admin, id));
  return { work, photos: await workPhotos(admin, { additionalWorkId: id }) };
}

/** Totals per stage for contracts (DEV-407 roll-up to the contract and the client). */
export interface WorkRollup {
  count: number;
  quoted: number;
  approved: number;
  rejected: number;
  invoiced: number;
  paid: number;
}

export async function additionalWorkRollup(admin: Admin, contractIds: string[]): Promise<WorkRollup> {
  const empty: WorkRollup = { count: 0, quoted: 0, approved: 0, rejected: 0, invoiced: 0, paid: 0 };
  if (!contractIds.length) return empty;
  const { data, error } = await admin.from("amc_additional_works").select("status, total").in("contract_id", contractIds);
  if (error) return empty;
  const r = { ...empty };
  for (const w of (data ?? []) as Row[]) {
    const total = Number(w.total ?? 0);
    const s = String(w.status);
    r.count += 1;
    if (["shared", "approved", "scheduled", "completed", "invoiced", "paid"].includes(s)) r.quoted += total;
    if (["approved", "scheduled", "completed", "invoiced", "paid"].includes(s)) r.approved += total;
    if (s === "rejected") r.rejected += total;
    if (["invoiced", "paid"].includes(s)) r.invoiced += total;
    if (s === "paid") r.paid += total;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { count: r.count, quoted: round(r.quoted), approved: round(r.approved), rejected: round(r.rejected), invoiced: round(r.invoiced), paid: round(r.paid) };
}

/** The client's roll-up: every contract of the client (Snagging client id). */
export async function clientWorkRollup(admin: Admin, customerId: string): Promise<WorkRollup> {
  const { data } = await admin.from("amc_contracts").select("id").eq("customer_id", customerId);
  return additionalWorkRollup(admin, ((data ?? []) as Row[]).map((c) => String(c.id)));
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function moveTo(admin: Admin, row: Row, to: AdditionalWorkStatus, changes: Row, actor: Actor, reason: string | null = null) {
  const from = row.status as AdditionalWorkStatus;
  if (!canMoveWork(from, to)) {
    throw new ContractError(`${String(row.work_no)} is ${ADDITIONAL_WORK_STATUS_LABELS[from].toLowerCase()}: it cannot be ${ADDITIONAL_WORK_STATUS_LABELS[to].toLowerCase()} now.`, 409);
  }
  const { data, error } = await admin
    .from("amc_additional_works")
    .update({ ...changes, status: to, updated_at: new Date().toISOString() })
    .eq("id", String(row.id))
    .eq("status", from)
    .select("id");
  if (error) throw fail(error);
  if (!data?.length) throw new ContractError("Someone else changed this additional work. Reload and try again.", 409);
  await recordStatusChange(admin, { entityType: "additional_work", entityId: String(row.id), from, to, reason, actor, details: { total: Number(changes.total ?? row.total ?? 0) } });
}

/** The call out the work came from follows: quoted once shared, resolved once all its work is done. */
async function followCallOut(admin: Admin, callOutId: string | null, actor: Actor) {
  if (!callOutId) return;
  const { data: co } = await admin.from("amc_call_outs").select("id, status").eq("id", callOutId).maybeSingle<Row>();
  if (!co) return;
  const { data: works } = await admin.from("amc_additional_works").select("status").eq("call_out_id", callOutId);
  const statuses = ((works ?? []) as Row[]).map((w) => String(w.status));
  const from = String(co.status);
  let to: string | null = null;
  if (from === "pending_works" && statuses.some((s) => s !== "identified" && s !== "quotation_prepared")) to = "quoted";
  if ((from === "quoted" || from === "pending_works") && statuses.length && statuses.every((s) => s === "completed" || s === "invoiced" || s === "paid")) to = "resolved";
  if (!to) return;
  const { data } = await admin
    .from("amc_call_outs")
    .update({ status: to, ...(to === "resolved" ? { resolved_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() })
    .eq("id", callOutId)
    .eq("status", from)
    .select("id");
  if (data?.length) await recordStatusChange(admin, { entityType: "call_out", entityId: callOutId, from, to, reason: "Additional work", actor, origin: "system" });
}

export async function performWorkAction(admin: Admin, id: string, action: AdditionalWorkAction, actor: Actor, config: AmcConfig) {
  const row = await loadWork(admin, id);
  const status = row.status as AdditionalWorkStatus;
  const now = new Date().toISOString();
  switch (action.action) {
    case "update": {
      if (status === "paid" || status === "rejected") throw new ContractError("A paid or rejected additional work is kept as it is.", 409);
      const changes: Row = { updated_at: now };
      if (action.finding !== undefined) changes.finding = action.finding;
      if (action.risk !== undefined) changes.risk = action.risk;
      if (action.trade !== undefined) changes.trade = action.trade;
      if (action.technicianId !== undefined) changes.technician_id = action.technicianId;
      if (action.parties) for (const p of WORK_PARTIES) if (action.parties[p] !== undefined) changes[PARTY_COLUMNS[p]] = action.parties[p];
      const { error } = await admin.from("amc_additional_works").update(changes).eq("id", id);
      if (error) throw fail(error);
      return { ok: true as const };
    }
    case "quote": {
      const totals = quotationTotals(action.lines, Number(row.material_fee_percent ?? config.additionalWork.materialHandlingFeePercent));
      await moveTo(
        admin,
        row,
        "quotation_prepared",
        {
          quotation_lines: action.lines,
          labour_total: totals.labourTotal,
          material_total: totals.materialTotal,
          material_fee: totals.materialFee,
          subtotal: totals.subtotal,
          vat_amount: totals.vatAmount,
          total: totals.total,
          quoted_at: now,
        },
        actor,
      );
      return { ok: true as const, totals };
    }
    case "share": {
      if (!canMoveWork(status, "shared")) throw new ContractError(`${String(row.work_no)} is ${ADDITIONAL_WORK_STATUS_LABELS[status].toLowerCase()}: prepare the quotation first.`, 409);
      const sent = await shareQuotation(admin, row, actor);
      await moveTo(admin, row, "shared", { shared_at: now }, actor);
      await followCallOut(admin, str(row.call_out_id), actor);
      const owner = str(one(one(row.contract)?.submission)?.owner_id);
      if (owner) {
        await notifyUsers(admin, {
          event: "additional_work_awaiting_approval",
          userIds: [owner],
          title: `Quotation awaiting client approval: ${String(row.work_no)}`,
          body: `${String(one(row.contract)?.customer_name ?? "")}: AED ${money(Number(row.total ?? 0))}.`,
          link: `/extensions/amc-contracts/additional-works?open=${id}`,
          entityType: "additional_work",
          entityId: id,
          contractId: String(row.contract_id),
          dedupeKey: `additional_work_awaiting_approval:${id}:${String(row.quoted_at ?? "")}`,
        });
      }
      return { ok: true as const, ...sent };
    }
    case "approve":
      await moveTo(admin, row, "approved", { approved_at: now, approval_evidence: `${action.evidence}${action.approvedBy ? ` (approved by ${action.approvedBy})` : ""}` }, actor);
      return { ok: true as const };
    case "reject":
      await moveTo(admin, row, "rejected", { rejected_at: now, rejection_reason: action.reason }, actor, action.reason);
      return { ok: true as const };
    case "schedule":
      await moveTo(admin, row, "scheduled", { scheduled_for: action.date }, actor);
      return { ok: true as const };
    case "complete":
      await moveTo(admin, row, "completed", { completed_at: action.completedAt ?? now }, actor);
      await followCallOut(admin, str(row.call_out_id), actor);
      return { ok: true as const };
    case "invoice":
      await moveTo(admin, row, "invoiced", { invoice_number: action.invoiceNumber, invoiced_at: action.invoicedAt ?? now }, actor);
      return { ok: true as const };
    case "pay":
      await moveTo(admin, row, "paid", { paid_at: action.paidAt ?? now, payment_reference: action.reference }, actor);
      return { ok: true as const };
  }
}

/** Settled work no longer holds its call out open. */
export const isSettled = (s: AdditionalWorkStatus) => (SETTLED_ADDITIONAL_WORK as readonly string[]).includes(s);

/* ------------------------------------------------------------------ */
/* The quotation document and its sending                              */
/* ------------------------------------------------------------------ */

function quotationHtml(w: AdditionalWorkRecord): string {
  const rows = w.quotationLines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.description)}</td><td>${l.kind === "labour" ? "Labour" : "Material"}</td><td class="n">${l.quantity}</td><td class="n">${money(l.unitPrice)}</td><td class="n">${money(Math.round(l.quantity * l.unitPrice * 100) / 100)}</td></tr>`,
    )
    .join("");
  const party = (p: WorkParty) => {
    const v = w.parties[p];
    return v ? `<tr><th>${WORK_PARTY_LABELS[p]}</th><td>${escapeHtml(v.name)}${v.email ? ` · ${escapeHtml(v.email)}` : ""}${v.phone ? ` · ${escapeHtml(v.phone)}` : ""}</td></tr>` : "";
  };
  return `<!doctype html><html><head><meta charset="utf-8"><title>Quotation ${escapeHtml(w.workNo)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:32px;font-size:12px}
    h1{font-size:20px;margin:0 0 4px;color:#8b1d2c} h2{font-size:14px;margin:20px 0 6px;color:#8b1d2c}
    .muted{color:#6b7280} table{border-collapse:collapse;width:100%} th{text-align:left;color:#6b7280;font-weight:normal;padding:4px 8px 4px 0;vertical-align:top;width:30%}
    td{padding:4px 8px 4px 0;vertical-align:top} .grid th,.grid td{border-bottom:1px solid #e5e7eb;padding:6px 8px;width:auto} .n{text-align:right}
    .totals td{padding:3px 8px} .totals .n{width:120px} .grand td{font-weight:bold;border-top:1px solid #1f2937}
  </style></head><body>
    <h1>Quotation ${escapeHtml(w.workNo)}</h1>
    <div class="muted">Yalla Fix It · additional work under AMC ${escapeHtml(w.contractNumber)} · ${new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Dubai" })}</div>
    <h2>Property</h2><table><tr><th>Client</th><td>${escapeHtml(w.customerName)}</td></tr><tr><th>Property</th><td>${escapeHtml(w.propertyLabel)}</td></tr></table>
    <h2>What was found</h2><p>${escapeHtml(w.finding)}</p><p class="muted">Risk: ${WORK_RISK_LABELS[w.risk]}${w.callOutNo ? ` · found on call out ${escapeHtml(w.callOutNo)}` : w.visitNo ? ` · found on PPM visit ${w.visitNo}` : ""}</p>
    <h2>Quotation</h2>
    <table class="grid"><tr><th>Item</th><th>Type</th><th class="n">Qty</th><th class="n">Unit (AED)</th><th class="n">Amount (AED)</th></tr>${rows}</table>
    <table class="totals" style="margin-top:8px;width:auto;margin-left:auto">
      <tr><td>Labour</td><td class="n">${money(w.totals.labourTotal)}</td></tr>
      <tr><td>Materials</td><td class="n">${money(w.totals.materialTotal)}</td></tr>
      <tr><td>Material handling (${w.materialFeePercent}%)</td><td class="n">${money(w.totals.materialFee)}</td></tr>
      <tr><td>Subtotal</td><td class="n">${money(w.totals.subtotal)}</td></tr>
      <tr><td>VAT</td><td class="n">${money(w.totals.vatAmount)}</td></tr>
      <tr class="grand"><td>Total</td><td class="n">AED ${money(w.totals.total)}</td></tr>
    </table>
    <h2>Parties</h2><table>${WORK_PARTIES.map(party).join("")}</table>
    <p class="muted" style="margin-top:24px">This work is outside the AMC scope. To approve, reply to this email or message your coordinator.</p>
  </body></html>`;
}

async function shareQuotation(admin: Admin, row: Row, actor: Actor) {
  const w = mapWork(row);
  if (!w.quotationLines.length) throw new ContractError("Prepare the quotation before sharing it.", 409);
  const html = quotationHtml(w);
  const pdf = await renderPdf(html);
  const bytes = pdf ?? new TextEncoder().encode(html);
  const ext = pdf ? "pdf" : "html";
  const mime = pdf ? "application/pdf" : "text/html";
  const documentId = randomUUID();
  const path = `documents/contract/${w.contractId}/${documentId}.${ext}`;
  const { error: upload } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (upload) throw new ContractError(`Could not store the quotation: ${upload.message}`, 500);
  const title = `Quotation ${w.workNo}`;
  const { data: versions } = await admin.from("amc_documents").select("version").eq("level", "contract").eq("entity_id", w.contractId).eq("title", title);
  const version = Math.max(0, ...((versions ?? []) as Row[]).map((v) => Number(v.version))) + 1;
  const contract = one(row.contract) ?? {};
  await admin.from("amc_documents").insert({
    id: documentId,
    level: "contract",
    entity_id: w.contractId,
    customer_id: str(contract.customer_id),
    category: "Additional work quotation",
    title,
    version,
    storage_path: path,
    file_name: `quotation-${w.workNo}.${ext}`,
    mime_type: mime,
    size_bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    uploaded_by: actor.id,
  });

  const approver = w.parties.approver;
  const to = approver?.email ?? null;
  const cc = [...new Set([w.parties.payer?.email, w.parties.invoiceRecipient?.email].filter((e): e is string => Boolean(e) && e !== to))];
  const intro = `Our technician found the following at ${w.propertyLabel}: ${w.finding}`;
  let outcome: "sent" | "failed" | "no_recipient" = "no_recipient";
  if (to) {
    try {
      await sendEmail({
        to,
        ...(cc.length ? { cc } : {}),
        subject: `Yalla Fix It quotation ${w.workNo} for ${w.propertyLabel}`,
        html: clientEmailHtml({
          eyebrow: "AMC additional work",
          heading: `Quotation ${w.workNo}`,
          greeting: `Dear ${approver?.name ?? w.customerName},`,
          paragraphs: [
            escapeEmailHtml(intro),
            escapeEmailHtml(`This work is outside your AMC. The quotation is attached: AED ${money(w.totals.total)} including VAT (materials carry a ${w.materialFeePercent}% handling fee).`),
            escapeEmailHtml("To approve, reply to this email or message your coordinator."),
          ],
          details: [
            { label: "Quotation", value: w.workNo },
            { label: "AMC", value: w.contractNumber },
            { label: "Total", value: `AED ${money(w.totals.total)}` },
          ],
        }),
        ...(pdf ? { attachment: { filename: `quotation-${w.workNo}.pdf`, content: Buffer.from(pdf).toString("base64"), contentType: "application/pdf" } } : {}),
      });
      outcome = "sent";
    } catch (e) {
      outcome = "failed";
      console.error("[amc:additional-works] quotation email failed:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }
  const { data: link } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrl(path, 14 * 86_400);
  const message = `Dear ${approver?.name ?? w.customerName}, our technician found: ${w.finding.slice(0, 300)}. Quotation ${w.workNo}: AED ${money(w.totals.total)} incl. VAT${link?.signedUrl ? `: ${link.signedUrl}` : ""}. Please reply to approve.`;
  const submissionId = str(one(contract.submission)?.id);
  if (submissionId) {
    await recordSend(admin, {
      submissionId,
      versionNo: 1,
      document: "additional_work_quotation",
      channel: "email",
      recipients: to ? [{ name: approver?.name ?? "", address: to }] : [],
      cc,
      outcome,
      detail: `Quotation ${w.workNo}`,
      sentBy: actor.id,
    });
  }
  const phone = approver?.phone ?? null;
  return { outcome, documentId, message, whatsapp: phone ? whatsappUrl(phone, message) : null };
}
