import type { SupabaseClient } from "@supabase/supabase-js";

import type { SnaggingTaskStatus } from "@/types/types";

/**
 * Shared query helpers for the Snagging Overview sections.
 *
 * Every section endpoint reads through here so they count the same way,
 * and so the counting stays in Postgres. Each helper issues a head-only
 * query — `count: "exact", head: true` returns the number and no rows —
 * which is what keeps the page honest as the table grows from nine jobs
 * to nine thousand. Nothing on this page pulls a row set back to count
 * its length in JavaScript.
 */

export type Admin = SupabaseClient;

/** A window of days ending today, in the shape PostgREST wants. */
export type Period = {
  days: number;
  fromTs: string;
  toTs: string;
  /** The equally sized window immediately before this one, for trends. */
  previousFromTs: string;
  previousToTs: string;
};

export function resolvePeriod(daysParam: string | null, fallback = 30): Period {
  const raw = Number(daysParam);
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(365, Math.floor(raw)) : fallback;

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const from = now - days * dayMs;
  return {
    days,
    fromTs: new Date(from).toISOString(),
    toTs: new Date(now).toISOString(),
    previousFromTs: new Date(from - days * dayMs).toISOString(),
    previousToTs: new Date(from).toISOString(),
  };
}

/** Start of today in UTC, for the "assigned today" style counters. */
export function startOfToday(): string {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
}

type Refine<T> = (query: T) => T;

/**
 * COUNT(*) over snagging_jobs, refined by the caller.
 *
 * Typed loosely on purpose: the Supabase builder's type changes shape
 * with every filter, and pinning it here would make each call site
 * fight the compiler for no benefit — the query never leaves this file's
 * callers.
 */
export async function countJobs(
  admin: Admin,
  refine: Refine<any> = (query) => query,
): Promise<number> {
  const { count, error } = await refine(
    admin.from("snagging_jobs").select("id", { count: "exact", head: true }),
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** COUNT(*) over snagging_snags, refined by the caller. */
export async function countSnags(
  admin: Admin,
  refine: Refine<any> = (query) => query,
): Promise<number> {
  const { count, error } = await refine(
    admin.from("snagging_snags").select("id", { count: "exact", head: true }),
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** A percentage change between two counts, or null when there is no base. */
export function trendPercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/** The pipeline stages, in the order work moves through them. */
export const PIPELINE_STAGES: Array<{ status: SnaggingTaskStatus; label: string }> = [
  { status: "assigned", label: "Assigned" },
  { status: "in_progress", label: "In progress" },
  { status: "submitted", label: "Submitted" },
  { status: "in_review", label: "In review" },
  { status: "approved", label: "Approved" },
  { status: "delivered", label: "Delivered" },
];

/** Snag statuses that mean the defect is still outstanding. */
export const OPEN_SNAG_STATUSES = [
  "open",
  "pending_verification",
  "verified_poor_quality",
  "verified_not_done",
];

/** Snag statuses that mean the defect was closed off. */
export const RESOLVED_SNAG_STATUSES = ["verified_closed", "withdrawn"];

/**
 * Where a snag captured against the OLD catalogue belongs in the new one.
 *
 * The restructure replaced area / element / defect with category /
 * sub-category / defect, and it replaced rather than migrated: the twenty
 * categories are rows in `snagging_catalogue_categories` and a new snag
 * code reads `SN03-02-01`, but every snag captured before the new pickers
 * ship still carries the old `LDY-JN-HNG` shape, whose middle segment is
 * an element code.
 *
 * So a breakdown that only matched the new codes would draw twenty empty
 * bars while the portfolio plainly has defects in it. This is the bridge
 * that stops that: fifteen legacy element codes, each pointing at the
 * category its defects now live under.
 *
 * Every line is evidenced by a sub-category that exists in the new tree —
 * `BL` Balustrade lands on SN12 because "Balustrades & guarding" is a
 * sub-category of it, `SK` Skirting on SN03 because "Skirting & trims"
 * is one there. Nothing here is a guess about where the business thinks
 * a defect belongs.
 *
 * It is deletable. Once no snag on the system carries an old-style code,
 * this map and the legacy half of the query go, and the breakdown reads
 * the category segment alone.
 */
export const LEGACY_ELEMENT_CATEGORY: Record<string, string> = {
  WL: "SN03", // Walls        -> Walls, Ceilings & Finishes
  CL: "SN03", // Ceiling      -> Walls, Ceilings & Finishes
  PT: "SN03", // Paint        -> Walls, Ceilings & Finishes
  SK: "SN03", // Skirting     -> Walls, Ceilings & Finishes
  FL: "SN04", // Floor        -> Flooring & Tiling
  DR: "SN05", // Doors        -> Doors, Windows & Glazing
  WN: "SN05", // Windows      -> Doors, Windows & Glazing
  JN: "SN06", // Joinery      -> Joinery, Cabinetry & Furniture
  SN: "SN08", // Sanitary     -> Bathrooms & Sanitary Fixtures
  PL: "SN09", // Plumbing     -> Plumbing, Drainage & Water Systems
  EL: "SN10", // Electrical   -> Electrical, Lighting & Power
  HV: "SN11", // HVAC         -> Air Conditioning & Ventilation
  BL: "SN12", // Balustrade   -> Fire, Life Safety & EHS
  AP: "SN14", // Appliances   -> Appliances & Installed Equipment
  EX: "SN15", // External Works -> Facade, Balcony, Roof & External Areas
};

/** The legacy element codes that roll up into one category code. */
export function legacyElementsFor(categoryCode: string): string[] {
  return Object.entries(LEGACY_ELEMENT_CATEGORY)
    .filter(([, code]) => code === categoryCode)
    .map(([element]) => element);
}

/**
 * Cache headers per section.
 *
 * The live worklists revalidate quickly because they are what somebody
 * is acting on; the breakdowns sit longer because a severity split does
 * not meaningfully move minute to minute.
 */
export function cacheHeaders(seconds: number): Record<string, string> {
  return {
    "Cache-Control": `private, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`,
  };
}
