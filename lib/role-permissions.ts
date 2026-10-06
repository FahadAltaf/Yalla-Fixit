import { ActionType, ResourceType, Todo, User, UserRoles } from "@/types/types";

export type RoleAccessEntry = {
  resource: string;
  action: string;
  enabled?: boolean | null;
  record_access?: string | null;
};

export const OWN_RECORDS_ACCESS = "Own Records";
export const ALL_RECORDS_ACCESS = "All Records";

export function isAdminUser(user: User | null | undefined): boolean {
  return user?.roles?.name === UserRoles.ADMIN;
}

export function getRoleAccessEntries(user: User | null | undefined): RoleAccessEntry[] {
  const edges = user?.roles?.role_accessCollection?.edges ?? [];
  return edges.map((edge) => edge.node);
}

export function getResourceAccessEntries(
  user: User | null | undefined,
  resource: ResourceType
): RoleAccessEntry[] {
  return getRoleAccessEntries(user).filter((entry) => entry.resource === resource);
}

/**
 * The actions an admin does NOT get for free.
 *
 * Every other check short-circuits for an admin, which is what makes the
 * role usable: without it an admin could lock themselves out of Roles and
 * Permissions and have no way back in through the UI.
 *
 * Signing off an inspection is different. It is a named person putting
 * their name to a report that goes to a client, so it never falls to
 * somebody for holding a role.
 *
 * Note where the real gate lives now: snagging's review, approval,
 * rejection and delivery routes ask who is NAMED on the job, on its
 * Setup tab, and no permission at all substitutes for that (see
 * lib/server/snagging/workflow.ts). This entry is the belt to that
 * braces -- it keeps the admin short-circuit off SNAGGING + APPROVE so
 * that a check added here later cannot quietly reopen the bypass.
 * Everything else in snagging -- View especially, which is what the
 * inspector app's sign-in is gated on -- is untouched.
 */
const NOT_INHERITED_BY_ADMIN: ReadonlyArray<{
  resource: ResourceType;
  action: ActionType;
}> = [{ resource: ResourceType.SNAGGING, action: ActionType.APPROVE }];

function adminInherits(resource: ResourceType, action: ActionType): boolean {
  return !NOT_INHERITED_BY_ADMIN.some(
    (entry) => entry.resource === resource && entry.action === action
  );
}

export function hasResourceAction(
  user: User | null | undefined,
  resource: ResourceType,
  action: ActionType
): boolean {
  if (isAdminUser(user) && adminInherits(resource, action)) return true;

  return getResourceAccessEntries(user, resource).some(
    (entry) => entry.action === action && entry.enabled !== false
  );
}

export function getResourceRecordAccess(
  user: User | null | undefined,
  resource: ResourceType
): string {
  if (isAdminUser(user)) return ALL_RECORDS_ACCESS;

  const entries = getResourceAccessEntries(user, resource);
  const viewEntry = entries.find((entry) => entry.action === ActionType.VIEW);
  return viewEntry?.record_access || entries[0]?.record_access || ALL_RECORDS_ACCESS;
}

export function hasAllRecordsAccess(
  user: User | null | undefined,
  resource: ResourceType
): boolean {
  return getResourceRecordAccess(user, resource) !== OWN_RECORDS_ACCESS;
}

export function isTodoRecordOwnerOrAssignee(
  todo: Pick<Todo, "owner_id" | "assignees">,
  userId: string
): boolean {
  if (todo.owner_id === userId) return true;
  return Boolean(todo.assignees?.some((assignee) => assignee.id === userId));
}

export function canViewTodoRecord(
  user: User | null | undefined,
  todo: Pick<Todo, "owner_id" | "assignees">,
  userId: string
): boolean {
  if (!hasResourceAction(user, ResourceType.TODOS, ActionType.VIEW)) return false;
  if (isAdminUser(user) || hasAllRecordsAccess(user, ResourceType.TODOS)) return true;
  return isTodoRecordOwnerOrAssignee(todo, userId);
}

export function canEditTodoRecord(
  user: User | null | undefined,
  todo: Pick<Todo, "owner_id" | "assignees">,
  userId: string
): boolean {
  if (!hasResourceAction(user, ResourceType.TODOS, ActionType.EDIT)) return false;
  if (isAdminUser(user) || hasAllRecordsAccess(user, ResourceType.TODOS)) return true;
  return isTodoRecordOwnerOrAssignee(todo, userId);
}

export function canDeleteTodoRecord(
  user: User | null | undefined,
  todo: Pick<Todo, "owner_id" | "assignees">,
  userId: string
): boolean {
  if (!hasResourceAction(user, ResourceType.TODOS, ActionType.DELETE)) return false;
  if (isAdminUser(user) || hasAllRecordsAccess(user, ResourceType.TODOS)) return true;
  return isTodoRecordOwnerOrAssignee(todo, userId);
}

export function buildUserFromAccess(
  profile: { id: string; roles?: { name?: string | null } | Array<{ name?: string | null }> | null },
  roleAccess: RoleAccessEntry[]
): User {
  const role = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
  return {
    id: profile.id,
    roles: {
      name: role?.name ?? null,
      role_accessCollection: {
        edges: roleAccess.map((entry) => ({ node: entry })),
      },
    },
  };
}
