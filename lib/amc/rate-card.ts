import { z } from "zod";

import { MAX_BASE_PRICE, MAX_FREQUENCY, MAX_UNITS, roundAed } from "./pricing";

/**
 * The governed AMC rate card (BRD 5.3; DEV-349, 363, 364). Pure: used by
 * the API, the rate-card screen, the wizard and the tests.
 *
 * A rate is per service and property model (villa, apartment, office, or
 * any): the unit it is charged in, the standard rate, the floor rate and
 * the frequencies allowed. Line value stays rate × units × frequency, as
 * the wizard has always calculated (lib/amc/pricing.ts). Users pick from
 * the card and discount within their authority; they never type a rate.
 *
 *   * Promotions in date reduce the rate automatically (a sanctioned price,
 *     never a trigger on their own).
 *   * A line whose rate after the proposal's discount falls below its floor
 *     is "below floor", which the approval ladder treats as a trigger.
 *   * Packages are preset service sets (the brochure packages).
 *
 * The card is stored whole, one version per publish, each effective from
 * a date (amc_rate_card_versions). The version in force on a day is the
 * latest published one whose date has come.
 */

/** The property models rates are set for: what `property.unitType` holds on a proposal. */
export const PROPERTY_MODELS = ["villa", "apartment", "office"] as const;
export type PropertyModel = (typeof PROPERTY_MODELS)[number];
export const MODEL_LABELS: Record<PropertyModel | "any", string> = { villa: "Villa", apartment: "Apartment", office: "Office", any: "Any property" };

/** How a rate is counted; the line is rate × units × frequency either way. */
export const RATE_BASES = ["per_unit", "per_property", "per_visit", "per_hour"] as const;
export type RateBasis = (typeof RATE_BASES)[number];
export const RATE_BASIS_LABELS: Record<RateBasis, string> = {
  per_unit: "Per unit",
  per_property: "Per property",
  per_visit: "Per visit",
  per_hour: "Per hour",
};

const id = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/, "Use lowercase letters, numbers, - and _");
const money = z.number().finite().min(0).max(MAX_BASE_PRICE);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");

export const rateItemSchema = z
  .object({
    id,
    serviceId: z.string().trim().min(1).max(100),
    model: z.enum(["any", ...PROPERTY_MODELS]),
    unit: z.string().trim().min(1, "Say what the rate is per").max(60),
    basis: z.enum(RATE_BASES),
    standardRate: money,
    floorRate: money,
    /* Empty: any frequency. */
    allowedFrequencies: z.array(z.number().int().min(1).max(MAX_FREQUENCY)).max(24).default([]),
    retired: z.boolean().default(false),
  })
  .strict()
  .refine((r) => r.floorRate <= r.standardRate, { message: "The floor rate cannot be above the standard rate", path: ["floorRate"] });

export const packageSchema = z
  .object({
    id,
    name: z.string().trim().min(1, "Name the package").max(80),
    description: z.string().trim().max(500).default(""),
    /* Empty: every model. */
    models: z.array(z.enum(PROPERTY_MODELS)).max(3).default([]),
    lines: z
      .array(
        z
          .object({
            serviceId: z.string().trim().min(1).max(100),
            units: z.number().int().min(1).max(MAX_UNITS),
            frequency: z.number().int().min(1).max(MAX_FREQUENCY),
          })
          .strict(),
      )
      .min(1, "A package has at least one service")
      .max(50),
    active: z.boolean().default(true),
  })
  .strict();

