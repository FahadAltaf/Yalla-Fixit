import type { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import {
  syncEntryToFsm,
  versionStatusFromResults,
  entryNeedsSync,
  SYNC_ENTRY_COLUMNS,
  type SyncEntryRow,
  type SyncEntryResult,
} from "@/lib/server/schedule-sync";

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

export class PublishBlockedError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

// Writes a schedule version to Zoho FSM: creates/reschedules the appointments,
// sets the version's final status (published / partially_synced / sync_failed),
// and points the day at it when fully published. Shared by the approval flow
// and the "no approval needed" submit path (E1). `actorId` is who triggered it.
export async function publishVersionToFsm(
  admin: Admin,
  scheduleVersionId: string,
  actorId: string,
  opts: { comment?: string | null } = {},
): Promise<{ version: Record<string, unknown>; results: SyncEntryResult[] }> {
  const { data: version, error: versionError } = await admin
    .from("schedule_versions")
    .select("*")
    .eq("id", scheduleVersionId)
    .single();
  if (versionError || !version) {
    throw new PublishBlockedError("Schedule version not found", 404);
  }

  const { data: entries, error: entriesError } = await admin
    .from("schedule_entries")
    .select(SYNC_ENTRY_COLUMNS)
    .eq("schedule_version_id", scheduleVersionId);
  if (entriesError) throw new Error(entriesError.message);

  // Note: there is intentionally no "review required" gate here any more. FSM
  // is treated as authoritative and reconcile adopts its changes silently
  // (YFI: drop the warnings and never block approval on an FSM change).

  // Lock the version against further editing while we write to FSM.
  await admin.from("schedule_versions").update({ status: "approved_syncing" }).eq("id", scheduleVersionId);

  // Only new or edited entries are (re)written; untouched synced ones skip.
  const results: SyncEntryResult[] = [];
  for (const entry of (entries ?? []) as SyncEntryRow[]) {
    if (!entryNeedsSync(entry)) {
      results.push({ entryId: entry.id, status: "skipped" });
      continue;
    }
    const opType = entry.entry_type === "new_appointment" ? "create_appointment" : "update_appointment";
    results.push(await syncEntryToFsm(admin, entry, scheduleVersionId, opType));
  }

  const finalStatus = versionStatusFromResults(results);
  const updateVersion: Record<string, unknown> = { status: finalStatus };
  if (finalStatus === "published") updateVersion.published_at = new Date().toISOString();

  const { data: updated, error: finalUpdateError } = await admin
    .from("schedule_versions")
    .update(updateVersion)
    .eq("id", scheduleVersionId)
    .select("*")
    .single();
  if (finalUpdateError) throw new Error(finalUpdateError.message);

  // Pointing the day at this version used to mean writing
  // daily_schedules.current_version_id here. That pointer is gone: the
  // version being published is already the date's is_current row (revise is
  // what flips it), and the partial unique index on (schedule_date) WHERE
  // is_current keeps that true. Nothing to update.

  await admin.from("schedule_audit_events").insert({
    event_type: "version_published",
    actor_id: actorId,
    origin: "portal",
    schedule_version_id: scheduleVersionId,
    after_value: { finalStatus, results, comment: opts.comment ?? null },
  });

  return { version: updated, results };
}
