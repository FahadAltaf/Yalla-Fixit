/**
 * What the approver checks on a site visit (23 Nov 2026, the user: the
 * same approver checklist as proposals). Two parts:
 *
 *   - what approving changes on the property: each asset and scope item
 *     the inspector added, changed or removed on site (held until then);
 *   - what DEV-362 says a site visit records (attendance, asset count,
 *     condition notes, photos, access notes, recommended scope,
 *     exclusions), each recorded or missing, and what needs a look: a
 *     checklist question left unanswered, an asset in poor or critical
 *     condition, a scope item with no visits a year.
 *
 * Pure: the route builds it from the visit, its held changes and photos.
 */

export type SiteCheckState = "ok" | "missing" | "warn";

export interface SiteCheck {
  key: string;
  label: string;
  state: SiteCheckState;
  detail: string;
}

export interface SiteChangeLine {
  entity: "asset" | "scope";
  op: "insert" | "update" | "delete";
  label: string;
}

export interface SiteVisitChecklist {
  changes: SiteChangeLine[];
  checks: SiteCheck[];
}

export interface SiteVisitChecklistInput {
  attendance: string | null;
  assetCounts: Record<string, number>;
  findings: string | null;
  summary: string | null;
  accessNotes: string | null;
  exclusions: string | null;
  recommendedServiceIds: string[];
  items: Array<{ label: string; result: string | null }>;
  photoCount: number;
  /** The property as approving would leave it. */
  assets: Array<{ assetType: string; location: string | null; condition: string }>;
  scope: Array<{ serviceId: string; frequencyPerYear: number | null }>;
  changes: Array<{ entity: "asset" | "scope"; op: "insert" | "update" | "delete"; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>;
  serviceLabel: (serviceId: string) => string;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function siteVisitChecklist(input: SiteVisitChecklistInput): SiteVisitChecklist {
  const changes: SiteChangeLine[] = input.changes.map((c) => {
    const row = (c.after ?? c.before ?? {}) as Record<string, unknown>;
    const label =
      c.entity === "asset"
        ? [text(row.assetType), text(row.location)].filter(Boolean).join(" · ") || "Asset"
        : input.serviceLabel(String(row.serviceId ?? ""));
    return { entity: c.entity, op: c.op, label };
  });

  const counted = Object.values(input.assetCounts ?? {}).reduce((s, n) => s + (Number(n) || 0), 0);
  const unanswered = input.items.filter((i) => !i.result);
  const poor = input.assets.filter((a) => a.condition === "poor" || a.condition === "critical");
  const noVisits = input.scope.filter((s) => !s.frequencyPerYear);
  const recorded = (key: string, label: string, value: string | null, missing: string): SiteCheck =>
    value ? { key, label, state: "ok", detail: value.length > 120 ? `${value.slice(0, 117)}…` : value } : { key, label, state: "missing", detail: missing };

  const checks: SiteCheck[] = [
    recorded("attendance", "Attendance", text(input.attendance), "Who was there is not recorded."),
    counted > 0 || input.assets.length > 0
      ? { key: "assets", label: "Asset count", state: "ok", detail: counted > 0 ? plural(counted, "asset") + " counted" : plural(input.assets.length, "asset") + " on the property" }
      : { key: "assets", label: "Asset count", state: "missing", detail: "No assets counted or recorded." },
    recorded("condition", "Condition notes", text(input.findings) ?? text(input.summary), "No findings or condition notes."),
    input.photoCount > 0
      ? { key: "photos", label: "Photos", state: "ok", detail: plural(input.photoCount, "photo") }
      : { key: "photos", label: "Photos", state: "missing", detail: "No photos taken." },
    recorded("access", "Access notes", text(input.accessNotes), "No access notes."),
    input.scope.length > 0 || input.recommendedServiceIds.length > 0
      ? {
          key: "scope",
          label: "Recommended scope",
          state: "ok",
          detail: input.scope.length ? plural(input.scope.length, "service") + " in the scope" : plural(input.recommendedServiceIds.length, "service") + " recommended",
        }
      : { key: "scope", label: "Recommended scope", state: "missing", detail: "No services recommended." },
    recorded("exclusions", "Exclusions", text(input.exclusions), "No exclusions noted (fine if there are none)."),
  ];
  if (unanswered.length) {
    checks.push({
      key: "unanswered",
      label: "Checklist",
      state: "warn",
      detail: `${plural(unanswered.length, "question")} not answered: ${unanswered.slice(0, 4).map((i) => i.label).join(", ")}${unanswered.length > 4 ? "…" : ""}`,
    });
  }
  if (poor.length) {
    checks.push({
      key: "poor",
      label: "Assets needing attention",
      state: "warn",
      detail: `${plural(poor.length, "asset")} in poor or critical condition: ${poor.slice(0, 4).map((a) => [a.assetType, a.location].filter(Boolean).join(" · ")).join(", ")}${poor.length > 4 ? "…" : ""}`,
    });
  }
  if (noVisits.length) {
    checks.push({
      key: "no_visits",
      label: "Scope without visits a year",
      state: "warn",
      detail: `${noVisits.map((s) => input.serviceLabel(s.serviceId)).join(", ")}: the schedule needs a number of visits.`,
    });
  }
  return { changes, checks };
}
