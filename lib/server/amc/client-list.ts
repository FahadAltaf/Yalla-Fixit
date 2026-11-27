import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CLIENT_DIRECTORY,
  CUSTOMER_COLUMNS,
  ensureClientRef,
  getCustomer,
  writeClientProfile,
  mapCustomer,
  safeTerm,
  type CustomerRecord,
} from "@/lib/server/amc/business";
import { ContractError } from "@/lib/server/amc/contracts";
import {
  fsmClientsReady,
  linkFsmContact,
} from "@/lib/server/snagging/fsm-clients";
import { FsmConfigError, getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { FsmApiError, getContact, listContacts, searchContacts } from "@/lib/server/zoho/fsm-contacts";

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
  /** Set when Zoho FSM did not answer and the portal's own clients are listed instead (23 Nov 2026). */
  notice?: string;
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

/**
 * The portal's clients whose name (or Client ID, company, phone, email)
 * matches a search, FSM-linked ones too, with the FSM contact Snagging
 * linked them to. Zoho FSM's contact search matches only a last name, an
 * email or a phone, so "Test Client QA" found nobody there (27 Nov 2026);
 * these fill that gap on the first page of a search.
 */
async function portalMatches(
  admin: Admin,
  search: string,
): Promise<Array<{ customer: CustomerRecord; fsmContactId: string | null }>> {
  const term = safeTerm(search);
  if (!term) return [];
  const { data, error } = await admin
    .from(CLIENT_DIRECTORY)
    .select(CUSTOMER_COLUMNS)
    .or(searchFilter(term))
    .order("name")
    .limit(PORTAL_ONLY_LIMIT);
  if (error) throw new ContractError(error.message, 400);
  const rows = ((data ?? []) as unknown as Row[]).map(mapCustomer);
  if (rows.length === 0) return [];
  const { data: linked } = await admin
    .from("snagging_clients")
    .select("id, fsm_contact_id")
    .in(
      "id",
      rows.map((r) => r.id),
    );
  const fsmOf = new Map(((linked ?? []) as Row[]).map((r) => [String(r.id), r.fsm_contact_id ? String(r.fsm_contact_id) : null]));
  return rows.map((customer) => ({ customer, fsmContactId: fsmOf.get(customer.id) ?? customer.fsmContactId ?? null }));
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

  /*
    Zoho FSM slow or unreachable (23 Nov 2026): the clients already in the
    portal are listed instead, with a notice and a way to try again, rather
    than only an error that stops the enquiry.
  */
  let fsm: Awaited<ReturnType<typeof listContacts>>;
  let portalOnly: CustomerRecord[];
  let matches: Awaited<ReturnType<typeof portalMatches>>;
  try {
    const token = await getFsmAccessToken(admin);
    const paging = { page: query.page, perPage: query.perPage };
    const firstPage = query.page === 0;
    [fsm, portalOnly, matches] = await Promise.all([
      search ? searchContacts(token, search, paging) : listContacts(token, paging),
      firstPage ? portalOnlyClients(admin, search) : Promise.resolve([] as CustomerRecord[]),
      firstPage && search ? portalMatches(admin, search) : Promise.resolve([]),
    ]);
  } catch (error) {
    if (!(error instanceof FsmApiError) && !(error instanceof FsmConfigError)) throw error;
    console.warn("[amc:clients] Zoho FSM unavailable, listing portal clients:", error.message);
    const page = await portalPage(admin, { search, page: query.page, perPage: query.perPage, lifecycle });
    return { ...page, notice: "Zoho FSM did not answer, so these are the clients already saved in the portal. Try again in a moment to search FSM." };
  }
  const { rows: contacts, hasMore } = fsm;

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
      /* Zoho FSM's customer number is the Client ID; the portal's copy stands in when FSM has none. */
      customerRef: contact.customerId ?? local?.customerRef ?? null,
      lifecycle: local?.lifecycle ?? null,
      portalOnly: false,
      customer: local ?? null,
    };
  });
  const shown = new Set(fsmRows.map((r) => r.id).filter(Boolean));
  const shownContacts = new Set(fsmRows.map((r) => r.fsmContactId).filter(Boolean));
  const onlyHere = portalOnly.filter((c) => !shown.has(c.id));
  for (const c of onlyHere) shown.add(c.id);
  // Name matches FSM's search missed: linked clients keep their FSM contact.
  const named = matches
    .filter((m) => !shown.has(m.customer.id) && !(m.fsmContactId && shownContacts.has(m.fsmContactId)))
    .map((m) => fromCustomer(m.customer, !m.fsmContactId, m.fsmContactId));
  return {
    clients: [
      ...onlyHere.map((c) => fromCustomer(c, true, null)),
      ...named,
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
  await copyCustomerIdFromFsm(admin, linked.id, fsmContactId, actorId);
  await ensureClientRef(admin, linked.id, actorId);
  return getCustomer(admin, linked.id);
}

/**
 * Zoho FSM's customer number (Customer_Id__C) onto the portal client as its
 * Client ID, so a proposal prints the number FSM keeps rather than one typed
 * by hand. FSM wins when it has one; the portal's stays when it has none. A
 * failure here never stops the client being used: the ID can still be added
 * with Edit client.
 */
async function copyCustomerIdFromFsm(admin: Admin, clientId: string, fsmContactId: string, actorId: string | null): Promise<void> {
  try {
    const contact = await getContact(await getFsmAccessToken(admin), fsmContactId);
    if (contact?.customerId) await writeClientProfile(admin, clientId, { customer_ref: contact.customerId }, actorId, true);
  } catch {
    /* Left as it was; the proposal asks for the ID when it is missing. */
  }
}
