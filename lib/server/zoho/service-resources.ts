// Zoho FSM technician (service resource) sync.
//
// Ported from the zoho-fsm-service-resources Edge Function (FRD LEAVE-001,
// TAG-006, Section 12.6). Zoho FSM has no dedicated "Service Resources"
// module -- technicians are Users whose record carries a Service_Resources
// sub-object (see fsm/v1/users).
//
// Refreshing is now on-demand instead of a 30-minute pg_cron job: the roster
// changes a handful of times a month, so polling it 48x a day was ~1,400
// wasted Zoho calls monthly. syncFsmTechnicians() backs the explicit Refresh
// action, and refreshTechniciansIfStale() lazily tops it up when the
// scheduling screen is opened and the cache has aged out.

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import {
  fsmFail,
  fsmFetch,
  fsmOk,
  fsmResultFromError,
  getFsmAccessToken,
  type FsmResult,
} from "./fsm-client";

const PER_PAGE = 200;
const MAX_PAGES = 10; // safety cap: 2000 users, far above expected headcount

// How old the cache may get before opening the scheduling screen refreshes it
// in the background. Replaces the every-30-minutes cron.
export const TECHNICIAN_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

// Only these FSM user profiles are operational technicians for scheduling.
// Excludes Administrator, Dispatcher, Manager, CallCenter Agent, etc.
// (per YFI: "we only need to see ones with the user profile Field Agent,
// Limited Field Agent, and YFI Field Agent V2").
const TECHNICIAN_PROFILES = new Set(["Field Agent", "Limited Field Agent", "YFI Field Agent V2"]);

// The /users listing includes invited, inactive and deleted accounts. The FSM
// top-level `status` is "active" even for a user who was only invited and
// never accepted -- what actually mirrors the "Active Users" tab in Zoho is
// `client_status`. Per YFI (Q-2): "We only need to consider Active Users."
const ACTIVE_CLIENT_STATUS = "Active";

type ZohoUser = {
  id: string;
  full_name?: string;
  email?: string;
  status?: string;
  client_status?: string; // "Active" | "Invited" | "Inactive" | "Deleted"
  confirm?: boolean;
  profile?: { name?: string; api_name?: string } | null;
  Service_Resources?: { id: string; Name?: string; isActive?: boolean } | null;
};

type Resource = {
  // The immutable FSM *service resource* ID (Service_Resources.id), NOT the
  // parent user's id -- these are distinct records in FSM and
  // LEAVE-002/TAG-006/BR-019 require the former.
  fsmResourceId: string;
  name: string | null;
  email: string | null;
  isActive: boolean;
};

