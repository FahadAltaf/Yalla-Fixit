import type { SupabaseClient } from "@supabase/supabase-js";

import { AMC_SERVICES } from "@/components/dashboard/extensions/amc/amc-constants";
import type { AmcConfig } from "@/lib/amc/config";
import { includedQuantityFor } from "@/lib/amc/contracts";
import { buildPpmSchedule } from "@/lib/amc/ppm";
import type { TrackerContract, TrackerParse, TrackerService } from "@/lib/amc/tracker-import";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ensureClientRef, writeClientProfile } from "@/lib/server/amc/business";
import { recordStatusChange } from "@/lib/server/amc/status-history";

/**
 * DEV-486 (26 Nov 2026): the department tracker's contracts written into
 * the portal, read by lib/amc/tracker-import.ts.
 *
 * Writes the portal only: no Zoho FSM contact or address, no message to a
 * client, no instalment schedule (the tracker's payment terms are kept as
 * words). For each contract, oldest first so a renewal finds the contract it
 * renews:
 *   client     the portal client with that Customer ID, else that email, else
 *              that exact name, else a new one (Customer ID as the tracker
 *              shows it);
 *   property   the client's address with that unit and building, else a new one;
 *   proposal   a signed record, owned by the tracker's handler (a contract
 *              needs one, and its owner is the coordinator every reminder goes to);
 *   contract   active, expired or renewed, with its services and allowances;
 *   visits     the tracker's dates (done before today, planned after), and for
 *              a running contract the rest of its term planned by the portal's
 *              own schedule, never a past date left open.
 * A contract already imported (same holder, unit and dates) is skipped, so
 * running the import twice does no harm. One that fails is taken out again
 * and reported; the rest carry on.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string; label: string | null };

/* The tracker's columns and the portal's services. Ones the catalogue has no
   entry for keep a tracker id of their own. */
const SERVICE_FOR: Record<string, { id: string; kind: "ppm" | "fixed" | "hours" | "call_out"; perUnit?: boolean; callOutClass?: "emergency" | "non_emergency" }> = {
  "AC Service": { id: "ac-ppm", kind: "ppm", perUnit: true },
  "Chiller (Villa) Service": { id: "tracker-chiller-service", kind: "fixed" },
  "AC Y-Strainer": { id: "ac-y-strainer", kind: "fixed", perUnit: true },
  "Electrical PPM": { id: "electrical-ppm", kind: "ppm" },
  "Plumbing PPM": { id: "plumbing-ppm", kind: "ppm" },
  "Handyman Hrs": { id: "handyman", kind: "hours" },
  "AC Duct Cleaning": { id: "duct-cleaning", kind: "fixed", perUnit: true },
  "AC Coil Cleaning": { id: "coil-cleaning", kind: "fixed", perUnit: true },
  "Kitchen Exhaust Cleaning": { id: "kitchen-exhaust", kind: "fixed" },
  "Facade/ Window Cleaning": { id: "facade-window", kind: "fixed" },
  "Drain Line Cleaning": { id: "tracker-drain-line-cleaning", kind: "fixed" },
  "Roof Drain Cleaning": { id: "roof-drain", kind: "fixed" },
  "Pest Control": { id: "pest-control", kind: "fixed" },
  "Water Pump Servicing": { id: "water-pump", kind: "fixed" },
  "Water Tank Cleaning": { id: "water-tank", kind: "fixed" },
  "Grease Trap Cleaning": { id: "grease-trap", kind: "fixed" },
  "Fire Alarm & Firefighting": { id: "fire-alarm", kind: "fixed" },
  "Elevator Maintenance": { id: "tracker-elevator-maintenance", kind: "fixed" },
  "Waste Management": { id: "tracker-waste-management", kind: "fixed" },
  "Emergency Call-out": { id: "emergency", kind: "call_out", callOutClass: "emergency" },
  "Non-Emergency Call-out": { id: "non-emergency", kind: "call_out", callOutClass: "non_emergency" },
};

const RESIDENTIAL = new Set(["apartment", "villa", "townhouse", "accommodation"]);
const norm = (v: string | null | undefined) => (v ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const dubaiNoon = (iso: string) => `${iso}T12:00:00+04:00`;
const months = (start: string, end: string) => Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / (30.44 * 86_400_000)));

