import type { SupabaseClient } from "@supabase/supabase-js";

import { whatsappUrl } from "@/lib/amc/approval-ladder";
import { todayInDubai } from "@/lib/amc/contracts";
import { FIELD_STARTABLE, fieldStartProblems, type ClientConfirmation, type FieldStartKind } from "@/lib/amc/field-start";
import { initialOutcome, type SendChannel, type SendResult } from "@/lib/amc/send-channels";
import { accessFromPasses, type AccessStatus } from "@/lib/amc/visits";
import { chargeOpen, type PaymentTimingInput, type VisitCharge } from "@/lib/amc/visit-charges";
import { readCharge, setPaymentTiming, syncWorkCharge } from "@/lib/server/amc/visit-charges";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { additionalWorkDetail } from "@/lib/server/amc/additional-works";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError } from "@/lib/server/amc/contracts";
import { recordSend } from "@/lib/server/amc/proposal-share";
import { accessRuleView, readPasses, writePassType, type AccessRuleView, type PassView } from "@/lib/server/amc/visits";
import { sendEmail } from "@/lib/server/send-email";

/*
  A call out's and an additional work's access, start and (additional work)
  client confirmation (17 Nov 2026), managed as a planned visit's: the
  property's access rules, the record's own gate passes and the property's,
  the access status worked out from them for the visit day, and Start visit
  once the checklist is complete. Before 20261117130000 the columns are
  missing: everything reads, nothing new can be saved (ready: false).
*/

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

const TABLE: Record<FieldStartKind, string> = { call_out: "amc_call_outs", additional_work: "amc_additional_works" };
const BASE: Record<FieldStartKind, string> = {
  call_out: "id, call_out_no, contract_id, status, priority, coverage, scheduled_start, scheduled_end, technician_ids, reported_at",
  additional_work: "id, work_no, contract_id, status, scheduled_start, scheduled_end, scheduled_for, technician_ids, created_at",
};
const EXTRA: Record<FieldStartKind, string> = {
  call_out: "access_status, access_valid_until, access_document_id, started_at",
  additional_work: "access_status, access_valid_until, access_document_id, started_at, client_confirmation, confirmed_at, confirmation_channel, confirmation_note",
};
const NOUN: Record<FieldStartKind, string> = { call_out: "call out", additional_work: "additional work" };
const NOT_READY = "This needs the database update 20261117130000 first.";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
const missingColumns = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === "42703" || e.code === "PGRST204" || /access_status|started_at|client_confirmation/.test(e.message ?? "")));
const fail = (e: { message: string }) => new ContractError(e.message, 500);

async function loadRow(admin: Admin, kind: FieldStartKind, id: string): Promise<{ row: Row; ready: boolean }> {
  const read = (columns: string) => admin.from(TABLE[kind]).select(columns).eq("id", id).maybeSingle<Row>();
  let ready = true;
  let { data, error } = await read(`${BASE[kind]}, ${EXTRA[kind]}`);
  if (missingColumns(error)) {
    ready = false;
    ({ data, error } = await read(BASE[kind]));
  }
  if (error) throw fail(error);
  if (!data) throw new ContractError(kind === "call_out" ? "Call out not found." : "Additional work not found.", 404);
  return { row: data, ready };
}

/** The day access is judged for: the slot's day in Dubai, else the day planned, else today. */
function visitDay(kind: FieldStartKind, row: Row): string {
  const start = str(row.scheduled_start);
  if (start) return todayInDubai(new Date(start));
  if (kind === "additional_work" && str(row.scheduled_for)) return String(row.scheduled_for);
  if (kind === "call_out" && str(row.reported_at)) return todayInDubai(new Date(String(row.reported_at)));
  return todayInDubai();
}

export interface FieldAccessView {
  kind: FieldStartKind;
  ref: string;
  status: string;
  priority: string | null;
  technicianIds: string[];
  scheduledStart: string | null;
  scheduledEnd: string | null;
  contractActive: boolean;
  /** False until 20261117130000: nothing new can be saved. */
  ready: boolean;
  passTypes: boolean;
  propertyId: string | null;
  day: string;
  accessRules: AccessRuleView[];
  passes: PassView[];
  accessStatus: AccessStatus;
  accessValidUntil: string | null;
  startedAt: string | null;
  startable: boolean;
  clientConfirmation: ClientConfirmation | null;
  confirmedAt: string | null;
  confirmationChannel: string | null;
  confirmationNote: string | null;
  /** A call out's coverage (covered or chargeable). */
  coverage: string | null;
  /** What it costs the client and its payment (18 Nov 2026); null when none yet. */
  charge: VisitCharge | null;
  /** False before migration 20261118130000 (no charges then). */
  chargeReady: boolean;
  /** Its job sheet's state (draft, submitted, returned, closed), or null when there is none yet (18 Nov 2026). */
  sheetStatus: string | null;
}

