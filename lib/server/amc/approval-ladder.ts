import type { SupabaseClient } from "@supabase/supabase-js";

import {
  TRIGGER_LABELS,
  canDecideStep,
  evaluateTriggers,
  ladderLevels,
  priorApprovalCovers,
  type CrossedTrigger,
  type PriorApproval,
  type StepAction,
} from "@/lib/amc/approval-ladder";
import { approversForLevel, type AmcConfig } from "@/lib/amc/config";
import { PAYMENT_PLAN_LABELS, approvalLevelName, planFromLegacyTerms, type PaymentPlan } from "@/lib/amc/proposal-rules";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { notifyProposalEvent, notifyUsers } from "@/lib/server/amc/notifications";
import { recordStatusChange } from "@/lib/server/amc/status-history";
import { closeAmcTodos, openAmcTodo } from "@/lib/server/amc/todos";

/**
 * The approval ladder on the server (BRD 5.5, DEV-369; to-do #1 of 6.8).
 * Rules are in lib/amc/approval-ladder.ts. The proposal's status keeps the
 * values live `main` knows: awaiting_approval while a level is open,
 * approved when the last level approves (or no approval is needed),
 * sent_back when a level rejects or returns it (the step says which).
 *
 * Before 20261007150000 the steps table is missing and every function
 * here answers "not migrated", so the approval route keeps the single
 * approver flow it has always had.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string; label: string | null };

const TABLE = "amc_approval_steps";

export interface ApprovalStep {
  id: string;
  versionNo: number;
  round: number;
  level: number;
  levelName: string;
  approverIds: string[];
  approverNames: string[];
  triggers: CrossedTrigger[];
  status: "waiting" | "pending" | "approved" | "rejected" | "returned" | "cancelled";
  openedAt: string | null;
  escalateAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
}

/** The proposal fields the ladder reads. */
export interface LadderProposal {
  id: string;
  owner_id: string;
  status: string;
  proposal_number?: string | null;
  customer?: { customerName?: string; paymentTerms?: string } | null;
  discount_percent?: number | string | null;
  final_price?: number | string | null;
  payment_plan?: string | null;
  below_floor?: boolean | null;
  current_version?: number | null;
}

const LADDER_COLUMNS = "id, owner_id, status, proposal_number, customer, discount_percent, final_price, payment_plan, below_floor, current_version";

function mapStep(r: Row, names: Map<string, string>): ApprovalStep {
  const approverIds = ((r.approver_ids as string[] | null) ?? []).map(String);
  const by = r.decider as Row | null;
  return {
    id: String(r.id),
    versionNo: Number(r.version_no),
    round: Number(r.round),
    level: Number(r.level),
    levelName: String(r.level_name),
    approverIds,
    approverNames: approverIds.map((id) => names.get(id) ?? "User"),
    triggers: (Array.isArray(r.triggers) ? r.triggers : []) as CrossedTrigger[],
    status: r.status as ApprovalStep["status"],
    openedAt: (r.opened_at as string | null) ?? null,
    escalateAt: (r.escalate_at as string | null) ?? null,
    decidedBy: (by?.full_name as string | null) || (by?.email as string | null) || null,
    decidedAt: (r.decided_at as string | null) ?? null,
    comment: (r.comment as string | null) ?? null,
  };
}

const STEP_COLUMNS =
  "id, version_no, round, level, level_name, approver_ids, triggers, status, opened_at, escalate_at, decided_at, comment, decider:user_profile!amc_approval_steps_decided_by_fkey(full_name, email)";

async function nameMap(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = await admin.from("user_profile").select("id, full_name, email").in("id", unique);
  return new Map(((data ?? []) as Row[]).map((u) => [String(u.id), (u.full_name as string | null) || (u.email as string | null) || "User"]));
}

/** Every step of a proposal, oldest first; `migrated: false` before 20261007150000. */
export async function listApprovalSteps(admin: Admin, submissionId: string): Promise<{ steps: ApprovalStep[]; migrated: boolean }> {
  const { data, error } = await admin
    .from(TABLE)
    .select(STEP_COLUMNS)
    .eq("submission_id", submissionId)
    .order("version_no")
    .order("round")
    .order("level");
  if (error) {
    if (isMissingTable(error)) return { steps: [], migrated: false };
    throw new ContractError(error.message, 500);
  }
  const rows = (data ?? []) as unknown as Row[];
  const names = await nameMap(admin, rows.flatMap((r) => ((r.approver_ids as string[] | null) ?? []).map(String)));
  return { steps: rows.map((r) => mapStep(r, names)), migrated: true };
}

