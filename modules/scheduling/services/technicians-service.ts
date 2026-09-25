import { createServerClientWithCookies } from "@/lib/supabase/supabase-helpers";
import { executeRESTBackend } from "@/lib/rest-server";
import type { TechnicianReference, TechnicianShift } from "@/types/types";

export type { TechnicianReference } from "@/types/types";

// NOTE: this module is re-exported by the @/modules/scheduling barrel, which
// "use client" components import for techniciansService. Keep server-only
// machinery (admin client, Zoho calls) OUT of here or it lands in the client
// bundle -- the roster refresh lives in the page instead, via
// refreshTechniciansIfStale() from @/lib/server/zoho/service-resources.

// Server component loader. Resolves the managed attribute names (role,
// service type, team leader) alongside the raw ids so the UI needn't join.
export async function listTechnicians(): Promise<TechnicianReference[]> {
  const supabase = await createServerClientWithCookies();

  // role_id and service_type_id BOTH point at lookup_options, so each embed
  // must name its foreign key explicitly -- PostgREST can't pick between two
  // relationships to the same table on its own.
  const baseColumns =
    "fsm_resource_id, display_name, is_active, last_synced_at, role_id, service_type_id, shift, team_leader_fsm_id, " +
    "role:lookup_options!technician_reference_role_id_fkey(name), " +
    "service_type:lookup_options!technician_reference_service_type_id_fkey(name)";
  const load = (columns: string) =>
    supabase.from("technician_reference").select(columns).order("display_name", { ascending: true });

  let { data, error } = await load(`${baseColumns}, board_position`);
  // board_position arrives with migration 20260917090000. Until it's applied,
  // load without it so the board still opens (Custom order just stays empty).
  if (error?.code === "42703") ({ data, error } = await load(baseColumns));

  if (error) throw new Error(`Failed to load technicians: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const nameByFsmId = new Map<string, string>();
  rows.forEach((r) => nameByFsmId.set(r.fsm_resource_id as string, r.display_name as string));

  return rows.map((r) => {
    const role = r.role as { name?: string } | { name?: string }[] | null;
    const service = r.service_type as { name?: string } | { name?: string }[] | null;
    const roleName = Array.isArray(role) ? role[0]?.name : role?.name;
    const serviceName = Array.isArray(service) ? service[0]?.name : service?.name;
    return {
      fsm_resource_id: r.fsm_resource_id as string,
      display_name: r.display_name as string,
      is_active: r.is_active as boolean,
      last_synced_at: r.last_synced_at as string,
      role_id: (r.role_id as string) ?? null,
      role_name: roleName ?? null,
      service_type_id: (r.service_type_id as string) ?? null,
      service_type_name: serviceName ?? null,
      shift: (r.shift as TechnicianShift) ?? null,
      team_leader_fsm_id: (r.team_leader_fsm_id as string) ?? null,
      team_leader_name: r.team_leader_fsm_id ? (nameByFsmId.get(r.team_leader_fsm_id as string) ?? null) : null,
      board_position: typeof r.board_position === "number" ? r.board_position : null,
    };
  });
}

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
