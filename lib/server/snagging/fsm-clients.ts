import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FsmConfigError, getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import {
  FsmApiError,
  addContactAddress,
  createContact,
  ensureCompany,
  findContactByEmail,
  getContact,
  listContactAddresses,
  listContacts,
  updateContactAddress,
  searchContacts,
  updateContact,
  type FsmAddress,
  type FsmContact,
} from "@/lib/server/zoho/fsm-contacts";
import { hasColumn } from "@/lib/server/snagging/columns";
import { log } from "@/lib/server/snagging/fsm-quotation-sync";

/**
 * Clients and addresses from Zoho FSM (Sami, 14 Oct 2026).
 *
 * FSM is where the clients are kept. The Clients page and the client picker
 * read it directly; the portal keeps a row of its own (snagging_clients /
 * snagging_properties) only for a client or address that is used, made the
 * moment one is picked, so quotations, jobs and documents still point at
 * portal records. New clients and addresses are created in FSM as well.
 *
 * Nothing is imported in bulk: FSM has thousands of contacts, and its
 * addresses can only be read one contact at a time.
 *
 * Off with SNAGGING_FSM_CLIENTS=off, or until the migration that adds the
 * link columns (20261015100000_snagging_fsm_clients) is applied. The portal
 * then lists and saves clients locally as before.
 */

type Admin = SupabaseClient;
type Row = Record<string, any>;

export async function fsmClientsReady(admin: Admin): Promise<boolean> {
  if ((process.env.SNAGGING_FSM_CLIENTS ?? "").trim().toLowerCase() === "off") return false;
  const [client, property] = await Promise.all([
    hasColumn(admin, "snagging_clients", "fsm_contact_id"),
    hasColumn(admin, "snagging_properties", "fsm_address_id"),
  ]);
  return client && property;
}

/** A client as the pickers and the Clients page show it. */
export type ClientOptionWire = {
  id?: string;
  fsm_contact_id?: string | null;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  company: string | null;
  /** Maher_Id__C in FSM, which it requires on a contact. */
  maher_id: string | null;
  notes: string | null;
  created_at: string | null;
  job_count?: number;
  property_count?: number;
};

const BASE_COLUMNS = "id, name, email, phone, company, notes, created_at, fsm_contact_id, fsm_company_id";

/*
  The portal's copy of the Maher ID needs its column
  (20261015120000_snagging_client_maher_id). FSM gets the Maher ID either
  way, so the integration does not wait for it.
*/
async function maherColumn(admin: Admin): Promise<boolean> {
  return hasColumn(admin, "snagging_clients", "maher_id");
}
async function localColumns(admin: Admin): Promise<string> {
  return (await maherColumn(admin)) ? `${BASE_COLUMNS}, maher_id` : BASE_COLUMNS;
}
/** The Maher ID to write on the portal row, only once it has the column. */
async function maherPatch(admin: Admin, value: string | null | undefined): Promise<Row> {
  return value !== undefined && (await maherColumn(admin)) ? { maher_id: value } : {};
}

function localToWire(row: Row, counts?: { jobs?: number; addresses?: number }): ClientOptionWire {
  return {
    id: row.id,
    fsm_contact_id: row.fsm_contact_id ?? null,
    client_name: row.name,
    client_email: row.email ?? null,
    client_phone: row.phone ?? null,
    company: row.company ?? null,
    maher_id: row.maher_id ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at ?? null,
    ...(counts?.jobs !== undefined ? { job_count: counts.jobs } : {}),
    ...(counts?.addresses !== undefined ? { property_count: counts.addresses } : {}),
  };
}

function contactToWire(contact: FsmContact, local?: Row | null): ClientOptionWire {
  return {
    ...(local?.id ? { id: local.id as string } : {}),
    fsm_contact_id: contact.id,
    client_name: contact.name,
    client_email: contact.email,
    client_phone: contact.mobile ?? contact.phone,
    company: contact.company?.name || null,
    maher_id: contact.maherId,
    notes: (local?.notes as string | null | undefined) ?? null,
    created_at: contact.createdTime,
    job_count: Number(local?.job_count?.[0]?.count ?? 0),
    ...(local ? { property_count: Number(local.address_count?.[0]?.count ?? 0) } : {}),
  };
}

