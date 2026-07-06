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

export function hasResourceAction(
  user: User | null | undefined,
  resource: ResourceType,
  action: ActionType
): boolean {
  if (isAdminUser(user)) return true;

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
