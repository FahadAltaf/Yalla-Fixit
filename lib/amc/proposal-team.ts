/**
 * Proposals are visible to the team by role (BRD v0.4 5.4; DEV-368, 20 Nov
 * 2026 review): not only to the person who wrote them.
 *
 *   see   the proposal, drafts included: its owner, or anyone with AMC
 *         Proposals (View or Edit), AMC Operations (View or Edit), or the
 *         AMC approver right.
 *   act   edit, submit, send, revise, record the client's answer, take it
 *         over or give it to someone else: its owner, or anyone with AMC
 *         Proposals (Edit), AMC Operations (Edit) or the approver right.
 *
 * Approving stays apart: whoever wrote a proposal does not approve it.
 */

export interface ProposalViewerRoles {
  /** The AMC approver right (role permission, or named in AMC Settings). */
  canApprove: boolean;
  operationsView: boolean;
  operationsEdit: boolean;
  proposalsView: boolean;
  proposalsEdit: boolean;
}

/** Sees the team's proposals, drafts included. */
export const proposalTeamSees = (r: ProposalViewerRoles): boolean => r.canApprove || r.operationsView || r.operationsEdit || r.proposalsView || r.proposalsEdit;

/** Works on the team's proposals as their owner would. */
export const proposalTeamActs = (r: ProposalViewerRoles): boolean => r.canApprove || r.operationsEdit || r.proposalsEdit;

export function proposalRights(r: ProposalViewerRoles, isOwner: boolean): { see: boolean; act: boolean } {
  return { see: isOwner || proposalTeamSees(r), act: isOwner || proposalTeamActs(r) };
}
