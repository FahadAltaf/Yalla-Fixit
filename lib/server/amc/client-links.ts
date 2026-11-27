import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AmcConfig } from "@/lib/amc/config";
import { todayInDubai } from "@/lib/amc/contracts";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { createAccessRule, uploadDocument } from "@/lib/server/amc/client-profile";
import { ACCESS_TYPE_LABELS, type accessRuleSchema } from "@/lib/amc/client-profile";
import type { z } from "zod";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { notifyUsers } from "@/lib/server/amc/notifications";
import { getAssessment } from "@/lib/server/amc/business";
import { performVisitAction, siteVisitAccess, visitDetail, writePassType } from "@/lib/server/amc/visits";
import { fieldAccess } from "@/lib/server/amc/field-access";
import { tidyPropertyLabel } from "@/lib/server/amc/contracts";
import type { FieldStartKind } from "@/lib/amc/field-start";
import { hashLinkToken, linkTokenExpiry, mintLinkToken } from "@/lib/server/link-token";

type AccessRuleInput = z.infer<typeof accessRuleSchema>;

/*
  Client links without a login for one PPM visit (22 Nov 2026):
    visit_confirmation (DEV-507): Confirm or Reschedule, stored on the visit;
    access_upload (DEV-494): the gate pass or work permit, kept on the visit.
  The coordinator is told either way. Needs migration 20261122100000.

  26 Nov 2026: a site visit takes the pass upload link too (entity_type
  'assessment', migration 20261126110000); the file is kept on the site
  visit and whoever booked it (and the enquiry's owner) is told.
*/

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

export const CLIENT_LINK_PURPOSES = ["visit_confirmation", "access_upload"] as const;
export type ClientLinkPurpose = (typeof CLIENT_LINK_PURPOSES)[number];
export const CLIENT_LINK_CHANNELS = ["whatsapp", "email", "sms", "call"] as const;
export type ClientLinkChannel = (typeof CLIENT_LINK_CHANNELS)[number];

const TABLE = "amc_client_links";
const NOT_READY = "Client links need the database update 20261122100000 first.";
/** A confirmation is answered within the days before the visit; a pass upload a little longer. */
const TTL_DAYS: Record<ClientLinkPurpose, number> = { visit_confirmation: 21, access_upload: 30 };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The coordinator makes a link (an earlier one for the same purpose stops working). */
export async function createVisitClientLink(admin: Admin, input: { visitId: string; purpose: ClientLinkPurpose; channel: ClientLinkChannel }, actor: Actor, config: AmcConfig) {
  const detail = await visitDetail(admin, input.visitId, config, new Date(), false);
  if (["completed", "cancelled", "not_completed"].includes(String(detail.status))) throw new ContractError(`Visit ${detail.visitNo} is ${String(detail.status).replace(/_/g, " ")}.`, 409);
  const now = new Date().toISOString();
  const { error: revokeError } = await admin.from(TABLE).update({ revoked_at: now }).eq("entity_type", "visit").eq("entity_id", input.visitId).eq("purpose", input.purpose).is("revoked_at", null);
  if (revokeError) throw isMissingTable(revokeError) ? new ContractError(NOT_READY, 503) : new ContractError(revokeError.message, 500);
  const token = mintLinkToken();
  const expiresAt = linkTokenExpiry(TTL_DAYS[input.purpose]);
  const { error } = await admin.from(TABLE).insert({
    purpose: input.purpose,
    entity_type: "visit",
    entity_id: input.visitId,
    channel: input.channel,
    token_hash: token.hash,
    token_hint: token.hint,
    expires_at: expiresAt,
    created_by: actor.id,
  });
  if (error) throw isMissingTable(error) ? new ContractError(NOT_READY, 503) : new ContractError(error.message, 500);
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: detail.contractId,
    eventType: input.purpose === "visit_confirmation" ? "visit_confirmation_link_created" : "visit_access_link_created",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { visitId: input.visitId, visitNo: detail.visitNo, channel: input.channel, hint: token.hint, expiresAt },
  });
  const url = `${appUrl()}/amc-visit/${token.raw}`;
  const day = detail.scheduledStart ? todayInDubai(new Date(detail.scheduledStart)) : detail.targetDate;
  const message =
    input.purpose === "visit_confirmation"
      ? `Dear ${detail.customerName}, your AMC visit at ${detail.propertyLabel} is planned for ${fmtDay(day)}. Please confirm or ask for another date here: ${url}`
      : `Dear ${detail.customerName}, for your AMC visit at ${detail.propertyLabel} on ${fmtDay(day)} we need the gate pass or work permit. Please upload it here: ${url}`;
  return { url, expiresAt, message };
}

