import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType, type User } from "@/types/types";

/**
 * Clients, one module for the whole portal (26 Nov 2026, the user: "we have
 * clients in both amc and snagging ... make only one"). AMC and Snagging
 * always shared the records (snagging_clients); now they share the page.
 *
 * Either module's Clients permission opens it, as either module's opens
 * Workforce. What each person sees on a client follows their module:
 *   amc       AMC's client page (contracts, visits, payments ...), AMC's fields
 *   snagging  the client's Snagging jobs
 */
export type ClientsAccess = {
  /** May open the Clients page at all. */
  view: boolean;
  /** Has AMC's view of a client. */
  amc: boolean;
  /** Has Snagging's view of a client (its jobs). */
  snagging: boolean;
  /** May add a client (created in Zoho FSM and the portal). */
  create: boolean;
  /** May correct a client's contact details through Snagging (Edit); AMC's own rule is checked per client on the server. */
  editViaSnagging: boolean;
};

export function clientsAccess(user: User | null | undefined): ClientsAccess {
  const can = (resource: ResourceType, action: ActionType) => hasResourceAction(user, resource, action);
  const amc = canUseAmc(user as User) && can(ResourceType.AMC_CLIENTS, ActionType.VIEW);
  const snagging = can(ResourceType.SNAGGING_CLIENTS, ActionType.VIEW);
  return {
    view: amc || snagging,
    amc,
    snagging,
    /* The rules each module had: any AMC user added clients; Snagging asked for Snagging (Create) and (Edit). */
    create: amc || can(ResourceType.SNAGGING, ActionType.CREATE),
    editViaSnagging: can(ResourceType.SNAGGING, ActionType.EDIT),
  };
}

/** The Clients page and a client's page. */
export const CLIENTS_HREF = "/clients";
export const clientHref = (id: string, tab?: string | null) => `${CLIENTS_HREF}/${id}${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`;
