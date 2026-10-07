import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType, type TechnicianReference, type TechnicianShift } from "@/types/types";

// Server component loader for the scheduling pages. Resolves the managed
// attribute names (role, service type, team leader) alongside the raw ids so
// the UI needn't join.
//
// Reads with the service role, like every /api/scheduling route: the
// scheduling tables grant nothing to anon or authenticated on the live
// database, so a read through the signed-in user's session is refused with
// "permission denied" and took the whole page down. The permission check the
// grants used to stand in for is made here instead -- anyone who is not
// signed in with Scheduling view gets an empty roster, and the page's own
// client-side guard sends them on as before.
export async function listTechniciansForViewer(): Promise<TechnicianReference[]> {
  const { accessUser } = await getAuthenticatedUserAccess();
  if (!accessUser || !hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) return [];

  const admin = await createAdminServerClient();

  // role_id and service_type_id BOTH point at lookup_options, so each embed
  // must name its foreign key explicitly -- PostgREST can't pick between two
  // relationships to the same table on its own.
  const baseColumns =
    "fsm_resource_id, display_name, is_active, last_synced_at, role_id, service_type_id, shift, team_leader_fsm_id, " +
    "role:lookup_options!technician_reference_role_id_fkey(name), " +
    "service_type:lookup_options!technician_reference_service_type_id_fkey(name)";
  const load = (columns: string) =>
    admin.from("technician_reference").select(columns).order("display_name", { ascending: true });

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