const NOT_READY_SITE_VISIT = "Pass links for site visits need the database update 20261126110000 first.";
const NOT_READY_FIELD_WORK = "Pass links for call outs and additional work need the database update 20261127120000 first.";

const isFieldWork = (t: unknown): t is FieldStartKind => t === "call_out" || t === "additional_work";
const FIELD_NOUN: Record<FieldStartKind, string> = { call_out: "call out", additional_work: "additional work" };
const fieldPage = (kind: FieldStartKind, id: string) =>
  kind === "call_out" ? `/extensions/amc-contracts/visits/${id}?tab=access` : `/extensions/amc-contracts/additional-works/${id}?tab=access`;

/** A call out or additional work as its pass link shows it (27 Nov 2026): whose, where, when, its rules, who to tell. */
async function fieldWorkFacts(admin: Admin, kind: FieldStartKind, id: string) {
  const view = await fieldAccess(admin, kind, id);
  const { data: row } = await admin.from(kind === "call_out" ? "amc_call_outs" : "amc_additional_works").select("contract_id").eq("id", id).maybeSingle<Row>();
  const { data: contract } = await admin
    .from("amc_contracts")
    .select("id, contract_number, customer_name, property_label, customer_id, customer, submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id)")
    .eq("id", String(row?.contract_id ?? ""))
    .maybeSingle<Row>();
  if (!contract) throw new ContractError("The contract was not found.", 404);
  const sub = Array.isArray(contract.submission) ? (contract.submission[0] as Row | undefined) : (contract.submission as Row | null);
  const customer = (contract.customer ?? {}) as Row;
  return {
    view,
    contractId: String(contract.id),
    contractNumber: String(contract.contract_number ?? ""),
    customerName: str(contract.customer_name) ?? "Client",
    customerId: str(contract.customer_id),
    phone: str(customer.customerPhone),
    propertyLabel: tidyPropertyLabel(contract.property_label) ?? "the property",
    ownerId: str(sub?.owner_id),
    day: view.day,
    time: view.scheduledStart ? new Date(view.scheduledStart).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }) : null,
  };
}

/** DEV-494 on a call out or additional work (27 Nov 2026): the pass and access-rule link (an earlier one stops working). */
export async function createFieldWorkClientLink(admin: Admin, input: { kind: FieldStartKind; id: string; channel: ClientLinkChannel }, actor: Actor) {
  const f = await fieldWorkFacts(admin, input.kind, input.id);
  if (f.view.startedAt) throw new ContractError(`${f.view.ref} has already started: the crew is in.`, 409);
  const now = new Date().toISOString();
  const { error: revokeError } = await admin.from(TABLE).update({ revoked_at: now }).eq("entity_type", input.kind).eq("entity_id", input.id).eq("purpose", "access_upload").is("revoked_at", null);
  if (revokeError) throw isMissingTable(revokeError) ? new ContractError(NOT_READY, 503) : new ContractError(revokeError.message, 500);
  const token = mintLinkToken();
  const expiresAt = linkTokenExpiry(TTL_DAYS.access_upload);
  const { error } = await admin.from(TABLE).insert({
    purpose: "access_upload",
    entity_type: input.kind,
    entity_id: input.id,
    channel: input.channel,
    token_hash: token.hash,
    token_hint: token.hint,
    expires_at: expiresAt,
    created_by: actor.id,
  });
  if (error) {
    if (isMissingTable(error)) throw new ContractError(NOT_READY, 503);
    if (error.code === "23514") throw new ContractError(NOT_READY_FIELD_WORK, 503);
    throw new ContractError(error.message, 500);
  }
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: f.contractId,
    eventType: "visit_access_link_created",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { [input.kind === "call_out" ? "callOutId" : "additionalWorkId"]: input.id, ref: f.view.ref, channel: input.channel, hint: token.hint, expiresAt },
  });
  const url = `${appUrl()}/amc-visit/${token.raw}`;
  const message = `Dear ${f.customerName}, for our ${FIELD_NOUN[input.kind]} ${f.view.ref} at ${f.propertyLabel} on ${fmtDay(f.day)}${f.time ? ` at ${f.time}` : ""} we need the gate pass or work permit, and anything the building asks for before our team can get in. Please send them here: ${url}`;
  return { url, expiresAt, message, phone: f.phone };
}

