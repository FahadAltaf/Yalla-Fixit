import { ActionType, ResourceType } from "@/types/types";

/**
 * The AMC roles of BRD v0.3 (section 4, 6.7) as permission sets (DEV-418).
 *
 * Offered to an admin as a one-click setup on the AMC configuration screen,
 * never inserted automatically: the roles table is live and shared with
 * every module. Applying a template creates the role if it is missing and
 * adds any missing permission rows; it never removes a permission someone
 * granted by hand. Names start with "AMC" so they cannot collide with
 * existing roles. Afterwards every role stays editable in Roles / Permissions.
 *
 * DEV-418 (20 Nov 2026 review): each template grants the pages it needs as
 * well as the rights -- every AMC page asks for its OWN permission
 * (lib/server/amc/page-access.ts), so a role with only the module rights
 * was refused on Reports and the other pages. And technicians have a role:
 * they work in the YFI mobile app (BRD v0.4 3, 5.12), not the FSM app.
 *
 * Not here on purpose:
 *   * Administrator: the existing admin role, which inherits everything.
 * Approval levels are named people in AMC configuration (like Snagging's
 * named reviewer and approval manager), not a role.
 */

export interface AmcRoleTemplate {
  key: string;
  name: string;
  description: string;
  grants: Array<{ resource: ResourceType; actions: ActionType[] }>;
}

const { VIEW, CREATE, EDIT, EXPORT, APPROVE } = ActionType;
const R = ResourceType;

/* Opening a page (View on its own permission). */
const pages = (...resources: ResourceType[]) => resources.map((resource) => ({ resource, actions: [VIEW] }));

