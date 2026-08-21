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

  const { data, error } = await supabase
    .from("technician_reference")
    .select(
      "fsm_resource_id, display_name, is_active, last_synced_at, role_id, service_type_id, shift, team_leader_fsm_id, " +
        "technician_roles(name), technician_service_types(name)",
    )
    .order("display_name", { ascending: true });

  if (error) throw new Error(`Failed to load technicians: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const nameByFsmId = new Map<string, string>();
  rows.forEach((r) => nameByFsmId.set(r.fsm_resource_id as string, r.display_name as string));

  return rows.map((r) => {
    const role = r.technician_roles as { name?: string } | { name?: string }[] | null;
    const service = r.technician_service_types as { name?: string } | { name?: string }[] | null;
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
};
