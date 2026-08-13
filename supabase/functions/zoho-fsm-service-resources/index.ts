// Supabase Edge Function: zoho-fsm-service-resources
//
// Lists Zoho FSM users that are field service resources (technicians),
// for the Scheduling module's Leave/Tags module and dashboard
// (FRD LEAVE-001, TAG-006, Section 12.6). Zoho FSM has no dedicated
// "Service Resources" module -- technicians are Users whose record
// carries a Service_Resources sub-object (see fsm/v1/users).
//
// Mirrors the existing zoho-fsm-work-orders / zoho-fsm-appointments
// functions: reads the shared OAuth access token from public.settings
// and proxies to the Zoho FSM REST API.
//
// As a side effect, upserts the result into public.technician_reference
// so this single function serves both the portal's manual refresh action
// (SYNC-013) and the scheduled pg_cron technician-refresh job (12.6) --
// there is no separate "sync" endpoint to keep in lockstep.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FSM_BASE_URL = "https://fsm.zoho.com/fsm/v1";
const PER_PAGE = 200;
const MAX_PAGES = 10; // safety cap: 2000 users, far above expected headcount

// Only these FSM user profiles are operational technicians for scheduling.
// Excludes Administrator, Dispatcher, Manager, CallCenter Agent, etc.
// (per YFI: "we only need to see ones with the user profile Field Agent,
// Limited Field Agent, and YFI Field Agent V2").
const TECHNICIAN_PROFILES = new Set([
  "Field Agent",
  "Limited Field Agent",
  "YFI Field Agent V2",
]);

// The /users listing includes invited, inactive and deleted accounts. The
// FSM top-level `status` is "active" even for a user who was only invited
// and never accepted -- what actually mirrors the "Active Users" tab in Zoho
// is `client_status`. Per YFI (Q-2): "We only need to consider Active Users."
// This is what de-duplicates people like Francis Mwangi, who has one Active
// account and several Invited ones sharing the same name.
const ACTIVE_CLIENT_STATUS = "Active";

type ZohoUser = {
  id: string;
  full_name?: string;
  email?: string;
  status?: string;
  client_status?: string; // "Active" | "Invited" | "Inactive" | "Deleted"
  confirm?: boolean;
  profile?: {
    name?: string;
    api_name?: string;
  } | null;
  Service_Resources?: {
    id: string;
    Name?: string;
    isActive?: boolean;
  } | null;
};

type ZohoUsersResponse = {
  users?: ZohoUser[];
  info?: {
    more_records?: boolean;
  };
};

