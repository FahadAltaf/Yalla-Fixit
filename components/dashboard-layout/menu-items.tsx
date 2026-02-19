import {
  ActionType,
  MenuItem,
  MenuSection,
  ResourceType,
  User,
  UserRoles,
} from "@/types/types";
import {
  LayoutDashboard,
  Puzzle,
  Settings,
  Shield,
  User as UserIcon,
  UserCog,
} from "lucide-react";

// hasViewPermission and filter functions unchanged
const hasViewPermission = (
  userProfile: User,
  resource: ResourceType
): boolean => {
  try {
    if (!userProfile?.roles?.role_accessCollection?.edges) {
      return false;
    }

    return userProfile.roles.role_accessCollection.edges.some(
      (access: { node: { resource: string; action: string } }) =>
        access.node.resource === resource &&
        access.node.action === ActionType.VIEW
    );
  } catch (error) {
    console.error("Error checking menu permissions:", error);
    return false;
  }
};

const filterMenuItems = (items: MenuItem[], userProfile: User): MenuItem[] => {
  return items.filter((item) => {
    if (
      !item.resource ||
      item?.resource === ResourceType.DASHBOARD ||
      userProfile?.roles?.name === UserRoles.ADMIN
    ) {
      return true;
    }
    return hasViewPermission(userProfile, item.resource);
  });
};

const filterMenuSections = (
  sections: MenuSection[],
  userProfile: User
): MenuSection[] => {
  return sections
    .map((section) => ({
      ...section,
      items: filterMenuItems(section?.items, userProfile),
    }))
    .filter((section) => section?.items?.length > 0);
};

// Base menu configuration used for both navigation and permissions
export const baseSectionsItems: MenuItem[] = [
  {
    title: "Dashboard",
    url: "/",
    icon: <LayoutDashboard className="size-4 text-primary" />,
    isActive: false,
    resource: ResourceType.DASHBOARD,
  },
  {
    title: "Extensions",
    url: "/extensions",
    icon: <Puzzle className="size-4 text-primary" />,
    isActive: false,
    resource: ResourceType.EXTENSIONS,
  },
] as MenuItem[];

export const baseAdminItems: MenuItem[] = [
  {
    title: "Users",
    url: "/users",
    icon: <UserIcon className="size-4 text-primary" />,
    isActive: false,
    resource: ResourceType.USERS,
  },
  {
    title: "Roles",
    url: "/roles",
    icon: <UserCog className="size-4 text-primary" />,
    isActive: false,
    resource: ResourceType.ROLES,
  },
  {
    title: "Permissions",
    url: "/permissions",
    icon: <Shield className="size-4 text-primary" />,
    isActive: false,
    resource: ResourceType.PERMISSIONS,
  },
] as MenuItem[];

// NAV
export const getNavData = (user: User) => {
  const isAdminOrAgent = user?.roles?.name === UserRoles.ADMIN;

  // Clone base items so we don't mutate shared config
  const sectionsItems: MenuItem[] = [...baseSectionsItems];
  const adminItems: MenuItem[] = [...baseAdminItems];

  if (isAdminOrAgent) {
    adminItems.unshift({
      title: "Settings",
      url: "/settings",
      icon: <Settings className="size-4 text-primary" />,
      isActive: false,
      resource: ResourceType.SETTINGS,
    });
  }

  const navMain: MenuSection[] = [
    {
      title: "Menu",
      url: "#",
      items: sectionsItems,
    },
    {
      title: "Admin Area",
      url: "#",
      items: adminItems,
    },
  ];

  const filteredNavMain = filterMenuSections(navMain, user);

  return {
    navMain: filteredNavMain,
  };
};