/**
 * The record's access as its passes say today, written back while it is
 * not started (a pass that ran out, or a new slot, is caught when shown).
 */
export async function fieldAccess(admin: Admin, kind: FieldStartKind, id: string): Promise<FieldAccessView> {
  const { row, ready } = await loadRow(admin, kind, id);
  const { data: contract } = await admin.from("amc_contracts").select("property_id, status").eq("id", String(row.contract_id)).maybeSingle<Row>();
  const propertyId = str(contract?.property_id);
  const [{ data: rules, error }, own, onProperty] = await Promise.all([
    propertyId
      ? admin
          .from("amc_property_access_rules")
          .select("id, access_type, issuer, lead_time_days, permitted_days, permitted_from, permitted_to, parking, contact_name, contact_phone, notes")
          .eq("property_id", propertyId)
          .eq("active", true)
      : Promise.resolve({ data: [] as Row[], error: null }),
    readPasses(admin, kind, [id]),
    readPasses(admin, "property", propertyId ? [propertyId] : []),
  ]);
  if (error) throw fail(error);
  const accessRules = ((rules ?? []) as Row[]).map(accessRuleView);
  const passes = [...own.passes, ...onProperty.passes];
  const day = visitDay(kind, row);
  const live = accessFromPasses(
    passes.map((p) => ({ id: p.id, validUntil: p.expiresOn, uploadedAt: p.uploadedAt, status: p.accessStatus })),
    day,
    accessRules.length > 0,
  );
  const startedAt = str(row.started_at);
  if (ready && !startedAt && (live.status !== row.access_status || live.validUntil !== str(row.access_valid_until) || live.documentId !== str(row.access_document_id))) {
    await admin.from(TABLE[kind]).update({ access_status: live.status, access_valid_until: live.validUntil, access_document_id: live.documentId }).eq("id", id);
  }
  const status = String(row.status);
  /* The work's charge follows its quotation; a call out's is its services. */
  if (kind === "additional_work") await syncWorkCharge(admin, id, { id: null, label: null }).catch(() => null);
  const [{ charge, ready: chargeReady }, sheetRead] = await Promise.all([
    readCharge(admin, kind, id),
    admin.from("amc_visit_job_sheets").select("status").eq(kind === "call_out" ? "call_out_id" : "additional_work_id", id).maybeSingle<Row>(),
  ]);
  const sheetStatus = sheetRead.error ? null : str(sheetRead.data?.status);
  return {
    kind,
    coverage: str(row.coverage),
    charge,
    chargeReady,
    sheetStatus,
    ref: String(kind === "call_out" ? row.call_out_no : row.work_no),
    status,
    priority: str(row.priority),
    technicianIds: strings(row.technician_ids),
    scheduledStart: str(row.scheduled_start),
    scheduledEnd: str(row.scheduled_end),
    contractActive: contract?.status === "active",
    ready,
    passTypes: own.typed && onProperty.typed,
    propertyId,
    day,
    accessRules,
    passes,
    accessStatus: live.status,
    accessValidUntil: live.validUntil,
    startedAt,
    startable: ready && !startedAt && FIELD_STARTABLE[kind].includes(status),
    clientConfirmation: (str(row.client_confirmation) as ClientConfirmation | null) ?? null,
    confirmedAt: str(row.confirmed_at),
    confirmationChannel: str(row.confirmation_channel),
    confirmationNote: str(row.confirmation_note),
  };
}

/** Whether the record was started by the office (true before 20261117130000, so nothing is blocked then). */
export async function fieldWorkStarted(admin: Admin, kind: FieldStartKind, id: string): Promise<boolean> {
  const { data, error } = await admin.from(TABLE[kind]).select("started_at").eq("id", id).maybeSingle<Row>();
  if (missingColumns(error)) return true;
  if (error) throw fail(error);
  return Boolean(str(data?.started_at));
}

