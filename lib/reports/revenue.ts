/**
 * The revenue report (BRD 5.2 B5; DEV-454), pure calculation.
 *
 * Revenue (4 Nov, decided): the value of the work orders Completed in Zoho
 * FSM in the dates, before VAT, counted on the day FSM completed them. A
 * work order with no value of its own takes its quotation's.
 *
 * Shared jobs (D-17, decided 4 Nov): a work order's revenue is split
 * between the technicians who worked on it by their hours on it (their own
 * time sheet, else the appointment's actual times); when nobody's hours
 * are known, equally between the crew. Technician totals therefore add up
 * to the company's revenue; work orders with nobody from the technician
 * list on them (none in FSM, or only test and office accounts) sit under
 * "Not on the technician list".
 *
 * AMC (29 Oct, D-14): Work Type "AMC PPM" or an AMC contract reference.
 * Ratings: the customer's stars on FSM service reports, 1 to 5; FSM writes
 * 0 when the customer gave none, so 0 is "not rated". A rating counts for
 * every technician on its appointment, on the day the report was made.
 */

export type RevenueWorkOrder = {
  id: string;
  number: string | null;
  clientName: string | null;
  /** When FSM completed it, and that day in the org's zone. */
  completedAt: string;
  completedDate: string;
  /** Before VAT. */
  value: number;
  /** Where the value came from: the work order's own total, its quotation's, or none (0). */
  valueSource: "work_order" | "quotation" | "none";
  amc: boolean;
};

/** Who worked on a work order and for how long (minutes, every appointment added up). */
export type RevenueCrew = { technicianIds: string[]; minutes: Record<string, number> };

export type RevenueRating = {
  id: string;
  workOrderId: string | null;
  clientName: string | null;
  technicianIds: string[];
  /** 1 to 5 (0 and blanks are left out by the loader). */
  stars: number;
  date: string;
};

export type RevenueTechnician = { name: string; teamName: string };

export type Share = { technicianId: string; minutes: number; amount: number; percent: number };

export type RevenueWorkOrderRow = RevenueWorkOrder & {
  /** How it was split: by hours, equally (no hours known), or not at all (nobody from the technician list on it). */
  basis: "hours" | "equal" | "unassigned";
  shares: Array<Share & { name: string }>;
  invoiced: number;
  averageRating: number | null;
  ratings: number;
};

type Totals = {
  workOrders: number;
  revenue: number;
  amc: number;
  oneTime: number;
  invoiced: number;
  averageRating: number | null;
  ratings: number;
};

export type RevenueClientRow = Totals & { key: string; name: string; sharePercent: number | null };
export type RevenueTechnicianRow = Totals & {
  key: string;
  name: string;
  teamName: string;
  minutes: number;
  sharePercent: number | null;
  /** Work orders split equally for want of hours (their revenue is still counted). */
  equalSplits: number;
};
export type RevenueMonthRow = Totals & { key: string; label: string };

export type RevenueSummary = Totals & {
  amcPercent: number | null;
  invoicedPercent: number | null;
  /** Revenue on work orders with nobody from the technician list on them. */
  unassigned: number;
  unassignedWorkOrders: number;
  equalSplitWorkOrders: number;
  /** Completed with no value in FSM (counted, at 0). */
  noValueWorkOrders: number;
  /** Valued from their quotation. */
  quotationValued: number;
};

export type RevenueResult = {
  summary: RevenueSummary;
  workOrders: RevenueWorkOrderRow[];
  clients: RevenueClientRow[];
  technicians: RevenueTechnicianRow[];
  months: RevenueMonthRow[];
};

export const NO_TECHNICIAN = "none";
const NO_CLIENT = "No client";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const round2 = (n: number) => Math.round(n * 100) / 100;
const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const average = (sum: number, count: number) => (count ? Math.round((sum / count) * 10) / 10 : null);
export const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/**
 * A work order's value split by hours: each technician's minutes over the
 * crew's, in fils so the shares add up to the value exactly (the last
 * fils go to the largest share). No hours known: equal shares.
 */
