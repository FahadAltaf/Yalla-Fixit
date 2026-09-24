import type { SupabaseClient } from "@supabase/supabase-js";

import { likeTerm, pageParams } from "@/lib/server/snagging/search";

/*
  The Quotations list, shared by GET /api/snagging/quotations and the
  Quotations page, which reads its first page on the server so it arrives
  with the page. Both run this, so the first page the server renders is
  exactly what the API would return.
*/

/* What the Quotations table shows and filters on. property_snapshot is
   read for the client and unit names toWire() lifts out of it, and is not
   sent on; the figures and dates behind the total live on the quotation
   page, which loads the quotation by id. */
export const LIST_COLUMNS =
  "id, quote_number, status, quote_kind, currency, total, created_at, job_id, property_snapshot";

/* The status pills on the Quotations table, each with its own count. */
export const LIST_STATUSES = ["draft", "sent", "approved", "rejected"] as const;

/** One page of quotations, with the total and each status pill's count. */
export async function listQuotations(admin: SupabaseClient, params: URLSearchParams) {
  const status = params.get("status");
  const kind = params.get("kind");
  const term = likeTerm(params.get("search"));
  const { from, to } = pageParams(params, { defaultSize: 10, maxSize: 100 });

  /*
    A client's name lives on the client record, so the clients that
    match are found first and their quotations matched by id; the
    unit, building and snapshot name are matched on the quotation.
  */
  let clientIds: string[] = [];
  if (term) {
    const { data: clients, error: clientError } = await admin
      .from("snagging_clients")
      .select("id")
      .ilike("name", term)
      .limit(200);
    if (clientError) throw new Error(clientError.message);
    clientIds = (clients ?? []).map((row) => row.id as string);
  }
  const searchFilter = term
    ? [
        `quote_number.ilike.${term}`,
        `property_snapshot->>client_name.ilike.${term}`,
        `property_snapshot->>unit_label.ilike.${term}`,
        `property_snapshot->>building_name.ilike.${term}`,
        ...(clientIds.length ? [`client_id.in.(${clientIds.join(",")})`] : []),
      ].join(",")
    : null;

  let query = admin
    .from("snagging_quotations")
    .select(`${LIST_COLUMNS}, client:client_id(name), job:job_id(code)`, {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to);

  if (status && status !== "all") query = query.eq("status", status);
  if (kind && kind !== "all") query = query.eq("quote_kind", kind);
  if (searchFilter) query = query.or(searchFilter);

  // The pill counts follow the search and kind, not the status picked.
  const countFor = async (value: string | null) => {
    let counter = admin
      .from("snagging_quotations")
      .select("id", { count: "exact", head: true });
    if (value) counter = counter.eq("status", value);
    if (kind && kind !== "all") counter = counter.eq("quote_kind", kind);
    if (searchFilter) counter = counter.or(searchFilter);
    const { count, error: countError } = await counter;
    if (countError) throw new Error(countError.message);
    return count ?? 0;
  };

  const [{ data, error, count }, all, ...byStatus] = await Promise.all([
    query,
    countFor(null),
    ...LIST_STATUSES.map((value) => countFor(value)),
  ]);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return {
    data: rows.map(toWire),
    totalCount: count ?? 0,
    counts: {
      all,
      ...Object.fromEntries(LIST_STATUSES.map((value, i) => [value, byStatus[i]])),
    } as Record<string, number>,
  };
}

/** Flattens the joins into the shape the Quotations screen reads. */
export function toWire(row: Record<string, unknown>) {
  type Joined = Record<string, unknown> | Record<string, unknown>[] | null;
  const first = (value: Joined): Record<string, unknown> | null =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

  const client = first(row.client as Joined);
  const job = first(row.job as Joined);
  const snapshot = (row.property_snapshot ?? {}) as Record<string, unknown>;

  return {
    id: row.id,
    job_id: row.job_id ?? null,
    quote_number: row.quote_number,
    quote_kind: row.quote_kind,
    status: row.status,
    currency: row.currency,
    total: row.total,
    created_at: row.created_at,
    client_name:
      (client?.name as string) ?? (snapshot.client_name as string) ?? null,
    job_code: (job?.code as string) ?? null,
    unit_label: (snapshot.unit_label as string) ?? null,
    building_name: (snapshot.building_name as string) ?? null,
  };
}

