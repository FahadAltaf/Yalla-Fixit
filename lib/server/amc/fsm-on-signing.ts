import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAmcAudit } from "@/lib/server/amc/audit";
import { loadContract } from "@/lib/server/amc/contracts";
import { notifyUsers } from "@/lib/server/amc/notifications";
import { ensurePropertyInFsm, fsmClientWritesReady, fsmErrorMessage, putClientInFsm } from "@/lib/server/snagging/fsm-clients";
import { getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { getContact } from "@/lib/server/zoho/fsm-contacts";

/**
 * DEV-504 (26 Nov 2026): the client becomes an FSM customer when the
 * contract is signed, not when the enquiry is saved (BRD v0.4 section 3: "a
 * prospect becomes an FSM customer on signing"). Before signing nothing
 * needs FSM: site visits run in the YFI app and sit on the Scheduling board
 * as portal entries (DEV-489).
 *
 * On the last signature (link, portal or signed scan):
 *   1. the client is put into Zoho FSM: linked by email when FSM has them,
 *      otherwise created (FSM needs an email; the Maher ID is optional);
 *   2. the contract's property is added to them as an FSM address;
 *   3. the contract records its FSM customer (the contact and its Customer ID).
 * Anything missing goes to the contract's owner as a notice, and the
 * contract page offers "Create in FSM" to try again.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

export type FsmOnSigningResult =
  | { ok: true; state: "already" | "linked" | "created"; contactId: string; addressId: string | null }
  | { ok: false; state: "off" | "missing_details" | "taken" | "not_found" | "no_client" | "failed"; message: string };

export async function clientToFsmOnSigning(admin: Admin, contractId: string, actor: Actor, opts: { notify: boolean } = { notify: true }): Promise<FsmOnSigningResult> {
  const { data } = await admin.from("amc_contracts").select("id, customer_id, property_id, contract_number, customer_name").eq("id", contractId).maybeSingle<Row>();
  const clientId = (data?.customer_id as string | null) ?? null;
  const propertyId = (data?.property_id as string | null) ?? null;
  const number = String(data?.contract_number ?? "");

  let result: FsmOnSigningResult;
  if (!data || !clientId) {
    result = { ok: false, state: "no_client", message: "The contract has no client linked in the portal, so nobody could be put into Zoho FSM." };
  } else {
    try {
      const put = await putClientInFsm(admin, clientId, actor.id);
      if ("contactId" in put) {
        const addressId = propertyId ? await ensurePropertyInFsm(admin, propertyId, actor.id) : null;
        await linkContractToContact(admin, contractId, put.contactId, actor);
        result = { ok: true, state: put.state, contactId: put.contactId, addressId };
      } else {
        result = { ok: false, state: put.state, message: put.message };
      }
    } catch (error) {
      result = { ok: false, state: "failed", message: fsmErrorMessage(error) };
    }
  }

  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: "fsm_client_on_signing",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: result.ok ? { state: result.state, fsmContactId: result.contactId, fsmAddressId: result.addressId } : { state: result.state, message: result.message },
  }).catch(() => undefined);

  /* Writes switched off is the setup, not a problem to chase. */
  if (!result.ok && result.state !== "off" && opts.notify) {
    const ownerId = await loadContract(admin, contractId).then((c) => c.ownerId).catch(() => null);
    if (ownerId) {
      await notifyUsers(admin, {
        event: "contract_fsm_client_missing",
        userIds: [ownerId],
        title: `Client not in Zoho FSM yet: AMC ${number}`,
        body: `${String(data?.customer_name ?? "The client")}: ${result.message}`,
        link: `/extensions/amc-contracts/${contractId}`,
        entityType: "contract",
        entityId: contractId,
        contractId,
        dedupeKey: `contract_fsm_client_missing:${contractId}:${result.state}`,
      }).catch(() => 0);
    }
  }
  return result;
}

/** The contract's FSM customer: the contact, its name and Customer ID (best effort; the client link is what matters). */
async function linkContractToContact(admin: Admin, contractId: string, contactId: string, actor: Actor): Promise<void> {
  let name: string | null = null;
  let customerId: string | null = null;
  try {
    const contact = await getContact(await getFsmAccessToken(admin), contactId);
    name = contact?.name ?? null;
    customerId = contact?.customerId ?? null;
  } catch {
    /* Linked by id; the name and number fill in on the next check. */
  }
  const now = new Date().toISOString();
  await admin
    .from("amc_contracts")
    .update({ fsm_contact_id: contactId, fsm_contact_name: name, fsm_customer_id: customerId, fsm_customer_linked_at: now, fsm_customer_linked_by: actor.id })
    .eq("id", contractId)
    .is("fsm_contact_id", null);
}

/** Runs it once the caller has answered, so signing is never slowed or failed by FSM. */
export function queueClientToFsmOnSigning(admin: Admin, contractId: string, actor: Actor): void {
  const run = () =>
    clientToFsmOnSigning(admin, contractId, actor).then(
      () => undefined,
      (e) => console.error(`[amc] FSM client on signing for ${contractId} failed:`, e instanceof Error ? e.message : e),
    );
  try {
    after(run);
  } catch {
    void run();
  }
}

export type ContractFsmClientState = {
  /** Whether the contract's client is in Zoho FSM. */
  inFsm: boolean;
  clientId: string | null;
  clientName: string | null;
  /** Whether the portal sends clients to FSM at all. */
  writesOn: boolean;
  /** The last try at signing, when it did not work. */
  lastProblem: string | null;
};

/** What the contract page shows: is the client in FSM, and why not. */
export async function contractFsmClientState(admin: Admin, contractId: string): Promise<ContractFsmClientState> {
  const { data } = await admin.from("amc_contracts").select("customer_id").eq("id", contractId).maybeSingle<Row>();
  const clientId = (data?.customer_id as string | null) ?? null;
  const [client, writesOn, last] = await Promise.all([
    clientId ? admin.from("snagging_clients").select("id, name, fsm_contact_id").eq("id", clientId).maybeSingle<Row>() : Promise.resolve({ data: null }),
    fsmClientWritesReady(admin),
    admin
      .from("amc_audit_events")
      .select("payload")
      .eq("entity_type", "contract")
      .eq("entity_id", contractId)
      .eq("event_type", "fsm_client_on_signing")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Row>(),
  ]);
  const c = (client as { data: Row | null }).data;
  const payload = ((last as { data: Row | null }).data?.payload ?? null) as Row | null;
  return {
    inFsm: Boolean(c?.fsm_contact_id),
    clientId,
    clientName: (c?.name as string | null) ?? null,
    writesOn,
    lastProblem: payload && typeof payload.message === "string" ? payload.message : null,
  };
}
