import type { PropertyModel, RatePackage } from "./rate-card";

/**
 * Ready-made AMC packages (12 Nov 2026), the tiers a Dubai maintenance
 * company usually sells: three home tiers, a villa-only top tier, and
 * one each for offices/shops and restaurants. They are only a starting
 * point: the rate card editor adds them to the working copy, the team
 * changes what it likes, and nothing reaches a proposal until the card is
 * published. Units and visits a year are typical figures, not prices.
 *
 * Each line names a service from the AMC catalogue (amc-settings.ts). A
 * line whose service the catalogue does not have is left out when the
 * templates are added, so a renamed or removed service never breaks one.
 */
export interface PackageTemplate {
  id: string;
  name: string;
  description: string;
  models: PropertyModel[];
  lines: Array<{ serviceId: string; units: number; frequency: number }>;
}

const HOMES: PropertyModel[] = ["villa", "townhouse", "apartment"];
const VILLAS: PropertyModel[] = ["villa", "townhouse"];

/* One line: the service, its units (AC units, properties, hours) and how often a year. */
const line = (serviceId: string, units: number, frequency: number) => ({ serviceId, units, frequency });
/* Every package keeps the hotline and the emergency call-outs: what a client calls about first. */
const cover = [line("helpdesk", 1, 1), line("emergency", 1, 1)];

export const PACKAGE_TEMPLATES: readonly PackageTemplate[] = [
  {
    id: "essential",
    name: "Essential",
    description: "The basics kept running: AC, electrics and plumbing checked twice a year, with the 24/7 hotline and emergency call-outs.",
    models: HOMES,
    lines: [...cover, line("ac-ppm", 3, 2), line("electrical-ppm", 1, 2), line("plumbing-ppm", 1, 2)],
  },
  {
    id: "advantage",
    name: "Advantage",
    description: "Essential plus a third service visit, a yearly AC coil clean, quarterly pest control and non-emergency call-outs.",
    models: HOMES,
    lines: [
      ...cover,
      line("non-emergency", 1, 1),
      line("ac-ppm", 3, 3),
      line("coil-cleaning", 3, 1),
      line("electrical-ppm", 1, 3),
      line("plumbing-ppm", 1, 3),
      line("pest-control", 1, 4),
    ],
  },
  {
    id: "premium",
    name: "Premium",
    description: "Quarterly visits for a villa: full AC care (coils, ducts, Y-strainer), water tank and pump, pest control and handyman hours.",
    models: VILLAS,
    lines: [
      ...cover,
      line("non-emergency", 1, 1),
      line("ac-ppm", 5, 4),
      line("coil-cleaning", 5, 1),
      line("duct-cleaning", 5, 1),
      line("ac-y-strainer", 1, 1),
      line("electrical-ppm", 1, 4),
      line("plumbing-ppm", 1, 4),
      line("water-pump", 1, 2),
      line("water-tank", 1, 2),
      line("pest-control", 1, 4),
      line("handyman", 1, 6),
    ],
  },
  {
    id: "complete",
    name: "Complete",
    description: "Everything in Premium, plus deep cleaning, windows, roof drains, gas and fire safety checks and more handyman hours.",
    models: ["villa"],
    lines: [
      ...cover,
      line("non-emergency", 1, 1),
      line("ac-ppm", 5, 4),
      line("coil-cleaning", 5, 1),
      line("duct-cleaning", 5, 1),
      line("ac-y-strainer", 1, 1),
      line("electrical-ppm", 1, 4),
      line("plumbing-ppm", 1, 4),
      line("water-pump", 1, 2),
      line("water-tank", 1, 2),
      line("roof-drain", 1, 2),
      line("pest-control", 1, 4),
      line("deep-cleaning", 1, 2),
      line("facade-window", 1, 4),
      line("gas-leak-detection", 1, 2),
      line("fire-extinguishers", 1, 1),
      line("handyman", 1, 12),
    ],
  },
  {
    id: "business",
    name: "Business Care",
    description: "For offices, shops, clinics and warehouses: quarterly AC, electrical and plumbing visits with the fire and life safety checks Civil Defence expects.",
    models: ["office", "shop", "clinic", "warehouse"],
    lines: [
      ...cover,
      line("non-emergency", 1, 1),
      line("ac-ppm", 6, 4),
      line("electrical-ppm", 1, 4),
      line("plumbing-ppm", 1, 4),
      line("fire-alarm", 1, 4),
      line("emergency-lighting", 1, 4),
      line("fire-extinguishers", 1, 1),
      line("pest-control", 1, 4),
    ],
  },
  {
    id: "kitchen",
    name: "Restaurant & Kitchen",
    description: "For restaurants: kitchen exhaust, grease trap and floor drains, kitchen fire suppression and gas checks, with monthly pest control.",
    models: ["restaurant"],
    lines: [
      ...cover,
      line("ac-ppm", 4, 4),
      line("kitchen-exhaust", 1, 2),
      line("grease-trap", 1, 4),
      line("kitchen-floor-drain", 1, 4),
      line("kitchen-fire-suppression", 1, 2),
      line("gas-leak-detection", 1, 2),
      line("fire-extinguishers", 1, 1),
      line("pest-control", 1, 12),
    ],
  },
];

/**
 * The templates a card does not have yet (by id or by name), with lines
 * only for services the catalogue has. A template left with fewer than two
 * lines is not worth offering.
 */
export function suggestedPackages(existing: readonly Pick<RatePackage, "id" | "name">[], serviceIds: Iterable<string>): RatePackage[] {
  const known = new Set(serviceIds);
  const taken = new Set(existing.flatMap((p) => [p.id, p.name.trim().toLowerCase()]));
  return PACKAGE_TEMPLATES.filter((t) => !taken.has(t.id) && !taken.has(t.name.toLowerCase()))
    .map((t) => ({ ...t, models: [...t.models], lines: t.lines.filter((l) => known.has(l.serviceId)), active: true }))
    .filter((p) => p.lines.length >= 2);
}