/** The key that says "this contract is already in the portal". */
export function importKey(c: TrackerContract): string {
  return ["trk", norm(c.customer.ref) || norm(c.customer.name), norm(c.property.unit), norm(c.property.building), c.startDate, c.endDate].join("|");
}

/** Oldest first: a renewal after the contract it renews. */
export function importOrder(parsed: TrackerParse): number[] {
  return parsed.contracts.map((_, i) => i).sort((a, b) => parsed.contracts[a].startDate.localeCompare(parsed.contracts[b].startDate) || a - b);
}

const serviceLabel = (column: string, id: string) => AMC_SERVICES.find((s) => s.id === id)?.label ?? column.replace(/\s+/g, " ").trim();

function bedroomsOf(text: string | null): number | null {
  if (!text) return null;
  if (/studio/i.test(text)) return 0;
  const m = /(\d+)/.exec(text);
  return m ? Number(m[1]) : null;
}

function unitTypeOf(type: string | null): string | null {
  const t = (type ?? "").toLowerCase();
  if (t.startsWith("apartment")) return "apartment";
  if (t.startsWith("villa")) return "villa";
  if (t.startsWith("townhouse")) return "townhouse";
  if (t.startsWith("restaurant")) return "restaurant";
  if (t.startsWith("office")) return "office";
  if (t.startsWith("retail") || t.startsWith("shop")) return "shop";
  if (t.startsWith("warehouse")) return "warehouse";
  if (t.startsWith("clinic")) return "clinic";
  return t ? "other" : null;
}

function paymentPlanOf(terms: string | null): string | null {
  const t = (terms ?? "").toLowerCase();
  if (!t) return null;
  if (/^1 payment|single/.test(t)) return "single";
  if (/^2 payments|50%/.test(t)) return "fifty_fifty";
  if (t.includes("quarter")) return "quarterly";
  if (t.includes("month")) return "monthly";
  return null;
}

const propertyLabel = (c: TrackerContract) => [c.property.unit, c.property.building, c.property.community].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ") || c.customer.name;

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

export type ImportPreviewRow = {
  index: number;
  source: string;
  synthesized: boolean;
  customerName: string;
  customerRef: string | null;
  property: string;
  contractType: string;
  startDate: string;
  endDate: string;
  status: TrackerContract["status"];
  renews: string | null;
  services: number;
  visitsDone: number;
  visitsPlanned: number;
  handler: string | null;
  client: "existing" | "new";
  alreadyImported: boolean;
  issues: string[];
};

export type ImportPreview = {
  rows: ImportPreviewRow[];
  handlers: Array<{ handler: string; contracts: number; suggestedUserId: string | null }>;
  people: Array<{ id: string; name: string }>;
};

