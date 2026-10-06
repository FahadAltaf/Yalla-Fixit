/**
 * Who may do what with AMC contracts, customers and assessments, as pure
 * rules (no imports): the API applies them, the tests pin them.
 *
 * Actors (docs/amc-security-model.md):
 *   approver   AMC Settings approver list, or the AMC Approve permission
 *              (admins inherit it)
 *   owner      the user who owns the source proposal
 *   operations the AMC Operations permission (View / Create / Edit / Approve)
 *   member     any other AMC user (AMC View)
 *
 * The operations permission only ever ADDS rights; the owner/approver rules
 * that existed before (6 Oct 2026) are unchanged. BUSINESS DECISION
 * REQUIRED: whether corrections become approver-only (AMC_CORRECTIONS_APPROVER_ONLY).
 */

export interface AmcActor {
  userId: string;
  canApprove: boolean;
  ops: { view: boolean; create: boolean; edit: boolean; approve: boolean };
}

/** Off: the proposal owner may correct usage on their own contract, as today. */
export const AMC_CORRECTIONS_APPROVER_ONLY = false;

const isOwner = (a: AmcActor, ownerId: string | null | undefined) => !!ownerId && ownerId === a.userId;

/** Lists, reports and dashboards show every contract, not only the caller's own. */
export function seesAllContracts(a: AmcActor): boolean {
  return a.canApprove || a.ops.view || a.ops.edit;
}

/** Open one contract (read). */
export function canReadContract(a: AmcActor, ownerId: string | null | undefined): boolean {
  return seesAllContracts(a) || isOwner(a, ownerId);
}

/** Change a contract's operational records: usage, FSM links, renewal, reminders, quotes. */
export function canOperateContract(a: AmcActor, ownerId: string | null | undefined): boolean {
  return a.canApprove || isOwner(a, ownerId) || a.ops.edit;
}

/** Turn a signed proposal into a contract. */
export function canActivateContract(a: AmcActor, ownerId: string | null | undefined): boolean {
  return a.canApprove || isOwner(a, ownerId) || a.ops.create;
}

/** Record consumption against an allowance. */
export function canRecordUsage(a: AmcActor, ownerId: string | null | undefined): boolean {
  return canOperateContract(a, ownerId);
}

/** Reverse a usage entry (a correction): a different privilege from recording. */
export function canCorrectUsage(
  a: AmcActor,
  ownerId: string | null | undefined,
  approverOnly: boolean = AMC_CORRECTIONS_APPROVER_ONLY,
): boolean {
  if (a.canApprove || a.ops.approve) return true;
  return !approverOnly && isOwner(a, ownerId);
}

/** Cancel a contract: approvers only (unchanged). */
export function canCancelContract(a: AmcActor): boolean {
  return a.canApprove;
}

/** Change a shared customer or property record (never delete). */
export function canEditCustomer(a: AmcActor, createdBy: string | null | undefined): boolean {
  return a.canApprove || a.ops.edit || (!!createdBy && createdBy === a.userId);
}

/** Read an assessment, or see it in the list. */
export function canReadAssessment(a: AmcActor, createdBy: string | null | undefined): boolean {
  return seesAllContracts(a) || (!!createdBy && createdBy === a.userId);
}

/**
 * Look up a Zoho FSM work order by number. Approvers and operations staff
 * may look up any number (to map services and link work); anyone else only
 * from a contract they may operate, so the portal is not a general FSM
 * search for every AMC user.
 */
export function canLookUpFsmWorkOrder(a: AmcActor, contractOwnerId?: string | null, inContract = false): boolean {
  if (a.canApprove || a.ops.edit) return true;
  return inContract && isOwner(a, contractOwnerId);
}