Deno.serve(async (req: Request) => {
  const jsonHeaders = { "Content-Type": "application/json" };

  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Supabase environment is not configured" }),
        { status: 500, headers: jsonHeaders },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: settings, error: settingsError } = await supabase
      .from("settings")
      .select("oauth_access_token")
      .eq("id", 1)
      .single();

    if (settingsError || !settings?.oauth_access_token) {
      return new Response(
        JSON.stringify({ error: "Zoho FSM OAuth token is not configured" }),
        { status: 500, headers: jsonHeaders },
      );
    }

    const accessToken = settings.oauth_access_token as string;
    const resources: Array<{
      // The immutable FSM *service resource* ID (Service_Resources.id),
      // NOT the parent user's id -- these are distinct records in FSM
      // and LEAVE-002/TAG-006/BR-019 require the former.
      fsmResourceId: string;
      name: string | null;
      email: string | null;
      isActive: boolean;
    }> = [];

    // Reported back so a manual refresh can say what it pruned.
    const removed: { deleted: string[]; referenced: string[] } = {
      deleted: [],
      referenced: [],
    };

    let page = 1;
    let moreRecords = true;

    while (moreRecords && page <= MAX_PAGES) {
      const fsmRes = await fetch(
        `${FSM_BASE_URL}/users?page=${page}&per_page=${PER_PAGE}`,
        {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
        },
      );

      if (!fsmRes.ok) {
        const errorBody = await fsmRes.text();
        console.error(`[zoho-fsm-service-resources] FSM error page=${page}:`, errorBody);
        return new Response(
          JSON.stringify({ error: "Failed to fetch users from Zoho FSM" }),
          { status: 502, headers: jsonHeaders },
        );
      }

      const payload = (await fsmRes.json()) as ZohoUsersResponse;

      for (const user of payload.users ?? []) {
        if (!user.Service_Resources?.id) continue; // not a field technician
        // Only accepted "Active Users" -- excludes invited, inactive and
        // deleted accounts in one check (Q-2).
        if (user.client_status !== ACTIVE_CLIENT_STATUS) continue;
        const profileName = user.profile?.name ?? user.profile?.api_name ?? "";
        if (!TECHNICIAN_PROFILES.has(profileName)) continue; // not an operational technician profile
        resources.push({
          fsmResourceId: user.Service_Resources.id,
          name: user.full_name ?? user.Service_Resources.Name ?? null,
          email: user.email ?? null,
          isActive: Boolean(user.Service_Resources.isActive),
        });
      }

      moreRecords = Boolean(payload.info?.more_records);
      page += 1;
    }

    if (resources.length > 0) {
      const now = new Date().toISOString();

      // Some people hold more than one active FSM account under the same
      // full name (different emails). Qualify the duplicates with the email
      // so a scheduler can tell which account they are assigning work to,
      // instead of seeing the same name three times.
      const nameCounts = new Map<string, number>();
      for (const r of resources) {
        const key = r.name ?? "";
        nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
      }
      const displayNameFor = (r: (typeof resources)[number]) => {
        const base = r.name ?? r.email ?? r.fsmResourceId;
        if (r.name && (nameCounts.get(r.name) ?? 0) > 1 && r.email) return `${r.name} (${r.email})`;
        return base;
      };

      const { error: upsertError } = await supabase
        .from("technician_reference")
        .upsert(
          resources.map((r) => ({
            fsm_resource_id: r.fsmResourceId,
            display_name: displayNameFor(r),
            is_active: r.isActive,
            last_synced_at: now,
          })),
          { onConflict: "fsm_resource_id" },
        );

      if (upsertError) {
        console.error("[zoho-fsm-service-resources] upsert error:", upsertError);
      }

      // Anyone who no longer qualifies -- wrong profile, deleted in FSM, or
      // gone from the listing entirely -- is REMOVED, not just deactivated.
      // Per YFI: "Any other user with any other profile does not need to be
      // shown at all, not even as inactive."
      //
      // The one exception is a row still referenced by historical data
      // (leave, tags, or a schedule assignment); the FK is RESTRICT, so those
      // are deactivated instead of deleted and history stays intact.
      const seenIds = new Set(resources.map((r) => r.fsmResourceId));

      const { data: allRows, error: listError } = await supabase
        .from("technician_reference")
        .select("fsm_resource_id");

      if (listError) {
        console.error("[zoho-fsm-service-resources] list error:", listError);
      } else {
        const disqualified = (allRows ?? [])
          .map((r: { fsm_resource_id: string }) => r.fsm_resource_id)
          .filter((id: string) => !seenIds.has(id));

        for (const id of disqualified) {
          const { error: deleteError } = await supabase
            .from("technician_reference")
            .delete()
            .eq("fsm_resource_id", id);

          if (deleteError) {
            // 23503 = foreign key violation: referenced by leave/tags/schedule.
            removed.referenced.push(id);
            await supabase
              .from("technician_reference")
              .update({ is_active: false, last_synced_at: now })
              .eq("fsm_resource_id", id);
          } else {
            removed.deleted.push(id);
          }
        }
      }
    }

    return new Response(JSON.stringify({ resources, removed }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error: unknown) {
    console.error("[zoho-fsm-service-resources]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
