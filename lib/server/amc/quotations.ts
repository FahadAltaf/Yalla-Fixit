import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fillTemplate, whatsappUrl } from "@/lib/amc/approval-ladder";
import { templateText } from "@/lib/amc/message-templates";
import { readAmcConfig } from "@/lib/server/amc/config";
import type { ChargeLine } from "@/lib/amc/visit-charges";
import type { SendChannel } from "@/lib/amc/send-channels";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError, tidyPropertyLabel } from "@/lib/server/amc/contracts";
import { setFsmQuotation } from "@/lib/server/amc/fsm-quotation";
import { notifyUsers } from "@/lib/server/amc/notifications";
import { draftWorkCharge, readCharge } from "@/lib/server/amc/visit-charges";
import { hashLinkToken, linkTokenExpiry, mintLinkToken } from "@/lib/server/link-token";
import { sendEmail } from "@/lib/server/send-email";
import { fsmClientWritesReady, putClientInFsm } from "@/lib/server/snagging/fsm-clients";
import {
  createEstimate,
  estimateAddress,
  quotationAddress,
  serviceLineItems,
  serviceTaxes,
  transition,
} from "@/lib/server/snagging/fsm-quotation-sync";
import { fsmFetch, fsmGetRecord, getFsmAccessToken } from "@/lib/server/zoho/fsm-client";

/**
 * AMC quotations (27 Nov 2026): a chargeable call out's or an additional
 * work's quotation, made the way Snagging's are.
 *
 *   Generate   the document, from the services and prices already entered
 *              (the call out's charge, the work's quotation lines), frozen
 *              with who and where it is for. In Zoho FSM it is created as an
 *              estimate when FSM takes the portal's changes; the estimate's
 *              number becomes the quotation's number and the record's FSM
 *              quotation number (DEV-508).
 *   Share      a client link (/amc-quote/<token>): Copy link, WhatsApp, or
 *              email with the PDF attached. FSM: Mark as Sent.
 *   Decide     the client approves (with their name) or rejects (with a
 *              reason) on the link. Additional work is approved or rejected
 *              with it; a call out's answer is recorded. The coordinator is
 *              told. FSM: Approve / Reject.
 *
 * The other way stays: the coordinator types the number of a quotation made
 * in FSM (setFsmQuotation). The small call out (no parts, under two hours)
 * still needs no quotation before the visit (DEV-407).
 *
 * Before migration 20261127100000 the table is missing: ready() is false
 * and Generate says the database update is needed.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };
export type AmcQuoteKind = "call_out" | "additional_work";
export type AmcQuoteStatus = "draft" | "sent" | "approved" | "rejected" | "void";

const TABLE = "amc_quotations";
const OWNER_TABLE: Record<AmcQuoteKind, string> = { call_out: "amc_call_outs", additional_work: "amc_additional_works" };
const KIND_LABEL: Record<AmcQuoteKind, string> = { call_out: "Call out", additional_work: "Additional work" };
const LINK_DAYS = 30;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => Number(v ?? 0) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const money = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const missingTable = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /amc_quotations/.test(e.message ?? "")));
export const QUOTATIONS_NOT_READY = "Generating quotations needs the database update 20261127100000. Ask an admin to apply it.";

export interface QuoteLine {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  amount: number;
}

export interface AmcQuotation {
  id: string;
  quoteNumber: string;
  kind: AmcQuoteKind;
  entityId: string;
  contractId: string;
  status: AmcQuoteStatus;
  currency: string;
  lines: QuoteLine[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  scopeOfWork: string | null;
  terms: string | null;
  clientSnapshot: Record<string, unknown>;
  sentAt: string | null;
  sentChannel: string | null;
  linkHint: string | null;
  linkExpiresAt: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  rejectedReason: string | null;
  decidedAt: string | null;
  decidedOrigin: string | null;
  fsmEstimateNumber: string | null;
  fsmStatus: string | null;
  fsmError: string | null;
  voidReason: string | null;
  createdAt: string;
}

function mapQuote(r: Row): AmcQuotation {
  return {
    id: String(r.id),
    quoteNumber: String(r.quote_number),
    kind: r.entity_type as AmcQuoteKind,
    entityId: String(r.entity_id),
    contractId: String(r.contract_id),
    status: r.status as AmcQuoteStatus,
    currency: String(r.currency ?? "AED"),
    lines: (Array.isArray(r.lines) ? r.lines : []) as QuoteLine[],
    subtotal: num(r.subtotal),
    taxRate: num(r.tax_rate),
    taxAmount: num(r.tax_amount),
    total: num(r.total),
    scopeOfWork: str(r.scope_of_work),
    terms: str(r.terms),
    clientSnapshot: (r.client_snapshot ?? {}) as Record<string, unknown>,
    sentAt: str(r.sent_at),
    sentChannel: str(r.sent_channel),
    linkHint: str(r.approval_token_hint),
    linkExpiresAt: str(r.approval_token_expires_at),
    approvedAt: str(r.approved_at),
    approvedByName: str(r.approved_by_name),
    rejectedReason: str(r.rejected_reason),
    decidedAt: str(r.decided_at),
    decidedOrigin: str(r.decided_origin),
    fsmEstimateNumber: str(r.fsm_estimate_number),
    fsmStatus: str(r.fsm_status),
    fsmError: str(r.fsm_error),
    voidReason: str(r.void_reason),
    createdAt: String(r.created_at),
  };
}

/** Lines as the quotation shows them: a free line at no charge, said so. Pure. */
export function quoteLinesFrom(lines: readonly ChargeLine[]): QuoteLine[] {
  return lines.map((l) => {
    const qty = Number(l.units) || 1;
    const unitPrice = l.charged ? round2(Number(l.unitPrice) || 0) : 0;
    return {
      description: l.charged ? l.label : `${l.label} (no charge)`,
      qty,
      unit: l.unit ?? "",
      unit_price: unitPrice,
      amount: round2(qty * unitPrice),
    };
  });
}