/**
 * One page of FSM's contacts, newest first, or those matching a search,
 * each with its portal row (and job count) when it has one. FSM gives no
 * total, so the page says whether there are more.
 */
export async function listFsmClients(
  admin: Admin,
  query: { search?: string | null; page: number; perPage: number },
): Promise<{ data: ClientOptionWire[]; hasMore: boolean }> {
  const token = await getFsmAccessToken(admin);
  const term = (query.search ?? "").trim();
  const { rows, hasMore } = term
    ? await searchContacts(token, term, query)
    : await listContacts(token, query);
  if (rows.length === 0) return { data: [], hasMore: false };

  const { data: locals } = await admin
    .from("snagging_clients")
    .select(`${await localColumns(admin)}, job_count:snagging_jobs(count), address_count:snagging_properties(count)`)
    .in(
      "fsm_contact_id",
      rows.map((r) => r.id),
    );
  const byContact = new Map(((locals ?? []) as Row[]).map((r) => [String(r.fsm_contact_id), r]));
  return { data: rows.map((r) => contactToWire(r, byContact.get(r.id))), hasMore };
}

/** Updates the portal row's copy of the contact's details. */
async function refreshLocal(admin: Admin, localId: string, contact: FsmContact) {
  await admin
    .from("snagging_clients")
    .update({
      name: contact.name,
      email: contact.email,
      phone: contact.mobile ?? contact.phone,
      company: contact.company?.name || null,
      fsm_company_id: contact.company?.id ?? null,
      ...(await maherPatch(admin, contact.maherId)),
      updated_at: new Date().toISOString(),
    })
    .eq("id", localId);
}

/**
 * The portal row for an FSM contact: the one already linked, a portal
 * client with the same email (linked now, so it is not duplicated), or a
 * new one. Its details are refreshed from FSM either way.
 */
export async function linkFsmContact(
  admin: Admin,
  contactId: string,
  actorId: string | null,
): Promise<ClientOptionWire> {
  const token = await getFsmAccessToken(admin);
  const contact = await getContact(token, contactId);
  if (!contact) throw new FsmApiError("That client is no longer in Zoho FSM.", 404);

  const { data: linked } = await admin
    .from("snagging_clients")
    .select(await localColumns(admin))
    .eq("fsm_contact_id", contact.id)
    .maybeSingle();
  if (linked) {
    await refreshLocal(admin, (linked as Row).id, contact);
    return localToWire({ ...(linked as Row), name: contact.name, email: contact.email, phone: contact.mobile ?? contact.phone, company: contact.company?.name || null });
  }

  if (contact.email) {
    const { data: sameEmail } = await admin
      .from("snagging_clients")
      .select(await localColumns(admin))
      .ilike("email", contact.email)
      .is("fsm_contact_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sameEmail) {
      await admin.from("snagging_clients").update({ fsm_contact_id: contact.id }).eq("id", (sameEmail as Row).id);
      await refreshLocal(admin, (sameEmail as Row).id, contact);
      await log(admin, {
        quotationId: null,
        clientId: (sameEmail as Row).id,
        action: "contact_link",
        status: "success",
        recordId: contact.id,
        message: "Portal client linked to the FSM contact with the same email",
        actorId,
      });
      return localToWire({ ...(sameEmail as Row), fsm_contact_id: contact.id, name: contact.name });
    }
  }

  const { data: created, error } = await admin
    .from("snagging_clients")
    .insert({
      name: contact.name,
      email: contact.email,
      phone: contact.mobile ?? contact.phone,
      company: contact.company?.name || null,
      fsm_contact_id: contact.id,
      fsm_company_id: contact.company?.id ?? null,
      ...(await maherPatch(admin, contact.maherId)),
      created_by: actorId,
    })
    .select(await localColumns(admin))
    .single();
  if (error) {
    // Two pickers linking the same contact at once: the other one won.
    if (error.code === "23505") {
      const { data: again } = await admin
        .from("snagging_clients")
        .select(await localColumns(admin))
        .eq("fsm_contact_id", contact.id)
        .maybeSingle();
      if (again) return localToWire(again as Row);
    }
    throw new Error(error.message);
  }
  return localToWire(created as Row);
}