/** What the checklist says about the charge: services still to pick, and the payment with the choice made in the dialog. */
export function chargeFacts(v: Pick<FieldAccessView, "kind" | "coverage" | "charge" | "chargeReady">, payment: PaymentTimingInput | null) {
  const servicesMissing = v.chargeReady && v.kind === "call_out" && v.coverage === "chargeable" && (!v.charge || v.charge.lines.length === 0);
  const due = chargeOpen(v.charge) || v.charge?.status === "paid";
  return {
    servicesMissing,
    payment: due ? { paid: v.charge?.status === "paid", timing: payment?.timing ?? v.charge?.paymentTiming ?? null, reason: payment?.reason ?? v.charge?.paymentTimingReason ?? null } : null,
  };
}

/** Start visit: the checklist again on the server, then started once; the payment's timing is kept on the charge. */
export async function startFieldWork(admin: Admin, kind: FieldStartKind, id: string, actor: Actor, payment: PaymentTimingInput | null = null) {
  const v = await fieldAccess(admin, kind, id);
  if (!v.ready) throw new ContractError(NOT_READY, 503);
  if (v.startedAt) throw new ContractError(`This ${NOUN[kind]} was already started.`, 409);
  if (!FIELD_STARTABLE[kind].includes(v.status)) throw new ContractError(`This ${NOUN[kind]} is ${v.status.replace(/_/g, " ")}: it cannot be started.`, 409);
  if (!v.contractActive) throw new ContractError("The contract is not active, so its work cannot start.", 409);
  const problems = fieldStartProblems({
    kind,
    priority: v.priority,
    technicianIds: v.technicianIds,
    scheduledStart: v.scheduledStart,
    scheduledEnd: v.scheduledEnd,
    clientConfirmation: v.clientConfirmation,
    accessStatus: v.accessStatus,
    ...chargeFacts(v, payment),
  });
  if (problems.length) throw new ContractError(`Before starting: ${problems.map((p) => p.text.replace(/\.$/, "").toLowerCase()).join("; ")}.`, 400);
  /* Before or after the visit, with the reason for after, kept on the charge. */
  if (v.charge && chargeOpen(v.charge) && payment) await setPaymentTiming(admin, v.charge.id, payment, actor);
  else if (v.charge?.status === "paid") await setPaymentTiming(admin, v.charge.id, { timing: "before_visit", reason: null }, actor);
  const now = new Date().toISOString();
  const { data, error } = await admin.from(TABLE[kind]).update({ started_at: now, started_by: actor.id }).eq("id", id).is("started_at", null).select("id");
  if (error) throw fail(error);
  if (!data?.length) throw new ContractError("This changed a moment ago. Refresh the page.", 409);
  await recordAmcAudit(admin, { entityType: kind, entityId: id, eventType: `${kind}_started`, actorId: actor.id, actorLabel: actor.label, payload: { ref: v.ref } });
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/* Passes                                                              */
/* ------------------------------------------------------------------ */

async function ownPass(admin: Admin, kind: FieldStartKind, id: string, documentId: string) {
  const { data } = await admin.from("amc_documents").select("id, level, entity_id, category, superseded_by").eq("id", documentId).maybeSingle<Row>();
  if (!data || data.level !== kind || String(data.entity_id) !== id || data.category !== "Gate pass" || data.superseded_by) {
    throw new ContractError(`That pass is not on this ${NOUN[kind]}.`, 404);
  }
}

export async function saveFieldPass(
  admin: Admin,
  kind: FieldStartKind,
  id: string,
  input: { documentId: string; validUntil: string | null; note: string | null; accessRuleId?: string | null; accessStatus?: AccessStatus },
  actor: Actor,
) {
  await ownPass(admin, kind, id, input.documentId);
  const { error } = await admin.from("amc_documents").update({ expires_on: input.validUntil, notes: input.note || null }).eq("id", input.documentId);
  if (error) throw fail(error);
  const { data: row } = await admin.from(TABLE[kind]).select("contract_id").eq("id", id).maybeSingle<Row>();
  const { data: contract } = await admin.from("amc_contracts").select("property_id").eq("id", String(row?.contract_id)).maybeSingle<Row>();
  await writePassType(admin, input.documentId, { accessRuleId: input.accessRuleId, accessStatus: input.accessStatus }, str(contract?.property_id));
  await recordAmcAudit(admin, { entityType: kind, entityId: id, eventType: "pass_updated", actorId: actor.id, actorLabel: actor.label, payload: { documentId: input.documentId, status: input.accessStatus ?? null } });
  return fieldAccess(admin, kind, id);
}

export async function removeFieldPass(admin: Admin, kind: FieldStartKind, id: string, documentId: string, actor: Actor) {
  await ownPass(admin, kind, id, documentId);
  /* Taken out of use, the file kept: marked as replaced by itself, so every list leaves it out. */
  const { error } = await admin.from("amc_documents").update({ superseded_by: documentId }).eq("id", documentId);
  if (error) throw fail(error);
  await recordAmcAudit(admin, { entityType: kind, entityId: id, eventType: "pass_removed", actorId: actor.id, actorLabel: actor.label, payload: { documentId } });
  return fieldAccess(admin, kind, id);
}

/* ------------------------------------------------------------------ */
/* Additional work: the client confirms the day                        */
/* ------------------------------------------------------------------ */

/** Recorded by the office: the client confirmed (or declined) the slot, and how. */
export async function confirmWork(admin: Admin, id: string, input: { outcome: ClientConfirmation; channel: string | null; note: string | null }, actor: Actor) {
  const v = await fieldAccess(admin, "additional_work", id);
  if (!v.ready) throw new ContractError(NOT_READY, 503);
  if (v.startedAt) throw new ContractError("The work has started: its confirmation is kept as it is.", 409);
  const { error } = await admin
    .from("amc_additional_works")
    .update({
      client_confirmation: input.outcome,
      confirmed_at: input.outcome === "confirmed" ? new Date().toISOString() : null,
      confirmation_channel: input.channel,
      confirmation_note: input.note,
    })
    .eq("id", id);
  if (error) throw fail(error);
  await recordAmcAudit(admin, { entityType: "additional_work", entityId: id, eventType: "work_confirmation", actorId: actor.id, actorLabel: actor.label, payload: { outcome: input.outcome, channel: input.channel } });
  return { ok: true as const };
}

/** Asks the client to confirm the slot: emailed, or the text for WhatsApp or to copy. */
export async function requestWorkConfirmation(admin: Admin, id: string, channel: SendChannel, actor: Actor): Promise<SendResult & { ok: true }> {
  const v = await fieldAccess(admin, "additional_work", id);
  if (!v.ready) throw new ContractError(NOT_READY, 503);
  if (!v.scheduledStart) throw new ContractError("Set the date and time first, then ask the client to confirm them.", 400);
  const { work } = await additionalWorkDetail(admin, id);
  const who = work.parties.approver ?? work.parties.payer ?? null;
  const name = who?.name ?? work.customerName ?? "customer";
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(v.scheduledStart));
  const message = `Dear ${name}, we would like to carry out the approved work ${work.workNo} at ${work.propertyLabel} on ${when}. Please reply to confirm this time, or tell us one that suits you better. Yalla Fix It`;
  const to = who?.email ?? null;
  const phone = who?.phone ?? null;
  let outcome = initialOutcome(channel);
  if (channel === "email" && to) {
    try {
      await sendEmail({
        to,
        subject: `Yalla Fix It: please confirm the visit for ${work.workNo}`,
        html: clientEmailHtml({ eyebrow: "AMC additional work", heading: "Please confirm the visit", paragraphs: [escapeEmailHtml(message)], details: [{ label: "Work", value: work.workNo }, { label: "When", value: when }] }),
      });
      outcome = "sent";
    } catch (e) {
      outcome = "failed";
      console.error("[amc:field-access] confirmation email failed:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }
  if (outcome !== "failed" && outcome !== "no_recipient" && v.clientConfirmation !== "confirmed") {
    await admin.from("amc_additional_works").update({ client_confirmation: "pending" }).eq("id", id);
  }
  const { data: contract } = await admin.from("amc_additional_works").select("contract:amc_contracts(submission_id)").eq("id", id).maybeSingle<Row>();
  const c = (Array.isArray(contract?.contract) ? contract?.contract[0] : contract?.contract) as Row | undefined;
  const submissionId = str(c?.submission_id);
  if (submissionId) {
    await recordSend(admin, {
      submissionId,
      versionNo: 1,
      document: "visit_confirmation",
      channel,
      recipients: channel === "email" ? (to ? [{ name, address: to }] : []) : channel === "whatsapp" && phone ? [{ name, address: phone }] : [],
      outcome,
      detail: `Additional work ${work.workNo}`,
      sentBy: actor.id,
    });
  }
  return { ok: true, outcome, message, whatsapp: phone ? whatsappUrl(phone, message) : null, link: null };
}