/** The site visit as its pass link shows it: whose it is, where, when, and who to tell. */
async function siteVisitFacts(admin: Admin, assessmentId: string) {
  const a = await getAssessment(admin, assessmentId);
  const day = a.scheduledAt ? todayInDubai(new Date(a.scheduledAt)) : (a.assessedOn ?? todayInDubai());
  const time = a.scheduledAt ? new Date(a.scheduledAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }) : null;
  let enquiryOwner: string | null = null;
  if (a.enquiryId) {
    const { data } = await admin.from("amc_enquiries").select("owner_id").eq("id", a.enquiryId).maybeSingle<Row>();
    enquiryOwner = str(data?.owner_id);
  }
  return {
    a,
    day,
    time,
    customerName: a.customer?.name ?? "Client",
    propertyLabel: a.property?.label ?? "the property",
    /* Whoever booked it and the enquiry's owner hear about an upload. */
    tell: [...new Set([a.createdBy, enquiryOwner].filter((v): v is string => Boolean(v)))],
  };
}

/** DEV-494 on a site visit (26 Nov 2026): the pass upload link (an earlier one stops working). */
export async function createSiteVisitClientLink(admin: Admin, input: { assessmentId: string; channel: ClientLinkChannel }, actor: Actor) {
  const f = await siteVisitFacts(admin, input.assessmentId);
  if (f.a.status === "completed") throw new ContractError(`Site visit ${f.a.assessmentNumber} is already completed.`, 409);
  const now = new Date().toISOString();
  const { error: revokeError } = await admin.from(TABLE).update({ revoked_at: now }).eq("entity_type", "assessment").eq("entity_id", input.assessmentId).eq("purpose", "access_upload").is("revoked_at", null);
  if (revokeError) throw isMissingTable(revokeError) ? new ContractError(NOT_READY, 503) : new ContractError(revokeError.message, 500);
  const token = mintLinkToken();
  const expiresAt = linkTokenExpiry(TTL_DAYS.access_upload);
  const { error } = await admin.from(TABLE).insert({
    purpose: "access_upload",
    entity_type: "assessment",
    entity_id: input.assessmentId,
    channel: input.channel,
    token_hash: token.hash,
    token_hint: token.hint,
    expires_at: expiresAt,
    created_by: actor.id,
  });
  if (error) {
    if (isMissingTable(error)) throw new ContractError(NOT_READY, 503);
    if (error.code === "23514") throw new ContractError(NOT_READY_SITE_VISIT, 503);
    throw new ContractError(error.message, 500);
  }
  await recordAmcAudit(admin, {
    entityType: "assessment",
    entityId: input.assessmentId,
    eventType: "site_visit_access_link_created",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { channel: input.channel, hint: token.hint, expiresAt },
  });
  const url = `${appUrl()}/amc-visit/${token.raw}`;
  const message = `Dear ${f.customerName}, for our site visit at ${f.propertyLabel} on ${fmtDay(f.day)}${f.time ? ` at ${f.time}` : ""} we need the gate pass or work permit. Please upload it here: ${url}`;
  return { url, expiresAt, message, phone: f.a.customer?.phone ?? null };
}

/*
  The coordinator's notice goes out once the client has the answer (27 Nov
  2026): it reads the whole visit and sends emails, and a confirmation on
  live took 6.8 s with it in the way. Inside a request it runs after the
  response; anywhere else (tests, scripts) it runs now and is awaited.
*/
function afterAnswer(work: () => Promise<unknown>): Promise<void> {
  const run = () =>
    work().then(
      () => undefined,
      (e) => console.error("[amc:client-link] notice not sent:", e instanceof Error ? e.message : e),
    );
  try {
    after(run);
    return Promise.resolve();
  } catch {
    return run();
  }
}

