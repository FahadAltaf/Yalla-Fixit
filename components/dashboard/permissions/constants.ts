import { ActionType, MenuItem, ResourceType } from "@/types/types";
import { baseAdminItems, baseSectionsItems } from "@/components/dashboard-layout/menu-items";
import { REPORTS_ENABLED } from "@/lib/reports/enabled";

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
  The inspector app. View signs in and reads the jobs; Edit sends back
  what was captured -- the same two the app's endpoints ask for.

  Which jobs an inspector sees, and which they may write to, is still
  decided by who is named on the job, not here.

  It has no menu entry, so it is named here or it would never reach the
  Permissions screen at all.
*/
RESOURCE_ACTIONS[ResourceType.MOBILE_APP] = [ActionType.VIEW, ActionType.EDIT];

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
// Manpower Compliance (FRD FR-9): full CRUD plus Export. Delete means
// archive; nothing is hard-deleted. Seeing a full Emirates ID or passport
// number is not an action here at all -- it is a per-user allowlist.
RESOURCE_ACTIONS[ResourceType.COMPLIANCE] = [
  ...CRUD_MODULE_ACTIONS,
  ActionType.EXPORT,
];
// Compliance settings are master data: certificate types and lists are
// retired, never deleted, so no Delete.
RESOURCE_ACTIONS[ResourceType.COMPLIANCE_SETTINGS] = [
  ActionType.VIEW,
  ActionType.CREATE,
  ActionType.EDIT,
];
// Full Emirates ID and passport numbers (D2). View only, no menu entry, not
// inherited by admins (lib/role-permissions.ts). Grant it to the managers'
// role only.
RESOURCE_ACTIONS[ResourceType.COMPLIANCE_IDENTITY] = [ActionType.VIEW];
// Workforce settings (31 Oct 2026): the shared lists. Delete removes a role,
// service type, tag or leave type; designations and nationalities are only
// ever retired.
RESOURCE_ACTIONS[ResourceType.WORKFORCE_SETTINGS] = CRUD_MODULE_ACTIONS;

/*
  Finance and Reports (BRD §6.7, DEV-462). Their pages arrive phase by
  phase, so they are listed here rather than read from the menu: a role
  can be prepared before the page it opens exists.

  Turning a module on in the Permissions screen grants every action
  listed, so the named-person acts (record invoice, verify exclusion,
  waive, decide dispute) need unticking for roles that should not hold
  them. Admins do not get those four by default (lib/role-permissions.ts).

  Ready to invoice has two views (3 Nov): the Finance view is the queue
  key, the Operations view the not-invoiceable key (lib/server/finance/
  route-helpers.ts says what each action opens). The queue's Export was
  never read by any page or route, and nobody held it, so it is not offered.
*/
const REPORT_ACTIONS = [ActionType.VIEW, ActionType.EXPORT];
RESOURCE_ACTIONS[ResourceType.FINANCE] = [ActionType.VIEW];
RESOURCE_ACTIONS[ResourceType.FINANCE_QUEUE] = [
  ActionType.VIEW,
  ActionType.EDIT,
  ActionType.APPROVE,
];
RESOURCE_ACTIONS[ResourceType.FINANCE_EXCLUSIONS] = [ActionType.CREATE, ActionType.APPROVE];
RESOURCE_ACTIONS[ResourceType.FINANCE_QUERIES] = [ActionType.VIEW];
RESOURCE_ACTIONS[ResourceType.FINANCE_METRICS] = [ActionType.VIEW];
RESOURCE_ACTIONS[ResourceType.REPORTS] = [ActionType.VIEW];
RESOURCE_ACTIONS[ResourceType.REPORTS_QUOTATIONS] = REPORT_ACTIONS;
RESOURCE_ACTIONS[ResourceType.REPORTS_UTILIZATION] = REPORT_ACTIONS;
RESOURCE_ACTIONS[ResourceType.REPORTS_CAPACITY] = REPORT_ACTIONS;
RESOURCE_ACTIONS[ResourceType.REPORTS_ATTENDANCE] = REPORT_ACTIONS;
RESOURCE_ACTIONS[ResourceType.REPORTS_REVENUE] = REPORT_ACTIONS;
RESOURCE_ACTIONS[ResourceType.REPORTS_EXCEPTIONS] = REPORT_ACTIONS;
RESOURCE_ACTIONS[ResourceType.REPORTS_COMPLIANCE] = [
  ActionType.VIEW,
  ActionType.EDIT,
  ActionType.APPROVE,
  ActionType.EXPORT,
];
RESOURCE_ACTIONS[ResourceType.COMPLIANCE_SELF] = [ActionType.VIEW];
RESOURCE_ACTIONS[ResourceType.REPORTING_SETTINGS] = [ActionType.VIEW, ActionType.EDIT];

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
  /* The module itself: View opens AMC; Approve makes an approver of proposals. Its pages sit under it. */
  [ResourceType.AMC]: "AMC (module; Approve = proposal approver)",
  [ResourceType.AMC_OPERATIONS]: "AMC Operations",
  [ResourceType.AMC_ENQUIRIES]: "AMC Enquiries",
  [ResourceType.AMC_RATE_CARD]: "AMC Rate Card",
  [ResourceType.AMC_CONFIG]: "AMC Configuration (Approve = thresholds and bands)",
  [ResourceType.AMC_PAYMENTS]: "AMC Payments (Approve = payment gate override)",
  [ResourceType.AMC_VISITS]: "AMC Visits (Approve = supervisor closure)",
  [ResourceType.AMC_ALLOWANCES]: "AMC Allowances (Approve = override and reversal)",
  [ResourceType.SNAGGING]: "Snagging (whole module)",
  [ResourceType.EXTENSIONS]: "Extensions (whole module)",
  [ResourceType.MOBILE_APP]: "Mobile application",
  [ResourceType.FINANCE]: "Finance (whole module)",
  [ResourceType.FINANCE_QUEUE]: "Ready to invoice: Finance view",
  [ResourceType.FINANCE_EXCLUSIONS]: "Ready to invoice: Operations view",
  [ResourceType.REPORTS]: "Reports (whole module)",
  [ResourceType.REPORTS_QUOTATIONS]: "Quotation summary",
  [ResourceType.REPORTS_UTILIZATION]: "Utilization",
  [ResourceType.REPORTS_CAPACITY]: "Capacity",
  [ResourceType.REPORTS_ATTENDANCE]: "Attendance",
  [ResourceType.REPORTS_REVENUE]: "Revenue",
  [ResourceType.REPORTS_EXCEPTIONS]: "Exception reports",
  [ResourceType.REPORTS_COMPLIANCE]: "Check-in compliance (Edit = waive, Approve = decide disputes and finalise the month)",
  [ResourceType.COMPLIANCE_SELF]: "My compliance (technicians)",
  [ResourceType.REPORTING_SETTINGS]: "Reporting settings",
};

