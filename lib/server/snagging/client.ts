import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Find-or-create a client, by name and email.
 *
 * Lifted out of the job route so the Quotations section uses the identical
 * rule (BA v2, changes 1-2). Two entry points that each decided for
 * themselves whether a client already existed would eventually disagree —
 * and the failure mode is the one the Clients page was built to clean up:
 * the same person as two records, their jobs split across both.
 *
 * Matched on name AND email together rather than name alone, because
 * "Ahmed" is not an identity and merging two of them would be worse than
 * creating a second record.
 */
type Admin = SupabaseClient;

export async function resolveClient(
  admin: Admin,
  input: {
    /** An id from the picker short-circuits the search entirely. */
    clientId?: string | null;
    name: string;
    email: string | null;
    phone: string | null;
    createdBy: string;
  },
): Promise<string> {
  if (input.clientId) return input.clientId;

  const { data: existing } = await admin
    .from("snagging_clients")
    .select("id, email")
    .ilike("name", input.name)
    .limit(20);

  const match = (existing ?? []).find(
    (c: { id: string; email: string | null }) =>
      (c.email ?? "").toLowerCase() === (input.email ?? "").toLowerCase(),
  );
  if (match) return match.id;

  const { data, error } = await admin
    .from("snagging_clients")
    .insert({
      name: input.name,
      email: input.email,
      phone: input.phone,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}
