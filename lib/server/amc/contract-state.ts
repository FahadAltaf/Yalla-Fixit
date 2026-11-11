import type { SupabaseClient } from "@supabase/supabase-js";

import type { ContractStatus } from "@/lib/amc/contract-lifecycle";
import { recordLifecycleChange } from "@/lib/server/amc/client-profile";
import { ContractError } from "@/lib/server/amc/contracts";
import { recordStatusChange } from "@/lib/server/amc/status-history";

/**
 * The two contract moves both the lifecycle (signing, activation) and the
 * payments (the initial payment gate) make, kept here so neither module
 * imports the other.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

/**
 * Moves a contract from one status to another, only if it is still in the
 * first: two people acting at once cannot both win. Recorded in the status
 * history with who and why.
 */
export async function setContractStatus(
  admin: Admin,
  contractId: string,
  from: string,
  to: ContractStatus,
  extra: Row,
  actor: Actor,
  reason: string | null,
) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("amc_contracts")
    .update({ status: to, status_changed_at: now, updated_at: now, ...extra })
    .eq("id", contractId)
    .eq("status", from)
    .select("id");
  if (error) throw new ContractError(error.message, error.code === "23514" ? 409 : 500);
  if (!data?.length) throw new ContractError("Someone else changed this contract a moment ago. Reload it.", 409);
  await recordStatusChange(admin, { entityType: "contract", entityId: contractId, from, to, reason, actor: { id: actor.id, label: actor.label } });
}

/**
 * The prospect becomes a client (BRD 5.9: "on signing and first payment"):
 * once the first instalment is received, or the gate is opened on agreed
 * credit terms. Lifecycle lives on the client's AMC profile
 * (20261007170000); a client with none reads as a client already.
 */
export async function prospectBecomesClient(admin: Admin, customerId: unknown, actor: Actor, reason: string) {
  if (typeof customerId !== "string" || !customerId) return;
  const { data } = await admin.from("amc_client_profiles").select("lifecycle").eq("client_id", customerId).maybeSingle<Row>();
  if (!data || data.lifecycle === "client") return;
  const { error } = await admin
    .from("amc_client_profiles")
    .update({ lifecycle: "client", updated_at: new Date().toISOString() })
    .eq("client_id", customerId);
  if (error) return;
  await recordLifecycleChange(admin, customerId, String(data.lifecycle ?? "prospect"), "client", { id: actor.id ?? "", label: actor.label }, reason);
}