/** The open level, or null; `migrated: false` before 20261007150000. */
export async function pendingStep(admin: Admin, submissionId: string): Promise<{ step: ApprovalStep | null; migrated: boolean }> {
  const { data, error } = await admin.from(TABLE).select(STEP_COLUMNS).eq("submission_id", submissionId).eq("status", "pending").maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { step: null, migrated: false };
    throw new ContractError(error.message, 500);
  }
  if (!data) return { step: null, migrated: true };
  const row = data as unknown as Row;
  return { step: mapStep(row, await nameMap(admin, ((row.approver_ids as string[] | null) ?? []).map(String))), migrated: true };
}

/** Whether this person decides the open level; null when the proposal has no ladder step (decided the old way). */
export async function viewerDecidesStep(admin: Admin, proposal: { id: string; owner_id: string }, userId: string, isAmcApprover: boolean): Promise<boolean | null> {
  const { step } = await pendingStep(admin, proposal.id);
  if (!step) return null;
  return canDecideStep({ userId, ownerId: proposal.owner_id, approverIds: step.approverIds, isAmcApprover });
}

/* ------------------------------------------------------------------ */
/* Share                                                               */
/* ------------------------------------------------------------------ */

const planOf = (p: LadderProposal): PaymentPlan => (p.payment_plan as PaymentPlan | null) ?? planFromLegacyTerms(p.customer?.paymentTerms);

/** What the previous version was approved for (BRD 5.5: re-trigger only when more is asked). */
async function priorApproval(admin: Admin, submissionId: string, versionNo: number): Promise<PriorApproval | null> {
  if (versionNo <= 1) return null;
  const previous = versionNo - 1;
  const [{ data: steps }, { data: locked }] = await Promise.all([
    admin.from(TABLE).select("round, level, status").eq("submission_id", submissionId).eq("version_no", previous),
    admin.from("amc_submission_versions").select("discount_percent, payment_plan, snapshot").eq("submission_id", submissionId).eq("version_no", previous).maybeSingle<Row>(),
  ]);
  if (!locked) return null;
  const rows = (steps ?? []) as Row[];
  const lastRound = rows.reduce((max, r) => Math.max(max, Number(r.round)), 0);
  const round = rows.filter((r) => Number(r.round) === lastRound);
  /* Approved: every level of its last round approved. Shared without approval counts as level 0. */
  const level = round.length && round.every((r) => r.status === "approved") ? round.reduce((m, r) => Math.max(m, Number(r.level)), 0) : 0;
  const services = (((locked.snapshot ?? {}) as Row).services ?? []) as Array<{ included?: boolean; belowFloor?: boolean }>;
  return {
    level,
    discountPercent: Number(locked.discount_percent ?? 0),
    plan: (locked.payment_plan as string | null) ?? null,
    belowFloor: services.some((s) => s.included && s.belowFloor),
  };
}

export type ShareOutcome =
  | { migrated: false }
  | { migrated: true; outcome: "shared_directly" | "covered"; triggers: CrossedTrigger[]; requiredLevel: number }
  | { migrated: true; outcome: "pending"; triggers: CrossedTrigger[]; requiredLevel: number; levelName: string };

/**
 * The owner shares a draft (it was "submit for approval"): the triggers
 * decide whether it is approved at once or climbs the ladder.
 */
