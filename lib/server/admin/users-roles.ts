import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ActionType, ResourceType, UserRoles, type User } from "@/types/types";

/**
 * Users, roles and permission mappings, written only here, with the
 * service role, after the route has checked who is asking.
 *
 * These tables decide what everyone in the portal may do, AMC approval
 * included. They used to be written from the browser through pg_graphql
 * with the public anon key (and `/api/role-access` wrote role_access with
 * the service role and no check at all), so anyone holding the anon key
 * could make themselves an admin. Migration 20261006160000 takes the
 * browser roles off these tables; this module is the trusted path that
 * replaces them. The rules it enforces beyond the RBAC check:
 *
 *   - Only an admin may give anyone the admin role, or change an admin.
 *   - Nobody changes their own role, active flag or approval-email flag.
 *   - Nobody deletes their own account.
 *   - The admin role cannot be renamed or deleted.
 *   - Permission rows name a real resource and action.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

export class AdminError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 500,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROLE_EMBED = "roles(name, description, role_access(resource, action, enabled, record_access))";
const FULL_USER =
  "id, email, role_id, first_name, last_name, full_name, is_active, receives_schedule_approval_email, last_login, profile_image, created_at, updated_at";
/* A colleague in a picker: no role, no permission matrix, no flags. */
const DIRECTORY_USER = "id, email, first_name, last_name, full_name, is_active, profile_image";

/** The GraphQL shape the screens were written against (roles.role_accessCollection.edges). */
export function toUserShape(row: Row): User {
  const joined = row.roles as Row | Row[] | null | undefined;
  const role = Array.isArray(joined) ? joined[0] : joined;
  const { roles: _r, ...rest } = row;
  void _r;
  return {
    ...(rest as unknown as User),
    ...(role
      ? {
          roles: {
            name: role.name,
            description: role.description,
            role_accessCollection: {
              edges: ((role.role_access as Row[] | null) ?? []).map((node) => ({ node })),
            },
          },
        }
      : {}),
  } as User;
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

const SORTABLE = new Set(["created_at", "updated_at", "full_name", "email", "last_login", "is_active"]);

export async function listUsersPage(
  admin: Admin,
  input: { search: string; limit: number; page: number; sortBy?: string | null; sortOrder?: string | null },
): Promise<{ users: User[]; totalCount: number }> {
  const limit = Math.min(Math.max(Math.trunc(input.limit) || 10, 1), 100);
  const page = Math.max(Math.trunc(input.page) || 0, 0);
  /* Only known columns: the sort key comes from the browser. */
  const sortBy = input.sortBy && SORTABLE.has(input.sortBy) ? input.sortBy : "created_at";
  const term = input.search.replace(/[,()"'\\%*:]/g, " ").trim().slice(0, 100);
  let q = admin
    .from("user_profile")
    .select(`${FULL_USER}, ${ROLE_EMBED}`, { count: "exact" })
    .order(sortBy, { ascending: input.sortOrder === "asc", nullsFirst: false })
    .order("id")
    .range(page * limit, page * limit + limit - 1);
  if (term) q = q.or(`email.ilike.%${term}%,full_name.ilike.%${term}%`);
  const { data, error, count } = await q;
  if (error) throw new AdminError(error.message, 500);
  return { users: ((data ?? []) as Row[]).map(toUserShape), totalCount: count ?? 0 };
}

/** Every user, for pickers. Full rows for user managers, directory fields for everyone else. */
export async function listAllUsers(admin: Admin, full: boolean): Promise<User[]> {
  const out: User[] = [];
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await admin
      .from("user_profile")
      .select(full ? `${FULL_USER}, ${ROLE_EMBED}` : DIRECTORY_USER)
      .order("created_at", { ascending: true })
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new AdminError(error.message, 500);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows.map(toUserShape));
    if (rows.length < 1000) break;
  }
  return out;
}

export async function getUser(admin: Admin, id: string): Promise<User | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await admin
    .from("user_profile")
    .select(`${FULL_USER}, ${ROLE_EMBED}`)
    .eq("id", id)
    .maybeSingle<Row>();
  if (error) throw new AdminError(error.message, 500);
  return data ? toUserShape(data) : null;
}

