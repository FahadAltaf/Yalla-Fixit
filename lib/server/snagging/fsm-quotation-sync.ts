import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FsmConfigError, fsmFetch, fsmGetRecord, getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { fsmMessage } from "@/lib/server/zoho/fsm-contacts";
import { hasColumn, hasTable } from "@/lib/server/snagging/columns";
import { ensurePropertyInFsm, isRealAddressId } from "@/lib/server/snagging/fsm-clients";

/**
 * Snagging quotations in Zoho FSM, as "YFI Snagging - Zoho FSM APIs for
 * Quotations" sets out, through the portal's own FSM client (no edge
 * functions):
 *
 *   1-4  the client: found in FSM by email, then mobile, then phone, or
 *        created (with its company, for a business); its addresses read
 *        back for the estimate. The FSM contact id is kept on the client.
 *   5    the services each line is sent as: FSM's snagging items, found
 *        by name the first time and their ids saved.
 *   6    the quotation: created as an FSM Estimate; its id and number kept.
 *   7-8  sent, approved and rejected: the estimate's blueprint transitions.
 *   9-10 edited after it went out: the estimate is cancelled and a revised
 *        one created with the revision fields. An estimate still in Draft
 *        is simply updated.
 *
 * One entry point, syncQuotationToFsm: it brings FSM in line with the
 * quotation as it is now, whatever happened to it, so every action only
 * has to ask for a sync and a retry is the same call. It never throws:
 * the outcome is written to the quotation (fsm_status / fsm_error) and to
 * snagging_fsm_sync_log, one row per FSM call.
 *
 * Off unless SNAGGING_FSM_SYNC=on: FSM is the live Zoho account.
 */

type Admin = SupabaseClient;
type Row = Record<string, any>;

export const FSM_LINE_KINDS = [
  { key: "inspection", label: "Snagging inspection" },
  { key: "external", label: "External areas" },
  { key: "minimum", label: "Minimum charge adjustment" },
  { key: "out_of_hours", label: "Out of hours surcharge" },
  { key: "desnag", label: "De-snagging visit" },
  { key: "visit", label: "Additional visit" },
] as const;
export type FsmLineKind = (typeof FSM_LINE_KINDS)[number]["key"];

/** Which kind a quotation line is, from the wording the pricing writes. */
export function lineKind(description: string): FsmLineKind {
  const d = description.trim().toLowerCase();
  if (d.startsWith("external areas")) return "external";
  if (d.startsWith("minimum charge")) return "minimum";
  if (d.startsWith("out of hours")) return "out_of_hours";
  if (d.startsWith("de-snagging") || d.startsWith("de-snag")) return "desnag";
  if (d.startsWith("additional visit")) return "visit";
  return "inspection";
}

export function fsmSyncEnabled(): boolean {
  return (process.env.SNAGGING_FSM_SYNC ?? "").trim().toLowerCase() === "on";
}

/** Whether the migration that adds the sync's columns has been applied. */
export async function fsmSyncReady(admin: Admin): Promise<boolean> {
  const [estimate, log] = await Promise.all([
    hasColumn(admin, "snagging_quotations", "fsm_estimate_id"),
    hasTable(admin, "snagging_fsm_sync_log"),
  ]);
  return estimate && log;
}

/* ── the log ──────────────────────────────────────────────────────────── */

export type LogEntry = {
  quotationId: string | null;
  jobId?: string | null;
  clientId?: string | null;
  action: string;
  status: "success" | "failed" | "skipped";
  recordId?: string | null;
  message?: string | null;
  detail?: unknown;
  actorId?: string | null;
};

export async function log(admin: Admin, entry: LogEntry) {
  const { error } = await admin.from("snagging_fsm_sync_log").insert({
    quotation_id: entry.quotationId,
    /*
      Only named when there is a job: a database with the first copy of the
      FSM migration has no job_id, and naming it failed every log write.
    */
    ...(entry.jobId ? { job_id: entry.jobId } : {}),
    client_id: entry.clientId ?? null,
    action: entry.action,
    status: entry.status,
    fsm_record_id: entry.recordId ?? null,
    message: entry.message ?? null,
    detail: entry.detail === undefined ? null : JSON.parse(JSON.stringify(entry.detail)),
    actor_id: entry.actorId ?? null,
  });
  if (error) console.error("FSM sync log write failed:", error.message);
}