export async function shareProposal(admin: Admin, submissionId: string, actor: Actor, config: AmcConfig): Promise<ShareOutcome> {
  const probe = await admin.from(TABLE).select("id", { head: true, count: "exact" }).eq("submission_id", submissionId);
  if (probe.error && isMissingTable(probe.error)) return { migrated: false };

  const { data, error } = await admin.from("amc_submissions").select(LADDER_COLUMNS).eq("id", submissionId).maybeSingle();
  if (error) throw new ContractError(error.message, 500);
  if (!data) throw new ContractError("Not found", 404);
  const p = data as unknown as LadderProposal;
  const versionNo = Number(p.current_version ?? 1);
  const input = { discountPercent: Number(p.discount_percent ?? 0), finalPrice: Number(p.final_price ?? 0), plan: planOf(p), belowFloor: p.below_floor === true };
  const { triggers, requiredLevel } = evaluateTriggers(config, input);
  const now = new Date();
  const nowIso = now.toISOString();

  const covered = priorApprovalCovers(await priorApproval(admin, submissionId, versionNo), { ...input, requiredLevel });
  if (requiredLevel === 0 || covered) {
    const { data: moved, error: moveError } = await admin
      .from("amc_submissions")
      .update({ status: "approved", submitted_at: nowIso, submitted_by: actor.id, decided_at: nowIso, decided_by: null, sent_back_reason: null, updated_at: nowIso })
      .eq("id", submissionId)
      .eq("status", p.status)
      .select("id");
    if (moveError) throw new ContractError(moveError.message, 500);
    if (!moved?.length) throw new ContractError("Someone else updated this proposal a moment ago. Reload and try again.", 409);
    const outcome = covered ? "covered" : "shared_directly";
    await recordAmcAudit(admin, {
      entityType: "submission",
      entityId: submissionId,
      eventType: covered ? "approval_covered_by_previous_version" : "approval_not_required",
      actorId: actor.id,
      actorLabel: actor.label,
      payload: { from: p.status, to: "approved", version: versionNo, triggers },
    });
    await recordStatusChange(admin, {
      entityType: "submission",
      entityId: submissionId,
      from: p.status,
      to: "approved",
      reason: covered ? `V${versionNo} needs no more than V${versionNo - 1} was approved for` : "No approval trigger crossed",
      actor,
    });
    return { migrated: true, outcome, triggers, requiredLevel };
  }

  /* The ladder: a new round for this version, level 1 open, the rest waiting. */
  const { data: rounds } = await admin.from(TABLE).select("round").eq("submission_id", submissionId).eq("version_no", versionNo).order("round", { ascending: false }).limit(1);
  const round = Number(((rounds ?? []) as Row[])[0]?.round ?? 0) + 1;
  const escalateAt = new Date(now.getTime() + config.approvals.escalateAfterHours * 3_600_000).toISOString();
  const levels = ladderLevels(requiredLevel);
  const { data: inserted, error: insertError } = await admin
    .from(TABLE)
    .insert(
      levels.map((level) => ({
        submission_id: submissionId,
        version_no: versionNo,
        round,
        level,
        level_name: approvalLevelName(config.approvals, level),
        approver_ids: approversForLevel(config, level),
        triggers,
        status: level === 1 ? "pending" : "waiting",
        opened_at: level === 1 ? nowIso : null,
        escalate_at: level === 1 ? escalateAt : null,
      })),
    )
    .select("id, level");
  if (insertError) {
    if (insertError.code === "23505") throw new ContractError("This proposal is already waiting for approval.", 409);
    throw new ContractError(insertError.message, 500);
  }
  const { data: moved, error: moveError } = await admin
    .from("amc_submissions")
    .update({ status: "awaiting_approval", submitted_at: nowIso, submitted_by: actor.id, sent_back_reason: null, decided_at: null, decided_by: null, updated_at: nowIso })
    .eq("id", submissionId)
    .eq("status", p.status)
    .select("id");
  if (moveError || !moved?.length) {
    /* Someone moved it meanwhile: the round never opened. */
    await admin.from(TABLE).update({ status: "cancelled" }).in("id", ((inserted ?? []) as Row[]).map((r) => String(r.id)));
    if (moveError) throw new ContractError(moveError.message, 500);
    throw new ContractError("Someone else updated this proposal a moment ago. Reload and try again.", 409);
  }

  await recordAmcAudit(admin, {
    entityType: "submission",
    entityId: submissionId,
    eventType: "submitted_for_approval",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { from: p.status, to: "awaiting_approval", version: versionNo, round, requiredLevel, triggers },
  });
  await recordStatusChange(admin, {
    entityType: "submission",
    entityId: submissionId,
    from: p.status,
    to: "awaiting_approval",
    reason: triggers.map((t) => `${TRIGGER_LABELS[t.key]} (level ${t.level})`).join("; "),
    actor,
  });
  await openLevel(admin, p, versionNo, round, 1, escalateAt, triggers, config, actor);
  return { migrated: true, outcome: "pending", triggers, requiredLevel, levelName: approvalLevelName(config.approvals, 1) };
}