export function splitByHours(value: number, crew: RevenueCrew | undefined): { basis: RevenueWorkOrderRow["basis"]; shares: Share[] } {
  const ids = [...new Set(crew?.technicianIds ?? [])];
  if (!ids.length) return { basis: "unassigned", shares: [] };
  const minutes = ids.map((id) => Math.max(0, crew?.minutes[id] ?? 0));
  const totalMinutes = minutes.reduce((s, m) => s + m, 0);
  const basis = totalMinutes > 0 ? "hours" : "equal";
  const weights = basis === "hours" ? minutes : ids.map(() => 1);
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const fils = Math.round(value * 100);
  const raw = weights.map((w) => Math.floor((fils * w) / totalWeight));
  let left = fils - raw.reduce((s, f) => s + f, 0);
  const order = weights.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) raw[order[k].i] += 1;
  return {
    basis,
    shares: ids.map((technicianId, i) => ({
      technicianId,
      minutes: Math.round(minutes[i]),
      amount: raw[i] / 100,
      percent: Math.round((weights[i] / totalWeight) * 1000) / 10,
    })),
  };
}

const emptyTotals = (): Totals & { ratingSum: number } => ({
  workOrders: 0,
  revenue: 0,
  amc: 0,
  oneTime: 0,
  invoiced: 0,
  averageRating: null,
  ratings: 0,
  ratingSum: 0,
});

function addWork(t: Totals, amount: number, amc: boolean, invoiced: number) {
  t.workOrders += 1;
  t.revenue += amount;
  if (amc) t.amc += amount;
  else t.oneTime += amount;
  t.invoiced += invoiced;
}

function finish<T extends Totals & { ratingSum: number }>(t: T): Omit<T, "ratingSum"> {
  const { ratingSum, ...rest } = t;
  return {
    ...rest,
    revenue: round2(t.revenue),
    amc: round2(t.amc),
    oneTime: round2(t.oneTime),
    invoiced: round2(t.invoiced),
    averageRating: average(ratingSum, t.ratings),
  };
}