/** A property rule as the client's page lists it (27 Nov 2026): what, who issues it, how long ahead. */
function clientRuleView(r: { accessType: unknown; issuer?: unknown; leadTimeDays?: unknown }) {
  const type = String(r.accessType);
  return {
    type,
    label: (ACCESS_TYPE_LABELS as Record<string, string>)[type] ?? type.replace(/_/g, " "),
    issuer: typeof r.issuer === "string" && r.issuer.trim() ? r.issuer.trim() : null,
    leadTimeDays: Number(r.leadTimeDays ?? 0) || 0,
  };
}

/** The link behind a token, or why it does not work. */
export async function resolveClientLink(admin: Admin, raw: string): Promise<{ link: Row | null; problem: "not_found" | "expired" | "revoked" | "not_ready" | null }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) return { link: null, problem: "not_found" };
  const { data, error } = await admin.from(TABLE).select("*").eq("token_hash", hashLinkToken(raw)).maybeSingle<Row>();
  if (error) return { link: null, problem: isMissingTable(error) ? "not_ready" : "not_found" };
  if (!data) return { link: null, problem: "not_found" };
  if (data.revoked_at) return { link: null, problem: "revoked" };
  if (Date.parse(String(data.expires_at)) < Date.now()) return { link: null, problem: "expired" };
  return { link: data, problem: null };
}

/** What the client sees: only the visit's own facts, nothing internal. */
export async function clientLinkView(admin: Admin, link: Row, config: AmcConfig) {
  if (isFieldWork(link.entity_type)) {
    const f = await fieldWorkFacts(admin, link.entity_type, String(link.entity_id));
    return {
      purpose: "access_upload" as ClientLinkPurpose,
      reference: `AMC ${f.contractNumber} · ${link.entity_type === "call_out" ? "Call out" : "Additional work"} ${f.view.ref}`,
      customerName: f.customerName,
      propertyLabel: f.propertyLabel,
      contractNumber: f.contractNumber,
      visitNo: 0,
      day: f.day,
      time: f.time,
      windowStart: "",
      windowEnd: "",
      services: [link.entity_type === "call_out" ? "Call out" : "Additional work"],
      confirmed: false,
      status: f.view.status,
      passesNeeded: f.view.accessRules.filter((r) => /pass|permit|clearance/i.test(String(r.accessType))).map((r) => `${String(r.accessType).replace(/_/g, " ")}${r.issuer ? ` (${r.issuer})` : ""}`),
      rules: f.view.accessRules.map(clientRuleView),
      lastResponse: (link.response ?? null) as Row | null,
    };
  }
  if (link.entity_type === "assessment") {
    const f = await siteVisitFacts(admin, String(link.entity_id));
    const access = await siteVisitAccess(admin, { id: f.a.id, propertyId: f.a.property?.id ?? null, day: f.day });
    return {
      purpose: "access_upload" as ClientLinkPurpose,
      reference: `Site visit ${f.a.assessmentNumber}`,
      customerName: f.customerName,
      propertyLabel: f.propertyLabel,
      contractNumber: f.a.assessmentNumber,
      visitNo: 0,
      day: f.day,
      time: f.time,
      /* A site visit has a set time, not a service window: none is shown. */
      windowStart: "",
      windowEnd: "",
      services: ["Site visit"],
      confirmed: false,
      status: f.a.status,
      passesNeeded: access.accessRules.filter((r) => /pass|permit|clearance/i.test(String(r.accessType))).map((r) => `${String(r.accessType).replace(/_/g, " ")}${r.issuer ? ` (${r.issuer})` : ""}`),
      rules: access.accessRules.map(clientRuleView),
      lastResponse: (link.response ?? null) as Row | null,
    };
  }
  const d = await visitDetail(admin, String(link.entity_id), config, new Date(), false);
  const passRules = d.accessRules.filter((r) => /pass|permit|clearance/i.test(String(r.accessType)));
  return {
    purpose: String(link.purpose) as ClientLinkPurpose,
    reference: `AMC ${d.contractNumber} · Visit ${d.visitNo}`,
    customerName: d.customerName,
    propertyLabel: d.propertyLabel,
    contractNumber: d.contractNumber,
    visitNo: d.visitNo,
    day: d.scheduledStart ? todayInDubai(new Date(d.scheduledStart)) : d.targetDate,
    time: d.scheduledStart ? new Date(d.scheduledStart).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }) : null,
    windowStart: d.windowStart,
    windowEnd: d.windowEnd,
    services: d.lines.map((l) => l.label),
    confirmed: d.clientConfirmation === "confirmed",
    status: String(d.status),
    passesNeeded: passRules.map((r) => `${String(r.accessType).replace(/_/g, " ")}${r.issuer ? ` (${r.issuer})` : ""}`),
    rules: link.purpose === "access_upload" ? d.accessRules.map(clientRuleView) : [],
    lastResponse: (link.response ?? null) as Row | null,
  };
}