/*
  Names that must win over the menu title. The Compliance module and its
  settings page are both titled "Compliance" in the sidebar (the settings
  entry sits under a group already called Settings), which on this screen
  produced a parent row and a child row with the same name, and View on
  the child looked like View on the module.
*/
const OVERRIDE_RESOURCE_NAMES: Partial<Record<ResourceType, string>> = {
  [ResourceType.COMPLIANCE]: "Compliance (employees, reminders, overview)",
  [ResourceType.COMPLIANCE_SETTINGS]: "Compliance settings (lists, recipients)",
  [ResourceType.COMPLIANCE_IDENTITY]: "Compliance identity numbers (full Emirates ID and passport)",
  [ResourceType.WORKFORCE_SETTINGS]: "Workforce settings (roles, service types, tags, leave types, designations, nationalities)",
  /*
    The queue key also opens Invoicing metrics, whose menu entry gave this
    row its name; the row is the Finance side of Ready to invoice (3 Nov).
  */
  [ResourceType.FINANCE_QUEUE]: "Ready to invoice: Finance view",
  [ResourceType.FINANCE_EXCLUSIONS]: "Ready to invoice: Operations view",
};

/*
  Rows for pages nobody can open yet (3 Nov): while the Reports module is
  switched off (lib/reports/enabled.ts) its pages are hidden, all but
  Reporting settings, which the Finance digest uses. Grants already held
  stay as they are. Revenue has its page since 4 Nov (DEV-454).
*/
const REPORT_PAGE_RESOURCES = [
  ResourceType.REPORTS,
  ResourceType.REPORTS_QUOTATIONS,
  ResourceType.REPORTS_UTILIZATION,
  ResourceType.REPORTS_CAPACITY,
  ResourceType.REPORTS_ATTENDANCE,
  ResourceType.REPORTS_REVENUE,
  ResourceType.REPORTS_EXCEPTIONS,
  ResourceType.REPORTS_COMPLIANCE,
  ResourceType.COMPLIANCE_SELF,
];
export const HIDDEN_RESOURCES: ResourceType[] = REPORTS_ENABLED ? [] : REPORT_PAGE_RESOURCES;

