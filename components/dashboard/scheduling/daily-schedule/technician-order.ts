import type { TechnicianReference, TechnicianRole, TechnicianServiceType } from "@/types/types";

export type SortMode = "default" | "name" | "role" | "service";

// Which technicians are DRIVERS — role "Driver", or referenced as another
// technician's driver (the team_leader_fsm_id link, now used as "assigned
// driver"). Drivers head their group on the grid and are highlighted; the
// technicians assigned to a driver are listed underneath them.
export function computeDriverIds(techs: TechnicianReference[]): Set<string> {
  const drivers = new Set<string>();
  techs.forEach((t) => {
    if (t.team_leader_fsm_id) drivers.add(t.team_leader_fsm_id);
    if ((t.role_name ?? "").toLowerCase() === "driver") drivers.add(t.fsm_resource_id);
  });
  return drivers;
}

// The default-view rank (#14): Drivers first (each heads its own group of
// technicians), then service-typed technicians in the service list's order
// (Data Center before Maintenance), then anyone unclassified.
function defaultRank(
  tech: TechnicianReference,
  serviceOrder: Map<string, number>,
): number {
  const role = (tech.role_name ?? "").toLowerCase();
  if (role === "driver") return 0;
  if (tech.service_type_id && serviceOrder.has(tech.service_type_id)) {
    return 100 + (serviceOrder.get(tech.service_type_id) ?? 0);
  }
  return 950;
}

export function orderTechnicians(
  techs: TechnicianReference[],
  sortMode: SortMode,
  roles: TechnicianRole[],
  services: TechnicianServiceType[],
): TechnicianReference[] {
  const serviceOrder = new Map(services.map((s) => [s.id, s.sort_order]));
  const roleOrder = new Map(roles.map((r) => [r.id, r.sort_order]));
  const byName = (a: TechnicianReference, b: TechnicianReference) => a.display_name.localeCompare(b.display_name);
  const list = [...techs];

  if (sortMode === "name") return list.sort(byName);
  if (sortMode === "role") {
    return list.sort(
      (a, b) =>
        (roleOrder.get(a.role_id ?? "") ?? 9999) - (roleOrder.get(b.role_id ?? "") ?? 9999) || byName(a, b),
    );
  }
  if (sortMode === "service") {
    return list.sort(
      (a, b) =>
        (serviceOrder.get(a.service_type_id ?? "") ?? 9999) - (serviceOrder.get(b.service_type_id ?? "") ?? 9999) ||
        byName(a, b),
    );
  }

  // Default: group each team under its DRIVER, driver on top, groups ordered
  // by the driver's rank. A technician's `team_leader_fsm_id` is the driver
  // they are assigned to.
  const byId = new Map(list.map((t) => [t.fsm_resource_id, t]));
  const rankOf = (t: TechnicianReference) => defaultRank(t, serviceOrder);
  const groupHead = (t: TechnicianReference) =>
    t.team_leader_fsm_id && byId.has(t.team_leader_fsm_id) ? byId.get(t.team_leader_fsm_id)! : t;

  return list.sort((a, b) => {
    const ha = groupHead(a);
    const hb = groupHead(b);
    if (ha.fsm_resource_id !== hb.fsm_resource_id) {
      // Different teams: order by the driver's rank, then the driver's name.
      return rankOf(ha) - rankOf(hb) || byName(ha, hb);
    }
    // Same team: the driver (head) first, then members by rank/name.
    const aIsHead = a.fsm_resource_id === ha.fsm_resource_id ? 0 : 1;
    const bIsHead = b.fsm_resource_id === hb.fsm_resource_id ? 0 : 1;
    return aIsHead - bIsHead || rankOf(a) - rankOf(b) || byName(a, b);
  });
}
