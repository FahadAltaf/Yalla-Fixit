import {
  ActionType,
  MenuItem,
  MenuSection,
  ResourceType,
  User,
  UserRoles,
} from "@/types/types";
import {
  BadgeCheck,
  Bell,
  CalendarClock,
  ReceiptText,
  ChartColumn,
  ClipboardCheck,
  FileSignature,
  LayoutDashboard,
  ListTodo,
  Puzzle,
  Settings,
  Shield,
  User as UserIcon,
  UserCog,
  UsersRound,
} from "lucide-react";

import {
  canUseAmc,
  canViewAmcConfig,
  canViewAmcEnquiries,
  canViewAmcPayments,
  canViewAmcRateCard,
  canViewAmcVisits,
} from "@/components/dashboard/extensions/amc/amc-constants";
import { REPORTS_ENABLED } from "@/lib/reports/enabled";
import { hasResourceAction, hasSharedListAction } from "@/lib/role-permissions";

/* Who reaches the Ready-to-Invoice queue: Finance and managers (queue
   View), and the coordinators and verifier who answer its queries and
   exclusions (BRD §6.7). The API applies the same rule. */
const canUseFinanceQueue = (user: User) =>
  hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.VIEW) ||
  hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE) ||
  hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE);

/* Holding both views of Ready to invoice (admins do): each gets its own entry (3 Nov). */
const hasBothFinanceViews = (user: User) =>
  hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.VIEW) &&
  hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE);

/* The Finance group: any of its pages. */
const canUseFinance = (user: User) =>
  canUseFinanceQueue(user) ||
  hasResourceAction(user, ResourceType.FINANCE_QUERIES, ActionType.VIEW) ||
  hasResourceAction(user, ResourceType.FINANCE_METRICS, ActionType.VIEW);

/* Reports (BRD 5.2 B): the group shows when any report it holds may be opened. */
const canUseReports = (user: User) =>
  hasResourceAction(user, ResourceType.REPORTS_QUOTATIONS, ActionType.VIEW) ||
  hasResourceAction(user, ResourceType.REPORTS_UTILIZATION, ActionType.VIEW) ||
  hasResourceAction(user, ResourceType.REPORTS_CAPACITY, ActionType.VIEW) ||
  hasResourceAction(user, ResourceType.REPORTS_EXCEPTIONS, ActionType.VIEW) ||
  hasResourceAction(user, ResourceType.REPORTS_ATTENDANCE, ActionType.VIEW) ||
  hasResourceAction(user, ResourceType.REPORTS_COMPLIANCE, ActionType.VIEW);


// Workforce People (C6): one list for Scheduling's technicians and
// Compliance's employees, so either module's View opens it.
const canSeeWorkforce = (user: User): boolean =>
  hasResourceAction(user, ResourceType.SCHEDULING, ActionType.VIEW) ||
  hasResourceAction(user, ResourceType.COMPLIANCE, ActionType.VIEW);

// Settings → Workforce: Workforce settings, or the old key of any list on it.
const canSeeWorkforceLists = (user: User): boolean =>
  hasSharedListAction(user, ResourceType.SCHEDULING, ActionType.VIEW) ||
  hasSharedListAction(user, ResourceType.COMPLIANCE_SETTINGS, ActionType.VIEW);

