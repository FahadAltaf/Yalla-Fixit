import type { SupabaseClient } from "@supabase/supabase-js";
import { hasJobInspectors } from "./columns";

import { APPROVAL_SLA_HOURS } from "@/lib/server/snagging/workflow";
import type { SnaggingVisitType } from "@/types/types";

/**
 * One page of the jobs list, with its total.
 *
 * Shared by GET /api/snagging/tasks and the Jobs page itself: the page
 * reads its first screen on the server, so it arrives with its rows
 * instead of asking for them after it has loaded. Both run this, so the
 * first page the server renders is exactly the page the API would return.
 *
 * `params` are the API's query parameters (status, search, sortBy,
 * sortDirection, page, pageSize, assigneeId, createdFrom, createdTo, ...).
 */
export async function listJobs(
  admin: SupabaseClient,
  params: URLSearchParams,
): Promise<{ data: ReturnType<typeof enrichRows>; totalCount: number }> {
  const page = Math.max(0, Number(params.get("page") ?? 0));
  const pageSize = Math.min(
    200,
    Math.max(1, Number(params.get("pageSize") ?? 25)),
  );

  /*
    The job's inspectors, embedded rather than fetched per row. Asked once
    per process and left out entirely where 20260923100000 has not run, so
    a missing table costs the column rather than the page.
  */
  const roster = (await hasJobInspectors(admin))
    ? "\n       roster:snagging_job_inspectors(user_profile:inspector_id(full_name, email)),"
    : "";

  // Generic given explicitly: the select is assembled at runtime, which
  // the client's literal-type parser cannot follow.
  let query = admin.from("snagging_jobs").select<string, JobRow>(
    /*
      What the Jobs table and the approvals queue actually draw, plus the
      two the row DERIVES (submitted_at and approval_due_at decide whether
      a job is late). It used to read the whole row -- the rejection
      fields, the remediation clock, the schedule window, the community
      and the developer -- and hand back forty-four fields for a table
      that draws ten.
    */
    `id, code, status, round_number, visit_type,
       submitted_at, created_at, updated_at,
       reviewed_at, approval_due_at, escalated_at,
       unit_label, building_name, property_type,
       client:client_id(name),
       inspector:inspector_id(full_name, email),${roster}
       reviewer:reviewer_id(id, full_name, email),
       manager:approval_manager_id(id, full_name, email),
       high_snags:snagging_snags(count),
       medium_snags:snagging_snags(count),
       low_snags:snagging_snags(count)`,
    { count: "exact" },
  );
  /*
    The severity counts are counted by the database, in this same query,
    rather than by reading every snag of the page's jobs and counting them
    here. That was a second round trip, and it quietly stopped at the
    API's 1,000-row cap -- a busy page of jobs showed short counts.
  */
  query = query
    .eq("high_snags.severity", "high")
    .neq("high_snags.status", "withdrawn")
    .eq("medium_snags.severity", "medium")
    .neq("medium_snags.status", "withdrawn")
    .eq("low_snags.severity", "low")
    .neq("low_snags.status", "withdrawn");

  const status = params.get("status");
  if (status && status !== "all")
    query = query.in("status", status.split(","));

  const search = params.get("search")?.trim();
  if (search) {
    const term = `%${search}%`;
    query = query.or(
      [
        `code.ilike.${term}`,
        `unit_label.ilike.${term}`,
        `building_name.ilike.${term}`,
        `community.ilike.${term}`,
      ].join(","),
    );
  }

  const developer = params.get("developer");
  if (developer && developer !== "all")
    query = query.eq("developer_name", developer);

  const from = params.get("from");
  if (from) query = query.gte("scheduled_date", from);
  const to = params.get("to");
  if (to) query = query.lte("scheduled_date", to);

  /*
    When the job was RAISED, which is a different question from when it
    is booked in. The Overview's activity chart plots intake by
    created_at, so a click on one of its days has to narrow by the same
    column — reusing from/to above would have opened the jobs SCHEDULED
    that day, a different set with the same size and no way to tell.
  */
  const createdFrom = params.get("createdFrom");
  if (createdFrom) query = query.gte("created_at", createdFrom);
  const createdTo = params.get("createdTo");
  // Inclusive of the whole day, since the column is a timestamp.
  if (createdTo) query = query.lt("created_at", `${createdTo}T23:59:59.999Z`);

  if (params.get("queue") === "approval") {
    query = query
      .in("status", ["submitted", "in_review"])
      .order("submitted_at", { ascending: true, nullsFirst: false });
  } else {
    /*
      Newest first, by when the job was raised.

      The default was scheduled_date ascending, which put the oldest
      appointment at the top and buried a job created this morning
      somewhere in the middle of the list. Creation order is the one
      thing every record has, never changes, and matches what someone
      means by "the job I just made". A column the caller asks for
      still wins; this is only the default.
    */
    const sortByRaw = params.get("sortBy") ?? "created_at";
    const allowed = new Set([
      "scheduled_date",
      "code",
      "status",
      "created_at",
      "updated_at",
    ]);
    const sortBy = allowed.has(sortByRaw) ? sortByRaw : "created_at";
    // Newest first for a date, A-Z for a label.
    const dateLike = sortBy === "created_at" || sortBy === "updated_at";
    const direction = params.get("sortDirection");
    const ascending = direction ? direction !== "desc" : !dateLike;
    query = query.order(sortBy, { ascending, nullsFirst: false });
  }

  // One client's jobs, for the Clients page.
  const clientId = params.get("clientId");
  if (clientId) query = query.eq("client_id", clientId);

  // An inspector without All Records access only ever sees their own jobs.
  const assigneeId = params.get("assigneeId");
  if (assigneeId) query = query.eq("inspector_id", assigneeId);

  const { data, error, count } = await query.range(
    page * pageSize,
    page * pageSize + pageSize - 1,
  );
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as JobRow[];
  const enriched = enrichRows(rows);

  return { data: enriched, totalCount: count ?? 0 };
}