/** Opens a level's to-do and tells its approvers (or, when nobody is named, the AMC approvers). */
async function openLevel(
  admin: Admin,
  p: LadderProposal,
  versionNo: number,
  round: number,
  level: number,
  escalateAt: string,
  triggers: CrossedTrigger[],
  config: AmcConfig,
  actor: Actor,
) {
  const approvers = approversForLevel(config, level).filter((id) => id !== p.owner_id);
  const number = p.proposal_number ?? "";
  const name = p.customer?.customerName ?? "";
  const levelName = approvalLevelName(config.approvals, level);
  const detail = [
    `${name} · ${number} V${versionNo}`,
    `AED ${Number(p.final_price ?? 0).toLocaleString("en-AE", { maximumFractionDigits: 2 })} a year before VAT, ${Number(p.discount_percent ?? 0)}% discount, ${PAYMENT_PLAN_LABELS[planOf(p)]}`,
    `Needs approval for: ${triggers.map((t) => `${TRIGGER_LABELS[t.key]} (${t.detail})`).join("; ")}`,
  ].join("\n");
  if (approvers.length > 0) {
    try {
      await openAmcTodo(
        admin,
        {
          kind: "proposal_approval",
          entityType: "submission",
          entityId: p.id,
          dedupeKey: `proposal_approval:${p.id}:v${versionNo}:r${round}:l${level}`,
          title: `Approve AMC proposal ${number} V${versionNo} (${levelName})`,
          description: detail,
          ownerId: p.owner_id,
          assigneeIds: approvers,
          dueAt: escalateAt,
          escalateAt,
          createdBy: actor.id,
        },
        config,
      );
    } catch (e) {
      console.error("[amc:ladder] approval to-do not opened:", e instanceof Error ? e.message : e);
    }
    await notifyUsers(admin, {
      event: "proposal_pending_approval",
      userIds: approvers,
      title: `Proposal ${number} V${versionNo} needs your approval (${levelName})`,
      body: detail,
      link: `/extensions/amc/${p.id}`,
      entityType: "submission",
      entityId: p.id,
      submissionId: p.id,
      dedupeKey: `proposal_pending_approval:${p.id}:v${versionNo}:r${round}:l${level}`,
    });
  } else {
    /* Nobody named for this level: the AMC approvers, as before the ladder. */
    await notifyProposalEvent(admin, { event: "proposal_submitted", submissionId: p.id, actor, at: new Date().toISOString() });
  }
}

/* ------------------------------------------------------------------ */
/* Decide                                                              */
/* ------------------------------------------------------------------ */

export type DecideOutcome =
  | { handled: false }
  | { handled: true; status: "awaiting_approval" | "approved" | "sent_back"; nextLevelName: string | null };

/**
 * An approver decides the open level. Returns `handled: false` when the
 * proposal has no ladder step (not migrated, or submitted before the
 * ladder), so the route decides it the old single-approver way.
 */