async function roleName(admin: Admin, roleId: string | null | undefined): Promise<string | null> {
  if (!roleId) return null;
  const { data } = await admin.from("roles").select("name").eq("id", roleId).maybeSingle<{ name: string }>();
  return data?.name ?? null;
}

export interface Caller {
  id: string;
  isAdmin: boolean;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export const createUserSchema = z.object({
  id: z.string().regex(UUID),
  email: z.string().trim().email().max(320),
  role_id: z.string().regex(UUID),
  first_name: z.string().trim().max(100).nullish(),
  last_name: z.string().trim().max(100).nullish(),
  full_name: z.string().trim().max(200).nullish(),
  profile_image: z.string().trim().max(2000).nullish(),
});

export async function createUserProfile(admin: Admin, caller: Caller, input: z.infer<typeof createUserSchema>): Promise<User> {
  if (!caller.canCreate) throw new AdminError("You cannot add users.", 403);
  const role = await roleName(admin, input.role_id);
  if (!role) throw new AdminError("That role does not exist.", 400);
  if (role === UserRoles.ADMIN && !caller.isAdmin) throw new AdminError("Only an admin can create another admin.", 403);
  const { data, error } = await admin
    .from("user_profile")
    .insert({ ...input, is_active: true })
    .select(`${FULL_USER}, ${ROLE_EMBED}`)
    .single<Row>();
  if (error) throw new AdminError(error.code === "23505" ? "That user already exists." : error.message, error.code === "23505" ? 409 : 400);
  return toUserShape(data);
}

export const updateUserSchema = z.object({
  id: z.string().regex(UUID),
  first_name: z.string().trim().max(100).nullish(),
  last_name: z.string().trim().max(100).nullish(),
  full_name: z.string().trim().max(200).nullish(),
  profile_image: z.string().trim().max(2000).nullish(),
  role_id: z.string().regex(UUID).nullish(),
  is_active: z.boolean().nullish(),
  receives_schedule_approval_email: z.boolean().nullish(),
});

/** The fields anyone may change on their own profile. */
const SELF_FIELDS = ["first_name", "last_name", "full_name", "profile_image"] as const;
const PRIVILEGED_FIELDS = ["role_id", "is_active", "receives_schedule_approval_email"] as const;

/**
 * The decision for an update, separated from the database so it can be
 * tested: which fields are written, or why it is refused.
 */
export function planUserUpdate(
  caller: Caller,
  target: { id: string; roleName: string | null; roleId: string | null; isActive: boolean | null; receivesApprovalEmail: boolean | null },
  input: z.infer<typeof updateUserSchema>,
  newRoleName: string | null,
): { ok: true; patch: Row } | { ok: false; status: 403 | 400; error: string } {
  const self = caller.id === target.id;
  if (!self && !caller.canEdit) return { ok: false, status: 403, error: "You cannot edit other users." };
  const patch: Row = {};
  for (const f of SELF_FIELDS) if (input[f] !== undefined) patch[f] = input[f];
  /* A privileged field only counts when it actually changes: the edit forms send every field. */
  const changing = PRIVILEGED_FIELDS.filter((f) => {
    if (input[f] === undefined || input[f] === null) return false;
    const current = f === "role_id" ? target.roleId : f === "is_active" ? target.isActive : target.receivesApprovalEmail;
    return input[f] !== current;
  });
  if (changing.length > 0) {
    if (self) return { ok: false, status: 403, error: "You cannot change your own role or access." };
    if (!caller.canEdit) return { ok: false, status: 403, error: "You cannot change roles or access." };
    if (target.roleName === UserRoles.ADMIN && !caller.isAdmin) return { ok: false, status: 403, error: "Only an admin can change an admin." };
    if (changing.includes("role_id")) {
      if (!newRoleName) return { ok: false, status: 400, error: "That role does not exist." };
      if (newRoleName === UserRoles.ADMIN && !caller.isAdmin) return { ok: false, status: 403, error: "Only an admin can grant the admin role." };
    }
    for (const f of changing) patch[f] = input[f];
  }
  return { ok: true, patch };
}

export async function updateUserProfile(admin: Admin, caller: Caller, input: z.infer<typeof updateUserSchema>): Promise<User> {
  const { data: target, error } = await admin
    .from("user_profile")
    .select("id, role_id, is_active, receives_schedule_approval_email, roles(name)")
    .eq("id", input.id)
    .maybeSingle<Row>();
  if (error) throw new AdminError(error.message, 500);
  if (!target) throw new AdminError("User not found.", 404);
  const joined = target.roles as Row | Row[] | null;
  const currentRole = (Array.isArray(joined) ? joined[0] : joined)?.name as string | undefined;
  const newRoleName = input.role_id ? await roleName(admin, input.role_id) : null;
  const plan = planUserUpdate(
    caller,
    {
      id: String(target.id),
      roleName: currentRole ?? null,
      roleId: (target.role_id as string | null) ?? null,
      isActive: (target.is_active as boolean | null) ?? null,
      receivesApprovalEmail: (target.receives_schedule_approval_email as boolean | null) ?? null,
    },
    input,
    newRoleName,
  );
  if (!plan.ok) throw new AdminError(plan.error, plan.status);
  if (Object.keys(plan.patch).length > 0) {
    const { error: updateError } = await admin
      .from("user_profile")
      .update({ ...plan.patch, updated_at: new Date().toISOString() })
      .eq("id", input.id);
    if (updateError) throw new AdminError(updateError.message, 400);
  }
  const user = await getUser(admin, input.id);
  if (!user) throw new AdminError("User not found.", 404);
  return user;
}

export async function deleteUserProfile(admin: Admin, caller: Caller, id: string): Promise<void> {
  if (!caller.canDelete) throw new AdminError("You cannot delete users.", 403);
  if (id === caller.id) throw new AdminError("You cannot delete your own account.", 403);
  const target = await getUser(admin, id);
  if (!target) throw new AdminError("User not found.", 404);
  if ((target.roles as { name?: string } | undefined)?.name === UserRoles.ADMIN && !caller.isAdmin) {
    throw new AdminError("Only an admin can delete an admin.", 403);
  }
  const { error } = await admin.from("user_profile").delete().eq("id", id);
  if (error) {
    /* Records that must outlive the person (AMC proposals and contracts)
       refuse the delete (migration 20261006160000). */
    /* 23503: RESTRICT. "referential integrity": the append-only rule on
       amc_audit_events cancels the actor SET NULL, so any user who appears
       in AMC history cannot be removed either. */
    if (error.code === "23503" || /referential integrity/i.test(error.message)) {
      throw new AdminError("This user owns records that must be kept (such as AMC proposals). Deactivate the user instead.", 409);
    }
    throw new AdminError(error.message, 400);
  }
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

export async function listRoles(admin: Admin): Promise<Row[]> {
  const { data, error } = await admin.from("roles").select("id, name, description, created_at, updated_at").order("name").limit(1000);
  if (error) throw new AdminError(error.message, 500);
  return (data ?? []) as Row[];
}

export async function listRolesWithAccess(admin: Admin): Promise<Row[]> {
  const { data, error } = await admin
    .from("roles")
    .select("id, name, description, created_at, updated_at, role_access(id, resource, action, enabled, record_access)")
    .order("name")
    .limit(1000);
  if (error) throw new AdminError(error.message, 500);
  return (data ?? []) as Row[];
}

export const roleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).nullish(),
});