async function tellCoordinator(admin: Admin, link: Row, config: AmcConfig, title: string, body: string, kind: string) {
  if (isFieldWork(link.entity_type)) {
    const f = await fieldWorkFacts(admin, link.entity_type, String(link.entity_id));
    if (!f.ownerId) return;
    await notifyUsers(admin, {
      event: kind,
      userIds: [f.ownerId],
      title: `${title}: ${f.contractNumber} ${FIELD_NOUN[link.entity_type]} ${f.view.ref}`,
      body: `${f.customerName}: ${body}`,
      link: fieldPage(link.entity_type, String(link.entity_id)),
      entityType: link.entity_type,
      entityId: String(link.entity_id),
      contractId: f.contractId,
      dedupeKey: `${kind}:${String(link.id)}:${Date.now()}`,
    });
    return;
  }
  if (link.entity_type === "assessment") {
    const f = await siteVisitFacts(admin, String(link.entity_id));
    if (!f.tell.length) return;
    await notifyUsers(admin, {
      event: kind,
      userIds: f.tell,
      title: `${title}: site visit ${f.a.assessmentNumber}`,
      body: `${f.customerName}: ${body}`,
      link: `/extensions/amc-contracts/assessments/${f.a.id}?tab=access`,
      entityType: "assessment",
      entityId: f.a.id,
      dedupeKey: `${kind}:${String(link.id)}:${Date.now()}`,
    });
    return;
  }
  const d = await visitDetail(admin, String(link.entity_id), config, new Date(), false);
  if (!d.ownerId) return;
  await notifyUsers(admin, {
    event: kind,
    userIds: [d.ownerId],
    title: `${title}: ${d.contractNumber} visit ${d.visitNo}`,
    body: `${d.customerName}: ${body}`,
    link: `/extensions/amc-contracts/visits/${d.id}?tab=${link.purpose === "access_upload" ? "access" : "client"}`,
    entityType: "visit",
    entityId: d.id,
    contractId: d.contractId,
    dedupeKey: `${kind}:${String(link.id)}:${Date.now()}`,
  });
}

/**
 * DEV-507: the client's answer. Confirm sets the visit confirmed (as a
 * confirmed attempt: the to-do closes, the reminders stop); Reschedule
 * logs the request with the preferred date and the note. Either way the
 * coordinator is told.
 */