const workforceSettingsItem: MenuItem = {
  title: "Workforce",
  url: "/settings/workforce",
  canSee: canSeeWorkforceLists,
};

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
    // Sub-items carry their own resource — each Snagging page is granted
    // separately — so the filter has to reach into them rather than
    // stopping at the group.
    .map((item) =>
      item.items?.length
        ? { ...item, items: item.items.filter((subItem) => isItemVisible(subItem, userProfile)) }
        : item,
    )
    .filter((item) => {
      /*
        A group is worth showing only if something inside it is.

        Its own resource is the module as a whole, which a role can still
        hold while having none of the pages under it -- an inspector, for
        one, whose work is on the phone. That printed "Snagging" in the
        sidebar with nothing beneath it and nowhere to go: a menu entry
        that is only a disappointment. The pages decide now, and the
        group follows them.
      */
      if (item.items && item.items.length === 0) return false;
      return isItemVisible(item, userProfile);
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
  /* Everyone's own inbox (BRD §6.2); no resource, so always shown. */
  {
    title: "Notifications",
    url: "/notifications",
    icon: <Bell className="size-4 text-primary" />,
    isActive: false,
  },
  /* A technician's own compliance (BRD §6.7); those who can open the full report use that instead. */
  {
    title: "My compliance",
    url: "/my-compliance",
    icon: <BadgeCheck className="size-4 text-primary" />,
    isActive: false,
    /* Part of the Reports module: hidden while it is switched off (lib/reports/enabled.ts). */
    canSee: (user: User) => REPORTS_ENABLED && !hasResourceAction(user, ResourceType.REPORTS_COMPLIANCE, ActionType.VIEW),
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
        resource: ResourceType.EXTENSIONS_BULK_DOWNLOAD,
      },
      {
        title: "Quotation templates",
        url: "/extensions/quotation-templates",
        resource: ResourceType.EXTENSIONS_QUOTATION_TEMPLATES,
      },
    ],
  },
  {
    title: "Finance",
    url: "/finance/queue",
    icon: <ReceiptText className="size-4 text-primary" />,
    isActive: false,
    canSee: canUseFinance,
    items: [
      {
        title: "Ready to invoice",
        url: "/finance/queue",
        canSee: (user: User) => canUseFinanceQueue(user) && !hasBothFinanceViews(user),
      },
      {
        /* Short enough for one line in the menu (3 Nov); the page title says "Ready to invoice (Finance)". */
        title: "Invoices (Finance)",
        url: "/finance/queue",
        canSee: hasBothFinanceViews,
      },
      {
        title: "Invoices (Operations)",
        url: "/finance/operations",
        canSee: hasBothFinanceViews,
      },
      {
        title: "Queries",
        url: "/finance/queries",
        resource: ResourceType.FINANCE_QUERIES,
      },
      {
        title: "Invoicing metrics",
        url: "/finance/metrics",
        resource: ResourceType.FINANCE_METRICS,
      },
    ],
  },
  {
    title: "Reports",
    url: "/reports",
    icon: <ChartColumn className="size-4 text-primary" />,
    isActive: false,
    /* Hidden while the Reports module is switched off (lib/reports/enabled.ts). */
    canSee: (user: User) => REPORTS_ENABLED && canUseReports(user),
    items: [
      {
        title: "Quotation summary",
        url: "/reports/quotations",
        resource: ResourceType.REPORTS_QUOTATIONS,
      },
      {
        title: "Utilization",
        url: "/reports/utilization",
        resource: ResourceType.REPORTS_UTILIZATION,
      },
      {
        title: "Capacity",
        url: "/reports/capacity",
        resource: ResourceType.REPORTS_CAPACITY,
      },
      {
        title: "Exception reports",
        url: "/reports/exceptions",
        resource: ResourceType.REPORTS_EXCEPTIONS,
      },
      {
        title: "Daily attendance",
        url: "/reports/attendance",
        resource: ResourceType.REPORTS_ATTENDANCE,
      },
      {
        title: "App compliance",
        url: "/reports/compliance",
        resource: ResourceType.REPORTS_COMPLIANCE,
      },
      /* BRD B5: the reports kept in Zoho FSM, linked from here. Hidden for now (30 Oct, to be worked on later). */
      {
        title: "Zoho FSM reports",
        url: "/reports/fsm",
        canSee: () => false,
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
  /*
    AMC is a module of its own, laid out like Snagging: one parent, each
    section a sub-item. It used to hang off Extensions (so an AMC user
    without the Extensions permission never saw it) with the rest of its
    sections in a row of pills inside each page.

    The addresses stay under /extensions/amc*: notifications already
    stored, and emails already sent, link there.

    Every entry uses canSee rather than resource: AMC access is "any of
    the AMC permissions" (an approver may hold Approve without View),
    which the plain resource filter cannot express.
  */
  {
    title: "AMC",
    url: "/extensions/amc-contracts",
    icon: <FileSignature className="size-4 text-primary" />,
    isActive: false,
    canSee: canUseAmc,
    items: [
      { title: "Enquiries", url: "/extensions/amc-contracts/enquiries", canSee: canViewAmcEnquiries },
      { title: "Proposals", url: "/extensions/amc", resource: ResourceType.AMC_PROPOSALS },
      {
        title: "Contracts",
        url: "/extensions/amc-contracts",
        /* A contract opens at /extensions/amc-contracts/<id>; the other
           sections claim longer prefixes, so this only wins on those. */
        resource: ResourceType.AMC_CONTRACTS,
      },
      // { title: "Renewals", url: "/extensions/amc-contracts/renewals", resource: ResourceType.AMC_RENEWALS },
      // { title: "Payments", url: "/extensions/amc-contracts/payments", canSee: canViewAmcPayments },
      {
        title: "Clients",
        url: "/extensions/amc-contracts/customers",
        // A property page belongs to its client.
        match: ["/extensions/amc-contracts/properties"],
        resource: ResourceType.AMC_CLIENTS,
      },
      { title: "Site visits", url: "/extensions/amc-contracts/assessments", resource: ResourceType.AMC_SITE_VISITS },
      // { title: "Visit board", url: "/extensions/amc-contracts/board", canSee: canViewAmcVisits },
      // { title: "Job reviews", url: "/extensions/amc-contracts/job-reviews", canSee: canViewAmcVisits },
      // { title: "Call outs", url: "/extensions/amc-contracts/call-outs", resource: ResourceType.AMC_CALL_OUTS },
      // { title: "Additional work", url: "/extensions/amc-contracts/additional-works", resource: ResourceType.AMC_ADDITIONAL_WORKS },
      // { title: "Technicians", url: "/extensions/amc-contracts/technicians", resource: ResourceType.AMC_TECHNICIANS },
      // { title: "Reports", url: "/extensions/amc-contracts/reports", resource: ResourceType.AMC_REPORTS },
      { title: "Rate card", url: "/extensions/amc-contracts/rate-card", canSee: canViewAmcRateCard },
      // { title: "FSM mapping", url: "/extensions/amc-contracts/fsm-services", resource: ResourceType.AMC_FSM_MAPPING },
      // { title: "Operations settings", url: "/extensions/amc-contracts/settings", resource: ResourceType.AMC_OPERATIONS_SETTINGS },
      /* Admins also have it under Settings; this is for managers and
         department heads with AMC Configuration who are not admins. */
      // { title: "Configuration", url: "/settings/amc/configuration", canSee: canViewAmcConfig },
    ],
  },
  /*
    Workforce (C6, Sami 31 Oct 2026): everyone in one list, the compliance
    employees and the FSM technicians joined by the FSM link, with bulk
    editing. Replaces Scheduling's Technicians & leave page and Compliance's
    Employees list; each field is still stored where its module reads it.
  */
  {
    title: "Workforce",
    url: "/workforce",
    icon: <UsersRound className="size-4 text-primary" />,
    isActive: false,
    canSee: canSeeWorkforce,
  },
  {
    title: "Snagging",
    url: "/snagging",
    icon: <ClipboardCheck className="size-4 text-primary" />,
    isActive: false,
    /*
      The group itself, which is shown when any page under it is. Its
      children carry the permissions now; this one stays the module-wide
      resource so anything still asking about Snagging as a whole -- the
      staff lookup, the API guards -- keeps the answer it had.
    */
    resource: ResourceType.SNAGGING,
    items: [
      {
        title: "Overview",
        url: "/snagging",
        // The section landing page, so it lights up on /snagging alone.
        exact: true,
        resource: ResourceType.SNAGGING_OVERVIEW,
      },
      /*
        Quotations lead, because that is where work now begins (BA v2,
        changes 1-3): a client is quoted, and the job is raised only once
        they approve.
      */
      {
        title: "Quotations",
        url: "/snagging/quotations",
        resource: ResourceType.SNAGGING_QUOTATIONS,
      },
      {
        title: "Jobs",
        url: "/snagging/jobs",
        // An inspection opens at /snagging/<id>, not under /snagging/jobs,
        // so Jobs claims those too and stays selected while a job is open.
        match: ["/snagging"],
        resource: ResourceType.SNAGGING_JOBS,
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
        resource: ResourceType.SNAGGING_CLIENTS,
      },
      {
        title: "Analytics",
        url: "/snagging/analytics",
        resource: ResourceType.SNAGGING_ANALYTICS,
      },
      {
        title: "Snag catalogue",
        url: "/snagging/catalogue",
        resource: ResourceType.SNAGGING_CATALOGUE,
      },
      {
        title: "Checklist library",
        url: "/snagging/checklist",
        resource: ResourceType.SNAGGING_CHECKLIST,
      },
    ],
  },
  {
    // Manpower Compliance (FRD FR-1 to FR-14): Emirates ID, passport and
    // training expiry tracking for YFI staff.
    title: "Compliance",
    url: "/compliance",
    icon: <BadgeCheck className="size-4 text-primary" />,
    resource: ResourceType.COMPLIANCE,
    items: [
      {
        title: "Overview",
        url: "/compliance",
        exact: true,
        resource: ResourceType.COMPLIANCE,
      },
      {
        title: "Expiry reminders",
        url: "/compliance/reminders",
        resource: ResourceType.COMPLIANCE,
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
        { title: "AMC configuration", url: "/settings/amc/configuration", canSee: canViewAmcConfig },
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
        /* Thresholds, recipients and penalties for invoicing and reports
           (BRD §6.6). */
        {
          title: "Reporting",
          url: "/settings/reporting",
          /* Shown even while the Reports module is switched off: it holds the Finance digest's recipients and time (3 Nov). */
          resource: ResourceType.REPORTING_SETTINGS,
        },
        /*
          Manpower Compliance: certificate types, designation and
          nationality lists, deactivation-request recipients. Configures
          the module rather than operates it, so it sits here too.
        */
        {
          title: "Compliance",
          url: "/settings/compliance",
          resource: ResourceType.COMPLIANCE_SETTINGS,
        },
        // The lists Scheduling and Compliance share (13-5).
        workforceSettingsItem,
      ],
    });
  } else if (canSeeWorkforceLists(user)) {
    /*
      Managers hold Workforce settings without being admins (13-5). The
      route guard follows this menu, so they get a Settings group with that
      one page in it and none of the admin configuration.
    */
    adminItems.unshift({
      title: "Settings",
      url: "/settings/workforce",
      icon: <Settings className="size-4 text-primary" />,
      isActive: false,
      canSee: () => true,
      items: [workforceSettingsItem],
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
