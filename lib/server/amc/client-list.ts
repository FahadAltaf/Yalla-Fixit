import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CLIENT_DIRECTORY,
  CUSTOMER_COLUMNS,
  getCustomer,
  mapCustomer,
  safeTerm,
  type CustomerRecord,
} from "@/lib/server/amc/business";
import { ContractError } from "@/lib/server/amc/contracts";
import {
  fsmClientsReady,
  linkFsmContact,
} from "@/lib/server/snagging/fsm-clients";
import { getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { listContacts, searchContacts } from "@/lib/server/zoho/fsm-contacts";

/**
 * AMC's clients the way Snagging's Clients page lists them: from Zoho FSM,
 * newest first or matching a search, a page at a time. Each FSM contact
 * carries its portal client (and what AMC keeps about it: Customer ID,
 * status) when the portal has used it; one it has not used yet gets its
 * portal row only when it is opened or picked (linkFsmCustomer).
 *
 * AMC also has clients FSM does not know yet: prospects logged from an
 * enquiry, saved in the portal only while FSM is read-only. They are listed
 * on the first page, so a new prospect is never lost from the list.
 *
 * Without the FSM integration (ZOHO_FSM=off, SNAGGING_FSM_CLIENTS=off, or
 * before its migration) the portal's own clients are listed instead. A
 * status filter is AMC's own field, so it always reads the portal.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

export type ClientListRow = {
  /** The portal client; null for an FSM contact the portal has not used yet. */
  id: string | null;
  fsmContactId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  customerRef: string | null;
  /** AMC's status; null until the portal has the client. */
  lifecycle: CustomerRecord["lifecycle"] | null;
  /** In the portal only: FSM does not have this client yet. */
  portalOnly: boolean;
  /** The portal record, when there is one, so picking it needs no second call. */
  customer: CustomerRecord | null;
};

export type ClientListPage = {
  clients: ClientListRow[];
  hasMore: boolean;
  source: "fsm" | "portal";
};

/** AMC-only clients shown above FSM's first page, at most. */
const PORTAL_ONLY_LIMIT = 25;

function fromCustomer(
  c: CustomerRecord,
  portalOnly: boolean,
  fsmContactId: string | null = c.fsmContactId,
): ClientListRow {
  return {
    id: c.id,
    fsmContactId,
    name: c.name,
    email: c.email,
    phone: c.phone,
    company: c.company,
    customerRef: c.customerRef,
    lifecycle: c.lifecycle,
    portalOnly,
    customer: c,
  };
}

function searchFilter(term: string): string {
  return `name.ilike.%${term}%,customer_ref.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,company.ilike.%${term}%`;
}

/** One page of the portal's clients, by name (the list without FSM, or with a status filter). */
async function portalPage(
  admin: Admin,
  query: {
    search: string;
    page: number;
    perPage: number;
    lifecycle: CustomerRecord["lifecycle"] | null;
  },
): Promise<ClientListPage> {
  const term = safeTerm(query.search);
  const from = query.page * query.perPage;
  // One extra row says whether there is another page.
  let q = admin
    .from(CLIENT_DIRECTORY)
    .select(CUSTOMER_COLUMNS)
    .order("name")
    .range(from, from + query.perPage);
  if (term) q = q.or(searchFilter(term));
  if (query.lifecycle) q = q.eq("lifecycle", query.lifecycle);
  const { data, error } = await q;
  if (error) throw new ContractError(error.message, 400);
  const rows = ((data ?? []) as unknown as Row[]).map(mapCustomer);
  return {
    clients: rows.slice(0, query.perPage).map((c) => fromCustomer(c, false)),
    hasMore: rows.length > query.perPage,
    source: "portal",
  };
}

