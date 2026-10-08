import { ActionType, MenuItem, ResourceType } from "@/types/types";
import { baseAdminItems, baseSectionsItems } from "@/components/dashboard-layout/menu-items";

// Flatten nested menu items
const flattenMenuItems = (items: MenuItem[]): MenuItem[] => {
  return items.flatMap((item) => [
    item,
    ...(item.items ? flattenMenuItems(item.items) : []),
  ]);
};

// Build a unique list of resources directly from menu items
const allMenuItems: MenuItem[] = [
  ...flattenMenuItems(baseSectionsItems),
  ...flattenMenuItems(baseAdminItems),
];

const menuResources = Array.from(
  new Set(
    allMenuItems
      .map((item) => item.resource)
      .filter((resource): resource is ResourceType => Boolean(resource))
  )
);

const CRUD_MODULE_ACTIONS = [
  ActionType.VIEW,
  ActionType.CREATE,
  ActionType.EDIT,
  ActionType.DELETE,
];

// Auto-configured resource → actions mapping
// Default for every menu-driven module is VIEW only
export const RESOURCE_ACTIONS: Record<ResourceType, ActionType[]> = menuResources.reduce(
  (acc, resource) => {
    acc[resource] = [ActionType.VIEW];
    return acc;
  },
  {} as Record<ResourceType, ActionType[]>
);

/*
  Signing in to the inspector app. View is the whole of it: a yes or no
  about the phone, with what an inspector may then do decided by the job
  they are named on. It has no menu entry, so it is named here or it
  would never reach the Permissions screen at all.
*/
RESOURCE_ACTIONS[ResourceType.MOBILE_APP] = [ActionType.VIEW];

RESOURCE_ACTIONS[ResourceType.TODOS] = CRUD_MODULE_ACTIONS;
/* FR5.3 — Approve is the only AMC action granted by role. Creating and
   editing a proposal is gated by the email allowlist instead, which FRD
   §4 keeps out of scope. */
RESOURCE_ACTIONS[ResourceType.AMC] = [ActionType.VIEW, ActionType.APPROVE];
// Scheduling is a full CRUD module plus an Approve permission (#2): the holder
// can approve/reject a submitted day and receives the submission email.
RESOURCE_ACTIONS[ResourceType.SCHEDULING] = [...CRUD_MODULE_ACTIONS, ActionType.APPROVE];
// Snagging is a full CRUD module plus Approve (the manager sign-off gate,
// BR-4) and Export (analytics CSV). Without these listed here, the
// Permissions screen could only ever grant View, so nobody but an admin
// could create a job or approve an inspection.
RESOURCE_ACTIONS[ResourceType.SNAGGING] = [
  ...CRUD_MODULE_ACTIONS,
  ActionType.APPROVE,
  ActionType.EXPORT,
];
// The catalogue is master data: entries are retired, never deleted (BR-8),
// so it offers View / Create / Edit but not Delete.
RESOURCE_ACTIONS[ResourceType.SNAGGING_CATALOGUE] = [
  ActionType.VIEW,
  ActionType.CREATE,
  ActionType.EDIT,
];

// Helper to get display name for resource based on menu item titles
const resourceDisplayNameMap: Partial<Record<ResourceType, string>> =
  allMenuItems.reduce((acc, item) => {
    if (item.resource && !acc[item.resource]) {
      acc[item.resource] = item.title;
    }
    return acc;
  }, {} as Partial<Record<ResourceType, string>>);

/*
  Resources with no menu entry of their own, which is where the names
  above come from. Mobile app is not a page in the portal at all -- it is
  the permission to sign in to the inspector app on a phone.
*/
const EXTRA_RESOURCE_NAMES: Partial<Record<ResourceType, string>> = {
  [ResourceType.AMC]: "AMC Proposals",
  [ResourceType.SNAGGING]: "Snagging (whole module)",
  [ResourceType.EXTENSIONS]: "Extensions (whole module)",
  [ResourceType.MOBILE_APP]: "Mobile application",
};

export const getResourceDisplayName = (resource: ResourceType): string => {
  return (
    resourceDisplayNameMap[resource] ||
    EXTRA_RESOURCE_NAMES[resource] ||
    resource
  );
};

// Helper to get display name for action
export const getActionDisplayName = (action: ActionType): string => {
  const names: Record<ActionType, string> = {
    [ActionType.VIEW]: "View",
    [ActionType.CREATE]: "Create",
    [ActionType.EDIT]: "Edit",
    [ActionType.DELETE]: "Delete",
    [ActionType.EXPORT]: "Export",
    [ActionType.APPROVE]: "Approve",
  };
  return names[action] || action;
};

/*
  Which module each permission belongs under.

  The screen lists one row per resource, and once Snagging became seven
  of them they sorted in amongst Todos and Scheduling in enum order,
  reading as seven unrelated modules. This keeps a module's pages
  together and under it, so the list reads the way the menu does.
*/
export const RESOURCE_PARENT: Partial<Record<ResourceType, ResourceType>> = {
  [ResourceType.SNAGGING_OVERVIEW]: ResourceType.SNAGGING,
  [ResourceType.SNAGGING_QUOTATIONS]: ResourceType.SNAGGING,
  [ResourceType.SNAGGING_JOBS]: ResourceType.SNAGGING,
  [ResourceType.SNAGGING_CLIENTS]: ResourceType.SNAGGING,
  [ResourceType.SNAGGING_ANALYTICS]: ResourceType.SNAGGING,
  [ResourceType.SNAGGING_CATALOGUE]: ResourceType.SNAGGING,
  [ResourceType.SNAGGING_CHECKLIST]: ResourceType.SNAGGING,
  [ResourceType.MOBILE_APP]: ResourceType.SNAGGING,
  [ResourceType.EXTENSIONS_BULK_DOWNLOAD]: ResourceType.EXTENSIONS,
  [ResourceType.EXTENSIONS_QUOTATION_TEMPLATES]: ResourceType.EXTENSIONS,
};

/** Modules with pages of their own, which is what makes a row expandable. */
export function hasChildren(resource: ResourceType): boolean {
  return Object.values(RESOURCE_PARENT).includes(resource);
}

/** A module first, then its pages, then the next module. */
export function orderResources(resources: ResourceType[]): ResourceType[] {
  const children = new Map<ResourceType, ResourceType[]>();
  for (const resource of resources) {
    const parent = RESOURCE_PARENT[resource];
    if (!parent) continue;
    children.set(parent, [...(children.get(parent) ?? []), resource]);
  }
  const out: ResourceType[] = [];
  for (const resource of resources) {
    if (RESOURCE_PARENT[resource]) continue;
    out.push(resource, ...(children.get(resource) ?? []));
  }
  return out;
}
