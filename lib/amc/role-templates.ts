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
 * Not here on purpose:
 *   * Technician: technicians work in the Zoho FSM app and see their own
 *     jobs there (BRD 6.7); they need no AMC portal access.
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
    ],
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
