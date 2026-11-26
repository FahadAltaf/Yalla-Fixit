import type { SupabaseClient } from "@supabase/supabase-js";

import { getCustomer } from "@/lib/server/amc/business";
import { hasColumn } from "@/lib/server/snagging/columns";
import {
  createClientWithFsm,
  fsmClientsReady,
  fsmClientWritesReady,
  updateClientWithFsm,
} from "@/lib/server/snagging/fsm-clients";
import { getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { getContact } from "@/lib/server/zoho/fsm-contacts";

/**
 * One client, as the shared Clients module reads and saves it (26 Nov 2026).
 *
 * The record is Snagging's client row (snagging_clients), which AMC has
 * always used too; Zoho FSM is where the contact details are kept, so they
 * are read from FSM when it answers and corrected there first. AMC's own
 * fields (Customer ID, type, status, licence ...) sit on its profile and are
 * read only for someone with AMC's view.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

export type ClientAmcFields = {
  customerRef: string | null;
  customerType: string | null;
  lifecycle: "prospect" | "client" | "former";
  tradeLicenseNo: string | null;
  tradeLicenseExpiry: string | null;
  trn: string | null;
  preferredChannel: string | null;
  preferredLanguage: string | null;
};

export type ClientRecord = {
  id: string;
  fsmContactId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  /** Maher_Id__C, which Zoho FSM requires on a contact. */
  maherId: string | null;
  notes: string | null;
  createdBy: string | null;
  /** AMC's fields; null without AMC's view (or before AMC has the client). */
  amc: ClientAmcFields | null;
};

export type ClientContactFields = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  maherId?: string | null;
  notes?: string | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

async function columns(admin: Admin): Promise<string> {
  const base = "id, name, email, phone, company, notes, fsm_contact_id, created_by";
  return (await hasColumn(admin, "snagging_clients", "maher_id")) ? `${base}, maher_id` : base;
}

/** The client, with FSM's current contact details when FSM answers; null when there is no such client. */
export async function readClient(admin: Admin, id: string, opts: { withAmc: boolean }): Promise<ClientRecord | null> {
  const { data, error } = await admin.from("snagging_clients").select(await columns(admin)).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as Row;
  const record: ClientRecord = {
    id: String(row.id),
    fsmContactId: str(row.fsm_contact_id),
    name: String(row.name ?? ""),
    email: str(row.email),
    phone: str(row.phone),
    company: str(row.company),
    maherId: str(row.maher_id),
    notes: str(row.notes),
    createdBy: str(row.created_by),
    amc: null,
  };

  /* FSM is the record: an edit starts from what it holds now, not an older copy. */
  if (record.fsmContactId && (await fsmClientsReady(admin))) {
    try {
      const contact = await getContact(await getFsmAccessToken(admin), record.fsmContactId);
      if (contact) {
        record.name = contact.name || record.name;
        record.email = contact.email ?? record.email;
        record.phone = contact.mobile ?? contact.phone ?? record.phone;
        record.company = contact.company?.name || record.company;
        record.maherId = contact.maherId ?? record.maherId;
      }
    } catch (e) {
      console.warn(`[clients] FSM contact ${record.fsmContactId} not read; showing the portal's copy:`, e instanceof Error ? e.message : e);
    }
  }

  if (opts.withAmc) {
    try {
      const c = await getCustomer(admin, id);
      record.amc = {
        customerRef: c.customerRef,
        customerType: c.customerType,
        lifecycle: c.lifecycle,
        tradeLicenseNo: c.tradeLicenseNo,
        tradeLicenseExpiry: c.tradeLicenseExpiry,
        trn: c.trn,
        preferredChannel: c.preferredChannel,
        preferredLanguage: c.preferredLanguage,
      };
    } catch {
      record.amc = null;
    }
  }
  return record;
}

/** Whether a client's contact details are saved to Zoho FSM too (so it requires an email and a Maher ID). */
export function clientsWriteToFsm(admin: Admin): Promise<boolean> {
  return fsmClientWritesReady(admin);
}

/** Corrects the contact details: in Zoho FSM first when it is the record, then the portal's copy. */
export async function saveClientContact(admin: Admin, id: string, fields: ClientContactFields, actorId: string): Promise<void> {
  if (await fsmClientWritesReady(admin)) {
    await updateClientWithFsm(admin, { id }, fields, actorId);
    return;
  }
  const updates: Row = { updated_at: new Date().toISOString() };
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.email !== undefined) updates.email = fields.email;
  if (fields.phone !== undefined) updates.phone = fields.phone;
  if (fields.company !== undefined) updates.company = fields.company;
  if (fields.notes !== undefined) updates.notes = fields.notes;
  if (fields.maherId !== undefined && (await hasColumn(admin, "snagging_clients", "maher_id"))) updates.maher_id = fields.maherId;
  const { data, error } = await admin.from("snagging_clients").update(updates).eq("id", id).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Client not found");
}

/**
 * A new client: in Zoho FSM and the portal when FSM keeps clients (one FSM
 * already has by email is opened instead, `existed`); otherwise the portal
 * only, reusing one with the same name and email (as Snagging always did).
 */
export async function createSharedClient(
  admin: Admin,
  input: { name: string; email: string | null; phone: string | null; company: string | null; maherId: string | null },
  actorId: string,
): Promise<{ id: string; name: string; existed: boolean }> {
  if (await fsmClientWritesReady(admin)) {
    const { client, existed } = await createClientWithFsm(
      admin,
      { name: input.name, email: input.email ?? "", phone: input.phone, company: input.company, maherId: input.maherId },
      actorId,
    );
    if (!client.id) throw new Error("Could not save the client");
    return { id: client.id, name: client.client_name, existed };
  }
  const { data: same } = await admin.from("snagging_clients").select("id, name, email").ilike("name", input.name).limit(20);
  const match = ((same ?? []) as Row[]).find((c) => String(c.email ?? "").toLowerCase() === (input.email ?? "").toLowerCase());
  if (match) return { id: String(match.id), name: String(match.name), existed: true };
  const { data, error } = await admin
    .from("snagging_clients")
    .insert({
      name: input.name,
      email: input.email,
      phone: input.phone,
      company: input.company,
      created_by: actorId,
      ...((await hasColumn(admin, "snagging_clients", "maher_id")) && input.maherId ? { maher_id: input.maherId } : {}),
    })
    .select("id, name")
    .single();
  if (error) throw new Error(error.message);
  return { id: String((data as Row).id), name: String((data as Row).name), existed: false };
}
