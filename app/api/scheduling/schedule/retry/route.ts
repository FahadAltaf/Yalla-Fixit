import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";
import {
  syncEntryToFsm,
  versionStatusFromResults,
  SYNC_ENTRY_COLUMNS,
  type SyncEntryRow,
  type SyncEntryResult,
} from "@/lib/server/schedule-sync";

const retrySchema = z.object({
  scheduleVersionId: z.string().uuid(),
  // Optional: retry a single entry rather than every failed one.
  entryId: z.string().uuid().optional(),
});

// AC-006 / AC-015: re-attempt FSM sync for the entries that failed on
// approval, without re-approving the whole day. Idempotent — an entry that
// already synced is left alone, and each attempt reuses the entry id as the
// correlation id so a duplicate create can be detected FSM-side.
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Same gate as approval — the Approve permission (#2).
    const admin = await createAdminServerClient();
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.APPROVE)) {
      return NextResponse.json(
        { error: "You don't have permission to retry a sync" },
        { status: 403 },
      );
    }

    const parsed = retrySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { scheduleVersionId, entryId } = parsed.data;

    const { data: version, error: versionError } = await admin
      .from("schedule_versions")
      .select("*")
      .eq("id", scheduleVersionId)
      .single();
    if (versionError || !version) {
      return NextResponse.json({ error: "Schedule version not found" }, { status: 404 });
    }
    if (!["sync_failed", "partially_synced"].includes(version.status)) {
      return NextResponse.json(
        { error: `Nothing to retry — the day is ${version.status}, not a failed sync` },
        { status: 409 },
      );
    }

    // Retry only entries that actually failed (or the one named entry).
    let query = admin
      .from("schedule_entries")
      .select(SYNC_ENTRY_COLUMNS)
      .eq("schedule_version_id", scheduleVersionId)
      .eq("sync_status", "failed");
    if (entryId) query = query.eq("id", entryId);

    const { data: failedEntries, error: entriesError } = await query;
    if (entriesError) throw new Error(entriesError.message);

    if (!failedEntries || failedEntries.length === 0) {
      return NextResponse.json({ error: "No failed entries to retry" }, { status: 409 });
    }

    const results: SyncEntryResult[] = [];
    for (const entry of failedEntries as SyncEntryRow[]) {
      results.push(await syncEntryToFsm(admin, entry, scheduleVersionId, "retry_sync"));
    }

    // Recompute the version status across ALL FSM-backed entries, not just
    // the ones retried now — a partially-synced day becomes published only
    // when every entry is finally synced.
    const { data: allEntries } = await admin
      .from("schedule_entries")
      .select("id, entry_type, sync_status")
      .eq("schedule_version_id", scheduleVersionId);
    const fsmBacked = (allEntries ?? []).filter((e) => e.entry_type !== "free_text");
    const overall = versionStatusFromResults(
      fsmBacked.map((e) => ({
        entryId: e.id,
        status: e.sync_status === "synced" ? "succeeded" : e.sync_status === "failed" ? "failed" : "skipped",
      })),
    );

    const versionUpdate: Record<string, unknown> = { status: overall };
    if (overall === "published") versionUpdate.published_at = new Date().toISOString();

    const { data: updated, error: updateError } = await admin
      .from("schedule_versions")
      .update(versionUpdate)
      .eq("id", scheduleVersionId)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    // No daily_schedules.current_version_id to update any more -- the version
    // being retried is already the date's is_current row.

    await admin.from("schedule_audit_events").insert({
      event_type: "sync_retried",
      actor_id: profile.id,
      origin: "portal",
      schedule_version_id: scheduleVersionId,
      after_value: { overall, results },
    });

    return NextResponse.json({ data: { version: updated, results } });
  } catch (error) {
    console.error("Schedule retry error:", error);
    const message = error instanceof Error ? error.message : "Failed to retry sync";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