export async function answerVisitConfirmation(
  admin: Admin,
  link: Row,
  input: { answer: "confirm" | "reschedule"; name: string; preferredDate?: string | null; note?: string | null },
  config: AmcConfig,
) {
  if (link.purpose !== "visit_confirmation" || link.entity_type !== "visit") throw new ContractError("This link is not for confirming a visit.", 400);
  const name = input.name.trim();
  const note =
    input.answer === "confirm"
      ? `Confirmed by ${name} on the client link${input.note?.trim() ? `: ${input.note.trim()}` : ""}`
      : `${name} asked to reschedule on the client link${input.preferredDate ? `, preferably ${fmtDay(input.preferredDate)}` : ""}${input.note?.trim() ? `: ${input.note.trim()}` : ""}`;
  await performVisitAction(
    admin,
    String(link.entity_id),
    { action: "attempt", channel: (str(link.channel) ?? "whatsapp") as ClientLinkChannel, outcome: input.answer === "confirm" ? "confirmed" : "reschedule_requested", note: note.slice(0, 500) },
    { id: null, label: `${name} (client)` },
    config,
    () => true,
  );
  const now = new Date().toISOString();
  await admin
    .from(TABLE)
    .update({ last_used_at: now, response: { answer: input.answer, name, note: input.note?.trim() || null, preferredDate: input.preferredDate ?? null, at: now } })
    .eq("id", String(link.id));
  await afterAnswer(() => tellCoordinator(
    admin,
    link,
    config,
    input.answer === "confirm" ? "Client confirmed the visit" : "Client asked to reschedule",
    input.answer === "confirm" ? "confirmed on the link." : `asked for another date${input.preferredDate ? ` (${fmtDay(input.preferredDate)})` : ""}. Agree a new date and move the visit.`,
    input.answer === "confirm" ? "visit_confirmed_by_client" : "visit_reschedule_requested",
  ));
  return { ok: true as const };
}

/**
 * A pass from the client waits for the coordinator's check (26 Nov 2026):
 * without a status a pass counts as approved, so the client's upload showed
 * Approved before anyone had looked at it.
 */
async function markPending(admin: Admin, documentId: string) {
  const { error } = await admin.from("amc_documents").update({ access_status: "pending" }).eq("id", documentId);
  if (error) console.warn("[amc:client-link] uploaded pass not marked pending:", error.message);
}

/** DEV-494: a pass or permit from the client, kept on the visit; the coordinator checks it and marks access. */
/** A pass the client sends (27 Nov 2026): what it is and until when it is valid. */
export type ClientPassMeta = {
  /** One of ACCESS_TYPES, or "other" with its own name. */
  accessType: string;
  /** The name for "other" (or a more exact one: "Emaar gate pass"). */
  label?: string | null;
  /** The last day the pass is valid, when it says so. */
  validUntil?: string | null;
};

/** Where the client's pass and rules go: the visit (or site visit), its property, and its client. */
async function passTarget(admin: Admin, link: Row, config: AmcConfig) {
  if (isFieldWork(link.entity_type)) {
    const f = await fieldWorkFacts(admin, link.entity_type, String(link.entity_id));
    return { level: link.entity_type, entityId: String(link.entity_id), customerId: f.customerId, propertyId: f.view.propertyId };
  }
  if (link.entity_type === "assessment") {
    const f = await siteVisitFacts(admin, String(link.entity_id));
    return { level: "site_visit" as const, entityId: f.a.id, customerId: f.a.customer?.id ?? null, propertyId: f.a.property?.id ?? null };
  }
  const d = await visitDetail(admin, String(link.entity_id), config, new Date(), false);
  const { data: c } = await admin.from("amc_contracts").select("customer_id").eq("id", d.contractId).maybeSingle<Row>();
  return { level: "visit" as const, entityId: d.id, customerId: str(c?.customer_id), propertyId: d.propertyId };
}

const passLabel = (meta: ClientPassMeta | null) =>
  meta ? (meta.label?.trim() || (ACCESS_TYPE_LABELS as Record<string, string>)[meta.accessType] || "Pass") : "Pass";

/**
 * DEV-494: a pass or permit from the client, kept on the visit (or site
 * visit) as pending for the coordinator to check. 27 Nov 2026: each pass
 * says what it is (its access type, or a name of its own) and until when it
 * is valid, and is tied to the property's rule for that type; the client
 * sends several, one file per request, and the coordinator is told once,
 * after the last (quiet: true until then).
 */