export function computeRevenue(input: {
  workOrders: RevenueWorkOrder[];
  crews: Map<string, RevenueCrew>;
  ratings: RevenueRating[];
  /** Invoiced so far (MAHER, recorded in Ready to invoice), before VAT, per work order. */
  invoicedByWorkOrder: Map<string, number>;
  technicians: Map<string, RevenueTechnician>;
}): RevenueResult {
  const nameOf = (id: string) => (id === NO_TECHNICIAN ? "Not on the technician list" : (input.technicians.get(id)?.name ?? id));
  const teamOf = (id: string) => (id === NO_TECHNICIAN ? "—" : (input.technicians.get(id)?.teamName ?? "No team"));

  const ratingsByWo = new Map<string, RevenueRating[]>();
  for (const r of input.ratings) if (r.workOrderId) ratingsByWo.set(r.workOrderId, [...(ratingsByWo.get(r.workOrderId) ?? []), r]);

  const all = emptyTotals();
  const clients = new Map<string, ReturnType<typeof emptyTotals> & { key: string; name: string }>();
  const techs = new Map<string, ReturnType<typeof emptyTotals> & { key: string; minutes: number; equalSplits: number }>();
  const months = new Map<string, ReturnType<typeof emptyTotals> & { key: string }>();
  const bucket = <T>(map: Map<string, T>, key: string, make: () => T) => {
    let row = map.get(key);
    if (!row) {
      row = make();
      map.set(key, row);
    }
    return row;
  };

  let unassigned = 0;
  let unassignedWorkOrders = 0;
  let equalSplitWorkOrders = 0;
  const rows: RevenueWorkOrderRow[] = [];
  for (const wo of input.workOrders) {
    const invoiced = round2(input.invoicedByWorkOrder.get(wo.id) ?? 0);
    const split = splitByHours(wo.value, input.crews.get(wo.id));
    const woRatings = ratingsByWo.get(wo.id) ?? [];
    rows.push({
      ...wo,
      basis: split.basis,
      shares: split.shares.map((s) => ({ ...s, name: nameOf(s.technicianId) })),
      invoiced,
      averageRating: average(woRatings.reduce((s, r) => s + r.stars, 0), woRatings.length),
      ratings: woRatings.length,
    });

    addWork(all, wo.value, wo.amc, invoiced);
    const clientKey = wo.clientName ?? NO_CLIENT;
    addWork(bucket(clients, clientKey, () => ({ ...emptyTotals(), key: clientKey, name: clientKey })), wo.value, wo.amc, invoiced);
    const monthKey = wo.completedDate.slice(0, 7);
    addWork(bucket(months, monthKey, () => ({ ...emptyTotals(), key: monthKey })), wo.value, wo.amc, invoiced);

    if (split.basis === "unassigned") {
      unassigned += wo.value;
      unassignedWorkOrders += 1;
      addWork(bucket(techs, NO_TECHNICIAN, () => ({ ...emptyTotals(), key: NO_TECHNICIAN, minutes: 0, equalSplits: 0 })), wo.value, wo.amc, invoiced);
      continue;
    }
    if (split.basis === "equal") equalSplitWorkOrders += 1;
    for (const share of split.shares) {
      const t = bucket(techs, share.technicianId, () => ({ ...emptyTotals(), key: share.technicianId, minutes: 0, equalSplits: 0 }));
      /* Invoiced follows the same share as the revenue. */
      addWork(t, share.amount, wo.amc, wo.value > 0 ? (invoiced * share.amount) / wo.value : 0);
      t.minutes += share.minutes;
      if (split.basis === "equal") t.equalSplits += 1;
    }
  }

  /* Ratings on the day they were given; for every technician on the appointment. */
  for (const r of input.ratings) {
    for (const t of [all, bucket(clients, r.clientName ?? NO_CLIENT, () => ({ ...emptyTotals(), key: r.clientName ?? NO_CLIENT, name: r.clientName ?? NO_CLIENT })), bucket(months, r.date.slice(0, 7), () => ({ ...emptyTotals(), key: r.date.slice(0, 7) }))]) {
      t.ratings += 1;
      t.ratingSum += r.stars;
    }
    for (const id of new Set(r.technicianIds)) {
      const t = bucket(techs, id, () => ({ ...emptyTotals(), key: id, minutes: 0, equalSplits: 0 }));
      t.ratings += 1;
      t.ratingSum += r.stars;
    }
  }

  const total = all.revenue;
  const summary = finish(all);
  const noValueWorkOrders = input.workOrders.filter((w) => w.valueSource === "none").length;
  return {
    summary: {
      ...summary,
      amcPercent: percentOf(all.amc, total),
      invoicedPercent: percentOf(all.invoiced, total),
      unassigned: round2(unassigned),
      unassignedWorkOrders,
      equalSplitWorkOrders,
      noValueWorkOrders,
      quotationValued: input.workOrders.filter((w) => w.valueSource === "quotation").length,
    },
    /* Most recently completed first. */
    workOrders: rows.sort((a, b) => b.completedAt.localeCompare(a.completedAt) || (a.number ?? "").localeCompare(b.number ?? "")),
    /* Largest revenue first (BRD: ranked). */
    clients: [...clients.values()]
      .map((c) => ({ ...finish(c), sharePercent: percentOf(c.revenue, total) }))
      .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name)),
    technicians: [...techs.values()]
      .map((t) => ({ ...finish(t), name: nameOf(t.key), teamName: teamOf(t.key), minutes: Math.round(t.minutes), sharePercent: percentOf(t.revenue, total) }))
      /* Largest first; "Not on the technician list" is not a technician, so it comes last whatever its size. */
      .sort((a, b) => Number(a.key === NO_TECHNICIAN) - Number(b.key === NO_TECHNICIAN) || b.revenue - a.revenue || a.name.localeCompare(b.name)),
    /* Oldest month first: the trend reads left to right, top to bottom. */
    months: [...months.values()]
      .map((m) => ({ ...finish(m), label: monthLabel(m.key) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}