export async function createRole(admin: Admin, input: z.infer<typeof roleSchema>): Promise<Row> {
  if (input.name.toLowerCase() === UserRoles.ADMIN) throw new AdminError("The admin role already exists.", 409);
  const { data, error } = await admin.from("roles").insert({ name: input.name, description: input.description ?? null }).select().single<Row>();
  if (error) throw new AdminError(error.code === "23505" ? "A role with that name exists." : error.message, error.code === "23505" ? 409 : 400);
  return data;
}

export async function updateRole(admin: Admin, id: string, input: z.infer<typeof roleSchema>): Promise<Row> {
  const current = await admin.from("roles").select("id, name").eq("id", id).maybeSingle<Row>();
  if (!current.data) throw new AdminError("Role not found.", 404);
  if (current.data.name === UserRoles.ADMIN && input.name !== UserRoles.ADMIN) throw new AdminError("The admin role cannot be renamed.", 403);
  if (input.name.toLowerCase() === UserRoles.ADMIN && current.data.name !== UserRoles.ADMIN) {
    throw new AdminError("Another role cannot be named admin.", 403);
  }
  const { data, error } = await admin
    .from("roles")
    .update({ name: input.name, description: input.description ?? null })
    .eq("id", id)
    .select()
    .single<Row>();
  if (error) throw new AdminError(error.message, 400);
  return data;
}