/**
 * A new client, created in FSM and in the portal. When FSM already has a
 * contact with that email, it is linked rather than created twice.
 */
export async function createClientWithFsm(
  admin: Admin,
  input: { name: string; email: string; phone: string | null; company: string | null; maherId: string | null },
  actorId: string,
): Promise<{ client: ClientOptionWire; existed: boolean }> {
  const token = await getFsmAccessToken(admin);
  const existing = await findContactByEmail(token, input.email);
  if (existing) {
    return { client: await linkFsmContact(admin, existing.id, actorId), existed: true };
  }

  let contactId: string;
  let companyId: string | null = null;
  try {
    companyId = input.company
      ? await ensureCompany(token, input.company, { phone: input.phone, email: input.email })
      : null;
    contactId = await createContact(token, {
      name: input.name,
      email: input.email,
      mobile: input.phone,
      companyId,
      maherId: input.maherId,
    });
  } catch (err) {
    await log(admin, {
      quotationId: null,
      action: "contact_create",
      status: "failed",
      message: `${input.name} <${input.email}>: ${err instanceof Error ? err.message : "Zoho FSM refused the contact"}`,
      detail: err instanceof FsmApiError ? err.detail : undefined,
      actorId,
    });
    throw err;
  }
  const { data, error } = await admin
    .from("snagging_clients")
    .insert({
      name: input.name,
      email: input.email,
      phone: input.phone,
      company: input.company,
      ...(await maherPatch(admin, input.maherId)),
      fsm_contact_id: contactId,
      fsm_company_id: companyId,
      created_by: actorId,
    })
    .select(await localColumns(admin))
    .single();
  if (error) throw new Error(error.message);
  await log(admin, {
    quotationId: null,
    clientId: (data as Row).id,
    action: "contact_create",
    status: "success",
    recordId: contactId,
    message: `Client created in FSM as ${input.name}`,
    actorId,
  });
  return { client: localToWire(data as Row), existed: false };
}

/**
 * A client's details corrected: in FSM first (it is the record), then the
 * portal's copy. A contact that has no portal row yet is linked, so the
 * notes, which only the portal keeps, have somewhere to go.
 */
export async function updateClientWithFsm(
  admin: Admin,
  target: { id?: string | null; fsmContactId?: string | null },
  fields: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
    maherId?: string | null;
    notes?: string | null;
  },
  actorId: string,
): Promise<ClientOptionWire> {
  let local: Row | null = null;
  if (target.id) {
    const { data } = await admin.from("snagging_clients").select(await localColumns(admin)).eq("id", target.id).maybeSingle();
    local = (data as Row | null) ?? null;
    if (!local) throw new FsmApiError("Client not found", 404);
  }
  const contactId = (local?.fsm_contact_id as string | null) ?? target.fsmContactId ?? null;

  if (contactId) {
    const token = await getFsmAccessToken(admin);
    const companyId =
      fields.company === undefined
        ? undefined
        : fields.company
          ? await ensureCompany(token, fields.company, { phone: fields.phone ?? local?.phone, email: fields.email ?? local?.email })
          : null;
    await updateContact(token, contactId, {
      name: fields.name,
      email: fields.email,
      mobile: fields.phone,
      companyId,
      maherId: fields.maherId,
    });
    const linkedId = local?.id ?? (await linkFsmContact(admin, contactId, actorId)).id;
    local = { ...(local ?? {}), id: linkedId };
    if (companyId !== undefined) {
      await admin.from("snagging_clients").update({ fsm_company_id: companyId }).eq("id", linkedId);
    }
  }
  if (!local?.id) throw new FsmApiError("Client not found", 404);

  const updates: Row = { updated_at: new Date().toISOString() };
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.email !== undefined) updates.email = fields.email;
  if (fields.phone !== undefined) updates.phone = fields.phone;
  if (fields.company !== undefined) updates.company = fields.company;
  Object.assign(updates, await maherPatch(admin, fields.maherId));
  if (fields.notes !== undefined) updates.notes = fields.notes;
  const { data, error } = await admin
    .from("snagging_clients")
    .update(updates)
    .eq("id", local.id)
    .select(await localColumns(admin))
    .single();
  if (error) throw new Error(error.message);
  if (contactId) {
    await log(admin, {
      quotationId: null,
      clientId: local.id,
      action: "contact_update",
      status: "success",
      recordId: contactId,
      message: "Client details updated in FSM",
      actorId,
    });
  }
  return localToWire(data as Row);
}

