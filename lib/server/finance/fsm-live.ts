import type { SupabaseClient } from "@supabase/supabase-js";

import { createFsmReader, financeFsmReadEnabled } from "@/lib/server/finance/fsm-read";
import { lookupName, mapEstimate, mapLineItem, mapWorkOrder } from "@/lib/server/finance/fsm-sync/mappers";
import { getFsmAccessToken } from "@/lib/server/zoho/fsm-client";

/**
 * Ready to invoice reads Zoho FSM live (the user's direction, 22 Oct): work
 * orders, their line items and their quotations come from the FSM API, not
 * from the portal's synced copy. Read-only (the GET-only reader, behind
 * FINANCE_FSM_READ).
 *
 * What a page costs:
 *  - the list: FSM's work orders, newest first, 200 a call, until the dates
 *    asked for are covered (a call or two for 30 days, about 8 for the four
 *    months allowed). FSM's list never carries line items.
 *  - one work order: its detail (header and line items), and its
 *    quotation's, so one or two calls.
 *
 * Each answer is kept here for ten minutes, so paging, filtering and going
 * back and forth cost nothing; Refresh asks FSM again. The browser keeps
 * its own copy too (the section cache).
 */

const TTL_MS = 10 * 60_000;
const PER_PAGE = 200;
/* 4,000 work orders: far more than four months, and a ceiling on calls. */
const MAX_LIST_PAGES = 20;

export class FsmLiveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type FsmRecord = Record<string, unknown>;

export type LiveWorkOrder = {
  id: string;
  number: string | null;
  status: string | null;
  type: string | null;
  workType: string | null;
  billingStatus: string | null;
  companyName: string | null;
  contactName: string | null;
  /** FSM's owner of the work order: the coordinator. */
  ownerName: string | null;
  estimateId: string | null;
  estimateNumber: string | null;
  createdAt: string | null;
  completedAt: string | null;
  modifiedAt: string | null;
  /** Before VAT. */
  subTotal: number | null;
  grandTotal: number | null;
  taxAmount: number | null;
};

export type LiveLine = ReturnType<typeof mapLineItem>;

export type LiveEstimate = ReturnType<typeof mapEstimate>;

type Cached<T> = { at: number; value: T };
const listCache = new Map<string, Cached<{ rows: LiveWorkOrder[]; fetchedAt: string; calls: number }>>();
const detailCache = new Map<string, Cached<{ workOrder: LiveWorkOrder; lines: LiveLine[]; fetchedAt: string }>>();
const estimateCache = new Map<string, Cached<LiveEstimate | null>>();

const fresh = <T>(entry: Cached<T> | undefined) => (entry && Date.now() - entry.at < TTL_MS ? entry.value : null);

function liveWorkOrder(record: FsmRecord): LiveWorkOrder {
  const w = mapWorkOrder(record);
  return {
    id: w.fsm_work_order_id ?? "",
    number: w.number,
    status: w.status,
    type: w.type,
    workType: w.work_type,
    billingStatus: w.billing_status,
    companyName: w.company_name,
    contactName: w.contact_name,
    ownerName: lookupName(record.Owner),
    estimateId: w.fsm_estimate_id,
    estimateNumber: lookupName(record.Estimate),
    createdAt: w.created_in_fsm_at,
    completedAt: w.completed_at,
    modifiedAt: w.modified_time,
    subTotal: w.sub_total,
    grandTotal: w.grand_total,
    taxAmount: w.tax_amount,
  };
}

async function readerFor(admin: SupabaseClient, budget: number) {
  if (!financeFsmReadEnabled()) throw new FsmLiveError("Reading from Zoho FSM is switched off (FINANCE_FSM_READ).", 503);
  return createFsmReader({ token: await getFsmAccessToken(admin), budget });
}

const dataOf = (json: unknown): FsmRecord[] => {
  const data = (json as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as FsmRecord[]) : [];
};

