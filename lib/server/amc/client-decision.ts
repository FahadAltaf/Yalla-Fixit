import type { SupabaseClient } from "@supabase/supabase-js";

import { CLIENT_ANSWER_LABELS, type ClientAnswer } from "@/lib/amc/approval-ladder";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError } from "@/lib/server/amc/contracts";
import { notifyProposalEvent } from "@/lib/server/amc/notifications";
import { recordStatusChange } from "@/lib/server/amc/status-history";
import { readAmcConfig } from "@/lib/server/amc/config";
import { createContractFromApproval } from "@/lib/server/amc/contract-lifecycle";

/**
 * The client's answer given outside the link (BRD 5.6, DEV-371): the
 * coordinator records it with the evidence in the document store (the
 * email, the WhatsApp message, the signed page). The proposal moves as if
 * the client had answered on the link, which then stops working; an
 * approved proposal is locked.
 */

type Admin = SupabaseClient;
type Actor = { id: string; label: string | null };

export async function recordClientDecision(
  admin: Admin,
  input: { id: string; answer: ClientAnswer; clientName: string; note?: string | null; evidenceDocumentId: string },
  actor: Actor,
): Promise<{ status: string }> {
  const { data: doc } = await admin
    .from("amc_documents")
    .select("id, level, entity_id")
    .eq("id", input.evidenceDocumentId)
    .maybeSingle<{ id: string; level: string; entity_id: string }>();
  if (!doc || doc.level !== "proposal" || doc.entity_id !== input.id) {
    throw new ContractError("Attach the evidence to this proposal first (Documents on the proposal page).", 400);
  }

  const now = new Date().toISOString();
  const approved = input.answer === "approved";
  const note = input.note?.trim() || null;
  const status = approved ? "proposal_approved" : "proposal_rejected";
  const { data, error } = await admin
    .from("amc_submissions")
    .update({
      status,
      client_decision: approved ? "approved" : "rejected",
      client_decided_at: now,
      client_decided_by_name: input.clientName.trim(),
      client_rejected_reason: approved ? null : input.answer === "revision_requested" ? `Revision requested: ${note}` : note,
      client_answer: input.answer,
      client_answer_source: "coordinator",
      client_answer_recorded_by: actor.id,
      client_answer_evidence_id: doc.id,
      updated_at: now,
    })
    .eq("id", input.id)
    /* Only while it waits for the client: an answer already given on the link wins. */
    .eq("status", "proposal_sent")
    .select("id");
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") {
      throw new ContractError("Recording the client's answer needs the AMC database update 20261007150000.", 503);
    }
    throw new ContractError(error.message, 500);
  }
  if (!data?.length) throw new ContractError("This proposal is no longer waiting for the client's answer. Reload it.", 409);

  await recordAmcAudit(admin, {
    entityType: "submission",
    entityId: input.id,
    eventType: "client_decision_recorded",
    actorId: actor.id,
    actorLabel: actor.label,
    justification: note,
    payload: { from: "proposal_sent", to: status, answer: input.answer, clientName: input.clientName.trim(), evidenceDocumentId: doc.id },
  });
  await recordStatusChange(admin, {
    entityType: "submission",
    entityId: input.id,
    from: "proposal_sent",
    to: status,
    reason: `${CLIENT_ANSWER_LABELS[input.answer]} by ${input.clientName.trim()} (recorded by ${actor.label ?? "the coordinator"})${note ? `: ${note}` : ""}`,
    actor,
  });
  await notifyProposalEvent(admin, {
    event: approved ? "client_approved" : "client_rejected",
    submissionId: input.id,
    actor,
    at: now,
    facts: { signedByName: input.clientName.trim(), reason: approved ? null : note },
  });
  /* Phase 6: the contract record from the client's approval. */
  if (approved) await createContractFromApproval(admin, input.id, actor, await readAmcConfig(admin));
  return { status };
}
