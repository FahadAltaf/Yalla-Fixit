import type { SupabaseClient } from "@supabase/supabase-js";

import type { SyncResource } from "./store";

/** One resource's freshness, for the indicator beside each report. */
export type FsmResourceStatus = {
  resource: SyncResource;
  /** Newest FSM change fully copied. Null until the backfill completes. */
  watermark: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  backfillDone: boolean;
  running: boolean;
  lastRun: {
    kind: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    recordsWritten: number;
    calls: number;
  } | null;
};

export async function readFsmSyncStatus(admin: SupabaseClient): Promise<{ resources: FsmResourceStatus[] }> {
  const [states, runs] = await Promise.all([
    admin
      .schema("fsm")
      .from("sync_state")
      .select("resource, watermark, last_success_at, last_error, consecutive_failures, backfill_done, lease_until")
      .order("resource"),
    admin
      .schema("fsm")
      .from("sync_runs")
      .select("resource, kind, status, started_at, finished_at, records_written, calls")
      .order("started_at", { ascending: false })
      .limit(30),
  ]);
  if (states.error) throw new Error(states.error.message);
  if (runs.error) throw new Error(runs.error.message);

  const now = Date.now();
  return {
    resources: (states.data ?? []).map((row) => {
      const last = (runs.data ?? []).find((run) => run.resource === row.resource);
      return {
        resource: row.resource as SyncResource,
        watermark: (row.watermark as string | null) ?? null,
        lastSuccessAt: (row.last_success_at as string | null) ?? null,
        lastError: (row.last_error as string | null) ?? null,
        consecutiveFailures: Number(row.consecutive_failures ?? 0),
        backfillDone: Boolean(row.backfill_done),
        running: Boolean(row.lease_until && Date.parse(row.lease_until as string) > now),
        lastRun: last
          ? {
              kind: last.kind as string,
              status: last.status as string,
              startedAt: last.started_at as string,
              finishedAt: (last.finished_at as string | null) ?? null,
              recordsWritten: Number(last.records_written ?? 0),
              calls: Number(last.calls ?? 0),
            }
          : null,
      };
    }),
  };
}