// Some people hold more than one active FSM account under the same full name
// (different emails). Qualify the duplicates with the email so a scheduler can
// tell which account they are assigning work to.
function buildDisplayNamer(resources: Resource[]) {
  const nameCounts = new Map<string, number>();
  for (const r of resources) {
    const key = r.name ?? "";
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  return (r: Resource) => {
    if (r.name && (nameCounts.get(r.name) ?? 0) > 1 && r.email) return `${r.name} (${r.email})`;
    return r.name ?? r.email ?? r.fsmResourceId;
  };
}

// Pulls the technician roster from FSM and upserts public.technician_reference.
export async function syncFsmTechnicians(): Promise<FsmResult> {
  try {
    const admin = await createAdminServerClient();
    const token = await getFsmAccessToken(admin);

    const resources: Resource[] = [];
    // Reported back so a manual refresh can say what it pruned.
    const removed: { deleted: string[]; referenced: string[] } = { deleted: [], referenced: [] };

    let page = 1;
    let moreRecords = true;
    while (moreRecords && page <= MAX_PAGES) {
      const res = await fsmFetch(token, `/users?page=${page}&per_page=${PER_PAGE}`);
      if (!res.ok) {
        console.error(`[zoho:syncFsmTechnicians] FSM error page=${page}:`, res.json);
        return fsmFail("Failed to fetch users from Zoho FSM", 502);
      }

      for (const user of (res.json?.users ?? []) as ZohoUser[]) {
        if (!user.Service_Resources?.id) continue; // not a field technician
        // Only accepted "Active Users" -- excludes invited, inactive and
        // deleted accounts in one check (Q-2).
        if (user.client_status !== ACTIVE_CLIENT_STATUS) continue;
        const profileName = user.profile?.name ?? user.profile?.api_name ?? "";
        if (!TECHNICIAN_PROFILES.has(profileName)) continue;
        resources.push({
          fsmResourceId: user.Service_Resources.id,
          name: user.full_name ?? user.Service_Resources.Name ?? null,
          email: user.email ?? null,
          isActive: Boolean(user.Service_Resources.isActive),
        });
      }

      moreRecords = Boolean(res.json?.info?.more_records);
      page += 1;
    }

    if (resources.length > 0) {
      const now = new Date().toISOString();
      const displayNameFor = buildDisplayNamer(resources);

      const { error: upsertError } = await admin.from("technician_reference").upsert(
        resources.map((r) => ({
          fsm_resource_id: r.fsmResourceId,
          display_name: displayNameFor(r),
          is_active: r.isActive,
          last_synced_at: now,
        })),
        { onConflict: "fsm_resource_id" },
      );
      if (upsertError) console.error("[zoho:syncFsmTechnicians] upsert error:", upsertError);

      // Anyone who no longer qualifies -- wrong profile, deleted in FSM, or
      // gone from the listing entirely -- is REMOVED, not just deactivated.
      // Per YFI: "Any other user with any other profile does not need to be
      // shown at all, not even as inactive."
      //
      // The one exception is a row still referenced by historical data (leave,
      // tags, or a schedule assignment); the FK is RESTRICT, so those are
      // deactivated instead of deleted and history stays intact.
      const seenIds = new Set(resources.map((r) => r.fsmResourceId));
      const { data: allRows, error: listError } = await admin
        .from("technician_reference")
        .select("fsm_resource_id");

      if (listError) {
        console.error("[zoho:syncFsmTechnicians] list error:", listError);
      } else {
        const disqualified = (allRows ?? [])
          .map((r: { fsm_resource_id: string }) => r.fsm_resource_id)
          .filter((id: string) => !seenIds.has(id));

        for (const id of disqualified) {
          const { error: deleteError } = await admin
            .from("technician_reference")
            .delete()
            .eq("fsm_resource_id", id);

          if (deleteError) {
            // 23503 = foreign key violation: referenced by leave/tags/schedule.
            removed.referenced.push(id);
            await admin
              .from("technician_reference")
              .update({ is_active: false, last_synced_at: now })
              .eq("fsm_resource_id", id);
          } else {
            removed.deleted.push(id);
          }
        }
      }
    }

    return fsmOk({ resources, removed });
  } catch (error) {
    return fsmResultFromError(error, "zoho:syncFsmTechnicians");
  }
}

// Refreshes the roster only when the cache has aged past
// TECHNICIAN_CACHE_MAX_AGE_MS. This is what replaces the every-30-minutes
// cron: the work happens when someone actually opens the scheduling screen,
// and is a no-op the rest of the time.
//
// Never throws and never blocks the caller's own response on an FSM outage --
// a stale roster is far better than a failed page load.
export async function refreshTechniciansIfStale(): Promise<{ refreshed: boolean }> {
  try {
    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("technician_reference")
      .select("last_synced_at")
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return { refreshed: false };

    const lastSynced = data?.last_synced_at ? new Date(data.last_synced_at).getTime() : 0;
    if (Date.now() - lastSynced < TECHNICIAN_CACHE_MAX_AGE_MS) return { refreshed: false };

    const result = await syncFsmTechnicians();
    return { refreshed: result.ok };
  } catch (error) {
    console.error("[zoho:refreshTechniciansIfStale]", error);
    return { refreshed: false };
  }
}
