import type { TechnicianReference, TechnicianRole, TechnicianServiceType } from "@/types/types";

export type SortMode = "custom" | "default" | "site" | "name" | "role" | "service";

// The default-view rank: Supervisors first (each heads its own group of
// technicians), then service-typed technicians in the service list's order
// (Data Center before Maintenance), then anyone unclassified.
function defaultRank(
  tech: TechnicianReference,
  serviceOrder: Map<string, number>,
): number {
  const role = (tech.role_name ?? "").toLowerCase();
  if (role === "supervisor") return 0;
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
  // FR-6: technician fsm id → site (appointment address), for the "site" mode.
  siteOf?: Map<string, string>,
): TechnicianReference[] {
  const serviceOrder = new Map(services.map((s) => [s.id, s.sort_order]));
  const roleOrder = new Map(roles.map((r) => [r.id, r.sort_order]));
  const byName = (a: TechnicianReference, b: TechnicianReference) => a.display_name.localeCompare(b.display_name);
  const list = [...techs];

  if (sortMode === "name") return list.sort(byName);
  // The team's own arrangement (rows dragged on the board); technicians not
  // arranged yet follow, by name.
  if (sortMode === "custom") {
    return list.sort(
      (a, b) => (a.board_position ?? Infinity) - (b.board_position ?? Infinity) || byName(a, b),
    );
  }
  // FR-6: group technicians by site (appointment address); those with no
  // appointment that day (no site) sink to the bottom.
  if (sortMode === "site") {
    const site = siteOf ?? new Map<string, string>();
    return list.sort((a, b) => {
      const sa = site.get(a.fsm_resource_id) ?? "";
      const sb = site.get(b.fsm_resource_id) ?? "";
      if (!sa && !sb) return byName(a, b);
      if (!sa) return 1;
      if (!sb) return -1;
      return sa.localeCompare(sb) || byName(a, b);
    });
  }
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

  // Default: group each team under its SUPERVISOR, supervisor on top, groups
  // ordered by the supervisor's rank. A technician's `team_leader_fsm_id` is the
  // supervisor they report to (decision 25 Sep 2026: supervisor, not driver).
  const byId = new Map(list.map((t) => [t.fsm_resource_id, t]));
  const rankOf = (t: TechnicianReference) => defaultRank(t, serviceOrder);
  const groupHead = (t: TechnicianReference) =>
    t.team_leader_fsm_id && byId.has(t.team_leader_fsm_id) ? byId.get(t.team_leader_fsm_id)! : t;

  return list.sort((a, b) => {
    const ha = groupHead(a);
    const hb = groupHead(b);
    if (ha.fsm_resource_id !== hb.fsm_resource_id) {
      // Different teams: order by the supervisor's rank, then their name.
      return rankOf(ha) - rankOf(hb) || byName(ha, hb);
    }
    // Same team: the supervisor (head) first, then members by rank/name.
    const aIsHead = a.fsm_resource_id === ha.fsm_resource_id ? 0 : 1;
    const bIsHead = b.fsm_resource_id === hb.fsm_resource_id ? 0 : 1;
    return aIsHead - bIsHead || rankOf(a) - rankOf(b) || byName(a, b);
  });
}
