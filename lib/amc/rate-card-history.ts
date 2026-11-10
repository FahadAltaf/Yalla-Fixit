import { formatCurrencyAED } from "@/utils/format-currency";

import { MODEL_LABELS, RATE_BASIS_LABELS } from "./rate-card";

/**
 * A published rate card change in words, for the History tab (BRD 5.3: old
 * and new value per field). diffRateCards says which fields changed; this
 * says what they were: rates in AED, visits a year, dates, property models
 * and service names, and a package's services as what was added, removed
 * or changed rather than two whole lists.
 */

const dmy = (iso: string) => iso.split("-").reverse().join("/");

/** The card's field names as people say them. */
const FIELD_LABELS: Record<string, string> = {
  serviceId: "Service",
  model: "Property model",
  unit: "Per",
  basis: "Counted",
  standardRate: "Standard rate",
  floorRate: "Floor rate",
  allowedFrequencies: "Visits a year",
  retired: "Retired",
  name: "Name",
  description: "Description",
  models: "Property models",
  lines: "Services",
  active: "Active",
  startDate: "Starts",
  endDate: "Ends",
  percentOff: "Off",
  serviceIds: "Services",
};

type PackageLine = { serviceId: string; units: number; frequency: number };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One value of a field, in the words the rate card screen uses. */
function showValue(field: string, value: unknown, label: (id: string) => string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  switch (field) {
    case "standardRate":
    case "floorRate":
      return formatCurrencyAED(Number(value));
    case "percentOff":
      return `${value}%`;
    case "startDate":
    case "endDate":
      return dmy(String(value));
    case "basis":
      return RATE_BASIS_LABELS[value as keyof typeof RATE_BASIS_LABELS] ?? String(value);
    case "model":
      return MODEL_LABELS[value as keyof typeof MODEL_LABELS] ?? String(value);
    case "serviceId":
      return label(String(value));
    case "allowedFrequencies":
      return Array.isArray(value) && value.length ? `${value.join(", ")} a year` : "Any";
    case "models":
      return Array.isArray(value) && value.length ? value.map((m) => MODEL_LABELS[m as keyof typeof MODEL_LABELS] ?? String(m)).join(", ") : "Every property model";
    case "serviceIds":
      return Array.isArray(value) && value.length ? value.map((s) => label(String(s))).join(", ") : "Every service";
    case "lines":
      return Array.isArray(value) && value.length
        ? (value as PackageLine[]).map((l) => `${label(l.serviceId)} (${plural(l.units, "unit")}, ${l.frequency} a year)`).join(", ")
        : "None";
  }
  return Array.isArray(value) ? value.map(String).join(", ") || "—" : String(value);
}

/**
 * A package's services as what changed, not two whole lists: added,
 * removed, or the units and visits a year that moved.
 */
function linesChange(before: unknown, after: unknown, label: (id: string) => string): string {
  const old = new Map(((Array.isArray(before) ? before : []) as PackageLine[]).map((l) => [l.serviceId, l]));
  const next = new Map(((Array.isArray(after) ? after : []) as PackageLine[]).map((l) => [l.serviceId, l]));
  const parts: string[] = [];
  for (const [id, l] of next) {
    const was = old.get(id);
    if (!was) parts.push(`${label(id)} added (${plural(l.units, "unit")}, ${l.frequency} a year)`);
    else {
      const moved = [
        was.units !== l.units ? `units ${was.units} → ${l.units}` : null,
        was.frequency !== l.frequency ? `visits a year ${was.frequency} → ${l.frequency}` : null,
      ].filter(Boolean);
      if (moved.length) parts.push(`${label(id)} ${moved.join(", ")}`);
    }
  }
  for (const id of old.keys()) if (!next.has(id)) parts.push(`${label(id)} removed`);
  return parts.join("; ") || "reordered";
}

/** "Standard rate: AED 40.00 → AED 43.00", or the package services that changed. */
export function describeRateCardField(f: { field: string; before: unknown; after: unknown }, label: (id: string) => string): string {
  const name = FIELD_LABELS[f.field] ?? f.field;
  if (f.field === "lines") return `${name}: ${linesChange(f.before, f.after, label)}`;
  return `${name}: ${showValue(f.field, f.before, label)} → ${showValue(f.field, f.after, label)}`;
}
