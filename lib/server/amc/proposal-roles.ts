import { hasResourceAction } from "@/lib/role-permissions";
import type { ProposalViewerRoles } from "@/lib/amc/proposal-team";
import { ActionType, ResourceType } from "@/types/types";

/** The viewer's role permissions that decide what they may do with the team's proposals (DEV-368). */
export function proposalViewerRoles(accessUser: Parameters<typeof hasResourceAction>[0], canApprove: boolean): ProposalViewerRoles {
  return {
    canApprove,
    operationsView: hasResourceAction(accessUser, ResourceType.AMC_OPERATIONS, ActionType.VIEW),
    operationsEdit: hasResourceAction(accessUser, ResourceType.AMC_OPERATIONS, ActionType.EDIT),
    proposalsView: hasResourceAction(accessUser, ResourceType.AMC_PROPOSALS, ActionType.VIEW),
    proposalsEdit: hasResourceAction(accessUser, ResourceType.AMC_PROPOSALS, ActionType.EDIT),
  };
}
