import { NextRequest, NextResponse } from "next/server";
import { canCorrectUsage, canOperateContract, canRecordUsage } from "@/lib/amc/access";

import {
  describeUsage,
  entitlementState,
  expiryLabel,
  isConsumable,
  remainingQuantity,
  summarizeContract,
  todayInDubai,
  usagePercent,
} from "@/lib/amc/contracts";
import { signedCommitments } from "@/lib/amc/commitments";
import { AMC_SLA_DEFAULTS } from "@/lib/amc/sla";
import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import { usageStats } from "@/lib/server/amc/contract-operations";
import { listSignatories } from "@/lib/server/amc/contract-lifecycle";
import { AWAITING_SIGNATURE, PRE_ACTIVATION, canSignInternally, type ContractStatus } from "@/lib/amc/contract-lifecycle";

/**
 * One AMC contract: summary, coverage, commercial values, account
 * managers, service levels, the source proposal and the audit trail. The
 * usage history, renewal and reminders load from their own endpoints.
 * Visible to the proposal's owner and to approvers, as the proposal is.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;

  try {
    const loaded = await requireManagedContract(gate, id, "read");
    if (!loaded.ok) return loaded.response;
    const { contract, entitlements } = loaded;
    const today = todayInDubai();

    const [stats, auditResult, sourceResult, renewalResult, snapshotResult, signing] = await Promise.all([
      usageStats(gate.admin, id),
      gate.admin
        .from("amc_audit_events")
        .select("id, event_type, actor_label, justification, payload, created_at")
        .eq("entity_type", "contract")
        .eq("entity_id", id)
        .order("created_at", { ascending: false })
        .limit(200),
      gate.admin
        .from("amc_submissions")
        .select("id, proposal_number, status, signed_at, signed_by_name, proposal_sent_at, contract_sent_at")
        .eq("id", contract.submissionId)
        .maybeSingle(),
      gate.admin
        .from("amc_submissions")
        .select("id")
        .eq("renewal_of_contract_id", id)
        .limit(1)
        .maybeSingle<{ id: string }>(),
      gate.admin.from("amc_contracts").select("contract_settings_snapshot").eq("id", id).maybeSingle(),
      /* Phase 6: the signatories, in order. */
      listSignatories(gate.admin, id).catch(() => ({ signatories: [], migrated: false })),
    ]);

    const summary = { ...summarizeContract(entitlements), ...stats };
    /* What the signed wording promises (support line, response times), from
       the contract's own frozen settings, never from today's AMC Settings. */
    const commitments = signedCommitments(
      (snapshotResult.data as { contract_settings_snapshot?: Parameters<typeof signedCommitments>[0] } | null)
        ?.contract_settings_snapshot,
      entitlements.map((e) => e.serviceId),
    );
    /* Service levels for the call-out services on this contract: the target
       only. Whether a call-out met it is unknown until FSM sends request
       and arrival times. */
    const sla = [...new Set(entitlements.map((e) => e.callOutClass).filter((c) => c !== null))].map((c) => ({
      ...AMC_SLA_DEFAULTS[c],
      state: "unknown" as const,
    }));
    const inForce = contract.displayStatus === "active" || contract.displayStatus === "expiring";

    return NextResponse.json({
      contract,
      expiryLabel: expiryLabel(contract, today),
      summary,
      entitlements: entitlements.map((e) => ({
        ...e,
        remainingQuantity: remainingQuantity(e),
        usagePercent: usagePercent(e),
        usageLabel: describeUsage(e),
        consumable: isConsumable(e),
        state: entitlementState(e, contract.displayStatus),
      })),
      sla,
      commitments,
      audit: (auditResult.data ?? []).map((row) => ({
        id: String(row.id),
        type: String(row.event_type),
        actor: (row.actor_label as string | null) ?? null,
        note: (row.justification as string | null) ?? null,
        payload: (row.payload as Record<string, unknown> | null) ?? null,
        at: String(row.created_at),
      })),
      source: sourceResult.data ?? null,
      signatories: signing.signatories,
      permissions: {
        /* Phase 6 lifecycle (lib/amc/contract-lifecycle.ts). */
        canSign:
          AWAITING_SIGNATURE.includes(contract.status as ContractStatus) &&
          !!canSignInternally(
            signing.signatories.map((s) => ({ id: s.id, party: s.party, sign_order: s.signOrder, status: s.status, user_id: s.userId })),
            gate.userId,
          ),
        canRecordScan: AWAITING_SIGNATURE.includes(contract.status as ContractStatus) && canOperateContract(gate.actor, loaded.ownerId),
        canActivate: (contract.status === "signed" || contract.status === "pending_initial_payment") && canOperateContract(gate.actor, loaded.ownerId),
        canEditTerms: PRE_ACTIVATION.includes(contract.status as ContractStatus) && canOperateContract(gate.actor, loaded.ownerId),
        canHold: (contract.status === "active" || contract.status === "on_hold") && canOperateContract(gate.actor, loaded.ownerId),
        canTerminate: gate.canApprove && (contract.status === "active" || contract.status === "on_hold"),
        canCallOff: gate.canApprove && PRE_ACTIVATION.includes(contract.status as ContractStatus),
        /* Usage can be recorded only while the contract is in force; the
           server also checks the usage date against the period. */
        canRecordUsage: contract.status === "active" && inForce && canRecordUsage(gate.actor, loaded.ownerId),
        /* Correcting the record is allowed whatever the state, to whoever may correct. */
        canCorrect: canCorrectUsage(gate.actor, loaded.ownerId),
        canCancel: gate.canApprove && contract.status === "active",
        canRenew: canOperateContract(gate.actor, loaded.ownerId) && contract.status !== "cancelled" && !contract.renewedByContractId && !renewalResult.data,
      },
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the contract");
  }
}