/* ── addresses ──────────────────────────────────────────────────────────── */

/**
 * An FSM address as the portal's property fields. FSM keeps an address as
 * one line, "DUBAI MARINA, SILVERENE TOWER B, 1402": the last part is the
 * unit when it has a number in it, the one before it the building, and
 * anything earlier the community.
 */
export function addressToProperty(address: FsmAddress) {
  const parts = (address.street1 ?? address.label)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  let unit: string | null = null;
  let building: string | null = null;
  let community = address.street2;
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && last && /\d/.test(last) && last.length <= 15) {
    unit = parts.pop() ?? null;
    building = parts.pop() ?? null;
    if (parts.length > 0) community = [parts.join(", "), address.street2].filter(Boolean).join(", ");
  } else {
    unit = parts.join(", ") || address.label;
  }
  return {
    unit_label: unit || address.label,
    building_name: building,
    community: community ?? null,
    location_lat: address.lat,
    location_lng: address.lng,
  };
}

/** A portal property as the one line FSM keeps, in FSM's own order. */
export function propertyToAddressLine(property: Row): string {
  return [property.community, property.building_name, property.unit_label]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join(", ");
}

const PROPERTY_SELECT =
  "id, client_id, unit_label, building_name, community, developer_name, property_type, " +
  "bedrooms, built_up_area_sqft, plot_area_sqft, external_areas_in_scope, floors, " +
  "location_lat, location_lng, title_deed_path, noc_required, noc_path, created_at, updated_at, fsm_address_id";

/**
 * The FSM addresses of a client's contact that the portal has no row for
 * yet, shaped like a property with an "fsm:" id. Picking one makes the row
 * (linkFsmAddress). An FSM failure leaves the list to the portal's own rows.
 */
export async function fsmOnlyAddresses(
  admin: Admin,
  clientId: string,
  linkedIds: Set<string>,
): Promise<{ rows: Row[]; error: string | null }> {
  const { data: client } = await admin
    .from("snagging_clients")
    .select("id, fsm_contact_id")
    .eq("id", clientId)
    .maybeSingle();
  const contactId = (client as Row | null)?.fsm_contact_id as string | null | undefined;
  if (!contactId) return { rows: [], error: null };
  try {
    const token = await getFsmAccessToken(admin);
    const addresses = await listContactAddresses(token, contactId);
    return {
      rows: addresses
        .filter((a) => !linkedIds.has(a.id))
        .map((a) => ({
          id: `fsm:${a.id}`,
          client_id: clientId,
          ...addressToProperty(a),
          property_type: null,
          fsm_address_id: a.id,
          fsm_address_code: a.code,
          fsm_address_label: a.label,
          source: "fsm",
          created_at: a.createdTime,
        })),
      error: null,
    };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : "Could not read the addresses in Zoho FSM" };
  }
}