export async function uploadVisitPass(
  admin: Admin,
  link: Row,
  file: { bytes: Uint8Array; fileName: string },
  input: { name: string; note?: string | null; meta?: ClientPassMeta | null; quiet?: boolean },
  config: AmcConfig,
) {
  if (link.purpose !== "access_upload") throw new ContractError("This link is not for uploading a pass.", 400);
  const t = await passTarget(admin, link, config);
  const who = input.name.trim();
  const meta = input.meta ?? null;
  if (meta?.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(meta.validUntil)) throw new ContractError("Give the end date as a date.", 400);
  const label = passLabel(meta);
  const doc = await uploadDocument(
    admin,
    {
      level: t.level,
      entityId: t.entityId,
      customerId: t.customerId,
      category: "Gate pass",
      title: `${label} from ${who}`.slice(0, 200),
      expiresOn: meta?.validUntil || null,
      notes: input.note?.trim() ? `Uploaded by the client on the link: ${input.note.trim()}`.slice(0, 1000) : "Uploaded by the client on the link.",
    },
    file,
    { id: null, label: `${who} (client)` },
  );
  await markPending(admin, doc.id);
  /* Tied to the property's rule for its type, when there is one (the coordinator can change it). */
  if (meta && t.propertyId && meta.accessType !== "other") {
    const { data: rule } = await admin
      .from("amc_property_access_rules")
      .select("id")
      .eq("property_id", t.propertyId)
      .eq("access_type", meta.accessType)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Row>();
    if (rule?.id) await writePassType(admin, doc.id, { accessRuleId: String(rule.id) }, t.propertyId).catch(() => undefined);
  }
  const before = (link.response ?? {}) as Row;
  const at = new Date().toISOString();
  await admin.from(TABLE).update({ last_used_at: at, response: { ...before, uploads: Number(before.uploads ?? 0) + 1, name: who, at } }).eq("id", String(link.id));
  link.response = { ...before, uploads: Number(before.uploads ?? 0) + 1, name: who, at };
  if (!input.quiet) {
    await afterAnswer(() =>
      tellCoordinator(admin, link, config, "Client uploaded a pass", `uploaded "${label}" (${file.fileName})${meta?.validUntil ? `, valid until ${fmtDay(meta.validUntil)}` : ""}. Check it and mark the access approved.`, "visit_pass_uploaded"),
    );
  }
  return { ok: true as const, documentId: doc.id };
}

/**
 * The client tells the coordinator what was sent, once, after the last pass
 * and any rules (27 Nov 2026).
 */
export async function finishClientPasses(admin: Admin, link: Row, input: { name: string; passes: number; rules: number; note?: string | null }, config: AmcConfig) {
  if (link.purpose !== "access_upload") throw new ContractError("This link is not for uploading a pass.", 400);
  if (input.passes <= 0 && input.rules <= 0) return { ok: true as const };
  const parts = [
    input.passes > 0 ? `${input.passes} ${input.passes === 1 ? "pass" : "passes"}` : null,
    input.rules > 0 ? `${input.rules} access ${input.rules === 1 ? "rule" : "rules"} for the property` : null,
  ].filter(Boolean);
  await afterAnswer(() =>
    tellCoordinator(
      admin,
      link,
      config,
      input.passes > 0 ? "Client uploaded passes" : "Client added access rules",
      `sent ${parts.join(" and ")}${input.note?.trim() ? ` (“${input.note.trim().slice(0, 200)}”)` : ""}. Check them and mark the access approved.`,
      "visit_pass_uploaded",
    ),
  );
  return { ok: true as const };
}

/**
 * What the property asks for before a crew can get in, as the client knows
 * it (27 Nov 2026): kept as the property's access rules, said to come from
 * the client, for every visit there. The coordinator checks them.
 */
export async function addClientAccessRules(admin: Admin, link: Row, input: { name: string; rules: AccessRuleInput[] }, config: AmcConfig) {
  if (link.purpose !== "access_upload") throw new ContractError("This link is not for access details.", 400);
  if (!input.rules.length) return { ok: true as const, added: 0 };
  const t = await passTarget(admin, link, config);
  if (!t.propertyId) throw new ContractError("This visit has no property to keep the rules on.", 409);
  const who = input.name.trim();
  for (const rule of input.rules.slice(0, 10)) {
    await createAccessRule(
      admin,
      t.propertyId,
      { ...rule, notes: [`Added by ${who} (client) on the link.`, rule.notes?.trim()].filter(Boolean).join(" ").slice(0, 2000) },
      { id: null, label: `${who} (client)` },
    );
  }
  return { ok: true as const, added: Math.min(input.rules.length, 10) };
}