type Joined =
  | { full_name: string | null; email: string | null }
  | { full_name: string | null; email: string | null }[]
  | null;
type JobRow = {
  id: string;
  code: string;
  status: string;
  round_number: number;
  visit_type: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  // FR-6.01 / FR-6.07 — who holds it now, and whether it is late.
  reviewed_at: string | null;
  approval_due_at: string | null;
  escalated_at: string | null;
  reviewer: Joined;
  manager: Joined;
  unit_label: string;
  building_name: string | null;
  property_type: string | null;
  client: { name: string | null } | { name: string | null }[] | null;
  inspector: Joined;
  roster?: Array<{ user_profile: Joined }> | null;
  // Counted by the database (see the list query).
  high_snags?: { count: number }[] | null;
  medium_snags?: { count: number }[] | null;
  low_snags?: { count: number }[] | null;
};

function firstOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Adds the per-row counters and joined names the summary shape carries. */
function enrichRows(rows: JobRow[]) {
  if (rows.length === 0) return [];
  // Severity counts, counted by the database in the list query itself.
  const countOf = (value: { count: number }[] | null | undefined) => value?.[0]?.count ?? 0;

  const now = Date.now();
  return rows.map((row) => {
    const s = {
      high: countOf(row.high_snags),
      medium: countOf(row.medium_snags),
      low: countOf(row.low_snags),
    };
    const client = firstOf(row.client);
    const insp = firstOf(row.inspector);
    /*
      Everyone on the job, not just the one the job row names.

      Several inspectors work a job now with no lead among them, so a
      column headed "Inspector" showing one name was picking an arbitrary
      winner. Falls back to that name where the roster table is not there
      or has nothing for the job.
    */
    const roster = (row.roster ?? [])
      .map((entry) => firstOf(entry?.user_profile))
      .map((profile) => profile?.full_name ?? profile?.email ?? null)
      .filter((name): name is string => Boolean(name));
    const inspectorNames =
      roster.length > 0
        ? roster
        : insp?.full_name || insp?.email
          ? [(insp.full_name ?? insp.email) as string]
          : [];
    /*
      FR-6.07 — the 48h approval SLA.

      The deadline is now stored on the row when the job is submitted, so
      the escalation sweep can index it and a job keeps the deadline it was
      actually given. It is still derived here for rows written before the
      column existed, so a historical job does not read as having no
      deadline at all.
    */
    const submittedMs = row.submitted_at ? Date.parse(row.submitted_at) : NaN;
    const approvalDueAt =
      row.approval_due_at ??
      (Number.isNaN(submittedMs)
        ? null
        : new Date(
            submittedMs + APPROVAL_SLA_HOURS * 60 * 60 * 1000,
          ).toISOString());
    const awaitingDecision =
      row.status === "submitted" || row.status === "in_review";
    // Stamped by the sweep, or past the deadline and not yet swept. Either
    // way the queue shows it as late rather than waiting on the scheduler.
    const escalated =
      Boolean(row.escalated_at) ||
      (awaitingDecision &&
        approvalDueAt !== null &&
        Date.parse(approvalDueAt) < now);
    /*
      Only what a caller reads.

      Seven of these used to be a constant on every row -- task_type
      "single_unit", and six nulls (the schedule window, the package, the
      tier, delivered_at, supervisor_id) -- fields that said the same
      thing about every job ever returned. The rest went unread: the
      rejection trio, the remediation and review clocks, the ids whose
      names are already embedded beside them.
    */
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      round_number: row.round_number,
      visit_type: (row.visit_type ?? "initial") as SnaggingVisitType,
      // Late, or waiting: what the approvals queue colours a row by.
      escalated,
      submitted_at: row.submitted_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      // Who holds it now -- the reviewer until they pass it on, then the
      // approval manager.
      reviewer: firstOf(row.reviewer) ?? null,
      manager: firstOf(row.manager) ?? null,
      reviewed_at: row.reviewed_at ?? null,
      unit_label: row.unit_label,
      building_name: row.building_name,
      /* The de-snag quotation dialog prices from this. */
      property_type: row.property_type,
      client_name: client?.name ?? "",
      high_severity_count: s.high,
      inspector_name: inspectorNames[0] ?? null,
      inspector_names: inspectorNames,
      medium_severity_count: s.medium,
      low_severity_count: s.low,
    };
  });
}

