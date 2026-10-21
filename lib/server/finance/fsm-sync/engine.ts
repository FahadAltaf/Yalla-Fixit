import { randomUUID } from "node:crypto";

import { FsmBudgetExceededError, type FsmReader } from "@/lib/server/finance/fsm-read";

import {
  crewFromDetail,
  mapAppointment,
  mapEstimate,
  mapLineItem,
  mapWorkOrder,
  modifiedTime,
  recordId,
  storable,
} from "./mappers";
import type { RunCounts, RunStatus, SyncKind, SyncResource, SyncStore } from "./store";

/**
 * The read-only FSM sync (P2). One call runs one resource once.
 *
 * - incremental: records modified since the watermark (less an overlap),
 *   read newest first until an older one appears, then processed OLDEST
 *   first so the watermark can advance as far as the work actually done.
 * - reconcile: the same over the last `reconcileDays`, to catch anything an
 *   earlier run missed. Never moves the watermark back.
 * - backfill: everything, oldest first, a page at a time, resumable from
 *   the last completed page. Ends by setting the watermark to the moment it
 *   began, so records changed during the backfill are read again.
 *
 * Detail calls (discovery, 20 Oct): a work order's lines and an
 * appointment's crew exist only on the record's detail call, and a line
 * can change without its work order's Modified_Time moving. So a changed
 * work order is re-read in full, and so is the work order of every changed
 * appointment: completing an appointment is what completes its lines.
 *
 * Every write goes through the database functions, which refuse to let an
 * older record overwrite a newer one, so overlap, replays and an
 * interrupted run are all harmless. The FSM reader is GET-only and stops at
 * its budget; running out is a clean stop, recorded as budget_exhausted.
 */

export const MODULE: Record<SyncResource, string> = {
  estimates: "Estimates",
  work_orders: "Work_Orders",
  appointments: "Service_Appointments",
};

export type SyncOptions = {
  overlapMinutes: number;
  reconcileDays: number;
  /** Incremental runs read at most this many list pages before giving up. */
  maxListPages: number;
  perPage: number;
  leaseSeconds: number;
  /** Backfill reads details only for records modified on or after this. */
  backfillDetailSince: string | null;
  now: () => Date;
  newId: () => string;
};

export const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  overlapMinutes: 10,
  reconcileDays: 7,
  maxListPages: 50,
  perPage: 200,
  leaseSeconds: 900,
  backfillDetailSince: null,
  now: () => new Date(),
  newId: () => randomUUID(),
};

export type SyncSummary = {
  runId: string | null;
  resource: SyncResource;
  kind: SyncKind;
  status: RunStatus;
  counts: RunCounts;
  watermarkBefore: string | null;
  watermarkAfter: string | null;
  error: string | null;
};

type FsmRecord = Record<string, unknown>;

class FsmListError extends Error {}

const byModified = (a: FsmRecord, b: FsmRecord) =>
  Date.parse(modifiedTime(a) ?? "") - Date.parse(modifiedTime(b) ?? "");

const minus = (iso: string, minutes: number) => new Date(Date.parse(iso) - minutes * 60_000).toISOString();

function dataOf(json: unknown): FsmRecord[] {
  const data = (json as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as FsmRecord[]) : [];
}

function moreRecords(json: unknown): boolean {
  return Boolean((json as { info?: { more_records?: unknown } } | null)?.info?.more_records);
}

function messageOf(status: number, json: unknown): string {
  const body = json as { code?: unknown; message?: unknown; error?: unknown } | null;
  const detail = [body?.code, body?.message, body?.error].filter((x) => typeof x === "string").join(": ");
  return `FSM ${status}${detail ? ` ${detail}` : ""}`;
}

