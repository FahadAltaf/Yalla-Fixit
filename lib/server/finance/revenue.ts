import type { SupabaseClient } from "@supabase/supabase-js";

import { isFsmCompleted } from "@/lib/finance/line-status";
import { effectiveEntry, isEnded, isNonBillable, type ProgressEntry } from "@/lib/finance/progress";
import { addDaysToDateString, zonedTimeToUtc } from "@/lib/scheduling/org-time";
import { readAllRows } from "@/lib/server/snagging/read-all";

/**
 * Revenue at month end (26 Oct, change 7): per work order the portal holds
 * records for, what was recognised, invoiced and still to invoice as of the
 * last day of a month, and what was recognised in that month, so Finance
 * can book revenue without an invoice. From schema finance only (no FSM
 * call): line values as last read from FSM, Operations' "% done" entries
 * recorded by then, invoices dated by then, and Completed as last seen
 * (migration 20261025100000's snapshot).
 *
 * Recognised = all of a work order Completed by then; else the latest
 * percentage recorded by then (to invoice or revenue only); never less than
 * what was invoiced by then. Amounts before VAT, with VAT beside them at
 * each line's rate as last seen (5 % where none was).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const STANDARD_VAT_RATE = 1.05;

export type RevenueRow = {
  workOrderId: string;
  number: string | null;
  quotationNumber: string | null;
  clientName: string | null;
  value: number;
  recognised: number;
  recognisedInMonth: number;
  invoiced: number;
  remaining: number;
  /** The same, with VAT. */
  withVat: { value: number; recognised: number; recognisedInMonth: number; invoiced: number; remaining: number };
};

export type MonthEndRevenue = {
  month: string;
  /** The last day counted, in the org's zone. */
  asOf: string;
  rows: RevenueRow[];
  totals: RevenueRow["withVat"] & { beforeVat: Omit<RevenueRow["withVat"], never> };
  /** False until 20261026100000 is applied: no "% done" is counted. */
  progressReady: boolean;
};

type Line = { id: string; workOrderId: string; amount: number; rate: number };
type Invoiced = { lineId: string; workOrderId: string; amount: number; date: string };