export const promotionSchema = z
  .object({
    id,
    name: z.string().trim().min(1, "Name the promotion").max(80),
    startDate: isoDate,
    endDate: isoDate,
    percentOff: z.number().gt(0, "A promotion takes something off").max(100),
    /* Empty: every service. */
    serviceIds: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    /* Empty: every model. */
    models: z.array(z.enum(PROPERTY_MODELS)).max(3).default([]),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((p) => p.endDate >= p.startDate, { message: "The promotion ends before it starts", path: ["endDate"] });

const unique = <T,>(list: T[], key: (item: T) => string) => new Set(list.map(key)).size === list.length;

export const rateCardSchema = z
  .object({
    items: z.array(rateItemSchema).max(300),
    packages: z.array(packageSchema).max(50).default([]),
    promotions: z.array(promotionSchema).max(50).default([]),
  })
  .strict()
  .refine((c) => unique(c.items, (i) => i.id), { message: "Two rates have the same id", path: ["items"] })
  .refine((c) => unique(c.items.filter((i) => !i.retired), (i) => `${i.serviceId}|${i.model}`), {
    message: "A service has two active rates for the same property model",
    path: ["items"],
  })
  .refine((c) => unique(c.packages, (p) => p.id), { message: "Two packages have the same id", path: ["packages"] })
  .refine((c) => unique(c.promotions, (p) => p.id), { message: "Two promotions have the same id", path: ["promotions"] });

export type RateItem = z.infer<typeof rateItemSchema>;
export type RatePackage = z.infer<typeof packageSchema>;
export type RatePromotion = z.infer<typeof promotionSchema>;
export type RateCard = z.infer<typeof rateCardSchema>;

export const publishRateCardSchema = z
  .object({
    card: rateCardSchema,
    effectiveFrom: isoDate,
    reason: z.string().trim().min(3, "Say why the card is changing").max(500),
  })
  .strict();

export function emptyRateCard(): RateCard {
  return { items: [], packages: [], promotions: [] };
}

/* ------------------------------------------------------------------ */
/* Which version, which rate                                           */
/* ------------------------------------------------------------------ */

/** The version in force on `day` (YYYY-MM-DD): the latest effective date that has come, then the latest published. */
export function versionInForce<T extends { effectiveFrom: string; versionNo: number }>(versions: readonly T[], day: string): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom > day) continue;
    if (!best || v.effectiveFrom > best.effectiveFrom || (v.effectiveFrom === best.effectiveFrom && v.versionNo > best.versionNo)) best = v;
  }
  return best;
}

/** The active rate for a service on a property model: the model's own, else the "any property" one. */
export function rateItemFor(card: RateCard, serviceId: string, model: string): RateItem | null {
  const live = card.items.filter((i) => !i.retired && i.serviceId === serviceId);
  return live.find((i) => i.model === model) ?? live.find((i) => i.model === "any") ?? null;
}

const appliesTo = (list: readonly string[], value: string) => list.length === 0 || list.includes(value);

/** The best promotion in date for a service on a model, or null. */
export function promotionFor(card: RateCard, serviceId: string, model: string, day: string): RatePromotion | null {
  let best: RatePromotion | null = null;
  for (const p of card.promotions) {
    if (!p.active || p.startDate > day || p.endDate < day) continue;
    if (!appliesTo(p.serviceIds, serviceId) || !appliesTo(p.models, model)) continue;
    if (!best || p.percentOff > best.percentOff) best = p;
  }
  return best;
}

/** The packages offered on a model. */
export function packagesFor(card: RateCard, model: string): RatePackage[] {
  return card.packages.filter((p) => p.active && appliesTo(p.models, model));
}

/* ------------------------------------------------------------------ */
/* Pricing lines from the card                                         */
/* ------------------------------------------------------------------ */

/** What a priced line keeps of the card, so it reads the same whatever the card says later. */
export interface RateFields {
  rateItemId: string | null;
  standardRate: number | null;
  floorRate: number | null;
  promotionId: string | null;
  promotionPercent: number | null;
  belowFloor: boolean;
}

/**
 * A line under its floor once the proposal's discount is applied. The floor
 * is compared with the rate actually offered, so a promotion alone never
 * triggers; a discount on top of it that goes under both does.
 */
export function lineBelowFloor(basePrice: number, floorRate: number, discountPercent: number): boolean {
  const pct = Math.min(100, Math.max(0, discountPercent || 0));
  if (pct === 0) return false;
  const effective = basePrice * (1 - pct / 100);
  return effective + 1e-9 < Math.min(floorRate, basePrice);
}

interface CardRow {
  serviceId: string;
  included: boolean;
  units: number;
  frequency: number;
  basePrice?: number | null;
  free?: boolean | null;
}

export interface CardPricing<R extends CardRow> {
  rows: Array<R & RateFields & { basePrice: number | null }>;
  belowFloor: boolean;
  /** Ticked lines the card cannot price, or priced at a frequency it does not allow. */
  problems: string[];
}

/**
 * Sets each line's base price from the card for this property model and
 * day: the standard rate, less a promotion in date. Free lines stay free.
 * Unticked lines are priced too, so ticking one shows its rate.
 */
