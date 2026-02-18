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

// Auto-configured resource → actions mapping
// Default for every menu-driven module is VIEW only
export const RESOURCE_ACTIONS: Record<ResourceType, ActionType[]> = menuResources.reduce(
  (acc, resource) => {
    acc[resource] = [ActionType.VIEW];
    return acc;
  },
  {} as Record<ResourceType, ActionType[]>
);

// Helper to get display name for resource based on menu item titles
const resourceDisplayNameMap: Partial<Record<ResourceType, string>> =
  allMenuItems.reduce((acc, item) => {
    if (item.resource && !acc[item.resource]) {
      acc[item.resource] = item.title;
    }
    return acc;
  }, {} as Partial<Record<ResourceType, string>>);

export const getResourceDisplayName = (resource: ResourceType): string => {
  return resourceDisplayNameMap[resource] || resource;
};

// Helper to get display name for action
export const getActionDisplayName = (action: ActionType): string => {
  const names: Record<ActionType, string> = {
    [ActionType.VIEW]: "View",
    [ActionType.CREATE]: "Create",
    [ActionType.EDIT]: "Edit",
    [ActionType.DELETE]: "Delete",
    [ActionType.EXPORT]: "Export",
  };
  return names[action] || action;
};
