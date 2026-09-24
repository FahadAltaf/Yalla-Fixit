import type { SupabaseClient } from "@supabase/supabase-js";

import { likeTerm, pageParams } from "@/lib/server/snagging/search";

/*
  The Clients list (and the client pickers), shared by GET
  /api/snagging/clients and the Clients page, which reads its first page on
  the server so it arrives with the page.
*/

export type ClientRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes?: string | null;
  created_at?: string | null;
};

export function toOption(row: ClientRow, jobCount?: number) {
  return {
    id: row.id,
    client_name: row.name,
    client_email: row.email,
    client_phone: row.phone,
    company: row.company,
    notes: row.notes ?? null,
    created_at: row.created_at ?? null,
    /*
      How much work this client has given us. Undefined for the picker,
      which neither needs it nor should pay for the extra query — it is
      the Clients page that has a column for it.
    */
    job_count: jobCount,
  };
}

/** A page of clients (?page=), or the few best matches for a picker (?limit=). */
export async function listClients(admin: SupabaseClient, params: URLSearchParams) {
  const term = likeTerm(params.get("search"));
  /* The Clients page asks for counts; the job picker does not. */
  const withCounts = params.get("with_counts") === "true";
  /*
    The Clients page reads a page at a time (?page=); the pickers ask
    for the few best matches (?limit=). Neither reads the whole table.
  */
  const paged = params.has("page");
  const { from, to } = pageParams(params, { defaultSize: 10, maxSize: 100 });
  const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 50);

  // Sorted on the server, over every client, not just the page shown.
  const SORTABLE: Record<string, string> = {
    client_name: "name",
    client_phone: "phone",
    client_email: "email",
    created_at: "created_at",
  };
  const sortColumn = SORTABLE[params.get("sortBy") ?? ""] ?? "name";
  const ascending = params.get("sortDirection") !== "desc";

  let query = admin
    .from("snagging_clients")
    .select<string, ClientRow & { job_count?: { count: number }[] | null }>(
      // Each client's job count, counted by the database in the same
      // query when the page shows it.
      `id, name, email, phone, company, notes, created_at${withCounts ? ", job_count:snagging_jobs(count)" : ""}`,
      { count: paged ? "exact" : undefined },
    )
    .order(sortColumn, { ascending, nullsFirst: false })
    .order("id");
  query = paged ? query.range(from, to) : query.limit(limit);

  if (term) {
    query = query.or(
      [
        `name.ilike.${term}`,
        `email.ilike.${term}`,
        `phone.ilike.${term}`,
        `company.ilike.${term}`,
      ].join(","),
    );
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const totalCount = paged ? (count ?? 0) : undefined;

  if (!withCounts) {
    return {
      data: (data ?? []).map((row) => toOption(row)),
      totalCount,
    };
  }

  /*
    The job counts came back with the clients (job_count, counted by the
    database). This was one extra count query per client on the page.
  */
  const counts = new Map<string, number>(
    (data ?? []).map(
      (row) => [row.id, row.job_count?.[0]?.count ?? 0] as const,
    ),
  );

  return {
    data: (data ?? []).map((row) => toOption(row, counts.get(row.id) ?? 0)),
    totalCount,
  };
}