export function applyRateCard<R extends CardRow>(
  rows: readonly R[],
  card: RateCard,
  model: string,
  day: string,
  discountPercent: number,
  labelOf: (serviceId: string) => string = (s) => s,
): CardPricing<R> {
  const problems: string[] = [];
  let belowFloor = false;
  const priced = rows.map((row) => {
    const item = rateItemFor(card, row.serviceId, model);
    if (!item) {
      if (row.included && !row.free) problems.push(`${labelOf(row.serviceId)} has no rate on the card for this property.`);
      const none: RateFields = { rateItemId: null, standardRate: null, floorRate: null, promotionId: null, promotionPercent: null, belowFloor: false };
      /* No rate, no price: a ticked line cannot be submitted until the card has one. */
      return { ...row, ...none, basePrice: null };
    }
    if (row.included && item.allowedFrequencies.length > 0 && !item.allowedFrequencies.includes(Math.trunc(row.frequency))) {
      problems.push(`${labelOf(row.serviceId)} can be ${item.allowedFrequencies.join(", ")} times a year on the card, not ${row.frequency}.`);
    }
    const promo = promotionFor(card, row.serviceId, model, day);
    const basePrice = roundAed(item.standardRate * (1 - (promo?.percentOff ?? 0) / 100));
    const under = row.included && !row.free && lineBelowFloor(basePrice, item.floorRate, discountPercent);
    if (under) belowFloor = true;
    return {
      ...row,
      basePrice: row.free ? null : basePrice,
      rateItemId: item.id,
      standardRate: item.standardRate,
      floorRate: item.floorRate,
      promotionId: promo?.id ?? null,
      promotionPercent: promo?.percentOff ?? null,
      belowFloor: under,
    };
  });
  return { rows: priced, belowFloor, problems };
}

/** A package's services ticked with its units and frequencies; every other charged line unticked, free lines kept. */
export function applyPackage<R extends CardRow>(rows: readonly R[], pkg: RatePackage): R[] {
  const lines = new Map(pkg.lines.map((l) => [l.serviceId, l]));
  return rows.map((row) => {
    const line = lines.get(row.serviceId);
    if (line) return { ...row, included: true, units: line.units, frequency: line.frequency };
    return row.free ? row : { ...row, included: false };
  });
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export interface RateCardChange {
  kind: "rate" | "package" | "promotion";
  id: string;
  label: string;
  change: "added" | "removed" | "changed";
  fields: Array<{ field: string; before: unknown; after: unknown }>;
}

function diffList<T extends { id: string }>(
  kind: RateCardChange["kind"],
  before: readonly T[],
  after: readonly T[],
  label: (item: T) => string,
): RateCardChange[] {
  const changes: RateCardChange[] = [];
  const old = new Map(before.map((i) => [i.id, i]));
  const next = new Map(after.map((i) => [i.id, i]));
  for (const [key, item] of next) {
    const prev = old.get(key);
    if (!prev) {
      changes.push({ kind, id: key, label: label(item), change: "added", fields: [] });
      continue;
    }
    const fields = [...new Set([...Object.keys(prev), ...Object.keys(item)])]
      .filter((f) => JSON.stringify((prev as Record<string, unknown>)[f]) !== JSON.stringify((item as Record<string, unknown>)[f]))
      .map((f) => ({ field: f, before: (prev as Record<string, unknown>)[f] ?? null, after: (item as Record<string, unknown>)[f] ?? null }));
    if (fields.length) changes.push({ kind, id: key, label: label(item), change: "changed", fields });
  }
  for (const [key, item] of old) if (!next.has(key)) changes.push({ kind, id: key, label: label(item), change: "removed", fields: [] });
  return changes;
}

/** What changed between two published cards: old and new value per field (BRD 5.3). */
export function diffRateCards(before: RateCard, after: RateCard, serviceLabel: (serviceId: string) => string = (s) => s): RateCardChange[] {
  return [
    ...diffList("rate", before.items, after.items, (i) => `${serviceLabel(i.serviceId)} · ${MODEL_LABELS[i.model]}`),
    ...diffList("package", before.packages, after.packages, (p) => p.name),
    ...diffList("promotion", before.promotions, after.promotions, (p) => p.name),
  ];
}

/** Reads a stored card, or null when its shape no longer validates (the caller then treats the card as not set). */
export function parseRateCard(value: unknown): RateCard | null {
  const parsed = rateCardSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