export async function deleteRole(admin: Admin, id: string): Promise<void> {
  const current = await admin.from("roles").select("id, name").eq("id", id).maybeSingle<Row>();
  if (!current.data) throw new AdminError("Role not found.", 404);
  if (current.data.name === UserRoles.ADMIN) throw new AdminError("The admin role cannot be deleted.", 403);
  const { error } = await admin.from("roles").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") throw new AdminError("Users still have this role. Move them to another role first.", 409);
    throw new AdminError(error.message, 400);
  }
}

/* ------------------------------------------------------------------ */
/* Permission rows                                                     */
/* ------------------------------------------------------------------ */

const RESOURCES = Object.values(ResourceType) as string[];
const ACTIONS = Object.values(ActionType) as string[];

export const roleAccessSchema = z.object({
  id: z.string().regex(UUID).optional(),
  role_id: z.string().regex(UUID),
  resource: z.string().refine((r) => RESOURCES.includes(r), "Unknown resource"),
  action: z.string().refine((a) => ACTIONS.includes(a), "Unknown action"),
  enabled: z.boolean().optional(),
  record_access: z.string().max(50).nullish(),
});

/** Who is asking, as the user rules above need it. */
export function callerFrom(accessUser: User, userId: string, isAdmin: boolean, has: (r: ResourceType, a: ActionType) => boolean): Caller {
  return {
    id: userId,
    isAdmin,
    canView: has(ResourceType.USERS, ActionType.VIEW),
    canCreate: has(ResourceType.USERS, ActionType.CREATE),
    canEdit: has(ResourceType.USERS, ActionType.EDIT),
    canDelete: has(ResourceType.USERS, ActionType.DELETE),
  };
}

export function adminErrorResponse(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof AdminError) return { status: error.status, body: { error: error.message } };
  console.error("admin route error:", error instanceof Error ? error.message : error);
  return { status: 500, body: { error: "Something went wrong" } };
}

/**
 * The profile for a new sign-in (self-registration, invite, OAuth first
 * login): always the default "user" role. The role is never taken from the
 * caller: the public sign-up form used to send a role_id the server
 * trusted, which let anyone register as an admin.
 */
export async function provisionDefaultProfile(
  admin: Admin,
  input: { id: string; email: string | null | undefined; first_name?: string | null; last_name?: string | null; full_name?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing } = await admin.from("user_profile").select("id").eq("id", input.id).maybeSingle();
  if (existing) return { ok: true };
  const { data: role } = await admin.from("roles").select("id").eq("name", UserRoles.USER).maybeSingle<{ id: string }>();
  if (!role) return { ok: false, error: "The default role is missing." };
  const { error } = await admin.from("user_profile").insert({
    id: input.id,
    email: input.email ?? null,
    role_id: role.id,
    first_name: input.first_name ?? null,
    last_name: input.last_name ?? null,
    full_name: input.full_name ?? null,
    is_active: true,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Whether a profile already uses this email (case-insensitive). */
export async function emailInUse(admin: Admin, email: string): Promise<boolean> {
  const { data } = await admin.from("user_profile").select("id").ilike("email", email.trim()).limit(1);
  return (data ?? []).length > 0;
}