/** The portal row for one of a client's FSM addresses: the linked one, or a new one. */
export async function linkFsmAddress(
  admin: Admin,
  clientId: string,
  addressId: string,
  actorId: string | null,
): Promise<Row> {
  const { data: linked } = await admin
    .from("snagging_properties")
    .select(PROPERTY_SELECT)
    .eq("fsm_address_id", addressId)
    .maybeSingle();
  if (linked) return linked as Row;

  const { data: client } = await admin
    .from("snagging_clients")
    .select("id, fsm_contact_id")
    .eq("id", clientId)
    .maybeSingle();
  const contactId = (client as Row | null)?.fsm_contact_id as string | null | undefined;
  if (!contactId) throw new FsmApiError("This client is not linked to Zoho FSM.", 409);
  const token = await getFsmAccessToken(admin);
  const address = (await listContactAddresses(token, contactId)).find((a) => a.id === addressId);
  if (!address) throw new FsmApiError("That address is no longer on the client in Zoho FSM.", 404);

  const { data, error } = await admin
    .from("snagging_properties")
    .insert({ ...addressToProperty(address), client_id: clientId, fsm_address_id: address.id, created_by: actorId })
    .select(PROPERTY_SELECT)
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: again } = await admin
        .from("snagging_properties")
        .select(PROPERTY_SELECT)
        .eq("fsm_address_id", addressId)
        .maybeSingle();
      if (again) return again as Row;
    }
    throw new Error(error.message);
  }
  return data as Row;
}

/*
  While an address is being added in FSM its link column holds a claim,
  "pending:<time>", so the background push and the quotation sync, which
  can both reach the same new address within a second, never add it twice.
  A claim older than this is taken to be from a call that died.
*/
const CLAIM_PREFIX = "pending:";
const CLAIM_STALE_MS = 2 * 60 * 1000;

export const isRealAddressId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && !value.startsWith(CLAIM_PREFIX);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A property made in the portal, in the client's contact in FSM: its FSM
 * address id, adding it first when it is not there yet. Null when it cannot
 * be (the integration is off, the client is not in FSM, or FSM refused,
 * which is logged). Never throws.
 */
export async function ensurePropertyInFsm(
  admin: Admin,
  propertyId: string,
  actorId: string | null,
): Promise<string | null> {
  let claimed: string | null = null;
  let clientId: string | null = null;
  try {
    if (!(await fsmClientsReady(admin))) return null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { data: property } = await admin
        .from("snagging_properties")
        .select("id, client_id, unit_label, building_name, community, location_lat, location_lng, fsm_address_id")
        .eq("id", propertyId)
        .maybeSingle();
      const row = property as Row | null;
      if (!row?.client_id) return null;
      clientId = row.client_id as string;
      if (isRealAddressId(row.fsm_address_id)) return row.fsm_address_id;

      const claim = row.fsm_address_id as string | null;
      const stale = claim ? Date.now() - Number(claim.slice(CLAIM_PREFIX.length)) > CLAIM_STALE_MS : false;
      if (claim && !stale) {
        // Someone else is adding it: wait for their answer.
        await sleep(750);
        continue;
      }

      const mine = `${CLAIM_PREFIX}${Date.now()}`;
      const take = admin.from("snagging_properties").update({ fsm_address_id: mine }).eq("id", propertyId);
      const { data: took } = await (claim ? take.eq("fsm_address_id", claim) : take.is("fsm_address_id", null)).select("id");
      if (!took || took.length === 0) continue;
      claimed = mine;

      const { data: client } = await admin
        .from("snagging_clients")
        .select("id, fsm_contact_id")
        .eq("id", row.client_id)
        .maybeSingle();
      const contactId = (client as Row | null)?.fsm_contact_id as string | null | undefined;
      const line = propertyToAddressLine(row);
      if (!contactId || !line) {
        await admin.from("snagging_properties").update({ fsm_address_id: null }).eq("id", propertyId).eq("fsm_address_id", mine);
        return null;
      }

      const token = await getFsmAccessToken(admin);
      const addressId = await addContactAddress(token, contactId, {
        street1: line,
        lat: (row.location_lat as number | null) ?? null,
        lng: (row.location_lng as number | null) ?? null,
      });
      await admin.from("snagging_properties").update({ fsm_address_id: addressId }).eq("id", propertyId);
      claimed = null;
      await log(admin, {
        quotationId: null,
        clientId,
        action: "address_create",
        status: "success",
        recordId: addressId,
        message: `Address "${line}" added to the client in FSM`,
        actorId,
      });
      return addressId;
    }
    return null;
  } catch (err) {
    console.error("FSM address push failed:", err);
    if (claimed) {
      await admin.from("snagging_properties").update({ fsm_address_id: null }).eq("id", propertyId).eq("fsm_address_id", claimed);
    }
    await log(admin, {
      quotationId: null,
      clientId,
      action: "address_create",
      status: "failed",
      message: err instanceof Error ? err.message : "Could not add the address in Zoho FSM",
      detail: err instanceof FsmApiError ? err.detail : undefined,
      actorId,
    });
    return null;
  }
}

