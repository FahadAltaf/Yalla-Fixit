// Nearest expiry (FRD FR-4, D18).
//
// Across Emirates ID, passport and held certificates, which item expires
// first. Expired items are included, so the most overdue one wins. Items with
// no date (not held, missing expiry, non-expiring types) are excluded. Ties
// resolve in the order the caller lists the items: Emirates ID, passport,
// then certificates by sort order.

import type { ComplianceItemStatus } from "./status";

export type ExpiryItem = {
  /** Stable key: "emirates_id", "passport" or "cert:<certificate_type_id>". */
  key: string;
  label: string;
  status: ComplianceItemStatus;
  days: number | null;
  expiry: string | null;
};

export type NearestExpiry = {
  key: string;
  label: string;
  expiry: string;
  days: number;
  status: ComplianceItemStatus;
};

export function nearestExpiry(items: ExpiryItem[]): NearestExpiry | null {
  let best: NearestExpiry | null = null;
  for (const item of items) {
    if (item.days === null || !item.expiry) continue;
    if (best === null || item.days < best.days) {
      best = { key: item.key, label: item.label, expiry: item.expiry, days: item.days, status: item.status };
    }
  }
  return best;
}
