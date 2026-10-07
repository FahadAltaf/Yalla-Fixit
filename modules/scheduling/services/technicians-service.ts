import { executeRESTBackend } from "@/lib/rest-server";
import type { TechnicianShift } from "@/types/types";

export type { TechnicianReference } from "@/types/types";

// NOTE: this module is re-exported by the @/modules/scheduling barrel, which
// "use client" components import for techniciansService. Keep server-only
// machinery (admin client, Zoho calls) OUT of here or it lands in the client
// bundle -- the roster loader (lib/server/scheduling-technicians.ts) and the
// roster refresh live in the page instead, the refresh via
// refreshTechniciansIfStale() from @/lib/server/zoho/service-resources.

export interface TechnicianAttributeUpdate {
  roleId?: string | null;
  serviceTypeId?: string | null;
  shift?: TechnicianShift | null;
  teamLeaderFsmId?: string | null;
}

// Client-side: set attributes on one or many technicians at once (#15 bulk edit).
export const techniciansService = {
  updateAttributes: async (
    fsmResourceIds: string[],
    attributes: TechnicianAttributeUpdate,
  ): Promise<{ updated: number }> => {
    return executeRESTBackend<{ updated: number }>("/api/scheduling/technicians", {
      method: "PUT",
      body: { fsmResourceIds, attributes },
    });
  },

  // Save the team's row order for the schedule board ("Custom" sort): the full
  // list of technician ids, top to bottom.
  saveBoardOrder: async (order: string[]): Promise<{ updated: number }> => {
    return executeRESTBackend<{ updated: number }>("/api/scheduling/technicians/order", {
      method: "PUT",
      body: { order },
    });
  },

  // SYNC-013: pull the roster from Zoho FSM on demand. The page also
  // self-refreshes when the cache is older than 6h, so this is the manual
  // "I know someone just joined/left" escape hatch.
  refreshFromFsm: async (): Promise<{
    resources: unknown[];
    removed: { deleted: string[]; referenced: string[] };
  }> => {
    return executeRESTBackend("/api/service-resources", { method: "POST" });
  },
};