export async function decideStep(
  admin: Admin,
  input: { submissionId: string; action: StepAction; comment?: string | null },
  actor: Actor,
  isAmcApprover: boolean,
  config: AmcConfig,
): Promise<DecideOutcome> {
  const { step, migrated } = await pendingStep(admin, input.submissionId);
  if (!migrated || !step) return { handled: false };

  const { data, error } = await admin.from("amc_submissions").select(LADDER_COLUMNS).eq("id", input.submissionId).maybeSingle();
  if (error) throw new ContractError(error.message, 500);
  if (!data) throw new ContractError("Not found", 404);
  const p = data as unknown as LadderProposal;
  if (p.status !== "awaiting_approval") throw new ContractError("This proposal is not waiting for approval.", 409);
  if (actor.id === p.owner_id) throw new ContractError("A proposal has to be approved by someone other than the person who wrote it.", 403);
  if (!canDecideStep({ userId: actor.id, ownerId: p.owner_id, approverIds: step.approverIds, isAmcApprover })) {
    throw new ContractError(
      step.approverIds.length ? `Level ${step.level} (${step.levelName}) is decided by ${step.approverNames.join(", ")}.` : "You do not have permission to approve AMC proposals.",
      403,
    );
  }
  const comment = input.comment?.trim() || null;
  if (input.action !== "approve" && !comment) throw new ContractError("Give a reason so the owner knows what to change.", 400);

  const nowIso = new Date().toISOString();
  const stepStatus = input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "returned";
  const { data: decided, error: decideError } = await admin
    .from(TABLE)
    .update({ status: stepStatus, decided_by: actor.id, decided_at: nowIso, comment })
    .eq("id", step.id)
    .eq("status", "pending")
    .select("id");
  if (decideError) throw new ContractError(decideError.message, 500);
  if (!decided?.length) throw new ContractError("Someone else decided this level a moment ago. Reload and try again.", 409);
  await closeAmcTodos(
    admin,
    { entityType: "submission", entityId: p.id, kind: "proposal_approval", dedupeKey: `proposal_approval:${p.id}:v${step.versionNo}:r${step.round}:l${step.level}` },
    { status: "done", reason: `Level ${step.level} ${stepStatus}` },
  );

  const versionNo = step.versionNo;
  let status: "awaiting_approval" | "approved" | "sent_back";
  let nextLevelName: string | null = null;

  if (input.action === "approve") {
    const { data: next } = await admin
      .from(TABLE)
      .select("id, level")
      .eq("submission_id", p.id)
      .eq("version_no", versionNo)
      .eq("round", step.round)
      .eq("status", "waiting")
      .order("level")
      .limit(1);
    const nextRow = ((next ?? []) as Row[])[0];
    if (nextRow) {
      const escalateAt = new Date(Date.now() + config.approvals.escalateAfterHours * 3_600_000).toISOString();
      await admin.from(TABLE).update({ status: "pending", opened_at: nowIso, escalate_at: escalateAt }).eq("id", String(nextRow.id)).eq("status", "waiting");
      status = "awaiting_approval";
      nextLevelName = approvalLevelName(config.approvals, Number(nextRow.level));
      await openLevel(admin, p, versionNo, step.round, Number(nextRow.level), escalateAt, step.triggers, config, actor);
    } else {
      const { data: moved } = await admin
        .from("amc_submissions")
        .update({ status: "approved", decided_at: nowIso, decided_by: actor.id, sent_back_reason: null, updated_at: nowIso })
        .eq("id", p.id)
        .eq("status", "awaiting_approval")
        .select("id");
      if (!moved?.length) throw new ContractError("Someone else updated this proposal a moment ago. Reload and try again.", 409);
      status = "approved";
    }
  } else {
    await admin.from(TABLE).update({ status: "cancelled" }).eq("submission_id", p.id).eq("version_no", versionNo).eq("round", step.round).eq("status", "waiting");
    const reason = input.action === "reject" ? `Rejected at ${step.levelName}: ${comment}` : comment!;
    const { data: moved } = await admin
      .from("amc_submissions")
      .update({ status: "sent_back", decided_at: nowIso, decided_by: actor.id, sent_back_reason: reason, updated_at: nowIso })
      .eq("id", p.id)
      .eq("status", "awaiting_approval")
      .select("id");
    if (!moved?.length) throw new ContractError("Someone else updated this proposal a moment ago. Reload and try again.", 409);
    status = "sent_back";
  }

  const event = input.action === "approve" ? (status === "approved" ? "approved" : `approved_level_${step.level}`) : input.action === "reject" ? "rejected_by_approver" : "sent_back";
  await recordAmcAudit(admin, {
    entityType: "submission",
    entityId: p.id,
    eventType: event,
    actorId: actor.id,
    actorLabel: actor.label,
    justification: comment,
    payload: { from: "awaiting_approval", to: status, level: step.level, levelName: step.levelName, version: versionNo, round: step.round },
  });
  if (status !== "awaiting_approval") {
    await recordStatusChange(admin, { entityType: "submission", entityId: p.id, from: "awaiting_approval", to: status, reason: comment, actor, details: { level: step.level } });
    await notifyProposalEvent(admin, {
      event: status === "approved" ? "proposal_approved" : "proposal_sent_back",
      submissionId: p.id,
      actor,
      at: nowIso,
      facts: status === "sent_back" ? { reason: input.action === "reject" ? `Rejected: ${comment}` : (comment ?? "") } : {},
    });
  } else {
    await notifyUsers(admin, {
      event: "proposal_level_approved",
      userIds: [p.owner_id],
      title: `Proposal ${p.proposal_number ?? ""} approved at ${step.levelName}`,
      body: `It now waits for ${nextLevelName}.`,
      link: `/extensions/amc/${p.id}`,
      entityType: "submission",
      entityId: p.id,
      submissionId: p.id,
      dedupeKey: `proposal_level_approved:${p.id}:v${versionNo}:r${step.round}:l${step.level}`,
    });
  }
  return { handled: true, status, nextLevelName };
}

/** Proposals waiting at a level this person decides (the approvals bell and queue). */
export async function pendingForApprover(
  admin: Admin,
  userId: string,
  isAmcApprover: boolean,
): Promise<{ submissionIds: string[]; allPending: string[]; migrated: boolean }> {
  const { data, error } = await admin.from(TABLE).select("submission_id, approver_ids").eq("status", "pending").limit(500);
  if (error) {
    if (isMissingTable(error)) return { submissionIds: [], allPending: [], migrated: false };
    throw new ContractError(error.message, 500);
  }
  const allPending = ((data ?? []) as Row[]).map((r) => String(r.submission_id));
  const ids = ((data ?? []) as Row[])
    .filter((r) => {
      const named = ((r.approver_ids as string[] | null) ?? []).map(String);
      return named.length ? named.includes(userId) : isAmcApprover;
    })
    .map((r) => String(r.submission_id));
  return { submissionIds: ids, allPending, migrated: true };
}
