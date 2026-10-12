import type { TechnicianReference, TechnicianRole, TechnicianServiceType } from "@/types/types";

export type SortMode = "custom" | "default" | "site" | "name" | "role" | "service";

// The rank within a team: Supervisors first (each heads its own group of
// technicians), then service-typed technicians in the service list's order
// (Data Center before Maintenance), then anyone unclassified.
function defaultRank(tech: TechnicianReference, serviceOrder: Map<string, number>): number {
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
  // FR-6/FR-12: technician fsm id → site (the address of their first
  // appointment that day), for the "site" mode.
  siteOf?: Map<string, string>,
  // FR-13: the order the team arranged for THIS day (fsm id → position).
  // Technicians not in it follow, in the site order.
  customOrder?: Map<string, number>,
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

  // Teams: each technician under their SUPERVISOR (`team_leader_fsm_id`;
  // decision 25 Sep 2026: supervisor, not driver), the supervisor on top.
  const byId = new Map(list.map((t) => [t.fsm_resource_id, t]));
  const rankOf = (t: TechnicianReference) => defaultRank(t, serviceOrder);
  const groupHead = (t: TechnicianReference) =>
    t.team_leader_fsm_id && byId.has(t.team_leader_fsm_id) ? byId.get(t.team_leader_fsm_id)! : t;
  const byTeam = (a: TechnicianReference, b: TechnicianReference) => {
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
  };

  if (sortMode === "default") return list.sort(byTeam);

  // FR-12 (decision 29 Sep 2026): the board opens grouped by SITE. A
  // technician's site is the address of their first appointment that day, or
  // failing that their supervisor's site. Sites in alphabetical order; inside
  // a site the supervisor first, then their team. Technicians with no site
  // follow at the end, grouped under their supervisor.
  const site = siteOf ?? new Map<string, string>();
  const siteFor = (t: TechnicianReference) => site.get(t.fsm_resource_id) ?? site.get(groupHead(t).fsm_resource_id) ?? "";
  const bySite = (a: TechnicianReference, b: TechnicianReference) => {
    const sa = siteFor(a);
    const sb = siteFor(b);
    if (sa !== sb) {
      if (!sa) return 1;
      if (!sb) return -1;
      return sa.localeCompare(sb);
    }
    return byTeam(a, b);
  };

  if (sortMode === "custom" && customOrder) {
    // The team's own arrangement for the day; anyone they have not placed
    // follows in the site order.
    return list.sort(
      (a, b) =>
        (customOrder.get(a.fsm_resource_id) ?? Infinity) - (customOrder.get(b.fsm_resource_id) ?? Infinity) ||
        bySite(a, b),
    );
  }
  if (sortMode === "custom") {
    // No order arranged for this day: the site order.
    return list.sort(bySite);
  }
  return list.sort(bySite);
}