function failure(status: number, json: unknown): FsmLiveError {
  const body = json as { code?: string; message?: string } | null;
  return new FsmLiveError(`Zoho FSM answered ${status}${body?.message ? `: ${body.message}` : ""}`, 502);
}

/**
 * Work orders FSM raised in [fromIso, toIso), newest first. Read a page at
 * a time until a page reaches back past fromIso.
 */
export async function fetchWorkOrdersLive(
  admin: SupabaseClient,
  range: { fromIso: string; toIso: string },
  options: { refresh?: boolean } = {},
): Promise<{ rows: LiveWorkOrder[]; fetchedAt: string; calls: number; cached: boolean }> {
  const key = `${range.fromIso}|${range.toIso}`;
  const cached = options.refresh ? null : fresh(listCache.get(key));
  if (cached) return { ...cached, cached: true };

  const reader = await readerFor(admin, MAX_LIST_PAGES);
  const from = Date.parse(range.fromIso);
  const to = Date.parse(range.toIso);
  const rows: LiveWorkOrder[] = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const res = await reader.get(`/Work_Orders?per_page=${PER_PAGE}&page=${page}&sort_by=Created_Time&sort_order=desc`);
    if (res.status === 204) break;
    if (!res.ok) throw failure(res.status, res.json);
    const data = dataOf(res.json);
    let reachedOlder = false;
    for (const record of data) {
      const wo = liveWorkOrder(record);
      const created = wo.createdAt ? Date.parse(wo.createdAt) : NaN;
      if (!wo.id || Number.isNaN(created)) continue;
      if (created < from) {
        reachedOlder = true;
        continue;
      }
      if (created < to) rows.push(wo);
    }
    const more = Boolean((res.json as { info?: { more_records?: boolean } } | null)?.info?.more_records);
    if (reachedOlder || !more) break;
  }
  const value = { rows, fetchedAt: new Date().toISOString(), calls: reader.calls() };
  listCache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}

/** One work order in full: header and line items. Null when FSM no longer has it. */
export async function fetchWorkOrderLive(
  admin: SupabaseClient,
  id: string,
  options: { refresh?: boolean } = {},
): Promise<{ workOrder: LiveWorkOrder; lines: LiveLine[]; fetchedAt: string; cached: boolean } | null> {
  const cached = options.refresh ? null : fresh(detailCache.get(id));
  if (cached) return { ...cached, cached: true };

  const reader = await readerFor(admin, 1);
  const res = await reader.get(`/Work_Orders/${encodeURIComponent(id)}`);
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw failure(res.status, res.json);
  const record = dataOf(res.json)[0];
  if (!record) return null;
  const workOrder = liveWorkOrder(record);
  const lines = ((record.Service_Line_Items as FsmRecord[] | undefined) ?? [])
    .map((l) => mapLineItem(l, workOrder.estimateId))
    .filter((l) => l.fsm_line_id)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const value = { workOrder, lines, fetchedAt: new Date().toISOString() };
  detailCache.set(id, { at: Date.now(), value });
  return { ...value, cached: false };
}

/** A quotation, for its status, totals, owner and Post to MAHER. */
export async function fetchEstimateLive(admin: SupabaseClient, id: string, options: { refresh?: boolean } = {}): Promise<LiveEstimate | null> {
  const hit = options.refresh ? undefined : estimateCache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const reader = await readerFor(admin, 1);
  const res = await reader.get(`/Estimates/${encodeURIComponent(id)}`);
  if (res.status === 204 || res.status === 404) {
    estimateCache.set(id, { at: Date.now(), value: null });
    return null;
  }
  if (!res.ok) throw failure(res.status, res.json);
  const record = dataOf(res.json)[0];
  const value = record ? mapEstimate(record) : null;
  estimateCache.set(id, { at: Date.now(), value });
  return value;
}

/** After a refresh of one work order, the lists holding it are re-read next time too. */
export function forgetLists() {
  listCache.clear();
}