/** AMC's own clients that FSM does not have: an AMC profile, and no FSM contact on either side. */
async function portalOnlyClients(
  admin: Admin,
  search: string,
): Promise<CustomerRecord[]> {
  const term = safeTerm(search);
  let q = admin
    .from(CLIENT_DIRECTORY)
    .select(CUSTOMER_COLUMNS)
    .eq("has_amc_profile", true)
    .is("fsm_contact_id", null)
    .order("created_at", { ascending: false })
    .limit(PORTAL_ONLY_LIMIT);
  if (term) q = q.or(searchFilter(term));
  const { data, error } = await q;
  if (error) throw new ContractError(error.message, 400);
  const rows = ((data ?? []) as unknown as Row[]).map(mapCustomer);
  if (rows.length === 0) return [];
  // The directory's FSM id is AMC's; Snagging links its client row to FSM itself.
  const { data: linked } = await admin
    .from("snagging_clients")
    .select("id")
    .in(
      "id",
      rows.map((r) => r.id),
    )
    .not("fsm_contact_id", "is", null);
  const inFsm = new Set(((linked ?? []) as Row[]).map((r) => String(r.id)));
  return rows.filter((r) => !inFsm.has(r.id));
}

export async function listClientsPage(
  admin: Admin,
  query: {
    search?: string | null;
    page: number;
    perPage: number;
    lifecycle?: CustomerRecord["lifecycle"] | null;
  },
): Promise<ClientListPage> {
  const search = (query.search ?? "").trim();
  const lifecycle = query.lifecycle ?? null;
  if (lifecycle || !(await fsmClientsReady(admin))) {
    return portalPage(admin, {
      search,
      page: query.page,
      perPage: query.perPage,
      lifecycle,
    });
  }

  const token = await getFsmAccessToken(admin);
  const paging = { page: query.page, perPage: query.perPage };
  const [{ rows: contacts, hasMore }, portalOnly] = await Promise.all([
    search
      ? searchContacts(token, search, paging)
      : listContacts(token, paging),
    query.page === 0
      ? portalOnlyClients(admin, search)
      : Promise.resolve([] as CustomerRecord[]),
  ]);

  // The portal clients behind these contacts, with what AMC keeps about them.
  const byContact = new Map<string, CustomerRecord>();
  if (contacts.length > 0) {
    const { data: locals } = await admin
      .from("snagging_clients")
      .select("id, fsm_contact_id")
      .in(
        "fsm_contact_id",
        contacts.map((c) => c.id),
      );
    const localRows = (locals ?? []) as Row[];
    if (localRows.length > 0) {
      const { data: directory, error } = await admin
        .from(CLIENT_DIRECTORY)
        .select(CUSTOMER_COLUMNS)
        .in(
          "id",
          localRows.map((r) => String(r.id)),
        );
      if (error) throw new ContractError(error.message, 400);
      const byId = new Map(
        ((directory ?? []) as unknown as Row[])
          .map(mapCustomer)
          .map((c) => [c.id, c]),
      );
      for (const r of localRows) {
        const customer = byId.get(String(r.id));
        if (customer) byContact.set(String(r.fsm_contact_id), customer);
      }
    }
  }

  const fsmRows = contacts.map<ClientListRow>((contact) => {
    const local = byContact.get(contact.id);
    return {
      id: local?.id ?? null,
      fsmContactId: contact.id,
      // FSM is the record for who the client is; AMC adds its own fields.
      name: contact.name,
      email: contact.email,
      phone: contact.mobile ?? contact.phone,
      company: contact.company?.name || null,
      customerRef: local?.customerRef ?? null,
      lifecycle: local?.lifecycle ?? null,
      portalOnly: false,
      customer: local ?? null,
    };
  });
  const shown = new Set(fsmRows.map((r) => r.id).filter(Boolean));
  return {
    clients: [
      ...portalOnly
        .filter((c) => !shown.has(c.id))
        .map((c) => fromCustomer(c, true, null)),
      ...fsmRows,
    ],
    hasMore,
    source: "fsm",
  };
}

/**
 * The portal client for an FSM contact, made the first time AMC uses it
 * (as Snagging does). Reads FSM; writes only the portal.
 */
export async function linkFsmCustomer(
  admin: Admin,
  fsmContactId: string,
  actorId: string | null,
): Promise<CustomerRecord> {
  if (!(await fsmClientsReady(admin)))
    throw new ContractError(
      "Zoho FSM is not available, so this client cannot be opened.",
      503,
    );
  const linked = await linkFsmContact(admin, fsmContactId, actorId);
  if (!linked.id) throw new ContractError("Could not use this client.", 500);
  return getCustomer(admin, linked.id);
}