/** Whether this server may create quotations in Zoho FSM. */
export function quotationFsmWrites(admin: Admin): Promise<boolean> {
  return fsmClientWritesReady(admin);
}

/** Whether the table is there (migration 20261127100000). */
export async function quotationsReady(admin: Admin): Promise<boolean> {
  const { error } = await admin.from(TABLE).select("id").limit(1);
  return !missingTable(error);
}

/** The latest quotation of a call out or additional work (any status), or null. */
export async function latestQuotation(admin: Admin, kind: AmcQuoteKind, id: string): Promise<AmcQuotation | null> {
  const { data, error } = await admin.from(TABLE).select("*").eq("entity_type", kind).eq("entity_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle<Row>();
  if (error) {
    if (missingTable(error)) return null;
    throw new ContractError(error.message, 500);
  }
  return data ? mapQuote(data) : null;
}

/** What the quotation is built from: the record, its contract, the client and the property. */
async function facts(admin: Admin, kind: AmcQuoteKind, id: string) {
  const cols =
    kind === "call_out"
      ? "id, call_out_no, contract_id, issue, status, on_site_contact_name, on_site_contact_phone"
      : "id, work_no, contract_id, finding, status, approver, payer, invoice_recipient";
  const { data: rec, error } = await admin.from(OWNER_TABLE[kind]).select(cols).eq("id", id).maybeSingle<Row>();
  if (error) throw new ContractError(error.message, 500);
  if (!rec) throw new ContractError(kind === "call_out" ? "Call out not found." : "Additional work not found.", 404);
  const { data: contract } = await admin
    .from("amc_contracts")
    .select("id, contract_number, customer_id, property_id, customer_name, property_label, customer, submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id)")
    .eq("id", String(rec.contract_id))
    .maybeSingle<Row>();
  if (!contract) throw new ContractError("The contract was not found.", 404);
  const customer = (contract.customer ?? {}) as Row;
  const [{ data: client }, { data: property }] = await Promise.all([
    str(contract.customer_id) ? admin.from("snagging_clients").select("id, name, email, phone, fsm_contact_id").eq("id", String(contract.customer_id)).maybeSingle<Row>() : Promise.resolve({ data: null }),
    str(contract.property_id) ? admin.from("snagging_properties").select("id, unit_label, building_name, community, developer_name, property_type, bedrooms, built_up_area_sqft").eq("id", String(contract.property_id)).maybeSingle<Row>() : Promise.resolve({ data: null }),
  ]);
  const approver = kind === "additional_work" ? ((rec.approver ?? null) as Row | null) : null;
  return {
    rec,
    contract,
    client: (client ?? null) as Row | null,
    property: (property ?? null) as Row | null,
    ref: String(kind === "call_out" ? rec.call_out_no : rec.work_no),
    ownerId: str(one(contract.submission as Row | Row[] | null)?.owner_id),
    /* Whom the quotation is addressed to: the work's approver, else the client. */
    recipient: {
      name: str(approver?.name) ?? str(client?.name) ?? str(contract.customer_name) ?? "Client",
      email: str(approver?.email) ?? str(client?.email) ?? str(customer.customerEmail),
      phone: str(approver?.phone) ?? str(client?.phone) ?? str(customer.customerPhone),
    },
    cc:
      kind === "additional_work"
        ? [str((rec.payer as Row | null)?.email), str((rec.invoice_recipient as Row | null)?.email)].filter((e): e is string => Boolean(e))
        : [],
  };
}

/** The charge the quotation prices: a call out's, or the work's quotation (before approval its draft). */
async function chargeFor(admin: Admin, kind: AmcQuoteKind, id: string) {
  const { charge } = await readCharge(admin, kind, id);
  const shown = charge ?? (kind === "additional_work" ? await draftWorkCharge(admin, id) : null);
  if (!shown || !shown.lines.length) throw new ContractError("Add the services and their prices first: they are what the quotation shows.", 409);
  if (!(shown.total > 0)) throw new ContractError("Nothing here is charged: there is nothing to quote.", 409);
  return shown;
}

/**
 * Why Generate quotation cannot run yet (no services, nothing charged), or
 * null when it can, so the card says so instead of offering a button the
 * server refuses (27 Nov 2026).
 */
export async function quotationBlocker(admin: Admin, kind: AmcQuoteKind, id: string): Promise<string | null> {
  try {
    await chargeFor(admin, kind, id);
    return null;
  } catch (error) {
    if (error instanceof ContractError) return error.message;
    throw error;
  }
}

/*
  The scope of work and the terms, from AMC configuration -> Emails and
  messages -> Quotation texts (27 Nov 2026), filled from the work. Fixed in
  the code before, a one-line scope and five short terms.
*/
async function quotationTexts(
  admin: Admin,
  kind: AmcQuoteKind,
  f: Awaited<ReturnType<typeof facts>>,
  lines: ReturnType<typeof quoteLinesFrom>,
): Promise<{ scope: string; terms: string }> {
  const config = await readAmcConfig(admin);
  const property = tidyPropertyLabel(f.contract.property_label) ?? "your property";
  const values = {
    "Work type": KIND_LABEL[kind],
    "Work no": f.ref,
    "Contract no": String(f.contract.contract_number ?? ""),
    Property: property,
    Finding: (kind === "call_out" ? str(f.rec.issue) : str(f.rec.finding)) ?? (kind === "call_out" ? "the reported fault" : "work outside the contract"),
    "Service list": lines.map((l) => `- ${l.description}${l.qty ? ` (${l.qty}${l.unit ? ` ${l.unit}` : ""})` : ""}`).join("\n"),
    "Validity days": LINK_DAYS,
    "Handling fee": config.additionalWork.materialHandlingFeePercent,
  };
  const scope = fillTemplate(templateText("quotationScope", config.templates)?.body ?? "", values);
  const terms = fillTemplate(templateText("quotationTerms", config.templates)?.body ?? "", values);
  return { scope, terms };
}

/* ── FSM ──────────────────────────────────────────────────────────────── */

/*
  The FSM service each line goes under: one for all of them, with the line's
  own description and price (as Snagging does for a line FSM has no item
  for). Found by name once and kept on every quotation it carried, so the
  next one reads it from there.
*/
const SERVICE_NAMES = [/^amc\s+(additional|extra)\s+work$/i, /^amc\s+call[\s-]*outs?$/i, /^various\s+maintenance\s+work$/i];

async function fsmServiceId(admin: Admin, token: string): Promise<string> {
  const fromEnv = (process.env.AMC_FSM_QUOTE_SERVICE_ID ?? "").trim();
  if (fromEnv) return fromEnv;
  const { data } = await admin.from(TABLE).select("fsm_service_id").not("fsm_service_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle<Row>();
  if (str(data?.fsm_service_id)) return String(data!.fsm_service_id);
  const found: Array<{ id: string; name: string }> = [];
  for (let page = 1; page <= 30; page += 1) {
    const res = await fsmFetch(token, `/Service_And_Parts?page=${page}&per_page=200`);
    if (res.status === 204 || !res.ok) break;
    for (const item of (res.json?.data ?? []) as Row[]) {
      if (item.$inactive || (item.Type && !/service/i.test(String(item.Type)))) continue;
      found.push({ id: String(item.id), name: String(item.Name ?? "").trim() });
    }
    if (!res.json?.info?.more_records) break;
  }
  for (const pattern of SERVICE_NAMES) {
    const hit = found.find((s) => pattern.test(s.name));
    if (hit) return hit.id;
  }
  throw new ContractError('Zoho FSM has no service to put the quotation lines under ("AMC Additional Work" or "Various Maintenance Work"). Add one in FSM, or set AMC_FSM_QUOTE_SERVICE_ID.', 409);
}

/**
 * Creates the quotation's estimate in FSM and takes its number. Returns the
 * reason when it could not; the quotation stands in the portal either way.
 */
async function createInFsm(admin: Admin, q: Row, f: Awaited<ReturnType<typeof facts>>, actor: Actor): Promise<string | null> {
  if (!(await fsmClientWritesReady(admin))) return null;
  try {
    if (!f.client) throw new ContractError("The contract has no client in the portal to quote in FSM.", 409);
    const put = await putClientInFsm(admin, String(f.client.id), actor.id);
    if (!("contactId" in put)) throw new ContractError(put.message, 409);
    const token = await getFsmAccessToken(admin);
    const serviceId = await fsmServiceId(admin, token);
    const [taxes, contactRes, address] = await Promise.all([
      serviceTaxes(token, { inspection: serviceId }),
      fsmGetRecord<Row>(token, "Contacts", put.contactId),
      quotationAddress(admin, token, put.contactId, str(f.contract.property_id), actor.id).catch(() => null),
    ]);
    const contact = contactRes.ok ? (contactRes.record ?? null) : null;
    const where = [f.property?.unit_label, f.property?.building_name].filter(Boolean).join(", ");
    const body = {
      data: [
        {
          Summary: `AMC ${KIND_LABEL[q.entity_type as AmcQuoteKind].toLowerCase()} ${f.ref} · ${String(f.contract.contract_number ?? "")}${where ? ` · ${where}` : ""}`.slice(0, 250),
          Contact: put.contactId,
          ...(contact?.Email ? { Email: contact.Email } : {}),
          ...(contact?.Phone || contact?.Mobile ? { Phone: contact.Phone ?? contact.Mobile } : {}),
          ...(contact?.Mobile ? { Mobile: contact.Mobile } : {}),
          Service_Address: estimateAddress((address ?? contact?.Service_Address) as Row | null, "Service"),
          Billing_Address: estimateAddress((contact?.Billing_Address ?? address ?? contact?.Service_Address) as Row | null, "Billing"),
          ...((address as Row | null)?.Territory && ((address as Row).Territory as Row).id ? { Territory: String(((address as Row).Territory as Row).id) } : {}),
          Service_Line_Items: serviceLineItems({ lines: q.lines, tax_rate: q.tax_rate }, { inspection: serviceId }, taxes),
          Quotation_Type__C: "Standard",
        },
      ],
    };
    const created = await createEstimate(token, body);
    const number = created.number ?? null;
    const now = new Date().toISOString();
    await admin
      .from(TABLE)
      .update({
        fsm_estimate_id: created.id,
        fsm_estimate_number: number,
        fsm_status: created.status,
        fsm_service_id: serviceId,
        fsm_synced_at: now,
        fsm_error: null,
        ...(number ? { quote_number: number } : {}),
        updated_at: now,
      })
      .eq("id", String(q.id));
    /* DEV-508: the record's FSM quotation number, filled in. */
    if (number) await setFsmQuotation(admin, q.entity_type as AmcQuoteKind, String(q.entity_id), number, actor).catch(() => undefined);
    return null;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Zoho FSM did not take the quotation.";
    await admin.from(TABLE).update({ fsm_error: reason.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", String(q.id));
    return reason;
  }
}

/** Moves the FSM estimate on (sent, approved, rejected, cancelled); best effort, after the answer. */
function fsmStep(admin: Admin, quoteId: string, step: "mark_as_sent" | "approve" | "reject" | "cancel", note: string | null) {
  const run = async () => {
    const { data } = await admin.from(TABLE).select("fsm_estimate_id").eq("id", quoteId).maybeSingle<Row>();
    const estimateId = str(data?.fsm_estimate_id);
    if (!estimateId || !(await fsmClientWritesReady(admin))) return;
    const token = await getFsmAccessToken(admin);
    const result = await transition(token, estimateId, step, note);
    await admin
      .from(TABLE)
      .update(result.done ? { fsm_status: step === "mark_as_sent" ? "Sent" : step === "approve" ? "Approved" : step === "reject" ? "Rejected" : "Cancelled", fsm_error: null, fsm_synced_at: new Date().toISOString() } : { fsm_error: (result.reason ?? "FSM did not move the estimate").slice(0, 500) })
      .eq("id", quoteId);
  };
  const safe = () => run().catch((e) => console.error("[amc:quotation] FSM step failed:", e instanceof Error ? e.message : e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}

/* ── generate ─────────────────────────────────────────────────────────── */

/** A live quotation (draft or sent) is set aside: its link stops working. */
export async function voidLiveQuotation(admin: Admin, kind: AmcQuoteKind, id: string, reason: string, actor: Actor): Promise<void> {
  const { data, error } = await admin
    .from(TABLE)
    .update({ status: "void", voided_at: new Date().toISOString(), void_reason: reason.slice(0, 300), approval_token_hash: null, updated_at: new Date().toISOString() })
    .eq("entity_type", kind)
    .eq("entity_id", id)
    .in("status", ["draft", "sent"])
    .select("id, quote_number, fsm_estimate_id");
  if (error) {
    if (missingTable(error)) return;
    throw new ContractError(error.message, 500);
  }
  for (const r of (data ?? []) as Row[]) {
    if (str(r.fsm_estimate_id)) fsmStep(admin, String(r.id), "cancel", reason);
    await recordAmcAudit(admin, { entityType: kind, entityId: id, eventType: "quotation_voided", actorId: actor.id, actorLabel: actor.label, payload: { quoteNumber: r.quote_number, reason } });
  }
}

/**
 * Generates the quotation from the services entered (a new one replaces a
 * draft or sent one, whose link stops working), and creates it in FSM.
 */
export async function generateQuotation(admin: Admin, kind: AmcQuoteKind, id: string, actor: Actor): Promise<{ quotation: AmcQuotation; fsmProblem: string | null }> {
  if (!(await quotationsReady(admin))) throw new ContractError(QUOTATIONS_NOT_READY, 503);
  const prior = await latestQuotation(admin, kind, id);
  if (prior?.status === "approved") throw new ContractError(`Quotation ${prior.quoteNumber} is already approved.`, 409);
  const [f, charge] = await Promise.all([facts(admin, kind, id), chargeFor(admin, kind, id)]);
  if (kind === "additional_work" && ["approved", "scheduled", "in_progress", "completed", "invoiced", "paid", "rejected"].includes(String(f.rec.status))) {
    throw new ContractError(`${f.ref} is past the quotation stage.`, 409);
  }
  const lines = quoteLinesFrom(charge.lines);
  const subtotal = round2(charge.subtotal);
  const taxAmount = round2(charge.vatAmount);
  const p = f.property ?? {};
  const snapshot = {
    unit_label: str(p.unit_label) ?? tidyPropertyLabel(f.contract.property_label),
    building_name: str(p.building_name),
    community: str(p.community),
    developer_name: str(p.developer_name),
    property_type: str(p.property_type),
    bedrooms: p.bedrooms ?? null,
    built_up_area_sqft: p.built_up_area_sqft ?? null,
    client_name: f.recipient.name,
    client_email: f.recipient.email,
    client_phone: f.recipient.phone,
    client_ref: str(((f.contract.customer ?? {}) as Row).customerId),
    contract_number: str(f.contract.contract_number),
    ref: f.ref,
  };
  const { scope, terms } = await quotationTexts(admin, kind, f, lines);

  await voidLiveQuotation(admin, kind, id, "A new quotation was generated", actor);
  const { data, error } = await admin
    .from(TABLE)
    .insert({
      entity_type: kind,
      entity_id: id,
      contract_id: String(f.contract.id),
      status: "draft",
      lines,
      subtotal,
      tax_rate: subtotal > 0 ? round2((taxAmount / subtotal) * 100) : 5,
      tax_amount: taxAmount,
      total: round2(charge.total),
      scope_of_work: scope.slice(0, 4000),
      terms: terms.slice(0, 5000),
      client_snapshot: snapshot,
      created_by: actor.id,
    })
    .select("*")
    .single<Row>();
  if (error) throw new ContractError(missingTable(error) ? QUOTATIONS_NOT_READY : error.message, missingTable(error) ? 503 : 500);
  await recordAmcAudit(admin, { entityType: kind, entityId: id, eventType: "quotation_generated", actorId: actor.id, actorLabel: actor.label, payload: { quoteNumber: data.quote_number, total: data.total } });
  const fsmProblem = await createInFsm(admin, data, f, actor);
  const fresh = await latestQuotation(admin, kind, id);
  return { quotation: fresh ?? mapQuote(data), fsmProblem };
}

/** Tries FSM again for a quotation that is not there yet. */
export async function retryQuotationFsm(admin: Admin, kind: AmcQuoteKind, id: string, actor: Actor): Promise<string | null> {
  const { data } = await admin.from(TABLE).select("*").eq("entity_type", kind).eq("entity_id", id).in("status", ["draft", "sent", "approved"]).order("created_at", { ascending: false }).limit(1).maybeSingle<Row>();
  if (!data) throw new ContractError("Generate the quotation first.", 409);
  if (str(data.fsm_estimate_id)) return null;
  if (!(await fsmClientWritesReady(admin))) return "Zoho FSM is not taking changes from this server (ZOHO_FSM is read-only or off).";
  const problem = await createInFsm(admin, data, await facts(admin, kind, id), actor);
  if (!problem && data.status === "sent") fsmStep(admin, String(data.id), "mark_as_sent", null);
  /*
    Made in FSM after the client approved (27 Nov 2026, AMQ-2026-0003 on
    live: estimate 18250 stayed New): FSM offers Mark as Approved from New.
  */
  if (!problem && data.status === "approved") {
    const by = str(data.approved_by_name);
    fsmStep(admin, String(data.id), "approve", `Approved${by ? ` by ${by}` : ""}${data.decided_origin === "client" ? " on the client link" : ""}`);
  }
  return problem;
}

/* ── share ────────────────────────────────────────────────────────────── */

function appUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://portal.yallafixit.ae").replace(/\/+$/, "");
}

/**
 * Sends the quotation: a new client link (an earlier one stops working),
 * and by email the PDF the browser built, attached. Returns the link and the
 * message for WhatsApp or to paste.
 */
export async function shareAmcQuotation(
  admin: Admin,
  kind: AmcQuoteKind,
  id: string,
  input: { channel: SendChannel; pdfBase64?: string | null },
  actor: Actor,
): Promise<{ url: string; message: string; whatsapp: string | null; emailed: boolean; quotation: AmcQuotation }> {
  const current = await latestQuotation(admin, kind, id);
  if (!current || current.status === "void") throw new ContractError("Generate the quotation first.", 409);
  if (current.status === "approved" || current.status === "rejected") throw new ContractError(`Quotation ${current.quoteNumber} is already ${current.status}.`, 409);
  const f = await facts(admin, kind, id);
  const token = mintLinkToken();
  const now = new Date().toISOString();
  const { error } = await admin
    .from(TABLE)
    .update({ status: "sent", sent_at: now, sent_channel: input.channel, sent_by: actor.id, approval_token_hash: token.hash, approval_token_hint: token.hint, approval_token_expires_at: linkTokenExpiry(LINK_DAYS), updated_at: now })
    .eq("id", current.id)
    .in("status", ["draft", "sent"]);
  if (error) throw new ContractError(error.message, 500);
  const url = `${appUrl()}/amc-quote/${token.raw}`;
  const message = `Dear ${f.recipient.name}, here is quotation ${current.quoteNumber} for ${KIND_LABEL[kind].toLowerCase()} ${f.ref} at ${(tidyPropertyLabel(f.contract.property_label) ?? "your property")}: AED ${money(current.total)} incl. VAT. Please review it and approve or reject it here: ${url}`;

  let emailed = false;
  if (input.channel === "email") {
    if (!f.recipient.email) throw new ContractError("There is no email address to send the quotation to. Add it to the client, or share the link.", 409);
    const pdf = input.pdfBase64 && input.pdfBase64.length < 12_000_000 ? input.pdfBase64 : null;
    await sendEmail({
      to: f.recipient.email,
      ...(f.cc.filter((e) => e !== f.recipient.email).length ? { cc: [...new Set(f.cc.filter((e) => e !== f.recipient.email))] } : {}),
      subject: `Yalla Fix It quotation ${current.quoteNumber} for ${(tidyPropertyLabel(f.contract.property_label) ?? "your property")}`,
      html: clientEmailHtml({
        eyebrow: `AMC ${KIND_LABEL[kind].toLowerCase()}`,
        heading: `Quotation ${current.quoteNumber}`,
        greeting: `Dear ${f.recipient.name},`,
        paragraphs: [
          escapeEmailHtml(`Here is our quotation for ${KIND_LABEL[kind].toLowerCase()} ${f.ref} on your AMC ${String(f.contract.contract_number ?? "")}: AED ${money(current.total)} including VAT.`),
          escapeEmailHtml("Open it to review the details, then approve or reject it. The PDF is attached."),
        ],
        details: [
          { label: "Quotation", value: current.quoteNumber },
          { label: "AMC", value: String(f.contract.contract_number ?? "") },
          { label: "Total", value: `AED ${money(current.total)}` },
        ],
        cta: { label: "Review the quotation", url },
      }),
      ...(pdf ? { attachment: { filename: `Quotation-${current.quoteNumber}.pdf`, content: pdf, contentType: "application/pdf" } } : {}),
    });
    emailed = true;
  }
  await recordAmcAudit(admin, { entityType: kind, entityId: id, eventType: "quotation_shared", actorId: actor.id, actorLabel: actor.label, payload: { quoteNumber: current.quoteNumber, channel: input.channel, hint: token.hint } });
  fsmStep(admin, current.id, "mark_as_sent", null);
  const fresh = (await latestQuotation(admin, kind, id)) ?? current;
  return { url, message, whatsapp: f.recipient.phone ? whatsappUrl(f.recipient.phone, message) : null, emailed, quotation: fresh };
}

/* ── the client's answer ──────────────────────────────────────────────── */

/** The quotation behind a client link, or why it does not open. */
export async function quotationByToken(admin: Admin, token: string): Promise<{ row: Row } | { error: string; status: number }> {
  if (!token || token.length < 16) return { error: "This quotation link is not available", status: 404 };
  const { data, error } = await admin.from(TABLE).select("*").eq("approval_token_hash", hashLinkToken(token)).maybeSingle<Row>();
  if (error) {
    if (missingTable(error)) return { error: "This quotation link is not available", status: 404 };
    throw new ContractError(error.message, 500);
  }
  if (!data) return { error: "This quotation link is not available", status: 404 };
  if (str(data.approval_token_expires_at) && Date.parse(String(data.approval_token_expires_at)) < Date.now() && data.status === "sent") {
    return { error: "This quotation link has expired. Please ask us to send it again.", status: 410 };
  }
  return { row: data };
}

/** What the client page renders: the document as Snagging's page reads it, nothing internal. */
export function publicQuotation(row: Row) {
  return {
    id: String(row.id),
    quote_number: String(row.quote_number),
    status: String(row.status),
    currency: String(row.currency ?? "AED"),
    subtotal: num(row.subtotal),
    tax_rate: num(row.tax_rate),
    tax_amount: num(row.tax_amount),
    total: num(row.total),
    lines: row.lines ?? [],
    scope_of_work: row.scope_of_work ?? null,
    terms: row.terms ?? null,
    property_snapshot: row.client_snapshot ?? {},
    created_at: row.created_at ?? null,
    sent_at: row.sent_at ?? null,
    decided_at: row.decided_at ?? null,
    rejected_reason: row.rejected_reason ?? null,
    approved_by_name: row.approved_by_name ?? null,
  };
}

/** The work's own approve or reject, done by the client's answer (wired by the caller, to keep this module apart from additional-works). */
export type WorkDecision = (decision: "approve" | "reject", input: { name: string; reason: string | null; quoteNumber: string }) => Promise<void>;

/**
 * The client approves (with their name) or rejects (with a reason) on the
 * link, once. Additional work is approved or rejected with it (decideWork);
 * a call out's answer is recorded. The coordinator is told either way.
 */
export async function decideAmcQuotation(
  admin: Admin,
  token: string,
  input: { decision: "approve" | "reject"; name: string; reason: string | null },
  decideWork: WorkDecision,
): Promise<{ status: AmcQuoteStatus }> {
  const found = await quotationByToken(admin, token);
  if ("error" in found) throw new ContractError(found.error, found.status === 404 ? 404 : 409);
  const row = found.row;
  if (row.status !== "sent") throw new ContractError(row.status === "approved" || row.status === "rejected" ? "This quotation has already been answered." : "This quotation is no longer open.", 409);
  const name = input.name.trim().slice(0, 160);
  if (!name) throw new ContractError("Tell us your name.", 400);
  if (input.decision === "reject" && !input.reason?.trim()) throw new ContractError("A reason is required to reject.", 400);
  const kind = row.entity_type as AmcQuoteKind;
  const entityId = String(row.entity_id);
  const now = new Date().toISOString();
  const status: AmcQuoteStatus = input.decision === "approve" ? "approved" : "rejected";
  const { data: claimed, error } = await admin
    .from(TABLE)
    .update({
      status,
      decided_at: now,
      decided_origin: "client",
      ...(status === "approved" ? { approved_at: now, approved_by_name: name } : { rejected_reason: input.reason!.trim().slice(0, 1000), approved_by_name: name }),
      updated_at: now,
    })
    .eq("id", String(row.id))
    .eq("status", "sent")
    .select("id");
  if (error) throw new ContractError(error.message, 500);
  if (!claimed?.length) throw new ContractError("This quotation has already been answered.", 409);

  const quoteNumber = String(row.quote_number);
  if (kind === "additional_work") {
    await decideWork(input.decision, { name, reason: input.reason?.trim() ?? null, quoteNumber }).catch((e) =>
      console.error("[amc:quotation] the work did not follow the client's answer:", e instanceof Error ? e.message : e),
    );
  }
  await recordAmcAudit(admin, {
    entityType: kind,
    entityId,
    eventType: status === "approved" ? "quotation_approved_by_client" : "quotation_rejected_by_client",
    actorId: null,
    actorLabel: `${name} (client)`,
    origin: "client",
    justification: status === "rejected" ? input.reason : null,
    payload: { quoteNumber },
  });
  fsmStep(admin, String(row.id), status === "approved" ? "approve" : "reject", status === "rejected" ? input.reason : `Approved by ${name} on the client link`);

  /* The coordinator: the contract's owner, told on the record's page. */
  const f = await facts(admin, kind, entityId).catch(() => null);
  if (f?.ownerId) {
    const link = kind === "call_out" ? `/extensions/amc-contracts/visits/${entityId}` : `/extensions/amc-contracts/additional-works/${entityId}`;
    await notifyUsers(admin, {
      event: status === "approved" ? "amc_quotation_approved" : "amc_quotation_rejected",
      userIds: [f.ownerId],
      title: status === "approved" ? `Quotation approved: ${f.ref}` : `Quotation rejected: ${f.ref}`,
      body:
        status === "approved"
          ? `${name} approved quotation ${quoteNumber} (AED ${money(num(row.total))}) on the client link.${kind === "additional_work" ? " Schedule the work." : " Go ahead with the call out."}`
          : `${name} rejected quotation ${quoteNumber}: ${input.reason?.trim() ?? ""}`,
      link,
      entityType: kind,
      entityId,
      contractId: String(row.contract_id),
      dedupeKey: `amc_quotation_${status}:${String(row.id)}`,
    }).catch(() => 0);
  }
  return { status };
}

/** Staff records the client's answer given another way (phone, email): the same outcome, origin staff. */
export async function recordQuotationDecision(admin: Admin, kind: AmcQuoteKind, id: string, decision: "approve" | "reject", note: string, actor: Actor): Promise<void> {
  const current = await latestQuotation(admin, kind, id);
  if (!current || (current.status !== "sent" && current.status !== "draft")) return;
  const now = new Date().toISOString();
  await admin
    .from(TABLE)
    .update({
      status: decision === "approve" ? "approved" : "rejected",
      decided_at: now,
      decided_origin: "staff",
      ...(decision === "approve" ? { approved_at: now } : { rejected_reason: note.slice(0, 1000) }),
      approval_token_hash: null,
      updated_at: now,
    })
    .eq("id", current.id)
    .in("status", ["draft", "sent"]);
  await recordAmcAudit(admin, { entityType: kind, entityId: id, eventType: decision === "approve" ? "quotation_approved_by_staff" : "quotation_rejected_by_staff", actorId: actor.id, actorLabel: actor.label, justification: note, payload: { quoteNumber: current.quoteNumber } });
  fsmStep(admin, current.id, decision === "approve" ? "approve" : "reject", note);
}