export async function previewTrackerImport(admin: Admin, parsed: TrackerParse): Promise<ImportPreview> {
  const keys = parsed.contracts.map(importKey);
  const [{ data: done }, { data: profiles }, { data: people }] = await Promise.all([
    admin.from("amc_contracts").select("customer").in("customer->>importKey", keys),
    admin.from("amc_client_profiles").select("client_id, customer_ref").not("customer_ref", "is", null).limit(10000),
    admin.from("user_profile").select("id, full_name, first_name, email, is_active").eq("is_active", true).eq("hidden_from_lists", false).order("full_name"),
  ]);
  const imported = new Set(((done ?? []) as Row[]).map((r) => String(((r.customer ?? {}) as Row).importKey)));
  const refs = new Set(((profiles ?? []) as Row[]).map((p) => norm(String(p.customer_ref))));
  const emails = [...new Set(parsed.contracts.map((c) => c.customer.email?.toLowerCase()).filter((e): e is string => Boolean(e)))];
  const { data: byEmail } = emails.length ? await admin.from("snagging_clients").select("email").in("email", emails) : { data: [] as Row[] };
  const knownEmails = new Set(((byEmail ?? []) as Row[]).map((r) => String(r.email).toLowerCase()));

  const rows = parsed.contracts.map<ImportPreviewRow>((c, i) => ({
    index: i,
    source: c.source,
    synthesized: c.synthesized,
    customerName: c.customer.name,
    customerRef: c.customer.ref,
    property: propertyLabel(c),
    contractType: c.contractTypeLabel,
    startDate: c.startDate,
    endDate: c.endDate,
    status: c.status,
    renews: c.renewsIndex !== null ? `${parsed.contracts[c.renewsIndex].startDate} to ${parsed.contracts[c.renewsIndex].endDate}` : null,
    services: c.services.length,
    visitsDone: c.visits.filter((v) => v.state === "done").length,
    visitsPlanned: c.visits.filter((v) => v.state === "planned").length,
    handler: c.handler,
    client: (c.customer.ref && refs.has(norm(c.customer.ref))) || (c.customer.email && knownEmails.has(c.customer.email.toLowerCase())) ? "existing" : "new",
    alreadyImported: imported.has(keys[i]),
    issues: c.issues,
  }));

  const list = ((people ?? []) as Row[]).map((p) => ({ id: String(p.id), name: String(p.full_name ?? p.email ?? "User"), first: String(p.first_name ?? "") }));
  const counts = new Map<string, number>();
  for (const c of parsed.contracts) if (c.handler) counts.set(c.handler, (counts.get(c.handler) ?? 0) + 1);
  const handlers = [...counts.entries()].map(([handler, contracts]) => {
    const h = handler.toLowerCase();
    const match = list.filter((p) => p.first.toLowerCase() === h || p.name.toLowerCase().split(/\s+/).includes(h));
    return { handler, contracts, suggestedUserId: match.length === 1 ? match[0].id : null };
  });
  return { rows, handlers, people: list.map(({ id, name }) => ({ id, name })) };
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export type ImportResult = { index: number; source: string; customerName: string; outcome: "imported" | "skipped" | "failed"; contractId: string | null; message: string };

async function findOrMakeClient(admin: Admin, c: TrackerContract, actor: Actor): Promise<{ id: string; made: boolean }> {
  const ref = c.customer.ref?.trim() || null;
  if (ref) {
    const { data } = await admin.from("amc_client_profiles").select("client_id").ilike("customer_ref", ref).limit(1).maybeSingle<Row>();
    if (data?.client_id) return { id: String(data.client_id), made: false };
  }
  if (c.customer.email) {
    const { data } = await admin.from("snagging_clients").select("id").ilike("email", c.customer.email).order("created_at").limit(1).maybeSingle<Row>();
    if (data?.id) return { id: String(data.id), made: false };
  }
  const { data: named } = await admin.from("snagging_clients").select("id").ilike("name", c.customer.name.replace(/[%_\\]/g, (m) => `\\${m}`)).limit(2);
  if ((named ?? []).length === 1) return { id: String((named as Row[])[0].id), made: false };

  const { data, error } = await admin
    .from("snagging_clients")
    .insert({
      name: c.customer.name,
      email: c.customer.email,
      phone: c.customer.phone,
      notes: c.customer.otherEmails.length ? `Other emails in the AMC tracker: ${c.customer.otherEmails.join(", ")}` : null,
      created_by: actor.id,
    })
    .select("id")
    .single<Row>();
  if (error) throw new Error(`Client not saved: ${error.message}`);
  return { id: String(data.id), made: true };
}

async function settleClientProfile(admin: Admin, clientId: string, c: TrackerContract, actor: Actor, made: boolean, notes: string[]) {
  const { data: profile } = await admin.from("amc_client_profiles").select("customer_ref, lifecycle").eq("client_id", clientId).maybeSingle<Row>();
  const fields: Row = {};
  const ref = c.customer.ref?.trim() || null;
  if (ref && !profile?.customer_ref) fields.customer_ref = ref;
  /* A client with a running contract is a client; one with only ended contracts, a former client (never downgraded). */
  if (c.status !== "expired" && profile?.lifecycle !== "client") fields.lifecycle = "client";
  else if (c.status === "expired" && !profile?.lifecycle) fields.lifecycle = "former";
  try {
    await writeClientProfile(admin, clientId, fields, actor.id, made || !profile);
  } catch (e) {
    if (fields.customer_ref) {
      notes.push(`Customer ID ${ref} is already another client's in the portal; this client keeps its own.`);
      delete fields.customer_ref;
      await writeClientProfile(admin, clientId, fields, actor.id, made || !profile);
    } else throw e;
  }
  await ensureClientRef(admin, clientId, actor.id);
}

async function findOrMakeProperty(admin: Admin, clientId: string, c: TrackerContract, actor: Actor): Promise<string> {
  const unit = c.property.unit ?? c.property.building ?? c.property.community ?? "Property";
  const { data: candidates } = await admin.from("snagging_properties").select("id, unit_label, building_name").eq("client_id", clientId).limit(200);
  const same = ((candidates ?? []) as Row[]).find((p) => norm(String(p.unit_label ?? "")) === norm(unit) && norm(String(p.building_name ?? "")) === norm(c.property.building));
  if (same) return String(same.id);
  const unitType = unitTypeOf(c.property.type);
  const { data, error } = await admin
    .from("snagging_properties")
    .insert({
      client_id: clientId,
      unit_label: unit,
      building_name: c.property.building,
      community: c.property.community,
      bedrooms: bedroomsOf(c.property.bedrooms),
      property_type: unitType === "apartment" || unitType === "villa" || unitType === "townhouse" ? unitType : "commercial",
      created_by: actor.id,
    })
    .select("id")
    .single<Row>();
  if (error) throw new Error(`Property not saved: ${error.message}`);
  const id = String(data.id);
  /* AMC's own fields for the address; best effort (the address stands without them). */
  await admin
    .from("amc_property_profiles")
    .insert({
      property_id: id,
      property_category: RESIDENTIAL.has((c.property.type ?? "").toLowerCase()) ? "residential" : "commercial",
      unit_type: unitType,
      city: c.property.area,
      notes: c.property.acUnits ? `${c.property.acUnits} AC units (AMC tracker)` : null,
      created_by: actor.id,
    })
    .then(({ error: e }) => e && console.warn("[amc:import] property profile not saved:", e.message));
  return id;
}

type EntitlementPlan = { column: string; serviceId: string; label: string; type: "visits" | "hours" | "unlimited"; frequencyType: string; callOutClass: string | null; units: number; frequency: number; included: number | null; done: number };

function planEntitlements(c: TrackerContract, term: number): EntitlementPlan[] {
  const plans: EntitlementPlan[] = [];
  c.services.forEach((s: TrackerService) => {
    const map = SERVICE_FOR[s.column] ?? { id: `tracker-${slug(s.column)}`, kind: "fixed" as const };
    const label = serviceLabel(s.column, map.id);
    const done = c.visits.filter((v) => v.state === "done" && v.services.includes(s.column)).length;
    if (map.kind === "hours") {
      const hours = s.quantity ?? 0;
      if (hours <= 0) return;
      plans.push({ column: s.column, serviceId: map.id, label, type: "hours", frequencyType: "handyman", callOutClass: null, units: 1, frequency: Math.max(1, Math.round(hours)), included: includedQuantityFor("hours", 1, hours, term), done: 0 });
      return;
    }
    if (map.kind === "call_out") {
      const unlimited = s.unlimited || s.quantity === null;
      plans.push({
        column: s.column,
        serviceId: map.id,
        label,
        type: unlimited ? "unlimited" : "visits",
        frequencyType: "call_out",
        callOutClass: map.callOutClass ?? null,
        units: 1,
        frequency: Math.max(1, s.quantity ?? 1),
        included: unlimited ? null : includedQuantityFor("visits", 1, Math.max(1, s.quantity ?? 1), term),
        done: 0,
      });
      return;
    }
    const frequency = Math.max(1, Math.round(s.perYear ?? (s.dates.length || 1)));
    const included = Math.max(includedQuantityFor("visits", 1, frequency, term) ?? 1, done);
    plans.push({ column: s.column, serviceId: map.id, label, type: "visits", frequencyType: map.kind, callOutClass: null, units: map.perUnit ? Math.max(1, c.property.acUnits ?? 1) : 1, frequency, included, done });
  });
  /* One line per service (the database allows each once on a contract). */
  const seen = new Set<string>();
  return plans.filter((p) => (seen.has(p.serviceId) ? false : (seen.add(p.serviceId), true)));
}

/**
 * Imports contracts `from` .. `from + count` of the import order. The caller
 * pages through all of them; each call is short enough for one request.
 */
export async function importTrackerContracts(
  admin: Admin,
  parsed: TrackerParse,
  opts: { from: number; count: number; owners: Record<string, string>; today: string },
  actor: Actor,
  config: AmcConfig,
): Promise<{ results: ImportResult[]; next: number | null; total: number }> {
  const order = importOrder(parsed);
  const slice = order.slice(opts.from, opts.from + opts.count);
  const results: ImportResult[] = [];

  for (const index of slice) {
    const c = parsed.contracts[index];
    const base = { index, source: c.source, customerName: c.customer.name };
    const key = importKey(c);
    const { data: existing } = await admin.from("amc_contracts").select("id").eq("customer->>importKey", key).limit(1).maybeSingle<Row>();
    if (existing?.id) {
      results.push({ ...base, outcome: "skipped", contractId: String(existing.id), message: "Already imported." });
      continue;
    }

    const made: { submission?: string; contract?: string } = {};
    try {
      const notes: string[] = [];
      const client = await findOrMakeClient(admin, c, actor);
      await settleClientProfile(admin, client.id, c, actor, client.made, notes);
      const propertyId = await findOrMakeProperty(admin, client.id, c, actor);
      const ownerId = (c.handler && opts.owners[c.handler]) || actor.id;

      let renewsId: string | null = null;
      if (c.renewsIndex !== null) {
        const { data: prev } = await admin.from("amc_contracts").select("id").eq("customer->>importKey", importKey(parsed.contracts[c.renewsIndex])).limit(1).maybeSingle<Row>();
        renewsId = (prev?.id as string | undefined) ?? null;
      }
      const hasSuccessor = parsed.contracts.some((o) => o.renewsIndex === index);
      const status = c.status === "expired" ? (hasSuccessor ? "renewed" : "expired") : "active";
      const term = months(c.startDate, c.endDate);
      const total = c.totalAed ?? 0;
      const finalPrice = Math.round((total / 1.05) * 100) / 100;
      const vat = Math.round((total - finalPrice) * 100) / 100;
      const unitType = unitTypeOf(c.property.type);
      const customerJson = {
        customerName: c.customer.name,
        customerId: c.customer.ref,
        customerPhone: c.customer.phone,
        customerEmail: c.customer.email,
        startDate: c.startDate,
        endDate: c.endDate,
        contractType: c.contractTypeLabel,
        paymentTerms: c.paymentTerms,
        trackerProposalNo: c.proposalNumber,
        importKey: key,
        importedFrom: `AMC tracker, ${c.source}`,
      };
      const propertyJson = {
        propertyCategory: RESIDENTIAL.has((c.property.type ?? "").toLowerCase()) ? "residential" : "commercial",
        unitType,
        propertyType: c.property.type,
        propertyAddress: propertyLabel(c),
        propertyDetail: [c.property.bedrooms, c.property.acUnits ? `${c.property.acUnits} AC units` : null].filter(Boolean).join(", ") || null,
      };
      const ents = planEntitlements(c, term);

      const { data: sub, error: subError } = await admin
        .from("amc_submissions")
        .insert({
          owner_id: ownerId,
          status: "signed",
          signed_by_name: c.customer.name,
          signed_at: dubaiNoon(c.startDate),
          customer: customerJson,
          property: propertyJson,
          services: ents.map((e) => ({ serviceId: e.serviceId, included: true, units: e.units, frequency: e.frequency, basePrice: 0, price: 0, free: false })),
          document_options: { trackerImport: { key, source: c.source }, accountManagers: [] },
          customer_id: client.id,
          property_id: propertyId,
          final_price: finalPrice,
          ...(renewsId ? { renewal_of_contract_id: renewsId } : {}),
        })
        .select("id, proposal_number")
        .single<Row>();
      if (subError) throw new Error(`Proposal record not saved: ${subError.message}`);
      made.submission = String(sub.id);

      const now = new Date().toISOString();
      const { data: contract, error: contractError } = await admin
        .from("amc_contracts")
        .insert({
          submission_id: made.submission,
          proposal_number: String(sub.proposal_number),
          status,
          customer: customerJson,
          property: propertyJson,
          customer_name: c.customer.name,
          customer_ref: c.customer.ref,
          property_label: propertyLabel(c),
          unit_type: unitType,
          customer_id: client.id,
          property_id: propertyId,
          start_date: c.startDate,
          end_date: c.endDate,
          term_months: term,
          subtotal: finalPrice,
          discount_percent: 0,
          discount_amount: 0,
          final_price: finalPrice,
          vat_amount: vat,
          grand_total: total,
          signed_at: dubaiNoon(c.startDate),
          signed_by_name: c.customer.name,
          signature_route: "scan",
          renewed_from_contract_id: renewsId,
          activated_by: actor.id,
          account_manager_names: c.handler ?? "",
          template: RESIDENTIAL.has((c.property.type ?? "").toLowerCase()) ? "residential" : "commercial",
          payment_plan: paymentPlanOf(c.paymentTerms),
          /* No instalments are made, so the first-payment gate must not hold its visits. */
          initial_payment_received_at: dubaiNoon(c.startDate),
          status_changed_at: now,
          ...(status === "renewed" ? { renewal_outcome: "renewed" } : {}),
        })
        .select("id")
        .single<Row>();
      if (contractError) throw new Error(`Contract not saved: ${contractError.message}`);
      made.contract = String(contract.id);

      const entIds = new Map<string, string>();
      if (ents.length) {
        const { data: rows, error } = await admin
          .from("amc_contract_entitlements")
          .insert(
            ents.map((e, i) => ({
              contract_id: made.contract,
              service_id: e.serviceId,
              service_label: e.label,
              sort_order: i,
              frequency_type: e.frequencyType,
              entitlement_type: e.type,
              call_out_class: e.callOutClass,
              units: e.units,
              frequency: e.frequency,
              included_quantity: e.included,
              used_quantity: e.type === "visits" ? Math.min(e.done, e.included ?? e.done) : 0,
              base_price: 0,
              contracted_price: 0,
            })),
          )
          .select("id, service_id");
        if (error) throw new Error(`Services not saved: ${error.message}`);
        for (const r of (rows ?? []) as Row[]) entIds.set(String(r.service_id), String(r.id));
      }

      const visitCount = await writeVisits(admin, c, ents, entIds, made.contract, status, actor, config, opts.today);
      if (status === "active" && visitCount.planned > 0) {
        await admin.from("amc_contracts").update({ ppm_confirmed_at: now, ppm_confirmed_by: actor.id }).eq("id", made.contract);
      }

      await recordStatusChange(admin, { entityType: "contract", entityId: made.contract, from: null, to: status, reason: `Imported from the AMC tracker (${c.source})`, actor });
      await recordAmcAudit(admin, {
        entityType: "contract",
        entityId: made.contract,
        eventType: "contract_imported",
        actorId: actor.id,
        actorLabel: actor.label,
        justification: "DEV-486: import of the department's contract tracker",
        payload: { source: c.source, importKey: key, synthesized: c.synthesized, client: client.made ? "new" : "existing", visitsDone: visitCount.done, visitsPlanned: visitCount.planned, issues: [...c.issues, ...notes] },
      });
      results.push({ ...base, outcome: "imported", contractId: made.contract, message: [`${visitCount.done} done and ${visitCount.planned} planned visits`, ...notes].join(". ") });
    } catch (error) {
      await undo(admin, made);
      results.push({ ...base, outcome: "failed", contractId: null, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const next = opts.from + slice.length;
  return { results, next: next < order.length ? next : null, total: order.length };
}

async function writeVisits(
  admin: Admin,
  c: TrackerContract,
  ents: EntitlementPlan[],
  entIds: Map<string, string>,
  contractId: string,
  status: string,
  actor: Actor,
  config: AmcConfig,
  today: string,
): Promise<{ done: number; planned: number }> {
  const visitEnts = ents.filter((e) => e.type === "visits" && e.frequencyType !== "call_out");
  const byColumn = new Map(visitEnts.map((e) => [e.column, e]));
  const occurrence = new Map<string, number>();
  type Plan = { date: string; window: [string, string]; cycle: [string, string]; state: "done" | "planned"; lines: Array<{ ent: EntitlementPlan; occurrence: number }> };
  const plans: Plan[] = [];

  for (const v of c.visits) {
    const lines = v.services
      .map((col) => byColumn.get(col))
      .filter((e): e is EntitlementPlan => Boolean(e))
      .map((ent) => {
        const n = (occurrence.get(ent.serviceId) ?? 0) + 1;
        occurrence.set(ent.serviceId, n);
        return { ent, occurrence: n };
      });
    if (lines.length) plans.push({ date: v.date, window: [v.date, v.date], cycle: [v.date, v.date], state: v.state, lines });
  }

  /* A running contract: the rest of its term, planned by the portal for services the tracker gave no future date. */
  if (status === "active") {
    const withFuture = new Set(c.visits.filter((v) => v.state === "planned").flatMap((v) => v.services));
    const toPlan = visitEnts.filter((e) => !withFuture.has(e.column));
    if (toPlan.length) {
      const planned = buildPpmSchedule({
        lines: toPlan.map((e) => ({ entitlementId: e.serviceId, serviceId: e.serviceId, label: e.label, frequencyPerYear: e.frequency, preferredMonths: [], preferredDays: [] })),
        commencementDate: c.startDate,
        endDate: c.endDate,
        termMonths: months(c.startDate, c.endDate),
        windowDays: config.scheduling.serviceWindowDays,
        calendar: { weekendDays: config.calendar.weekendDays, holidays: config.calendar.holidays },
      });
      for (const ent of toPlan) {
        const doneSoFar = occurrence.get(ent.serviceId) ?? 0;
        const rest = planned.filter((p) => p.entitlementId === ent.serviceId).sort((a, b) => a.occurrence - b.occurrence).slice(doneSoFar);
        for (const p of rest) {
          if (p.windowEnd < today) continue; /* never a past visit left open (DEV-486) */
          const n = (occurrence.get(ent.serviceId) ?? 0) + 1;
          occurrence.set(ent.serviceId, n);
          plans.push({ date: p.targetDate, window: [p.windowStart, p.windowEnd], cycle: [p.cycleStart, p.cycleEnd], state: "planned", lines: [{ ent, occurrence: n }] });
        }
      }
    }
  }

  plans.sort((a, b) => a.date.localeCompare(b.date));
  if (!plans.length) return { done: 0, planned: 0 };
  const { data: visits, error } = await admin
    .from("amc_visits")
    .insert(
      plans.map((p, i) => ({
        contract_id: contractId,
        visit_no: i + 1,
        status: p.state === "done" ? "completed" : "scheduled",
        cycle_start: p.cycle[0],
        cycle_end: p.cycle[1],
        window_start: p.window[0],
        window_end: p.window[1],
        target_date: p.date,
        source: p.state === "done" ? "added" : "generated",
        created_by: actor.id,
        ...(p.state === "done" ? { closed_at: dubaiNoon(p.date) } : {}),
      })),
    )
    .select("id, visit_no");
  if (error) throw new Error(`Visits not saved: ${error.message}`);
  const idByNo = new Map(((visits ?? []) as Row[]).map((v) => [Number(v.visit_no), String(v.id)]));
  const { error: lineError } = await admin.from("amc_visit_lines").insert(
    plans.flatMap((p, i) =>
      p.lines.map((l) => ({
        visit_id: idByNo.get(i + 1),
        contract_id: contractId,
        entitlement_id: entIds.get(l.ent.serviceId),
        service_id: l.ent.serviceId,
        service_label: l.ent.label,
        occurrence: l.occurrence,
        status: p.state === "done" ? "completed" : "pending",
        home_cycle_start: p.cycle[0],
        home_cycle_end: p.cycle[1],
        home_window_start: p.window[0],
        home_window_end: p.window[1],
        home_target_date: p.date,
        ...(p.state === "done" ? { completed_at: dubaiNoon(p.date) } : {}),
      })),
    ),
  );
  if (lineError) throw new Error(`Visit lines not saved: ${lineError.message}`);
  return { done: plans.filter((p) => p.state === "done").length, planned: plans.filter((p) => p.state === "planned").length };
}

/** Takes a failed contract out again (its client and address stay: they are reused). */
async function undo(admin: Admin, made: { submission?: string; contract?: string }) {
  try {
    if (made.contract) {
      await admin.from("amc_visit_lines").delete().eq("contract_id", made.contract);
      await admin.from("amc_visits").delete().eq("contract_id", made.contract);
      await admin.from("amc_contract_entitlements").delete().eq("contract_id", made.contract);
      await admin.from("amc_contracts").delete().eq("id", made.contract);
    }
    if (made.submission) await admin.from("amc_submissions").delete().eq("id", made.submission);
  } catch (e) {
    console.error("[amc:import] could not take a failed contract out:", e instanceof Error ? e.message : e);
  }
}
