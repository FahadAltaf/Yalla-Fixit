import { randomInt } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { readAllRows } from "@/lib/server/snagging/read-all";
import { snaggingRoleIds } from "@/lib/server/snagging/staff";
import type { TechnicianAccount, TechnicianLoginResult } from "@/lib/technician-accounts";

/**
 * A technician's login (13 Nov 2026).
 *
 * Technicians come from Zoho FSM (technician_reference); the mobile apps
 * sign in with a portal account (user_profile). The two are joined by
 * technician_reference.user_profile_id, which the AMC mobile sync already
 * reads to find "my visits". Assigning a technician to an AMC visit or a
 * snagging job now makes sure that join exists first: an account is created
 * with the technician's FSM email and the Inspector role (Snagging and the
 * mobile app), or an account that already has that email is linked.
 *
 * The password is generated here, returned once to the person who created
 * the login so they can hand it over, and never stored or shown again.
 */

export const INSPECTOR_ROLE = "inspector";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export class TechnicianAccountError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Every active, listed technician with whether they can sign in. */
export async function listTechnicianAccounts(admin: SupabaseClient): Promise<TechnicianAccount[]> {
  const techs = await readAllRows<Row>(
    (from, to) =>
      admin
        .from("technician_reference")
        .select("fsm_resource_id, display_name, email, user_profile_id, is_active, hidden_from_lists")
        .eq("is_active", true)
        .order("display_name")
        .order("fsm_resource_id")
        .range(from, to),
    "technicians",
  );
  const listed = techs.filter((t) => t.hidden_from_lists !== true);
  const linkedIds = [...new Set(listed.map((t) => str(t.user_profile_id)).filter((id): id is string => Boolean(id)))];
  const [roleIds, profiles] = await Promise.all([
    snaggingRoleIds(admin),
    linkedIds.length
      ? admin
          .from("user_profile")
          .select("id, is_active, role_id")
          .in("id", linkedIds)
          .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            return (data ?? []) as Row[];
          })
      : Promise.resolve([] as Row[]),
  ]);
  const snagging = new Set(roleIds);
  const profileOf = new Map(profiles.map((p) => [String(p.id), p]));
  return listed.map((t) => {
    const userId = str(t.user_profile_id);
    const profile = userId ? profileOf.get(userId) : undefined;
    const state: TechnicianAccount["login"] = !userId || !profile ? "none" : profile.is_active === false ? "inactive" : "ready";
    return {
      fsmId: String(t.fsm_resource_id),
      name: str(t.display_name) ?? "Technician",
      email: str(t.email),
      userId: state === "none" ? null : userId,
      login: state,
      canInspect: state === "ready" && snagging.has(String(profile?.role_id)),
    };
  });
}

/**
 * Inspector accounts that are not a technician (an office inspector, or
 * somebody set up before logins came from technicians), so the snagging
 * picker keeps offering the people it offered before.
 */
export async function listOtherInspectors(admin: SupabaseClient, technicians: TechnicianAccount[]): Promise<Array<{ id: string; name: string; email: string | null }>> {
  const { data: role, error: roleError } = await admin.from("roles").select("id").eq("name", INSPECTOR_ROLE).maybeSingle<Row>();
  if (roleError) throw new Error(roleError.message);
  if (!role) return [];
  const { data, error } = await admin
    .from("user_profile")
    .select("id, full_name, email, is_active, hidden_from_lists")
    .eq("role_id", String(role.id))
    .order("full_name");
  if (error) throw new Error(error.message);
  const technicianUsers = new Set(technicians.map((t) => t.userId).filter(Boolean));
  return ((data ?? []) as Row[])
    .filter((u) => u.is_active !== false && u.hidden_from_lists !== true && !technicianUsers.has(String(u.id)))
    .map((u) => ({ id: String(u.id), name: str(u.full_name) ?? str(u.email) ?? "Inspector", email: str(u.email) }));
}

/* Easy to read aloud and type on a phone: no 0/O, 1/l/I. Three groups of four, e.g. "Kx7m-Pq4r-Tz9h". */
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGIT = "23456789";
const ALL = LOWER + UPPER + DIGIT;
export function generatePassword(): string {
  const pick = (set: string) => set[randomInt(set.length)];
  for (;;) {
    const chars = Array.from({ length: 12 }, () => pick(ALL));
    const text = chars.join("");
    if (/[a-z]/.test(text) && /[A-Z]/.test(text) && /[2-9]/.test(text)) {
      return `${text.slice(0, 4)}-${text.slice(4, 8)}-${text.slice(8)}`;
    }
  }
}

