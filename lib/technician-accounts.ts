/**
 * A technician's portal login, as the browser sees it (13 Nov 2026).
 * Server side: lib/server/technician-accounts.ts.
 */

export interface TechnicianAccount {
  fsmId: string;
  name: string;
  /** From Zoho FSM; the login uses it. */
  email: string | null;
  /** The linked portal account, when there is one. */
  userId: string | null;
  /** none: no login yet; inactive: the account is switched off; ready: can sign in. */
  login: "none" | "inactive" | "ready";
  /** The linked account's role can open Snagging, so it can be put on a job. */
  canInspect: boolean;
}

export interface TechnicianLoginResult {
  fsmId: string;
  name: string;
  email: string | null;
  userId: string;
  /** created: a new Inspector login; linked: an account with that email already existed; existing: already linked. */
  status: "created" | "linked" | "existing";
  /** Only when created, shown once. */
  password?: string;
}

/** Who a login is being made for, as a crew list or a picker knows them. */
export interface TechnicianLoginTarget {
  fsmId: string;
  name: string;
  email?: string | null;
}
