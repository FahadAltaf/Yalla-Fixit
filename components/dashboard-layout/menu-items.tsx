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

import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";

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
  if (item.canSee) return item.canSee(userProfile);
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
  /*
    Each extension has its own page and its own address now, listed here
    like Snagging's, rather than a second menu inside one page switched by
    ?section=. A link or a reload lands on the extension it names.
  */
  {
    title: "Extensions",
    url: "/extensions",
    icon: <Puzzle className="size-4 text-primary" />,
    isActive: false,
    resource: ResourceType.EXTENSIONS,
    items: [
      {
        title: "Bulk download",
        url: "/extensions/bulk-download",
        resource: ResourceType.EXTENSIONS,
      },
      {
        title: "Quotation templates",
        url: "/extensions/quotation-templates",
        resource: ResourceType.EXTENSIONS,
      },
      {
        title: "AMC proposals",
        url: "/extensions/amc",
        // AMC view or approve, which the resource filter cannot say.
        canSee: canUseAmc,
      },
    ],
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
        title: "Overview",
        url: "/snagging",
        // The section landing page, so it lights up on /snagging alone.
        exact: true,
        resource: ResourceType.SNAGGING,
      },
      /*
        Quotations lead, because that is where work now begins (BA v2,
        changes 1-3): a client is quoted, and the job is raised only once
        they approve.
      */
      {
        title: "Quotations",
        url: "/snagging/quotations",
        resource: ResourceType.SNAGGING,
      },
      {
        title: "Jobs",
        url: "/snagging/jobs",
        // An inspection opens at /snagging/<id>, not under /snagging/jobs,
        // so Jobs claims those too and stays selected while a job is open.
        match: ["/snagging"],
        resource: ResourceType.SNAGGING,
      },
      /*
        "New job" is deliberately gone. A job exists to carry out work a
        client has agreed to pay for, so it is raised from the approved
        quotation that agreed it (BR-2) — the route still exists and the
        wizard still runs, but reaching it from a menu invited a job with
        no quotation behind it, which is the thing this change removes.
      */
      // {
      //   title: "Review",
      //   url: "/snagging/review",
      //   resource: ResourceType.SNAGGING,
      // },
      {
        title: "Clients",
        url: "/snagging/clients",
        resource: ResourceType.SNAGGING,
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
      {
        title: "Checklist library",
        url: "/snagging/checklist",
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
    /*
      Settings is a group like Snagging: each page has its own address,
      and AMC Settings lives here with the rest of the admin
      configuration instead of beside the proposals it governs.
    */
    adminItems.unshift({
      title: "Settings",
      url: "/settings",
      icon: <Settings className="size-4 text-primary" />,
      isActive: false,
      resource: ResourceType.SETTINGS,
      items: [
        { title: "Profile", url: "/settings/profile", resource: ResourceType.SETTINGS },
        { title: "Appearance", url: "/settings/appearance", resource: ResourceType.SETTINGS },
        /*
          Named for the thing configured, not the page. Under a group
          already called Settings, "AMC settings" and "Snagging settings"
          said the same word twice.
        */
        { title: "AMC", url: "/settings/amc", canSee: canUseAmc },
        /*
          The rate card and the quotation wording, which used to sit under
          Snagging beside the work they price. They configure the module
          rather than operate it, so they belong with the rest of the
          admin configuration for the same reason AMC settings do.
        */
        {
          title: "Snagging",
          url: "/settings/snagging",
          resource: ResourceType.SNAGGING_CATALOGUE,
        },
      ],
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