/**
 * A property edited in the portal, corrected on its address in FSM: the
 * address line (community, building, unit) and the map pin. A property not
 * in FSM yet is added instead. Nothing happens while the integration is off
 * or the client is not in FSM. Logged either way; never throws.
 */
export async function syncPropertyEditToFsm(
  admin: Admin,
  propertyId: string,
  actorId: string | null,
): Promise<void> {
  let clientId: string | null = null;
  let addressId: string | null = null;
  try {
    if (!(await fsmClientsReady(admin))) return;
    const { data: property } = await admin
      .from("snagging_properties")
      .select("id, client_id, unit_label, building_name, community, location_lat, location_lng, fsm_address_id")
      .eq("id", propertyId)
      .maybeSingle();
    const row = property as Row | null;
    if (!row?.client_id) return;
    clientId = row.client_id as string;
    if (!isRealAddressId(row.fsm_address_id)) {
      // Not in FSM yet (or being added right now): adding it carries the edit.
      if (!row.fsm_address_id) await ensurePropertyInFsm(admin, propertyId, actorId);
      return;
    }
    addressId = row.fsm_address_id;
    const { data: client } = await admin
      .from("snagging_clients")
      .select("fsm_contact_id")
      .eq("id", row.client_id)
      .maybeSingle();
    const contactId = (client as Row | null)?.fsm_contact_id as string | null | undefined;
    const line = propertyToAddressLine(row);
    if (!contactId || !line) return;

    const token = await getFsmAccessToken(admin);
    await updateContactAddress(token, contactId, addressId, {
      street1: line,
      lat: (row.location_lat as number | null) ?? null,
      lng: (row.location_lng as number | null) ?? null,
    });
    await log(admin, {
      quotationId: null,
      clientId,
      action: "address_update",
      status: "success",
      recordId: addressId,
      message: `Address updated in FSM: "${line}"`,
      actorId,
    });
  } catch (err) {
    console.error("FSM address update failed:", err);
    await log(admin, {
      quotationId: null,
      clientId,
      action: "address_update",
      status: "failed",
      recordId: addressId ?? undefined,
      message: err instanceof Error ? err.message : "Could not update the address in Zoho FSM",
      detail: err instanceof FsmApiError ? err.detail : undefined,
      actorId,
    });
  }
}

/** Sends a property's edit to FSM once the caller has answered. */
export function queuePropertyEditToFsm(admin: Admin, propertyId: string, actorId: string | null) {
  const run = () => syncPropertyEditToFsm(admin, propertyId, actorId);
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Sends a new property to FSM once the caller has answered. */
export function queuePropertyToFsm(admin: Admin, propertyId: string, actorId: string | null) {
  const run = () => ensurePropertyInFsm(admin, propertyId, actorId);
  try {
    after(run);
  } catch {
    void run();
  }
}

/** A readable reason for a failed FSM call, for the API's error answer. */
export function fsmErrorMessage(err: unknown): string {
  if (err instanceof FsmApiError) return err.message;
  if (err instanceof FsmConfigError) return "Zoho FSM is not connected (no OAuth token).";
  return err instanceof Error ? err.message : "Zoho FSM could not be reached";
}

export { PROPERTY_SELECT };