const splitName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  return { first_name: first ?? name, last_name: rest.join(" ") };
};

/** An account with this email, by profile (case-insensitive). */
async function profileByEmail(admin: SupabaseClient, email: string): Promise<Row | null> {
  const { data, error } = await admin.from("user_profile").select("id, is_active").ilike("email", email.replace(/[\\%_]/g, "\\$&")).limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as Row | undefined) ?? null;
}

/** A sign-in user with this email that has no profile yet (left behind by an earlier failed attempt). */
async function authUserByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 500 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (hit) return hit.id;
    if (data.users.length < 500) return null;
  }
  return null;
}

async function link(admin: SupabaseClient, fsmId: string, userId: string) {
  const { error } = await admin.from("technician_reference").update({ user_profile_id: userId }).eq("fsm_resource_id", fsmId);
  if (error) throw new Error(error.message);
}

/**
 * Make sure a technician can sign in: the linked account if there is one,
 * else the account that already has their email (linked now), else a new
 * Inspector account with a generated password.
 */
export async function ensureTechnicianLogin(admin: SupabaseClient, fsmId: string): Promise<TechnicianLoginResult> {
  const { data: tech, error } = await admin
    .from("technician_reference")
    .select("fsm_resource_id, display_name, email, user_profile_id, is_active")
    .eq("fsm_resource_id", fsmId)
    .maybeSingle<Row>();
  if (error) throw new Error(error.message);
  if (!tech) throw new TechnicianAccountError("Technician not found.", 404);
  const name = str(tech.display_name) ?? "Technician";
  const email = str(tech.email)?.toLowerCase() ?? null;

  const linkedId = str(tech.user_profile_id);
  if (linkedId) {
    const { data: profile } = await admin.from("user_profile").select("id").eq("id", linkedId).maybeSingle<Row>();
    if (profile) return { fsmId, name, email, userId: linkedId, status: "existing" };
  }
  if (!email) throw new TechnicianAccountError(`${name} has no email in Zoho FSM. Add one there first, then try again.`);
  if (tech.is_active === false) throw new TechnicianAccountError(`${name} is no longer active in Zoho FSM.`);

  const existing = await profileByEmail(admin, email);
  if (existing) {
    await link(admin, fsmId, String(existing.id));
    return { fsmId, name, email, userId: String(existing.id), status: "linked" };
  }

  const { data: role, error: roleError } = await admin.from("roles").select("id").eq("name", INSPECTOR_ROLE).maybeSingle<Row>();
  if (roleError) throw new Error(roleError.message);
  if (!role) throw new TechnicianAccountError("The Inspector role is missing. Add it under Roles first.", 409);

  const password = generatePassword();
  const names = splitName(name);
  let userId: string;
  let createdAuth = false;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { ...names, full_name: name } });
  if (created.error || !created.data.user) {
    /* Already a sign-in user without a profile: adopt it with the new password. */
    const orphan = /already|registered|exists/i.test(created.error?.message ?? "") ? await authUserByEmail(admin, email) : null;
    if (!orphan) throw new Error(created.error?.message ?? "Could not create the login.");
    /* Another request made the account a moment ago: link it, never reset its password. */
    const justMade = await profileByEmail(admin, email);
    if (justMade) {
      await link(admin, fsmId, String(justMade.id));
      return { fsmId, name, email, userId: String(justMade.id), status: "linked" };
    }
    const { error: pwError } = await admin.auth.admin.updateUserById(orphan, { password, email_confirm: true });
    if (pwError) throw new Error(pwError.message);
    userId = orphan;
  } else {
    userId = created.data.user.id;
    createdAuth = true;
  }

  const { error: profileError } = await admin.from("user_profile").insert({
    id: userId,
    email,
    ...names,
    full_name: name,
    role_id: String(role.id),
    is_active: true,
  });
  if (profileError) {
    /* Created twice at once: the other request won, so use its account. */
    const raced = await profileByEmail(admin, email);
    if (raced && String(raced.id) === userId) {
      await link(admin, fsmId, userId);
      return { fsmId, name, email, userId, status: "linked" };
    }
    if (createdAuth) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    throw new Error(profileError.message);
  }
  await link(admin, fsmId, userId);
  return { fsmId, name, email, userId, status: "created", password };
}