export const AMC_ROLE_TEMPLATES: AmcRoleTemplate[] = [
  {
    key: "management",
    name: "AMC Management",
    description: "Dashboard and reports, highest approval level, approval thresholds and payment value bands (BRD 4, 6.7).",
    grants: [
      { resource: R.AMC, actions: [VIEW, APPROVE] },
      { resource: R.AMC_OPERATIONS, actions: [VIEW, CREATE, EDIT, APPROVE] },
      { resource: R.AMC_ENQUIRIES, actions: [VIEW, EXPORT] },
      { resource: R.AMC_RATE_CARD, actions: [VIEW] },
      { resource: R.AMC_CONFIG, actions: [VIEW, EDIT, APPROVE] },
      { resource: R.AMC_PAYMENTS, actions: [VIEW, APPROVE] },
      { resource: R.AMC_VISITS, actions: [VIEW] },
      { resource: R.AMC_ALLOWANCES, actions: [VIEW, APPROVE] },
      { resource: R.AMC_PROPOSALS, actions: [VIEW, EDIT] },
      ...pages(R.AMC_CONTRACTS, R.AMC_CLIENTS, R.AMC_SITE_VISITS, R.AMC_CALL_OUTS, R.AMC_ADDITIONAL_WORKS, R.AMC_RENEWALS, R.AMC_REPORTS, R.AMC_TECHNICIANS, R.AMC_FSM_MAPPING, R.AMC_OPERATIONS_SETTINGS),
    ],
  },
  {
    key: "department_head",
    name: "AMC Department Head",
    description: "Rate card with Finance, approvals within authority, team reports; everything the coordinators do.",
    grants: [
      { resource: R.AMC, actions: [VIEW, APPROVE] },
      { resource: R.AMC_OPERATIONS, actions: [VIEW, CREATE, EDIT, APPROVE] },
      { resource: R.AMC_ENQUIRIES, actions: [VIEW, CREATE, EDIT, EXPORT] },
      { resource: R.AMC_RATE_CARD, actions: [VIEW, EDIT] },
      { resource: R.AMC_CONFIG, actions: [VIEW, EDIT] },
      { resource: R.AMC_PAYMENTS, actions: [VIEW] },
      { resource: R.AMC_VISITS, actions: [VIEW, CREATE, EDIT, APPROVE] },
      { resource: R.AMC_ALLOWANCES, actions: [VIEW, APPROVE] },
      { resource: R.AMC_PROPOSALS, actions: [VIEW, CREATE, EDIT] },
      { resource: R.AMC_CALL_OUTS, actions: [VIEW, CREATE, EDIT] },
      { resource: R.AMC_ADDITIONAL_WORKS, actions: [VIEW, CREATE, EDIT] },
      ...pages(R.AMC_CONTRACTS, R.AMC_CLIENTS, R.AMC_SITE_VISITS, R.AMC_RENEWALS, R.AMC_REPORTS, R.AMC_TECHNICIANS, R.AMC_FSM_MAPPING, R.AMC_OPERATIONS_SETTINGS),
    ],
  },
  {
    key: "finance",
    name: "AMC Finance",
    description: "Rate card with the department head, payment schedules, cheques, the initial-payment override, collections.",
    grants: [
      { resource: R.AMC, actions: [VIEW] },
      { resource: R.AMC_OPERATIONS, actions: [VIEW] },
      { resource: R.AMC_RATE_CARD, actions: [VIEW, EDIT] },
      { resource: R.AMC_CONFIG, actions: [VIEW] },
      { resource: R.AMC_PAYMENTS, actions: [VIEW, CREATE, EDIT, APPROVE] },
      ...pages(R.AMC_PROPOSALS, R.AMC_CONTRACTS, R.AMC_CLIENTS, R.AMC_ADDITIONAL_WORKS, R.AMC_RENEWALS, R.AMC_REPORTS, R.AMC_FSM_MAPPING),
    ],
  },
  {
    key: "sales",
    name: "AMC Sales",
    description: "Sales or pre-sales: enquiries, site visits and proposals, without approval rights.",
    grants: [
      { resource: R.AMC, actions: [VIEW] },
      { resource: R.AMC_ENQUIRIES, actions: [VIEW, CREATE, EDIT] },
      { resource: R.AMC_RATE_CARD, actions: [VIEW] },
      { resource: R.AMC_PROPOSALS, actions: [VIEW, CREATE, EDIT] },
      ...pages(R.AMC_SITE_VISITS, R.AMC_CLIENTS),
    ],
  },
  {
    key: "coordinator",
    name: "AMC Coordinator",
    description: "Account managers: all AMC prospects, clients and contracts; proposals, sharing, schedule, confirmations, access, assignment, call outs, renewals.",
    grants: [
      { resource: R.AMC, actions: [VIEW] },
      { resource: R.AMC_OPERATIONS, actions: [VIEW, CREATE, EDIT] },
      { resource: R.AMC_ENQUIRIES, actions: [VIEW, CREATE, EDIT, EXPORT] },
      { resource: R.AMC_RATE_CARD, actions: [VIEW] },
      { resource: R.AMC_PAYMENTS, actions: [VIEW, CREATE] },
      { resource: R.AMC_VISITS, actions: [VIEW, CREATE, EDIT] },
      { resource: R.AMC_ALLOWANCES, actions: [VIEW] },
      { resource: R.AMC_PROPOSALS, actions: [VIEW, CREATE, EDIT] },
      { resource: R.AMC_CALL_OUTS, actions: [VIEW, CREATE, EDIT] },
      { resource: R.AMC_ADDITIONAL_WORKS, actions: [VIEW, CREATE, EDIT] },
      ...pages(R.AMC_CONTRACTS, R.AMC_CLIENTS, R.AMC_SITE_VISITS, R.AMC_RENEWALS, R.AMC_REPORTS, R.AMC_TECHNICIANS),
    ],
  },
  {
    key: "supervisor",
    name: "AMC Supervisor",
    description: "Job sheet review and visit closure (the only role that closes a visit with pending works), allowance reversal.",
    grants: [
      { resource: R.AMC, actions: [VIEW] },
      { resource: R.AMC_OPERATIONS, actions: [VIEW] },
      { resource: R.AMC_VISITS, actions: [VIEW, EDIT, APPROVE] },
      { resource: R.AMC_ALLOWANCES, actions: [VIEW, APPROVE] },
      { resource: R.AMC_CALL_OUTS, actions: [VIEW, EDIT] },
      { resource: R.AMC_ADDITIONAL_WORKS, actions: [VIEW, EDIT] },
      ...pages(R.AMC_CONTRACTS, R.AMC_CLIENTS, R.AMC_SITE_VISITS, R.AMC_REPORTS, R.AMC_TECHNICIANS),
    ],
  },
  {
    key: "technician",
    name: "AMC Technician",
    description:
      "Technicians do AMC jobs in the YFI mobile app (BRD v0.4 3, 5.12): their own visits, call outs and additional work, the job sheet, photos and site visits. No portal pages.",
    grants: [{ resource: R.MOBILE_APP, actions: [VIEW] }],
  },
];

/** The (resource, action) rows a template grants. */
export function templateRows(template: AmcRoleTemplate): Array<{ resource: string; action: string }> {
  return template.grants.flatMap((g) => g.actions.map((action) => ({ resource: g.resource, action })));
}

/** Which of a template's rows a role does not have yet (enabled rows only count). */
export function missingTemplateRows(
  template: AmcRoleTemplate,
  existing: Array<{ resource: string; action: string; enabled?: boolean | null }>,
): Array<{ resource: string; action: string }> {
  const have = new Set(existing.filter((r) => r.enabled !== false).map((r) => `${r.resource}:${r.action}`));
  return templateRows(template).filter((r) => !have.has(`${r.resource}:${r.action}`));
}