export async function monthEndRevenue(admin: SupabaseClient, month: string): Promise<MonthEndRevenue> {
  const first = `${month}-01`;
  const nextMonth = addDaysToDateString(`${month}-28`, 4).slice(0, 7) + "-01";
  const lastDay = addDaysToDateString(nextMonth, -1);
  const previousLastDay = addDaysToDateString(first, -1);
  const endIso = zonedTimeToUtc(nextMonth).toISOString();
  const previousEndIso = zonedTimeToUtc(first).toISOString();

  const fin = () => admin.schema("finance");
  const [lineRows, flows, allocations, invoices] = await Promise.all([
    readAllRows<Record<string, unknown>>((from, to) => fin().from("line_states").select("*").order("fsm_line_id").range(from, to), "lines"),
    readAllRows<Record<string, unknown>>((from, to) => fin().from("work_order_states").select("*").order("fsm_work_order_id").range(from, to), "work orders"),
    readAllRows<Record<string, unknown>>(
      (from, to) => fin().from("line_invoice_allocations").select("invoice_id, fsm_line_id, fsm_work_order_id, amount").order("id").range(from, to),
      "allocations",
    ),
    readAllRows<Record<string, unknown>>((from, to) => fin().from("line_invoices").select("id, invoice_date").order("id").range(from, to), "invoices"),
  ]);
  let progressReady = true;
  let progressRows: Record<string, unknown>[] = [];
  try {
    progressRows = await readAllRows<Record<string, unknown>>(
      (from, to) => fin().from("progress_entries").select("*").order("recorded_at").range(from, to),
      "progress",
    );
  } catch (error) {
    if (!/progress_entries|PGRST205|42P01|schema cache/i.test(error instanceof Error ? error.message : String(error))) throw error;
    progressReady = false;
  }

  const flowOf = new Map(flows.map((f) => [String(f.fsm_work_order_id), f]));
  const woRate = (id: string) => {
    const f = flowOf.get(id);
    const sub = Number(f?.sub_total ?? 0);
    const grand = Number(f?.grand_total ?? 0);
    return sub > 0 && grand > 0 ? grand / sub : STANDARD_VAT_RATE;
  };
  const lines: Line[] = lineRows.map((l) => {
    const amount = Number(l.amount ?? 0);
    const withVat = l.amount_with_vat === null || l.amount_with_vat === undefined ? null : Number(l.amount_with_vat);
    return {
      id: String(l.fsm_line_id),
      workOrderId: String(l.fsm_work_order_id),
      amount,
      rate: withVat !== null && amount > 0 ? withVat / amount : woRate(String(l.fsm_work_order_id)),
    };
  });
  const invoiceDate = new Map(invoices.map((i) => [String(i.id), String(i.invoice_date)]));
  const invoiced: Invoiced[] = allocations.map((a) => ({
    lineId: String(a.fsm_line_id),
    workOrderId: String(a.fsm_work_order_id),
    amount: Number(a.amount),
    date: invoiceDate.get(String(a.invoice_id)) ?? "9999-12-31",
  }));
  type Entry = ProgressEntry & { workOrderId: string; value: number };
  const entries: Entry[] = progressRows.map((r) => ({
    workOrderId: String(r.fsm_work_order_id),
    lineId: str(r.fsm_line_id),
    percent: Number(r.percent),
    purpose: r.purpose === "revenue_only" ? "revenue_only" : "invoice",
    recordedAt: String(r.recorded_at),
    value: Number(r.value_before_vat ?? 0),
  }));

  const linesOf = groupBy(lines, (l) => l.workOrderId);
  const invoicedOf = groupBy(invoiced, (i) => i.workOrderId);
  const entriesOf = groupBy(entries, (e) => e.workOrderId);
  const ids = new Set([...linesOf.keys(), ...entriesOf.keys(), ...invoicedOf.keys()]);

  /* One work order as of a moment: [recognised, invoiced, value], before VAT and with VAT. */
  const asOf = (id: string, untilIso: string, untilDate: string) => {
    const flow = flowOf.get(id);
    const status = str(flow?.fsm_status);
    const completedAt = str(flow?.fsm_completed_at);
    const completed = isFsmCompleted(status) && (completedAt === null || completedAt < untilIso);
    const ended = isEnded(status) || isNonBillable(status);
    const known = linesOf.get(id) ?? [];
    const recorded = (entriesOf.get(id) ?? []).filter((e) => e.recordedAt < untilIso);
    const paid = (invoicedOf.get(id) ?? []).filter((i) => i.date <= untilDate);
    const paidOf = (lineId: string) => round2(paid.filter((p) => p.lineId === lineId).reduce((s, p) => s + p.amount, 0));
    let recognised = 0;
    let recognisedVat = 0;
    let invoicedSum = 0;
    let invoicedVat = 0;
    let value = 0;
    let valueVat = 0;
    for (const l of known) {
      const inv = paidOf(l.id);
      const entry = effectiveEntry(l.id, recorded);
      const r = ended ? inv : completed ? Math.max(l.amount, inv) : Math.max(entry ? (l.amount * entry.percent) / 100 : 0, inv);
      recognised += r;
      recognisedVat += r * l.rate;
      invoicedSum += inv;
      invoicedVat += inv * l.rate;
      value += l.amount;
      valueVat += l.amount * l.rate;
    }
    /* Never read line by line (before 20261025100000): the whole-work-order entry's own value. */
    if (!known.length) {
      const whole = recorded.filter((e) => e.lineId === null).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
      const inv = round2(paid.reduce((s, p) => s + p.amount, 0));
      const total = whole?.value ?? Number(flow?.sub_total ?? 0);
      const r = ended ? inv : completed ? Math.max(total, inv) : Math.max(whole ? (total * whole.percent) / 100 : 0, inv);
      const rate = woRate(id);
      recognised = r;
      recognisedVat = r * rate;
      invoicedSum = inv;
      invoicedVat = inv * rate;
      value = total;
      valueVat = total * rate;
    }
    return { recognised, recognisedVat, invoiced: invoicedSum, invoicedVat, value, valueVat };
  };

  const rows: RevenueRow[] = [];
  for (const id of ids) {
    const now = asOf(id, endIso, lastDay);
    const before = asOf(id, previousEndIso, previousLastDay);
    if (now.recognised <= 0.005 && now.invoiced <= 0.005) continue;
    const flow = flowOf.get(id);
    rows.push({
      workOrderId: id,
      number: str(flow?.work_order_number),
      quotationNumber: str(flow?.quotation_number),
      clientName: str(flow?.contact_name) ?? str(flow?.client_name),
      value: round2(now.value),
      recognised: round2(now.recognised),
      recognisedInMonth: round2(now.recognised - before.recognised),
      invoiced: round2(now.invoiced),
      remaining: round2(Math.max(0, now.value - now.invoiced)),
      withVat: {
        value: round2(now.valueVat),
        recognised: round2(now.recognisedVat),
        recognisedInMonth: round2(now.recognisedVat - before.recognisedVat),
        invoiced: round2(now.invoicedVat),
        remaining: round2(Math.max(0, now.valueVat - now.invoicedVat)),
      },
    });
  }
  rows.sort((a, b) => b.recognisedInMonth - a.recognisedInMonth || (a.number ?? "").localeCompare(b.number ?? ""));

  const sum = (pick: (r: RevenueRow) => number) => round2(rows.reduce((s, r) => s + pick(r), 0));
  return {
    month,
    asOf: lastDay,
    rows,
    totals: {
      value: sum((r) => r.withVat.value),
      recognised: sum((r) => r.withVat.recognised),
      recognisedInMonth: sum((r) => r.withVat.recognisedInMonth),
      invoiced: sum((r) => r.withVat.invoiced),
      remaining: sum((r) => r.withVat.remaining),
      beforeVat: {
        value: sum((r) => r.value),
        recognised: sum((r) => r.recognised),
        recognisedInMonth: sum((r) => r.recognisedInMonth),
        invoiced: sum((r) => r.invoiced),
        remaining: sum((r) => r.remaining),
      },
    },
    progressReady,
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}
