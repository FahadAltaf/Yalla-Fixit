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

/** The de-snag verdict comment (20260921100000_snag_verdict_note). */
export const hasVerdictNote = (admin: SupabaseClient) =>
  hasColumn(admin, "snagging_snags", "verdict_note");