export const getResourceDisplayName = (resource: ResourceType): string => {
  return (
    OVERRIDE_RESOURCE_NAMES[resource] ||
    resourceDisplayNameMap[resource] ||
    EXTRA_RESOURCE_NAMES[resource] ||
    resource
  );
};

/*
  What an action does on the rows where View, Edit and the rest say too
  little (3 Nov): the two Ready-to-invoice views.
*/
const RESOURCE_ACTION_NAMES: Partial<Record<ResourceType, Partial<Record<ActionType, string>>>> = {
  [ResourceType.FINANCE_QUEUE]: {
    [ActionType.VIEW]: "View (queue, metrics)",
    [ActionType.EDIT]: "Edit (queries, holds)",
    [ActionType.APPROVE]: "Approve (record invoices)",
  },
  [ResourceType.FINANCE_EXCLUSIONS]: {
    [ActionType.CREATE]: "Create (progress, ready, queries)",
    [ActionType.APPROVE]: "Approve (verify older items)",
  },
};

// Helper to get display name for action
export const getActionDisplayName = (action: ActionType, resource?: ResourceType): string => {
  const own = resource ? RESOURCE_ACTION_NAMES[resource]?.[action] : undefined;
  if (own) return own;
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
  /* AMC: its pages, and the rights that decide what can be done on them. */
  [ResourceType.AMC_ENQUIRIES]: ResourceType.AMC,
  [ResourceType.AMC_PROPOSALS]: ResourceType.AMC,
  [ResourceType.AMC_CONTRACTS]: ResourceType.AMC,
  [ResourceType.AMC_PAYMENTS]: ResourceType.AMC,
  [ResourceType.AMC_CLIENTS]: ResourceType.AMC,
  [ResourceType.AMC_SITE_VISITS]: ResourceType.AMC,
  [ResourceType.AMC_VISITS]: ResourceType.AMC,
  [ResourceType.AMC_TECHNICIANS]: ResourceType.AMC,
  [ResourceType.AMC_CALL_OUTS]: ResourceType.AMC,
  [ResourceType.AMC_ADDITIONAL_WORKS]: ResourceType.AMC,
  [ResourceType.AMC_RENEWALS]: ResourceType.AMC,
  [ResourceType.AMC_REPORTS]: ResourceType.AMC,
  [ResourceType.AMC_RATE_CARD]: ResourceType.AMC,
  [ResourceType.AMC_FSM_MAPPING]: ResourceType.AMC,
  [ResourceType.AMC_OPERATIONS_SETTINGS]: ResourceType.AMC,
  [ResourceType.AMC_CONFIG]: ResourceType.AMC,
  [ResourceType.AMC_OPERATIONS]: ResourceType.AMC,
  [ResourceType.AMC_ALLOWANCES]: ResourceType.AMC,
  [ResourceType.FINANCE_QUEUE]: ResourceType.FINANCE,
  [ResourceType.FINANCE_EXCLUSIONS]: ResourceType.FINANCE,
  [ResourceType.FINANCE_QUERIES]: ResourceType.FINANCE,
  [ResourceType.FINANCE_METRICS]: ResourceType.FINANCE,
  [ResourceType.REPORTS_QUOTATIONS]: ResourceType.REPORTS,
  [ResourceType.REPORTS_UTILIZATION]: ResourceType.REPORTS,
  [ResourceType.REPORTS_CAPACITY]: ResourceType.REPORTS,
  [ResourceType.REPORTS_ATTENDANCE]: ResourceType.REPORTS,
  [ResourceType.REPORTS_REVENUE]: ResourceType.REPORTS,
  [ResourceType.REPORTS_EXCEPTIONS]: ResourceType.REPORTS,
  [ResourceType.REPORTS_COMPLIANCE]: ResourceType.REPORTS,
  [ResourceType.COMPLIANCE_SELF]: ResourceType.REPORTS,
  /* On its own row while the Reports module is switched off, as in the menu (Settings → Reporting). */
  ...(REPORTS_ENABLED ? { [ResourceType.REPORTING_SETTINGS]: ResourceType.REPORTS } : {}),
  /*
    COMPLIANCE_SETTINGS is deliberately NOT a child of COMPLIANCE. A module
    row with children renders no switch and no actions here (its pages
    decide), and the compliance pages all share the COMPLIANCE key, so
    nesting the settings under it left the module itself ungrantable.
  */
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
