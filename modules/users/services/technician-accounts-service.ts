import { executeRESTBackend } from "@/lib/rest-server";
import type { TechnicianAccount, TechnicianLoginResult } from "@/lib/technician-accounts";

export interface TechnicianAccountsList {
  technicians: TechnicianAccount[];
  /** Inspector accounts that are not technicians. */
  inspectors: Array<{ id: string; name: string; email: string | null }>;
}

/*
  The same list for every picker on a screen: one request in flight at a
  time and a short cache, dropped whenever a login is made so the next
  picker sees it.
*/
const TTL_MS = 60_000;
let cache: { at: number; list: TechnicianAccountsList } | null = null;
let inFlight: Promise<TechnicianAccountsList> | null = null;

export const technicianAccountsService = {
  list: async (): Promise<TechnicianAccountsList> => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.list;
    if (inFlight) return inFlight;
    inFlight = executeRESTBackend<TechnicianAccountsList>("/api/technician-accounts")
      .then((list) => {
        cache = { at: Date.now(), list };
        return list;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
  /** Link or create the technician's login; a new one's password comes back once. */
  createLogin: (fsmId: string) =>
    executeRESTBackend<TechnicianLoginResult>("/api/technician-accounts", { method: "POST", body: { fsmId } }),
  forget: () => {
    cache = null;
  },
};
