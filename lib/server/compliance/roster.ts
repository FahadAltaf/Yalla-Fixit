// FSM roster freshness for the compliance module (FRD D11).
//
// The portal keeps a copy of the FSM technician roster in technician_reference.
// Scheduling refreshes it on demand and when its pages open with a copy older
// than six hours. The compliance module needs the D11 "inactive in FSM" signal
// sooner than that, and must not depend on anyone opening Scheduling, so:
//   - the employee record refreshes when the copy is older than 15 minutes;
//   - the list and overview use the same six-hour rule as Scheduling;
//   - a Refresh button on the compliance pages runs the sync at once.
// The sync itself is Scheduling's function, writing the same table, so the two
// modules can never disagree about who is active. No scheduled job: the
// senior developer ruled out cron (27 Oct 2026).

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { syncFsmTechnicians, TECHNICIAN_CACHE_MAX_AGE_MS } from "@/lib/server/zoho/service-resources";

export const RECORD_ROSTER_MAX_AGE_MS = 15 * 60 * 1000;
export const LIST_ROSTER_MAX_AGE_MS = TECHNICIAN_CACHE_MAX_AGE_MS;

/** When the roster copy was last written, or null if it never was. */
export async function rosterSyncedAt(): Promise<string | null> {
  try {
    const admin = await createAdminServerClient();
    const { data } = await admin.from("technician_reference").select("last_synced_at").order("last_synced_at", { ascending: false }).limit(1).maybeSingle();
    return (data as { last_synced_at: string | null } | null)?.last_synced_at ?? null;
  } catch {
    return null;
  }
}

/** Refresh the roster from FSM if the copy is older than `maxAgeMs`. Never throws. */
export async function refreshRosterIfOlderThan(maxAgeMs: number): Promise<{ refreshed: boolean }> {
  try {
    const at = await rosterSyncedAt();
    const age = at ? Date.now() - new Date(at).getTime() : Number.POSITIVE_INFINITY;
    if (age < maxAgeMs) return { refreshed: false };
    const result = await syncFsmTechnicians();
    return { refreshed: result.ok };
  } catch (error) {
    console.error("[compliance:refreshRosterIfOlderThan]", error);
    return { refreshed: false };
  }
}
