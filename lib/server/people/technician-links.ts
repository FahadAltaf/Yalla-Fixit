import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Links an FSM technician to their portal account by email (record scoping, DEV-462).
 *
 * A technician's own data (their compliance, their statement) is found from
 * the signed-in session through technician_reference.user_profile_id, never
 * from an id in a request. This fills that link automatically during the
 * FSM technician sync, conservatively:
 *
 *  - only technicians with no link yet: a link an administrator set by
 *    hand is never overwritten;
 *  - only an exact, case-insensitive email match;
 *  - never when the match is ambiguous: two technicians with one email, or
 *    two accounts with one email;
 *  - never to an account already linked to another technician (the
 *    database enforces one technician per account as well).
 */

export type TechnicianForLink = {
  fsmResourceId: string;
  email: string | null;
  userProfileId: string | null;
};

export type UserForLink = { id: string; email: string | null };

export type PlannedLink = { fsmResourceId: string; userProfileId: string };

const normalise = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function planTechnicianLinks(
  technicians: TechnicianForLink[],
  users: UserForLink[],
): PlannedLink[] {
  const technicianEmails = countBy(technicians, (t) => normalise(t.email));
  const userEmails = countBy(users, (u) => normalise(u.email));
  const userByEmail = new Map(users.map((u) => [normalise(u.email), u.id]));
  const alreadyLinked = new Set(technicians.map((t) => t.userProfileId).filter(Boolean));

  const links: PlannedLink[] = [];
  for (const technician of technicians) {
    if (technician.userProfileId) continue;
    const email = normalise(technician.email);
    if (!email) continue;
    if (technicianEmails.get(email) !== 1 || userEmails.get(email) !== 1) continue;
    const userId = userByEmail.get(email);
    if (!userId || alreadyLinked.has(userId)) continue;
    alreadyLinked.add(userId);
    links.push({ fsmResourceId: technician.fsmResourceId, userProfileId: userId });
  }
  return links;
}

/** Reads both sides, plans, and writes the new links. Returns what it linked. */
export async function linkTechniciansToUsers(admin: SupabaseClient): Promise<PlannedLink[]> {
  const [technicians, users] = await Promise.all([
    admin.from("technician_reference").select("fsm_resource_id, email, user_profile_id").limit(5000),
    admin.from("user_profile").select("id, email").limit(5000),
  ]);
  if (technicians.error) throw new Error(technicians.error.message);
  if (users.error) throw new Error(users.error.message);

  const links = planTechnicianLinks(
    (technicians.data ?? []).map((row) => ({
      fsmResourceId: row.fsm_resource_id as string,
      email: (row.email as string | null) ?? null,
      userProfileId: (row.user_profile_id as string | null) ?? null,
    })),
    (users.data ?? []).map((row) => ({ id: row.id as string, email: (row.email as string | null) ?? null })),
  );

  for (const link of links) {
    const { error } = await admin
      .from("technician_reference")
      .update({ user_profile_id: link.userProfileId })
      .eq("fsm_resource_id", link.fsmResourceId)
      /* Only if still unlinked: an administrator may have linked it since. */
      .is("user_profile_id", null);
    if (error) console.error("[people:links] link failed:", link.fsmResourceId, error.message);
  }
  return links;
}

/**
 * Whether the FSM sync may delete a technician who has left FSM's active
 * list. Someone with a recorded leaving date or a resigned status is
 * exactly who has left, and their dates are what the reports need to stop
 * counting them (BRD TC15), so they are deactivated instead.
 */
export function keepWhenGoneFromFsm(row: { employment_status?: string | null; leaving_date?: string | null }): boolean {
  return row.employment_status === "resigned" || Boolean(row.leaving_date);
}
