import type { SupabaseClient } from "@supabase/supabase-js";

import type { AmcConfig } from "@/lib/amc/config";
import { todayInDubai } from "@/lib/amc/contracts";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { uploadDocument } from "@/lib/server/amc/client-profile";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { notifyUsers } from "@/lib/server/amc/notifications";
import { getAssessment } from "@/lib/server/amc/business";
import { performVisitAction, siteVisitAccess, visitDetail } from "@/lib/server/amc/visits";
import { hashLinkToken, linkTokenExpiry, mintLinkToken } from "@/lib/server/link-token";

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
    lastResponse: (link.response ?? null) as Row | null,
  };
}

async function tellCoordinator(admin: Admin, link: Row, config: AmcConfig, title: string, body: string, kind: string) {
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
  if (link.purpose !== "visit_confirmation" || link.entity_type === "assessment") throw new ContractError("This link is not for confirming a visit.", 400);
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
  await tellCoordinator(
    admin,
    link,
    config,
    input.answer === "confirm" ? "Client confirmed the visit" : "Client asked to reschedule",
    input.answer === "confirm" ? "confirmed on the link." : `asked for another date${input.preferredDate ? ` (${fmtDay(input.preferredDate)})` : ""}. Agree a new date and move the visit.`,
    input.answer === "confirm" ? "visit_confirmed_by_client" : "visit_reschedule_requested",
  );
  return { ok: true as const };
}

/** DEV-494: a pass or permit from the client, kept on the visit; the coordinator checks it and marks access. */
export async function uploadVisitPass(admin: Admin, link: Row, file: { bytes: Uint8Array; fileName: string }, input: { name: string; note?: string | null }, config: AmcConfig) {
  if (link.purpose !== "access_upload") throw new ContractError("This link is not for uploading a pass.", 400);
  if (link.entity_type === "assessment") {
    const f = await siteVisitFacts(admin, String(link.entity_id));
    const who = input.name.trim();
    const sdoc = await uploadDocument(
      admin,
      {
        level: "site_visit",
        entityId: f.a.id,
        customerId: f.a.customer?.id ?? null,
        category: "Gate pass",
        title: `Pass from ${who}`.slice(0, 200),
        notes: input.note?.trim() ? `Uploaded by the client on the link: ${input.note.trim()}`.slice(0, 1000) : "Uploaded by the client on the link.",
      },
      file,
      { id: null, label: `${who} (client)` },
    );
    const before = (link.response ?? {}) as Row;
    const at = new Date().toISOString();
    await admin.from(TABLE).update({ last_used_at: at, response: { uploads: Number(before.uploads ?? 0) + 1, name: who, at } }).eq("id", String(link.id));
    await tellCoordinator(admin, link, config, "Client uploaded a pass", `uploaded "${file.fileName}". Check it and mark the access approved.`, "visit_pass_uploaded");
    return { ok: true as const, documentId: sdoc.id };
  }
  const d = await visitDetail(admin, String(link.entity_id), config, new Date(), false);
  const { data: c } = await admin.from("amc_contracts").select("customer_id").eq("id", d.contractId).maybeSingle<Row>();
  const name = input.name.trim();
  const doc = await uploadDocument(
    admin,
    {
      level: "visit",
      entityId: d.id,
      customerId: str(c?.customer_id),
      category: "Gate pass",
      title: `Pass from ${name}`.slice(0, 200),
      notes: input.note?.trim() ? `Uploaded by the client on the link: ${input.note.trim()}`.slice(0, 1000) : "Uploaded by the client on the link.",
    },
    file,
    { id: null, label: `${name} (client)` },
  );
  const previous = (link.response ?? {}) as Row;
  const now = new Date().toISOString();
  await admin
    .from(TABLE)
    .update({ last_used_at: now, response: { uploads: Number(previous.uploads ?? 0) + 1, name, at: now } })
    .eq("id", String(link.id));
  await tellCoordinator(admin, link, config, "Client uploaded a pass", `uploaded "${file.fileName}". Check it and mark the access approved.`, "visit_pass_uploaded");
  return { ok: true as const, documentId: doc.id };
}