/** Zoho's own reason, readable, from a failed response. */
export function fsmReason(json: any, status: number): string {
  return fsmMessage(json, status);
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly action: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

/* ── 1-4: the client ──────────────────────────────────────────────────── */

const PHONE_DIGITS = (value: string | null | undefined) => (value ?? "").replace(/[^\d+]/g, "");

async function searchContact(token: string, field: string, value: string) {
  const res = await fsmFetch(
    token,
    `/Contacts/search?api_name=${encodeURIComponent(field)}&value=${encodeURIComponent(value)}&comparator=equal`,
  );
  if (!res.ok && res.status !== 204) {
    throw new SyncError(fsmReason(res.json, res.status), "contact_search", res.json);
  }
  const hit = Array.isArray(res.json?.data) ? res.json.data[0] : null;
  return hit?.id ? String(hit.id) : null;
}

async function ensureCompany(
  admin: Admin,
  token: string,
  client: Row,
  quotationId: string,
  actorId: string | null,
): Promise<string | null> {
  const name = String(client.company ?? "").trim();
  if (!name) return null;
  if (client.fsm_company_id) return String(client.fsm_company_id);

  const found = await fsmFetch(
    token,
    `/Companies/search?api_name=Company_Name&value=${encodeURIComponent(name)}&comparator=equal`,
  );
  let id: string | null =
    found.ok && Array.isArray(found.json?.data) && found.json.data[0]?.id
      ? String(found.json.data[0].id)
      : null;
  if (!id) {
    const created = await fsmFetch(
      token,
      "/Companies",
      {
        method: "POST",
        // A new company needs a Phone in this FSM account: the client's own, and their email.
        body: JSON.stringify({
          data: [
            {
              Company_Name: name,
              ...(client.phone ? { Phone: String(client.phone) } : {}),
              ...(client.email ? { Email: String(client.email) } : {}),
            },
          ],
        }),
      },
      { retry: false },
    );
    if (!created.ok) {
      throw new SyncError(fsmReason(created.json, created.status), "company_create", created.json);
    }
    id = String(created.json?.data?.Companies?.[0]?.id ?? "");
    if (!id) throw new SyncError("FSM created the company but sent no id back", "company_create", created.json);
    await log(admin, {
      quotationId,
      clientId: client.id,
      action: "company_create",
      status: "success",
      recordId: id,
      message: `Company "${name}" created in FSM`,
      actorId,
    });
  }
  await admin.from("snagging_clients").update({ fsm_company_id: id }).eq("id", client.id);
  return id;
}

/** The client's FSM contact: the one on file, found, or created. */
export async function ensureContact(
  admin: Admin,
  token: string,
  client: Row,
  property: Row | null,
  quotationId: string,
  actorId: string | null,
): Promise<{ contactId: string; companyId: string | null }> {
  const companyId = await ensureCompany(admin, token, client, quotationId, actorId);
  if (client.fsm_contact_id) return { contactId: String(client.fsm_contact_id), companyId };

  const email = String(client.email ?? "").trim();
  const mobile = PHONE_DIGITS(client.phone);
  let contactId: string | null = null;
  // Call 1: by email; by mobile, then phone, only when there is no email.
  if (email) contactId = await searchContact(token, "Email", email);
  else if (mobile) {
    contactId =
      (await searchContact(token, "Mobile", mobile)) ?? (await searchContact(token, "Phone", mobile));
  }

  if (contactId) {
    await log(admin, {
      quotationId,
      clientId: client.id,
      action: "contact_link",
      status: "success",
      recordId: contactId,
      message: "Client found in FSM and linked",
      actorId,
    });
  } else {
    // FSM requires an email on a contact (Last_Name and Email are mandatory).
    if (!email) {
      throw new SyncError(
        "The client has no email address, which Zoho FSM requires to create a contact. Add one to the client and retry.",
        "contact_create",
      );
    }
    const parts = String(client.name ?? "").trim().split(/\s+/).filter(Boolean);
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : (parts[0] ?? email);
    const firstName = parts.length > 1 ? parts[0] : undefined;
    const street = [property?.unit_label, property?.building_name].filter(Boolean).join(", ");
    const body = {
      data: [
        {
          ...(firstName ? { First_Name: firstName } : {}),
          Last_Name: lastName,
          Email: email,
          ...(mobile ? { Mobile: mobile } : {}),
          ...(companyId ? { Company: companyId } : {}),
          ...(street || property?.community
            ? {
                Service_Address: {
                  Address_Name: "Service Address",
                  Street_1: street || property?.community,
                  Street_2: street ? (property?.community ?? null) : null,
                  City: "Dubai",
                  Country: "United Arab Emirates",
                },
                Billing_Address: "$SUBLOOKUP_Service_Address",
              }
            : {}),
        },
      ],
    };
    const created = await fsmFetch(
      token,
      "/Contacts",
      { method: "POST", body: JSON.stringify(body) },
      { retry: false },
    );
    if (!created.ok) {
      throw new SyncError(fsmReason(created.json, created.status), "contact_create", created.json);
    }
    contactId = String(created.json?.data?.Contacts?.[0]?.id ?? "");
    if (!contactId) {
      throw new SyncError("FSM created the contact but sent no id back", "contact_create", created.json);
    }
    await log(admin, {
      quotationId,
      clientId: client.id,
      action: "contact_create",
      status: "success",
      recordId: contactId,
      message: `Client created in FSM as ${firstName ? `${firstName} ` : ""}${lastName}`,
      actorId,
    });
  }

  await admin.from("snagging_clients").update({ fsm_contact_id: contactId }).eq("id", client.id);
  return { contactId, companyId };
}

/* An address as the estimate takes it: the contact's, with its id, and
   each field under the estimate's own prefixed name. */
export function estimateAddress(address: Row | null | undefined, prefix: "Service" | "Billing") {
  if (!address || typeof address !== "object" || !address.id) return null;
  const out: Row = { id: address.id };
  for (const [key, value] of Object.entries(address)) {
    if (key === "id") continue;
    const name = key.startsWith(`${prefix}_`) ? key : `${prefix}_${key}`;
    out[name] = value;
  }
  return out;
}

/* ── 5: the services each line is sent as ─────────────────────────────── */

/*
  Call 5, "once, at setup": FSM's Services and Parts are read, the
  snagging items found by name, and their ids saved on the pricing config
  (fsm_services). Later syncs use the saved ids and only look again for a
  kind that has none yet.

  Only the inspection service is required. Every other kind of line goes
  under it when FSM has no item of its own for it: the line's description
  and price still say what it is.
*/
const SERVICE_NAMES: Record<FsmLineKind, RegExp[]> = {
  // e.g. "Residential Property Handover Snagging Inspection and Report".
  inspection: [/^snagging inspection$/i, /snag\w*.*inspection|inspection.*snag/i],
  /*
    The rest only take an item made for snagging. A general "External area
    cleaning" or a "De-Snagging – 1-Bedroom Royal Suite" priced for one unit
    size is the wrong item, so without a snagging one the line goes under
    the inspection service.
  */
  external: [/snag.*external|external.*snag/i],
  minimum: [/snag.*minimum|minimum.*snag/i],
  out_of_hours: [/snag.*(out[\s-]*of[\s-]*hours|after[\s-]*hours)|(out[\s-]*of[\s-]*hours|after[\s-]*hours).*snag/i],
  desnag: [/^de-?\s*snag(ging)?(\s+(visit|inspection))?$/i],
  visit: [/^(snagging\s+)?additional\s+visit$/i, /snag.*additional visit|additional visit.*snag/i],
};

export type ServiceMap = Partial<Record<FsmLineKind, string>>;
type FsmService = { id: string; name: string; type: string | null };

async function savedServiceMap(admin: Admin): Promise<ServiceMap> {
  const { data } = await admin
    .from("snagging_pricing_config")
    .select("fsm_services")
    .eq("id", true)
    .maybeSingle();
  return ((data as Row | null)?.fsm_services ?? {}) as ServiceMap;
}

/** FSM's active services and parts (call 5). */
async function listFsmServices(token: string): Promise<FsmService[]> {
  const out: FsmService[] = [];
  for (let page = 1; page <= 30; page += 1) {
    const res = await fsmFetch(token, `/Service_And_Parts?page=${page}&per_page=200`);
    if (res.status === 204) break;
    if (!res.ok) throw new SyncError(fsmReason(res.json, res.status), "services_lookup", res.json);
    for (const item of (res.json?.data ?? []) as Row[]) {
      if (item.$inactive) continue;
      out.push({ id: String(item.id), name: String(item.Name ?? ""), type: item.Type ?? null });
    }
    if (!res.json?.info?.more_records) break;
  }
  return out;
}

/**
 * The FSM service for each kind of line: the saved ids, plus any kind that
 * has none looked up by name in FSM and saved. Throws when FSM has no
 * snagging inspection service, naming what it does have.
 */
export async function resolveServiceMap(
  admin: Admin,
  token: string,
  ref: { quotationId: string | null; jobId?: string | null; actorId: string | null },
): Promise<ServiceMap> {
  const saved = await savedServiceMap(admin);
  const missing = FSM_LINE_KINDS.map((k) => k.key).filter((k) => !saved[k]);
  if (missing.length === 0) return saved;

  const items = (await listFsmServices(token)).filter((s) => !s.type || /service/i.test(s.type));
  const found: ServiceMap = {};
  for (const kind of missing) {
    for (const pattern of SERVICE_NAMES[kind]) {
      const hit = items.find((s) => pattern.test(s.name.trim()));
      if (hit) {
        found[kind] = hit.id;
        break;
      }
    }
  }
  const map: ServiceMap = { ...saved, ...found };

  if (Object.keys(found).length > 0) {
    await admin.from("snagging_pricing_config").update({ fsm_services: map }).eq("id", true);
    await log(admin, {
      quotationId: ref.quotationId,
      jobId: ref.jobId ?? null,
      action: "services_lookup",
      status: "success",
      message: `FSM services saved: ${Object.entries(found)
        .map(([kind, id]) => `${FSM_LINE_KINDS.find((k) => k.key === kind)?.label} = ${items.find((s) => s.id === id)?.name}`)
        .join("; ")}`,
      actorId: ref.actorId,
    });
  }

  if (!map.inspection) {
    const snagging = items.filter((s) => /snag|inspect/i.test(s.name)).map((s) => s.name);
    throw new SyncError(
      `FSM has no "Snagging Inspection" service. ${
        snagging.length > 0
          ? `Services that look close: ${snagging.slice(0, 10).join(", ")}.`
          : "No service named with snagging or inspection was found."
      } Add or rename one in FSM's Services and Parts, then retry.`,
      "services_lookup",
    );
  }
  return map;
}

/** The service a kind of line is sent as: its own, else the inspection's. */
export function serviceFor(map: ServiceMap, kind: FsmLineKind): string | null {
  return map[kind] ?? map.inspection ?? null;
}

/* ── 6: the estimate ──────────────────────────────────────────────────── */

type QuoteLine = { description: string; qty: number; unit: string; unit_price: number; amount: number };

/** A fingerprint of what the estimate carries, to tell an edit apart. */
function contentHash(quote: Row): string {
  const lines = ((quote.lines ?? []) as QuoteLine[]).map((l) => [l.description, l.qty, l.unit_price, l.amount]);
  return JSON.stringify([lines, Number(quote.total), Number(quote.tax_rate)]);
}

/* Each mapped service's own tax in FSM, read once per sync: a line takes
   the tax its service carries there, so FSM computes VAT itself. */
export async function serviceTaxes(token: string, services: ServiceMap): Promise<Map<string, Row | null>> {
  const ids = [...new Set(Object.values(services).filter((v): v is string => Boolean(v)))];
  const entries = await Promise.all(
    ids.map(async (id) => {
      const res = await fsmGetRecord<Row>(token, "Service_And_Parts", id);
      const tax = res.ok ? (res.record?.Tax ?? null) : null;
      return [id, tax && tax.Tax_Id ? (tax as Row) : null] as const;
    }),
  );
  return new Map(entries);
}

/** What the quotation is for, as the estimate's summary says it. */
function summaryFor(quote: Row, property: Row | null): string {
  const kind =
    quote.quote_kind === "desnag"
      ? "De-snagging"
      : quote.quote_kind === "visit"
        ? "Snagging additional visit"
        : "Snagging inspection";
  const where = [property?.unit_label, property?.building_name].filter(Boolean).join(", ");
  return `${kind}${where ? ` · ${where}` : ""}`.slice(0, 250);
}

/**
 * The FSM address the quotation is for: its own property's, added to FSM
 * first when it is new, with the territory FSM gave it. Null falls back to
 * the contact's default service address.
 */
export async function quotationAddress(
  admin: Admin,
  token: string,
  contactId: string,
  propertyId: string | null | undefined,
  actorId: string | null,
): Promise<Row | null> {
  if (!propertyId || !(await hasColumn(admin, "snagging_properties", "fsm_address_id"))) return null;
  const addressId = await ensurePropertyInFsm(admin, propertyId, actorId);
  if (!isRealAddressId(addressId)) return null;
  const res = await fsmFetch(token, `/Contacts/${encodeURIComponent(contactId)}/Addresses?per_page=200`);
  if (!res.ok) return null;
  return ((res.json?.data ?? []) as Row[]).find((a) => String(a.id) === addressId) ?? null;
}

/**
 * The quotation's lines as FSM service lines: the service, the unit and,
 * when the quotation carries VAT, the tax the service has in FSM. The same
 * for an estimate and a work order; a work order without the tax is refused
 * ("Unable to Update Grand Total") in an account registered for VAT.
 */
export function serviceLineItems(quote: Row, services: ServiceMap, taxes: Map<string, Row | null>) {
  const lines = (quote.lines ?? []) as QuoteLine[];
  return lines.map((line, index) => {
    const service = serviceFor(services, lineKind(line.description)) as string;
    const tax = Number(quote.tax_rate) > 0 ? taxes.get(service) : null;
    return {
      Service: service,
      Description: line.description,
      Quantity: Number(line.qty) || 1,
      Unit: line.unit || null,
      List_Price: Number(line.unit_price) || 0,
      Sequence: index + 1,
      ...(tax
        ? {
            Tax: {
              Tax_Id: tax.Tax_Id,
              Tax_Name: tax.Tax_Name ?? null,
              Tax_Percentage: tax.Tax_Percentage ?? Number(quote.tax_rate),
              Tax_Exemption_Id: null,
              Tax_Exemption_Code: null,
            },
          }
        : {}),
    };
  });
}

function estimateBody(
  quote: Row,
  property: Row | null,
  contact: { contactId: string; companyId: string | null; record: Row | null },
  services: ServiceMap,
  taxes: Map<string, Row | null>,
  revision?: { rootRef: string; previousRef: string },
  address?: Row | null,
) {
  return {
    data: [
      {
        Summary: summaryFor(quote, property),
        Contact: contact.contactId,
        ...(contact.companyId ? { Company: contact.companyId } : {}),
        ...(contact.record?.Email ? { Email: contact.record.Email } : {}),
        // FSM requires Phone on an estimate; a contact may hold its number in either field.
        ...(contact.record?.Phone || contact.record?.Mobile
          ? { Phone: contact.record.Phone ?? contact.record.Mobile }
          : {}),
        ...(contact.record?.Mobile ? { Mobile: contact.record.Mobile } : {}),
        // The unit this quotation is for, when FSM has it; else the contact's default.
        Service_Address: estimateAddress(address ?? contact.record?.Service_Address, "Service"),
        // A contact created without an address has no billing one: bill the service address.
        Billing_Address: estimateAddress(
          contact.record?.Billing_Address ?? address ?? contact.record?.Service_Address,
          "Billing",
        ),
        ...(address?.Territory?.id ? { Territory: String(address.Territory.id) } : {}),
        Service_Line_Items: serviceLineItems(quote, services, taxes),
        ...(revision
          ? {
              Root_Quotation_Number__C: revision.rootRef,
              Previous_Quotation_Number__C: revision.previousRef,
              Revision_Type__C: "External",
              Quotation_Type__C: "Revision",
              Reason__C: "Revised in the portal after it was sent to the client",
            }
          : { Quotation_Type__C: "Standard" }),
      },
    ],
  };
}

async function readEstimate(token: string, id: string): Promise<Row | null> {
  const res = await fsmGetRecord<Row>(token, "Estimates", id);
  return res.ok ? (res.record ?? null) : null;
}

async function createEstimate(token: string, body: unknown) {
  const res = await fsmFetch(
    token,
    "/Estimates",
    { method: "POST", body: JSON.stringify(body) },
    { retry: false },
  );
  if (!res.ok) throw new SyncError(fsmReason(res.json, res.status), "estimate_create", res.json);
  const id = String(res.json?.data?.Estimates?.[0]?.id ?? "");
  if (!id) throw new SyncError("FSM created the estimate but sent no id back", "estimate_create", res.json);
  // The create response carries no number; read it back.
  const record = await readEstimate(token, id);
  return { id, number: (record?.Name as string | undefined) ?? null, status: (record?.Status as string | undefined) ?? null };
}

/* ── 7-9: the estimate's status ───────────────────────────────────────── */

/*
  FSM's own names, as the live account shows them from "New": "Mark as
  Sent", "Mark as Approved", "Cancel" (and "Send Estimate", which emails the
  client from FSM and is never used: the portal sends the quotation).
*/
const TRANSITION: Record<"mark_as_sent" | "approve" | "reject" | "cancel" | "convert", RegExp> = {
  // From "Approved": how the office turns an estimate into its work order.
  convert: /^convert\s*to\s*work\s*order$/i,
  mark_as_sent: /^mark\s*as\s*sent$/i,
  approve: /^(mark\s*as\s*)?approved?$/i,
  reject: /^(mark\s*as\s*)?reject(ed)?$/i,
  cancel: /^cancel/i,
};

async function transition(
  token: string,
  estimateId: string,
  action: keyof typeof TRANSITION,
  notes?: string | null,
): Promise<{ done: boolean; reason?: string; detail?: unknown }> {
  const list = await fsmFetch(token, `/Estimates/${encodeURIComponent(estimateId)}/actions/blueprint/transitions`);
  if (!list.ok) return { done: false, reason: fsmReason(list.json, list.status), detail: list.json };
  const transitions = (list.json?.transitions ?? []) as Row[];
  const match = transitions.find((t) => t.enabled !== false && TRANSITION[action].test(String(t.name ?? "")));
  if (!match) {
    return {
      done: false,
      reason: `FSM offers no "${action.replace(/_/g, " ")}" from status "${list.json?.process_info?.field_value ?? "unknown"}"`,
      detail: transitions.map((t) => t.name),
    };
  }
  const body = {
    blueprint: [
      {
        transition_id: String(match.id),
        ...(notes ? { data: { Notes: notes.slice(0, 2000) } } : {}),
      },
    ],
  };
  const res = await fsmFetch(token, `/Estimates/${encodeURIComponent(estimateId)}/actions/blueprint`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return res.ok ? { done: true } : { done: false, reason: fsmReason(res.json, res.status), detail: res.json };
}

/**
 * Turns an approved estimate into its work order ("Convert To Work Order"),
 * the way the office does: FSM copies the lines, the tax and the addresses,
 * and links the work order back to the estimate. Returns whether FSM
 * accepted it, and why not.
 */
export async function convertEstimate(token: string, estimateId: string, notes: string) {
  return transition(token, estimateId, "convert", notes);
}

/* ── the sync ─────────────────────────────────────────────────────────── */

/* An estimate not sent yet: FSM calls it "New" (older accounts "Draft"). */
const NOT_SENT = /^(new|draft)$/i;

/**
 * The quotation takes FSM's estimate number as its own (Sami, Oct 2026), so
 * the portal and FSM show the same number. Only while it is a draft: a
 * number the client has already seen never changes. An edit after sending
 * puts the quotation back to draft and FSM issues the revision a new
 * number, which it then takes, before it is sent again.
 */
async function adoptFsmNumber(admin: Admin, quote: Row, number: string | null, actorId: string | null) {
  if (!number || quote.status !== "draft" || quote.quote_number === number) return;
  const { error } = await admin
    .from("snagging_quotations")
    .update({ quote_number: number, updated_at: new Date().toISOString() })
    .eq("id", quote.id)
    .eq("status", "draft");
  await log(admin, {
    quotationId: quote.id as string,
    action: "number_adopt",
    status: error ? "failed" : "success",
    recordId: number,
    message: error
      ? `Could not use FSM's number ${number}: ${error.message}`
      : `Quotation ${quote.quote_number} is now ${number}, FSM's number`,
    actorId,
  });
  if (!error) quote.quote_number = number;
}

const QUOTE_COLUMNS =
  "id, quote_number, status, quote_kind, client_id, property_id, currency, subtotal, tax_rate, tax_amount, total, lines, rejected_reason, fsm_estimate_id, fsm_estimate_number, fsm_root_ref, fsm_status, fsm_synced_hash";

const LOCK_MS = 2 * 60 * 1000;

/**
 * Brings FSM in line with one quotation. Returns what happened, for the
 * Retry button; never throws.
 */
export async function syncQuotationToFsm(
  admin: Admin,
  quotationId: string,
  options: { actorId?: string | null } = {},
): Promise<{ ok: boolean; message: string }> {
  if (!fsmSyncEnabled()) return { ok: false, message: "Zoho FSM sync is switched off (SNAGGING_FSM_SYNC)." };
  if (!(await fsmSyncReady(admin))) {
    return { ok: false, message: "The Zoho FSM sync migration has not been applied yet." };
  }
  const actorId = options.actorId ?? null;

  // One sync at a time per quotation: a request during one marks it dirty,
  // and the running sync goes round again.
  const now = new Date();
  const { data: claimed } = await admin
    .from("snagging_quotations")
    .update({ fsm_lock_until: new Date(now.getTime() + LOCK_MS).toISOString(), fsm_dirty: false })
    .eq("id", quotationId)
    .or(`fsm_lock_until.is.null,fsm_lock_until.lt.${now.toISOString()}`)
    .select("id");
  if (!claimed || claimed.length === 0) {
    await admin.from("snagging_quotations").update({ fsm_dirty: true }).eq("id", quotationId);
    return { ok: true, message: "A sync is already running; it will include this change." };
  }

  let result: { ok: boolean; message: string } = { ok: true, message: "In step with Zoho FSM." };
  try {
    for (let round = 0; round < 3; round += 1) {
      result = await syncOnce(admin, quotationId, actorId);
      const { data: again } = await admin
        .from("snagging_quotations")
        .select("fsm_dirty")
        .eq("id", quotationId)
        .maybeSingle();
      if (!(again as Row | null)?.fsm_dirty) break;
      await admin.from("snagging_quotations").update({ fsm_dirty: false }).eq("id", quotationId);
    }
  } finally {
    await admin.from("snagging_quotations").update({ fsm_lock_until: null }).eq("id", quotationId);
  }
  return result;
}

async function syncOnce(
  admin: Admin,
  quotationId: string,
  actorId: string | null,
): Promise<{ ok: boolean; message: string }> {
  const { data: quoteRow, error } = await admin
    .from("snagging_quotations")
    .select(QUOTE_COLUMNS)
    .eq("id", quotationId)
    .maybeSingle();
  if (error || !quoteRow) return { ok: false, message: error?.message ?? "Quotation not found" };
  const quote = quoteRow as Row;

  try {
    const token = await getFsmAccessToken(admin);
    const [{ data: client }, { data: property }] = await Promise.all([
      admin
        .from("snagging_clients")
        .select("id, name, email, phone, company, fsm_contact_id, fsm_company_id")
        .eq("id", quote.client_id)
        .maybeSingle(),
      quote.property_id
        ? admin
            .from("snagging_properties")
            .select("id, unit_label, building_name, community")
            .eq("id", quote.property_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (!client) throw new SyncError("The quotation has no client to send to FSM", "contact");

    const hash = contentHash(quote);
    let estimateId = quote.fsm_estimate_id as string | null;
    let fsmStatus = quote.fsm_status as string | null;
    // The estimate number to report: changes when one is created or revised below.
    let estimateNumber = (quote.fsm_estimate_number as string | null) ?? null;

    // 6 / 9-10: create the estimate, or carry an edit across.
    if (!estimateId || quote.fsm_synced_hash !== hash) {
      const contact = await ensureContact(admin, token, client as Row, property as Row | null, quotationId, actorId);
      const contactRecord = (await fsmGetRecord(token, "Contacts", contact.contactId)).record ?? null;
      const services = await resolveServiceMap(admin, token, { quotationId, actorId });
      const taxes = await serviceTaxes(token, services);
      const address = await quotationAddress(admin, token, contact.contactId, quote.property_id, actorId);

      if (!estimateId) {
        const body = estimateBody(quote, property as Row | null, { ...contact, record: contactRecord }, services, taxes, undefined, address);
        const created = await createEstimate(token, body);
        estimateId = created.id;
        fsmStatus = created.status;
        await admin
          .from("snagging_quotations")
          .update({
            fsm_estimate_id: created.id,
            fsm_estimate_number: (estimateNumber = created.number),
            fsm_root_ref: created.number ? `${created.id}_${created.number}` : created.id,
            fsm_status: created.status,
            fsm_synced_hash: hash,
          })
          .eq("id", quotationId);
        await adoptFsmNumber(admin, quote, created.number, actorId);
        await log(admin, {
          quotationId,
          clientId: client.id,
          action: "estimate_create",
          status: "success",
          recordId: created.id,
          message: `Estimate ${created.number ?? created.id} created in FSM`,
          actorId,
        });
      } else {
        const current = await readEstimate(token, estimateId);
        fsmStatus = (current?.Status as string | undefined) ?? fsmStatus;
        if (!fsmStatus || NOT_SENT.test(fsmStatus)) {
          // Not sent yet in FSM ("New"): update it in place.
          const body = estimateBody(quote, property as Row | null, { ...contact, record: contactRecord }, services, taxes, undefined, address);
          /*
            A line sent without an id is added, not swapped in: the edit used
            to leave the old line beside the new one (total doubled). The
            estimate's current lines are deleted in the same call ("Edit an
            Estimate": "$fsm_delete": true on each by its id).
          */
          const oldLines = ((current?.Service_Line_Items ?? []) as Row[])
            .filter((line) => line?.id)
            .map((line) => ({ id: String(line.id), $fsm_delete: true }));
          const payload = {
            data: [{ ...body.data[0], Service_Line_Items: [...oldLines, ...body.data[0].Service_Line_Items] }],
          };
          const res = await fsmFetch(token, `/Estimates/${encodeURIComponent(estimateId)}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new SyncError(fsmReason(res.json, res.status), "estimate_update", res.json);
          await log(admin, {
            quotationId,
            clientId: client.id,
            action: "estimate_update",
            status: "success",
            recordId: estimateId,
            message: "Estimate updated in FSM with the edited quotation",
            actorId,
          });
        } else {
          // It went out: cancel it, and create the revised one (calls 9-10).
          const previousRef = quote.fsm_estimate_number
            ? `${estimateId}_${quote.fsm_estimate_number}`
            : estimateId;
          const cancelled = await transition(
            token,
            estimateId,
            "cancel",
            `Revised in the portal (${quote.quote_number}); replaced by a new estimate.`,
          );
          await log(admin, {
            quotationId,
            action: "estimate_cancel",
            status: cancelled.done ? "success" : "failed",
            recordId: estimateId,
            message: cancelled.done ? "Earlier estimate cancelled in FSM" : cancelled.reason,
            detail: cancelled.detail,
            actorId,
          });
          const body = estimateBody(
            quote,
            property as Row | null,
            { ...contact, record: contactRecord },
            services,
            taxes,
            { rootRef: (quote.fsm_root_ref as string | null) ?? previousRef, previousRef },
            address,
          );
          const created = await createEstimate(token, body);
          estimateId = created.id;
          fsmStatus = created.status;
          await admin
            .from("snagging_quotations")
            .update({
              fsm_estimate_id: created.id,
              fsm_estimate_number: (estimateNumber = created.number),
              fsm_status: created.status,
            })
            .eq("id", quotationId);
          await adoptFsmNumber(admin, quote, created.number, actorId);
          await log(admin, {
            quotationId,
            clientId: client.id,
            action: "estimate_revision",
            status: "success",
            recordId: created.id,
            message: `Revised estimate ${created.number ?? created.id} created in FSM`,
            actorId,
          });
        }
        await admin.from("snagging_quotations").update({ fsm_synced_hash: hash }).eq("id", quotationId);
      }
    }

    /*
      The totals should agree. A difference means FSM taxed or priced a
      line differently (a service with another tax rate, say): logged so
      the office can see it rather than finding it on the invoice.
    */
    if (estimateId && quote.fsm_synced_hash !== hash) {
      const differs = (row: Row | null) => {
        const total = Number(row?.Grand_Total);
        return Number.isFinite(total) && Math.abs(total - Number(quote.total)) > 0.01;
      };
      let current = await readEstimate(token, estimateId);
      /*
        FSM recalculates an edited estimate's total a moment after answering:
        read straight away it still showed the old lines. Asked once more
        before calling it a difference.
      */
      if (differs(current)) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        current = await readEstimate(token, estimateId);
      }
      const fsmTotal = Number(current?.Grand_Total);
      if (Number.isFinite(fsmTotal) && Math.abs(fsmTotal - Number(quote.total)) > 0.01) {
        await log(admin, {
          quotationId,
          action: "total_check",
          status: "skipped",
          recordId: estimateId,
          message: `FSM total ${fsmTotal} differs from the portal's ${Number(quote.total)}. Check the services' tax in FSM.`,
          actorId,
        });
      }
    }

    // 7-8: the estimate's status follows the quotation's.
    const want: (keyof typeof TRANSITION)[] =
      quote.status === "sent"
        ? ["mark_as_sent"]
        : quote.status === "approved"
          ? ["mark_as_sent", "approve"]
          : quote.status === "rejected"
            ? ["mark_as_sent", "reject"]
            : [];
    const reached = (s: string | null, step: keyof typeof TRANSITION) =>
      !!s &&
      (step === "mark_as_sent"
        ? !NOT_SENT.test(s)
        : step === "approve"
          ? // Converted to its work order is past approved.
            /approved|convert/i.test(s)
          : step === "reject"
            ? /rejected/i.test(s)
            : /cancel/i.test(s));
    for (const step of want) {
      if (reached(fsmStatus, step)) continue;
      const notes =
        step === "reject"
          ? (String(quote.rejected_reason ?? "").trim() || "Rejected by the client in the portal")
          : step === "approve"
            ? "Approved in the portal"
            : null;
      const done = await transition(token, estimateId as string, step, notes);
      await log(admin, {
        quotationId,
        action: `estimate_${step}`,
        status: done.done ? "success" : "failed",
        recordId: estimateId,
        message: done.done ? `Estimate ${step.replace(/_/g, " ")} in FSM` : done.reason,
        detail: done.detail,
        actorId,
      });
      if (!done.done) throw new SyncError(done.reason ?? "FSM transition failed", `estimate_${step}`);
      fsmStatus = (await readEstimate(token, estimateId as string))?.Status ?? fsmStatus;
    }

    await admin
      .from("snagging_quotations")
      .update({ fsm_status: fsmStatus, fsm_synced_at: new Date().toISOString(), fsm_error: null })
      .eq("id", quotationId);
    return { ok: true, message: `In step with FSM estimate ${estimateNumber ?? estimateId}.` };
  } catch (err) {
    const message =
      err instanceof FsmConfigError
        ? "The Zoho FSM connection is not set up (no OAuth token)."
        : err instanceof Error
          ? err.message
          : "FSM sync failed";
    await admin.from("snagging_quotations").update({ fsm_error: message }).eq("id", quotationId);
    await log(admin, {
      quotationId,
      action: err instanceof SyncError ? err.action : "sync",
      status: "failed",
      message,
      detail: err instanceof SyncError ? err.detail : undefined,
      actorId,
    });
    return { ok: false, message };
  }
}

/**
 * Syncs a quotation now rather than after the answer, for a new or edited
 * one: it then comes back with FSM's number as its own (adoptFsmNumber).
 * Returns the quotation's number afterwards, or null when the sync is off.
 * Never throws; an FSM failure leaves the portal number and is logged, and
 * a Retry before sending gives it FSM's.
 */
export async function syncQuotationNow(
  admin: Admin,
  quotationId: string,
  actorId: string | null,
): Promise<string | null> {
  if (!fsmSyncEnabled()) return null;
  try {
    await syncQuotationToFsm(admin, quotationId, { actorId });
  } catch (err) {
    console.error("FSM quotation sync failed:", err);
  }
  const { data } = await admin
    .from("snagging_quotations")
    .select("quote_number")
    .eq("id", quotationId)
    .maybeSingle();
  return ((data as Row | null)?.quote_number as string | undefined) ?? null;
}

/** The same for the job's own quotation (the newest one on the job). */
export async function syncJobQuotationNow(admin: Admin, jobId: string, actorId: string | null) {
  if (!fsmSyncEnabled()) return;
  const { data } = await admin
    .from("snagging_quotations")
    .select("id")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const id = (data as Row | null)?.id as string | undefined;
  if (id) await syncQuotationNow(admin, id, actorId);
}

/**
 * The same, for the job's own Quotation tab, which acts on "the job's
 * quotation" rather than a quotation id: the newest one on the job.
 */
export function queueJobQuotationSync(admin: Admin, jobId: string, actorId?: string | null) {
  if (!fsmSyncEnabled()) return;
  const run = async () => {
    const { data } = await admin
      .from("snagging_quotations")
      .select("id")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const id = (data as Row | null)?.id as string | undefined;
    if (id) await syncQuotationToFsm(admin, id, { actorId });
  };
  try {
    after(() => run().catch((err) => console.error("FSM quotation sync failed:", err)));
  } catch {
    void run().catch((err) => console.error("FSM quotation sync failed:", err));
  }
}

/**
 * Asks for a sync once the caller has its answer, so FSM never slows down
 * or fails the portal action. A no-op when the sync is off.
 */
export function queueFsmSync(admin: Admin, quotationId: string | null | undefined, actorId?: string | null) {
  if (!quotationId || !fsmSyncEnabled()) return;
  const run = () =>
    syncQuotationToFsm(admin, quotationId, { actorId }).catch((err) =>
      console.error("FSM quotation sync failed:", err),
    );
  try {
    after(run);
  } catch {
    void run();
  }
}
