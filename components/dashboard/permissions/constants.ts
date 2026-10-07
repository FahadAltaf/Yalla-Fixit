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

RESOURCE_ACTIONS[ResourceType.TODOS] = CRUD_MODULE_ACTIONS;
/* FR5.3 — Approve is the only AMC action granted by role. Creating and
   editing a proposal is gated by the email allowlist instead, which FRD
   §4 keeps out of scope. */
RESOURCE_ACTIONS[ResourceType.AMC] = [ActionType.VIEW, ActionType.APPROVE];
/* AMC operations (contracts after signature): View every contract,
   Create = activate, Edit = record usage / FSM links / customers and
   assessments, Approve = correct usage. */
RESOURCE_ACTIONS[ResourceType.AMC_OPERATIONS] = [ActionType.VIEW, ActionType.CREATE, ActionType.EDIT, ActionType.APPROVE];
/* BRD v0.3 6.7: the AMC roles are made of these (lib/amc/role-templates.ts). */
RESOURCE_ACTIONS[ResourceType.AMC_ENQUIRIES] = [ActionType.VIEW, ActionType.CREATE, ActionType.EDIT, ActionType.EXPORT];
RESOURCE_ACTIONS[ResourceType.AMC_RATE_CARD] = [ActionType.VIEW, ActionType.EDIT];
RESOURCE_ACTIONS[ResourceType.AMC_CONFIG] = [ActionType.VIEW, ActionType.EDIT, ActionType.APPROVE];
RESOURCE_ACTIONS[ResourceType.AMC_PAYMENTS] = [ActionType.VIEW, ActionType.CREATE, ActionType.EDIT, ActionType.APPROVE];
RESOURCE_ACTIONS[ResourceType.AMC_VISITS] = [ActionType.VIEW, ActionType.CREATE, ActionType.EDIT, ActionType.APPROVE];
RESOURCE_ACTIONS[ResourceType.AMC_ALLOWANCES] = [ActionType.VIEW, ActionType.APPROVE];
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

const EXTRA_RESOURCE_NAMES: Partial<Record<ResourceType, string>> = {
  [ResourceType.AMC]: "AMC Proposals",
  [ResourceType.AMC_OPERATIONS]: "AMC Operations",
  [ResourceType.AMC_ENQUIRIES]: "AMC Enquiries",
  [ResourceType.AMC_RATE_CARD]: "AMC Rate Card",
  [ResourceType.AMC_CONFIG]: "AMC Configuration (Approve = thresholds and bands)",
  [ResourceType.AMC_PAYMENTS]: "AMC Payments (Approve = payment gate override)",
  [ResourceType.AMC_VISITS]: "AMC Visits (Approve = supervisor closure)",
  [ResourceType.AMC_ALLOWANCES]: "AMC Allowances (Approve = override and reversal)",
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
