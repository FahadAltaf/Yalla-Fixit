import { executeRESTBackend } from "@/lib/rest-server";

/** The Clients module (26 Nov 2026): one list and one Edit client for AMC and Snagging. */

export type ClientLifecycle = "prospect" | "client" | "former";

export type ClientRow = {
  /** The portal client; null for a Zoho FSM contact the portal has not used yet. */
  id: string | null;
  fsmContactId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  customerRef: string | null;
  /** AMC's status; null until AMC has the client. */
  lifecycle: ClientLifecycle | null;
  /** In the portal only: Zoho FSM does not have this client yet. */
  portalOnly: boolean;
};

export type ClientsPage = {
  clients: ClientRow[];
  hasMore: boolean;
  source: "fsm" | "portal";
  /** Zoho FSM did not answer, so the portal's own clients are listed. */
  notice?: string;
  /** New clients and edits are saved to Zoho FSM too. */
  writesToFsm: boolean;
};

export type ClientAmcFields = {
  customerRef: string | null;
  customerType: string | null;
  lifecycle: ClientLifecycle;
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
  maherId: string | null;
  notes: string | null;
  createdBy: string | null;
  amc: ClientAmcFields | null;
};

export type ClientForEdit = {
  client: ClientRecord;
  canEditContact: boolean;
  canEditAmc: boolean;
  savedInFsm: boolean;
};

export type ClientContactInput = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  maherId: string | null;
  notes: string | null;
};

export const clientsService = {
  page(query: { q?: string; page: number; pageSize: number; lifecycle?: ClientLifecycle | null }) {
    return executeRESTBackend<ClientsPage>("/api/clients", {
      params: {
        q: query.q ?? "",
        page: query.page,
        pageSize: query.pageSize,
        ...(query.lifecycle ? { lifecycle: query.lifecycle } : {}),
      },
    });
  },
  /** The portal client behind an FSM contact, made the first time it is opened. */
  link(fsmContactId: string) {
    return executeRESTBackend<{ id: string }>("/api/clients/link", { method: "POST", body: { fsmContactId } });
  },
  get(id: string) {
    return executeRESTBackend<ClientForEdit>(`/api/clients/${id}`);
  },
  create(input: ClientContactInput) {
    return executeRESTBackend<{ client: { id: string; name: string }; existed: boolean }>("/api/clients", {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    });
  },
  update(id: string, input: ClientContactInput & { amc?: Partial<ClientAmcFields> | null }) {
    return executeRESTBackend<{ client: ClientRecord }>(`/api/clients/${id}`, {
      method: "PATCH",
      body: input as unknown as Record<string, unknown>,
    });
  },
};

/** The portal id for a list row, linking an FSM contact the first time. */
export async function clientIdForRow(row: Pick<ClientRow, "id" | "fsmContactId">): Promise<string> {
  if (row.id) return row.id;
  if (!row.fsmContactId) throw new Error("This client cannot be opened.");
  return (await clientsService.link(row.fsmContactId)).id;
}