export async function runFsmSync(input: {
  resource: SyncResource;
  kind: SyncKind;
  reader: FsmReader;
  store: SyncStore;
  options?: Partial<SyncOptions>;
}): Promise<SyncSummary> {
  const { resource, kind, reader, store } = input;
  const options: SyncOptions = { ...DEFAULT_SYNC_OPTIONS, ...input.options };
  const owner = options.newId();
  const fsmModule = MODULE[resource];
  const counts: RunCounts = { pages: 0, recordsSeen: 0, recordsWritten: 0, detailCalls: 0, calls: 0 };
  const summary: SyncSummary = {
    runId: null, resource, kind, status: "failed", counts,
    watermarkBefore: null, watermarkAfter: null, error: null,
  };

  if (!(await store.claim(resource, owner, options.leaseSeconds))) {
    summary.runId = await store.startRun(resource, kind, null);
    summary.status = "skipped_busy";
    summary.error = "another run holds this resource";
    await store.finishRun(summary.runId, "skipped_busy", counts, null, summary.error);
    return summary;
  }

  const state = await store.state(resource);
  summary.watermarkBefore = state.watermark;
  summary.runId = await store.startRun(resource, kind, state.watermark);

  /* Work orders already re-read in this run (an appointment sync can reach
     the same one many times). */
  const refreshed = new Set<string>();
  let backfillPage: number | undefined;
  let backfillDone: boolean | undefined;
  let backfillStartedAt: string | undefined;

  const get = async (path: string, detail = false) => {
    const res = await reader.get(path);
    counts.calls = reader.calls();
    if (detail) counts.detailCalls += 1;
    return res;
  };

  /* When details were last read, so a run (or a rerun after the budget ran
     out) never pays twice for a detail that is already current. */
  const linesSeen = new Map<string, string | null>();
  const crewSeen = new Map<string, string | null>();
  /* `seen` is our clock and `changedAt` FSM's, so a read counts as current
     only when it is newer by more than the overlap: clock drift between the
     two can never hide a change made just after a read. */
  const isCurrent = (seen: string | null | undefined, changedAt: string | null) =>
    Boolean(seen && changedAt && Date.parse(seen) - options.overlapMinutes * 60_000 >= Date.parse(changedAt));

  /* One work order in full: header and lines. Skipped when its lines were
     read after `changedAt` (the change that sent us here). */
  const refreshWorkOrder = async (workOrderId: string, changedAt: string | null) => {
    if (refreshed.has(workOrderId) || isCurrent(linesSeen.get(workOrderId), changedAt)) return;
    const seenAt = options.now().toISOString();
    const res = await get(`/Work_Orders/${encodeURIComponent(workOrderId)}`, true);
    if (res.status === 204 || res.status === 404) {
      refreshed.add(workOrderId);
      return;
    }
    if (!res.ok) throw new FsmListError(messageOf(res.status, res.json));
    const record = dataOf(res.json)[0];
    if (!record) return;
    const header = mapWorkOrder(record);
    if (header.fsm_work_order_id && header.modified_time) {
      counts.recordsWritten += (await store.upsertWorkOrders([header])).written;
      const lines = storable(
        ((record.Service_Line_Items as FsmRecord[] | undefined) ?? []).map((line) =>
          mapLineItem(line, header.fsm_estimate_id),
        ),
        (row) => row.fsm_line_id,
      );
      await store.syncLineItems(workOrderId, seenAt, lines.rows);
      linesSeen.set(workOrderId, seenAt);
    }
    refreshed.add(workOrderId);
  };

  /* One appointment's crew, from its full record, unless read after `changedAt`. */
  const refreshCrew = async (appointmentId: string, changedAt: string | null) => {
    if (isCurrent(crewSeen.get(appointmentId), changedAt)) return;
    const seenAt = options.now().toISOString();
    const res = await get(`/Service_Appointments/${encodeURIComponent(appointmentId)}`, true);
    if (res.status === 204 || res.status === 404) return;
    if (!res.ok) throw new FsmListError(messageOf(res.status, res.json));
    const record = dataOf(res.json)[0];
    if (record) {
      await store.setCrew(appointmentId, seenAt, crewFromDetail(record));
      crewSeen.set(appointmentId, seenAt);
    }
  };

  /**
   * Store records (oldest first) and do their detail work. Returns the
   * Modified_Time up to which everything is done, and whether the budget
   * stopped it.
   */
  const processRecords = async (
    records: FsmRecord[],
    withDetails: (record: FsmRecord) => boolean,
  ): Promise<{ doneThrough: string | null; outOfBudget: boolean }> => {
    const sorted = [...records].sort(byModified);
    counts.recordsSeen += sorted.length;

    if (resource === "estimates") {
      const { rows } = storable(sorted.map(mapEstimate), (row) => row.fsm_estimate_id);
      for (let i = 0; i < rows.length; i += 200) {
        counts.recordsWritten += (await store.upsertEstimates(rows.slice(i, i + 200))).written;
      }
      return { doneThrough: rows.at(-1)?.modified_time ?? null, outOfBudget: false };
    }

    if (resource === "work_orders") {
      const pairs = sorted
        .map((record) => ({ record, row: mapWorkOrder(record) }))
        .filter(({ row }) => row.fsm_work_order_id && row.modified_time);
      const rows = pairs.map(({ row }) => row);
      for (let i = 0; i < rows.length; i += 200) {
        counts.recordsWritten += (await store.upsertWorkOrders(rows.slice(i, i + 200))).written;
      }
      const ids = pairs.filter(({ record }) => withDetails(record)).map(({ row }) => row.fsm_work_order_id as string);
      for (const [id, seen] of await store.seenTimes("work_order_lines", ids)) linesSeen.set(id, seen);
      let doneThrough: string | null = null;
      for (const { record, row } of pairs) {
        try {
          if (withDetails(record)) await refreshWorkOrder(row.fsm_work_order_id as string, row.modified_time);
        } catch (error) {
          if (error instanceof FsmBudgetExceededError) return { doneThrough, outOfBudget: true };
          throw error;
        }
        doneThrough = row.modified_time;
      }
      return { doneThrough, outOfBudget: false };
    }

    const pairs = sorted
      .map((record) => ({ record, row: mapAppointment(record) }))
      .filter(({ row }) => row.fsm_appointment_id && row.modified_time);
    const rows = pairs.map(({ row }) => row);
    for (let i = 0; i < rows.length; i += 200) {
      counts.recordsWritten += (await store.upsertAppointments(rows.slice(i, i + 200))).written;
    }
    const detailed = pairs.filter(({ record }) => withDetails(record)).map(({ row }) => row);
    const crewTimes = await store.seenTimes("appointment_crew", detailed.map((r) => r.fsm_appointment_id as string));
    for (const [id, seen] of crewTimes) crewSeen.set(id, seen);
    const workOrderIds = detailed.map((r) => r.fsm_work_order_id).filter((id): id is string => Boolean(id));
    for (const [id, seen] of await store.seenTimes("work_order_lines", workOrderIds)) linesSeen.set(id, seen);
    let doneThrough: string | null = null;
    for (const { record, row } of pairs) {
      try {
        if (withDetails(record)) {
          if (row.status !== "Cancelled") await refreshCrew(row.fsm_appointment_id as string, row.modified_time);
          /* Completing an appointment is what completes its lines, so the work
             order is current only if its lines were read after this change. */
          if (row.fsm_work_order_id) await refreshWorkOrder(row.fsm_work_order_id, row.modified_time);
        }
      } catch (error) {
        if (error instanceof FsmBudgetExceededError) return { doneThrough, outOfBudget: true };
        throw error;
      }
      doneThrough = row.modified_time;
    }
    return { doneThrough, outOfBudget: false };
  };

  let watermarkOut: string | null = null;
  try {
    if (kind === "backfill") {
      if (state.backfillDone) {
        summary.status = "succeeded";
        summary.error = "backfill already complete";
      } else {
        backfillStartedAt = state.backfillStartedAt ?? options.now().toISOString();
        let page = state.backfillPage;
        backfillPage = page;
        const detailSince = options.backfillDetailSince ? Date.parse(options.backfillDetailSince) : null;
        const withDetails = (record: FsmRecord) =>
          detailSince === null || Date.parse(modifiedTime(record) ?? "") >= detailSince;
        summary.status = "succeeded";
        for (;;) {
          let res;
          try {
            res = await get(
              `/${fsmModule}?per_page=${options.perPage}&page=${page + 1}&sort_by=Modified_Time&sort_order=asc`,
            );
          } catch (error) {
            if (error instanceof FsmBudgetExceededError) {
              summary.status = "budget_exhausted";
              break;
            }
            throw error;
          }
          counts.pages += 1;
          if (res.status === 204) {
            backfillDone = true;
            break;
          }
          if (!res.ok) throw new FsmListError(messageOf(res.status, res.json));
          const { outOfBudget } = await processRecords(dataOf(res.json), withDetails);
          if (outOfBudget) {
            // The page is read again next time; everything on it is idempotent.
            summary.status = "budget_exhausted";
            break;
          }
          page += 1;
          // Kept as it goes, so a failure on a later page keeps this progress.
          backfillPage = page;
          if (!moreRecords(res.json)) {
            backfillDone = true;
            break;
          }
        }
        /* Records changed while the backfill ran are read again by the
           first incremental run, which starts from when the backfill began. */
        if (backfillDone) watermarkOut = backfillStartedAt;
      }
    } else {
      if (kind === "incremental" && !state.watermark) {
        throw new FsmListError("no watermark yet: run the backfill first");
      }
      const now = options.now().toISOString();
      const since =
        kind === "reconcile"
          ? minus(now, options.reconcileDays * 24 * 60)
          : minus(state.watermark as string, options.overlapMinutes);

      const collected: FsmRecord[] = [];
      let complete = false;
      for (let page = 1; page <= options.maxListPages; page += 1) {
        const res = await get(
          `/${fsmModule}?per_page=${options.perPage}&page=${page}&sort_by=Modified_Time&sort_order=desc`,
        );
        counts.pages += 1;
        if (res.status === 204) {
          complete = true;
          break;
        }
        if (!res.ok) throw new FsmListError(messageOf(res.status, res.json));
        let reachedOlder = false;
        for (const record of dataOf(res.json)) {
          const mt = modifiedTime(record);
          if (mt && Date.parse(mt) < Date.parse(since)) {
            reachedOlder = true;
            continue;
          }
          if (recordId(record)) collected.push(record);
        }
        if (reachedOlder || !moreRecords(res.json)) {
          complete = true;
          break;
        }
      }
      if (!complete) {
        throw new FsmListError(
          `more than ${options.maxListPages} pages changed since ${since}: run the backfill or a larger run`,
        );
      }

      const { doneThrough, outOfBudget } = await processRecords(collected, () => true);
      summary.status = outOfBudget ? "budget_exhausted" : "succeeded";
      if (kind === "reconcile") {
        /* A reconcile re-reads; it never sets the watermark. Before the
           backfill ends, setting it would let incremental runs start with
           history still missing. */
        watermarkOut = null;
      } else if (outOfBudget) {
        watermarkOut = doneThrough;
      } else {
        /* Everything changed since `since` is done: the newest seen, or the
           old watermark when nothing changed. */
        watermarkOut = doneThrough ?? state.watermark;
      }
    }
  } catch (error) {
    summary.status = "failed";
    summary.error =
      error instanceof Error ? error.message : typeof error === "string" ? error : "sync failed";
  }

  summary.watermarkAfter = watermarkOut ?? state.watermark;
  counts.calls = reader.calls();
  const succeeded = summary.status === "succeeded" || summary.status === "budget_exhausted";
  await store.release(resource, owner, {
    success: succeeded,
    error: summary.error,
    watermark: watermarkOut,
    backfillPage,
    backfillDone,
    backfillStartedAt,
  });
  await store.finishRun(summary.runId, summary.status, counts, summary.watermarkAfter, summary.error);
  return summary;
}
