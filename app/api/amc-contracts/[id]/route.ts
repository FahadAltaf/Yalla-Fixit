import { NextRequest, NextResponse } from "next/server";

import { describeUsage, isConsumable, remainingQuantity, usagePercent } from "@/lib/amc/contracts";
import { canManage, requireContractAccess } from "@/lib/server/amc/contract-access";
import { ContractError, loadContract, loadUsage } from "@/lib/server/amc/contracts";

/**
 * One AMC contract: overview, coverage and usage, commercial values, the
 * source proposal and the audit trail. Visible to the proposal's owner and
 * to approvers, as the proposal itself is.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Contract not found." }, { status: 404 });
  }

  try {
    const { contract, entitlements, ownerId } = await loadContract(gate.admin, id);
    if (!canManage(gate, ownerId)) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 });
    }

    const [usage, auditResult, sourceResult] = await Promise.all([
      loadUsage(gate.admin, id),
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
    ]);

    return NextResponse.json({
      contract,
      entitlements: entitlements.map((e) => ({
        ...e,
        remainingQuantity: remainingQuantity(e),
        usagePercent: usagePercent(e),
        usageLabel: describeUsage(e),
        consumable: isConsumable(e),
      })),
      usage,
      audit: (auditResult.data ?? []).map((row) => ({
        id: String(row.id),
        type: String(row.event_type),
        actor: (row.actor_label as string | null) ?? null,
        note: (row.justification as string | null) ?? null,
        payload: (row.payload as Record<string, unknown> | null) ?? null,
        at: String(row.created_at),
      })),
      source: sourceResult.data ?? null,
      permissions: {
        canRecordUsage: contract.status === "active",
        canCancel: gate.canApprove && contract.status === "active",
        canRenew: contract.status !== "cancelled" && !contract.renewedByContractId,
      },
    });
  } catch (error) {
    if (error instanceof ContractError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("AMC contract load failed:", error);
    return NextResponse.json({ error: "Could not load the contract" }, { status: 500 });
  }
}
