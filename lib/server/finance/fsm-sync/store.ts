import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppointmentRow, CrewMember, EstimateRow, LineItemRow, WorkOrderRow } from "./mappers";

/**
 * Where the sync writes. The engine only ever talks to this interface, so it
 * is tested against an in-memory version (tests/finance/fsm-sync.test.ts)
 * and runs against the database functions of migration 20261020130000,
 * which hold the out-of-order and replay rules. Everything is in the `fsm`
 * schema, which the API reaches once it is listed in Exposed schemas.
 */

export type SyncResource = "estimates" | "work_orders" | "appointments";
export type SyncKind = "incremental" | "reconcile" | "backfill";
export type RunStatus = "succeeded" | "failed" | "budget_exhausted" | "skipped_busy";

export type SyncState = {
  watermark: string | null;
  backfillPage: number;
  backfillDone: boolean;
  backfillStartedAt: string | null;
};

export type RunCounts = {
  pages: number;
  recordsSeen: number;
  recordsWritten: number;
  detailCalls: number;
  calls: number;
};

export type RunRelease = {
  success: boolean;
  error: string | null;
  watermark: string | null;
  backfillPage?: number;
  backfillDone?: boolean;
  backfillStartedAt?: string;
};

export interface SyncStore {
  claim(resource: SyncResource, owner: string, seconds: number): Promise<boolean>;
  release(resource: SyncResource, owner: string, outcome: RunRelease): Promise<void>;
  state(resource: SyncResource): Promise<SyncState>;
  startRun(resource: SyncResource, kind: SyncKind, watermarkBefore: string | null): Promise<string>;
  finishRun(runId: string, status: RunStatus, counts: RunCounts, watermarkAfter: string | null, error: string | null): Promise<void>;
  upsertEstimates(rows: EstimateRow[]): Promise<{ written: number }>;
  upsertWorkOrders(rows: WorkOrderRow[]): Promise<{ written: number }>;
  syncLineItems(workOrderId: string, seenAt: string, rows: LineItemRow[]): Promise<{ written: number }>;
  upsertAppointments(rows: AppointmentRow[]): Promise<{ written: number }>;
  setCrew(appointmentId: string, seenAt: string, crew: CrewMember[]): Promise<void>;
  /** When each record's details were last read (lines of a work order, crew
      of an appointment), so a detail already current is not read again. */
  seenTimes(kind: "work_order_lines" | "appointment_crew", ids: string[]): Promise<Map<string, string | null>>;
}

async function rpc<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.schema("fsm").rpc(fn, args);
  if (error) throw new Error(`fsm.${fn}: ${error.message}`);
  return data as T;
}

export function supabaseSyncStore(admin: SupabaseClient): SyncStore {
  return {
    claim: (resource, owner, seconds) =>
      rpc<boolean>(admin, "sync_claim", { p_resource: resource, p_owner: owner, p_seconds: seconds }),

    async release(resource, owner, outcome) {
      await rpc<boolean>(admin, "sync_release", {
        p_resource: resource,
        p_owner: owner,
        p_success: outcome.success,
        p_error: outcome.error,
        p_watermark: outcome.watermark,
        p_backfill_page: outcome.backfillPage ?? null,
        p_backfill_done: outcome.backfillDone ?? null,
        p_backfill_started_at: outcome.backfillStartedAt ?? null,
      });
    },

    async state(resource) {
      const { data, error } = await admin
        .schema("fsm")
        .from("sync_state")
        .select("watermark, backfill_page, backfill_done, backfill_started_at")
        .eq("resource", resource)
        .single();
      if (error) throw new Error(`fsm.sync_state: ${error.message}`);
      return {
        watermark: (data.watermark as string | null) ?? null,
        backfillPage: Number(data.backfill_page ?? 0),
        backfillDone: Boolean(data.backfill_done),
        backfillStartedAt: (data.backfill_started_at as string | null) ?? null,
      };
    },

    async startRun(resource, kind, watermarkBefore) {
      const { data, error } = await admin
        .schema("fsm")
        .from("sync_runs")
        .insert({ resource, kind, watermark_before: watermarkBefore })
        .select("id")
        .single();
      if (error) throw new Error(`fsm.sync_runs: ${error.message}`);
      return data.id as string;
    },

    async finishRun(runId, status, counts, watermarkAfter, error) {
      const { error: updateError } = await admin
        .schema("fsm")
        .from("sync_runs")
        .update({
          status,
          finished_at: new Date().toISOString(),
          pages: counts.pages,
          records_seen: counts.recordsSeen,
          records_written: counts.recordsWritten,
          detail_calls: counts.detailCalls,
          calls: counts.calls,
          watermark_after: watermarkAfter,
          error: error ? error.slice(0, 1000) : null,
        })
        .eq("id", runId);
      if (updateError) throw new Error(`fsm.sync_runs: ${updateError.message}`);
    },

    upsertEstimates: (rows) => rpc(admin, "upsert_estimates", { p_rows: rows }),
    upsertWorkOrders: (rows) => rpc(admin, "upsert_work_orders", { p_rows: rows }),
    syncLineItems: (workOrderId, seenAt, rows) =>
      rpc(admin, "sync_line_items", { p_work_order_id: workOrderId, p_seen_at: seenAt, p_rows: rows }),
    upsertAppointments: (rows) => rpc(admin, "upsert_appointments", { p_rows: rows }),
    async seenTimes(kind, ids) {
      const out = new Map<string, string | null>();
      const unique = [...new Set(ids)];
      const table = kind === "work_order_lines" ? "work_orders" : "appointments";
      const idColumn = kind === "work_order_lines" ? "fsm_work_order_id" : "fsm_appointment_id";
      const seenColumn = kind === "work_order_lines" ? "lines_seen_at" : "crew_seen_at";
      for (let i = 0; i < unique.length; i += 200) {
        const { data, error } = await admin
          .schema("fsm")
          .from(table)
          .select(`${idColumn}, ${seenColumn}`)
          .in(idColumn, unique.slice(i, i + 200));
        if (error) throw new Error(`fsm.${table}: ${error.message}`);
        for (const row of (data ?? []) as unknown as Record<string, string | null>[]) {
          out.set(row[idColumn] as string, row[seenColumn] ?? null);
        }
      }
      return out;
    },
    async setCrew(appointmentId, seenAt, crew) {
      await rpc<boolean>(admin, "set_appointment_crew", {
        p_appointment_id: appointmentId,
        p_seen_at: seenAt,
        p_crew: crew,
      });
    },
  };
}
