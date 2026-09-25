import type { SupabaseClient } from "@supabase/supabase-js";

/*
  Whether a column a newer migration adds exists yet.

  Code that reads or writes such a column deploys before, or without, the
  migration that adds it; naming a missing column fails the whole query, and
  on the job page or the inspector's sync that takes everything else down
  with it. So the few places that touch a new column ask here first and
  leave it out until it arrives.

  "Present" is remembered for good: a column does not go away. "Missing"
  is only remembered for a minute. It used to be remembered for the life
  of the server, so after a migration was applied the feature stayed off
  -- "not available until the database is updated" -- until someone
  restarted the server. A failed check is not remembered at all, so a
  transient error does not stick.
*/
const MISSING_RECHECK_MS = 60_000;
const known = new Map<string, { answer: Promise<boolean>; missingSince?: number }>();

export function hasColumn(admin: SupabaseClient, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const cached = known.get(key);
  if (cached && !(cached.missingSince && Date.now() - cached.missingSince > MISSING_RECHECK_MS)) {
    return cached.answer;
  }
  const entry: { answer: Promise<boolean>; missingSince?: number } = {
    answer: Promise.resolve(admin.from(table).select(column).limit(1)).then(({ error }) => {
      // 42703 is "undefined column"; anything else is not an answer.
      if (error && error.code !== "42703") {
        known.delete(key);
        return false;
      }
      if (error) entry.missingSince = Date.now();
      return !error;
    }),
  };
  known.set(key, entry);
  return entry.answer;
}

/** A room's own inspector, for several inspectors on one job (20260922100000_area_inspector). */
export const hasAreaInspector = (admin: SupabaseClient) =>
  hasColumn(admin, "snagging_areas", "inspector_id");

/** The de-snag verdict comment (20260921100000_snag_verdict_note). */
export const hasVerdictNote = (admin: SupabaseClient) =>
  hasColumn(admin, "snagging_snags", "verdict_note");

/** The reviewer's note to the inspector (20260922110000_snag_review_note). */
export const hasReviewNote = (admin: SupabaseClient) =>
  hasColumn(admin, "snagging_snags", "review_note");

/*
  Whether a table a newer migration adds exists yet, asked the same way and
  for the same reason as hasColumn: naming a missing relation fails the
  whole query, and on the job list that is the page rather than one column.
*/
const knownTables = new Map<string, Promise<boolean>>();

export function hasTable(admin: SupabaseClient, table: string): Promise<boolean> {
  let answer = knownTables.get(table);
  if (!answer) {
    answer = Promise.resolve(admin.from(table).select("*").limit(1)).then(({ error }) => {
      // 42P01 is "undefined table"; anything else is not an answer.
      if (error && error.code !== "42P01") {
        knownTables.delete(table);
        return false;
      }
      return !error;
    });
    knownTables.set(table, answer);
  }
  return answer;
}

/** Several inspectors on one job (20260923100000_multiple_inspectors). */
export const hasJobInspectors = (admin: SupabaseClient) =>
  hasTable(admin, "snagging_job_inspectors");

/** Several inspectors on one visit (20260924140000_visit_inspectors). */
export const hasVisitInspectors = (admin: SupabaseClient) =>
  hasTable(admin, "snagging_visit_inspectors");

/** Who answered a checklist item (20260924100000_checklist_answered_by). */
export const hasChecklistAnsweredBy = (admin: SupabaseClient) =>
  hasColumn(admin, "snagging_job_checklist", "answered_by");
