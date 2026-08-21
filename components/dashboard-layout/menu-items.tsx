import {
  ActionType,
  MenuItem,
  MenuSection,
  ResourceType,
  User,
  UserRoles,
} from "@/types/types";
import {
  CalendarClock,
  ClipboardCheck,
  LayoutDashboard,
  ListTodo,
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

const isItemVisible = (item: MenuItem, userProfile: User): boolean => {
  if (
    !item.resource ||
    item?.resource === ResourceType.DASHBOARD ||
    userProfile?.roles?.name === UserRoles.ADMIN
  ) {
    return true;
  }
  return hasViewPermission(userProfile, item.resource);
};

const filterMenuItems = (items: MenuItem[], userProfile: User): MenuItem[] => {
  return items
    // Sub-items carry their own resource — the snag catalogue is
    // restricted to Ops while the rest of Snagging is not — so the
    // filter has to reach into them rather than stopping at the group.
    .map((item) =>
      item.items?.length
        ? { ...item, items: item.items.filter((subItem) => isItemVisible(subItem, userProfile)) }
        : item,
    )
    .filter((item) => isItemVisible(item, userProfile));
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
    title: "Todos",
    url: "/todos",
    icon: <ListTodo className="size-4 text-primary" />,
    isActive: false,
    resource: ResourceType.TODOS,
  },
  {
    title: "Extensions",
    url: "/extensions",
    icon: <Puzzle className="size-4 text-primary" />,
    isActive: false,
    resource: ResourceType.EXTENSIONS,
  },
  {
    title: "Scheduling",
    url: "/scheduling",
    icon: <CalendarClock className="size-4 text-primary" />,
    isActive: false,
    resource: ResourceType.SCHEDULING,
  },
  {
    title: "Snagging",
    url: "/snagging",
    icon: <ClipboardCheck className="size-4 text-primary" />,
    isActive: false,
    resource: ResourceType.SNAGGING,
    items: [
      {
        title: "Today",
        url: "/snagging",
        resource: ResourceType.SNAGGING,
      },
      {
        title: "Jobs",
        url: "/snagging/jobs",
        resource: ResourceType.SNAGGING,
      },
      {
        title: "New job",
        url: "/snagging/jobs/new",
        resource: ResourceType.SNAGGING,
      },
      {
        title: "Review",
        url: "/snagging/review",
        resource: ResourceType.SNAGGING,
      },
      {
        title: "Pricing",
        url: "/snagging/pricing",
        resource: ResourceType.SNAGGING_CATALOGUE,
      },
      {
        title: "Analytics",
        url: "/snagging/analytics",
        resource: ResourceType.SNAGGING,
      },
      {
        title: "Snag catalogue",
        url: "/snagging/catalogue",
        resource: ResourceType.SNAGGING_CATALOGUE,
      },
    ],
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
