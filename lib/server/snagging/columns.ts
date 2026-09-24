import type { SupabaseClient } from "@supabase/supabase-js";

/*
  Whether a column a newer migration adds exists yet.

  Code that reads or writes such a column deploys before, or without, the
  migration that adds it; naming a missing column fails the whole query, and
  on the job page or the inspector's sync that takes everything else down
  with it. So the few places that touch a new column ask here first and
  leave it out until it arrives. Asked once per process and remembered; a
  failed check is not remembered, so a transient error does not stick.
*/
const known = new Map<string, Promise<boolean>>();

export function hasColumn(admin: SupabaseClient, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  let answer = known.get(key);
  if (!answer) {
    answer = Promise.resolve(admin.from(table).select(column).limit(1)).then(({ error }) => {
      // 42703 is "undefined column"; anything else is not an answer.
      if (error && error.code !== "42703") {
        known.delete(key);
        return false;
      }
      return !error;
    });
    known.set(key, answer);
  }
  return answer;
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
