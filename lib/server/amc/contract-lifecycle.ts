import type { SupabaseClient } from "@supabase/supabase-js";

import type { AmcConfig } from "@/lib/amc/config";
import {
  AWAITING_SIGNATURE,
  CONTRACT_STATUS_NAMES,
  PRE_ACTIVATION,
  checkStatusChange,
  checkTerm,
  expiryFromCommencement,
  nextPendingSignatory,
  planSignatories,
  statusFromSignatures,
  templateForCategory,
  type ContractStatus,
  type ManualStatusTarget,
  type SignatoryState,
} from "@/lib/amc/contract-lifecycle";
import { termMonthsBetween, todayInDubai } from "@/lib/amc/contracts";
import { grandTotalFromFinal, vatOnFinal } from "@/lib/amc/pricing";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { recordLifecycleChange } from "@/lib/server/amc/client-profile";
import { ContractError, isMissingTable, prepareActivation } from "@/lib/server/amc/contracts";
import { notifyContractEvent, notifyUsers } from "@/lib/server/amc/notifications";
import { recordStatusChange } from "@/lib/server/amc/status-history";
import { closeAmcTodos, openAmcTodo } from "@/lib/server/amc/todos";
import { contractShareTexts, recordSend } from "@/lib/server/amc/proposal-share";
import { linkTokenExpiry, mintLinkToken } from "@/lib/server/link-token";
import { sendEmail } from "@/lib/server/send-email";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";

/**
 * The contract lifecycle on the server (BRD 5.7; DEV-351, 372-376, 378).
 * Rules are in lib/amc/contract-lifecycle.ts.
 *
 *   client approval  -> draft (number, entitlements, signatories, wording)
 *   contract sent    -> pending client / internal signature (configured order)
 *   each signature   -> the next one, then signed
 *   signed scan      -> signed (every open signatory, with the scan as evidence)
 *   activation       -> active, with commencement and term (Phase 7 adds the payment gate)
 *   then             -> on hold, terminated, cancelled (with reason); expired by sweep;
 *                       renewed when its renewal is activated
 *
 * Before 20261007160000 the old status check refuses 'draft', so nothing
 * here runs and the existing "Activate AMC" on a signed proposal stays the
 * way a contract starts.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

export const LIFECYCLE_NOT_MIGRATED = "The contract lifecycle needs the AMC database update 20261007160000, which has not been applied yet.";

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const propertyLabelOf = (property: Row) =>
  [property.propertyDetail, property.propertyAddress]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join(" — ");

export interface SignatoryRecord {
  id: string;
  party: "client" | "internal";
  signOrder: number;
  name: string;
  email: string | null;
  userId: string | null;
  title: string | null;
  status: "waiting" | "pending" | "signed" | "cancelled";
  method: string | null;
  signedAt: string | null;
  signedName: string | null;
  evidenceDocumentId: string | null;
}

function mapSignatory(r: Row): SignatoryRecord {
  return {
    id: String(r.id),
    party: r.party as SignatoryRecord["party"],
    signOrder: Number(r.sign_order),
    name: String(r.name),
    email: (r.email as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    status: r.status as SignatoryRecord["status"],
    method: (r.method as string | null) ?? null,
    signedAt: (r.signed_at as string | null) ?? null,
    signedName: (r.signed_name as string | null) ?? null,
    evidenceDocumentId: (r.evidence_document_id as string | null) ?? null,
  };
}

const SIGNATORY_COLUMNS = "id, party, sign_order, name, email, user_id, title, status, method, signed_at, signed_name, evidence_document_id";

export async function listSignatories(admin: Admin, contractId: string): Promise<{ signatories: SignatoryRecord[]; migrated: boolean }> {
  const { data, error } = await admin.from("amc_contract_signatories").select(SIGNATORY_COLUMNS).eq("contract_id", contractId).order("sign_order");
  if (error) {
    if (isMissingTable(error)) return { signatories: [], migrated: false };
    throw new ContractError(error.message, 500);
  }
  return { signatories: ((data ?? []) as Row[]).map(mapSignatory), migrated: true };
}

const asState = (s: SignatoryRecord): SignatoryState & { user_id: string | null } => ({
  id: s.id,
  party: s.party,
  sign_order: s.signOrder,
  status: s.status,
  user_id: s.userId,
});

async function contractRow(admin: Admin, filter: { id?: string; submissionId?: string }): Promise<Row | null> {
  let q = admin
    .from("amc_contracts")
    .select("id, submission_id, status, contract_number, customer_name, customer_id, property_label, signed_at, renewed_from_contract_id, start_date, end_date, term_months, final_price");
  q = filter.id ? q.eq("id", filter.id) : q.eq("submission_id", filter.submissionId!);
  const { data, error } = await q.maybeSingle<Row>();
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204" || isMissingTable(error)) return null;
    throw new ContractError(error.message, 500);
  }
  return data ?? null;
}

async function setStatus(admin: Admin, contractId: string, from: string, to: ContractStatus, extra: Row, actor: Actor, reason: string | null) {
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

/** The client becomes a client (BRD 5.9): on signing until Phase 7 adds the first payment. */
async function prospectBecomesClient(admin: Admin, customerId: unknown, actor: Actor, reason: string) {
  if (typeof customerId !== "string" || !customerId) return;
  /* Lifecycle is on the client's AMC profile (20261007170000); a client with
     none reads as a client already, so there is nothing to change. */
  const { data } = await admin.from("amc_client_profiles").select("lifecycle").eq("client_id", customerId).maybeSingle<Row>();
  if (!data || data.lifecycle === "client") return;
  const { error } = await admin
    .from("amc_client_profiles")
    .update({ lifecycle: "client", updated_at: new Date().toISOString() })
    .eq("client_id", customerId);
  if (error) return;
  await recordLifecycleChange(admin, customerId, String(data.lifecycle ?? "prospect"), "client", { id: actor.id ?? "", label: actor.label }, reason);
}

/* ------------------------------------------------------------------ */
/* Creation on client approval (DEV-351, 372, 373)                     */
/* ------------------------------------------------------------------ */

/**
 * Creates the contract record when the client approves the proposal: its
 * number, the commercial values and entitlements of the approved version,
 * the wording, the template by category and the signatories in the
 * configured order. Idempotent: a second call returns the existing one.
 * Never throws for the caller's sake (the client's approval stands).
 */
export async function createContractFromApproval(
  admin: Admin,
  submissionId: string,
  actor: Actor,
  config: AmcConfig,
): Promise<{ contractId: string | null; created: boolean; reason?: string }> {
  try {
    const p = await prepareActivation(admin, submissionId);
    if (p.existingContractId) return { contractId: p.existingContractId, created: false };
    if (!["proposal_approved", "contract_sent", "signed"].includes(String(p.submission.status))) {
      return { contractId: null, created: false, reason: "not approved" };
    }
    if (p.entitlements.length === 0) return { contractId: null, created: false, reason: "no services" };

    const { data: extra } = await admin
      .from("amc_submissions")
      .select("customer_id, property_id, enquiry_id, current_version")
      .eq("id", submissionId)
      .maybeSingle<Row>();
    const proposedStart = isDate(p.customer.startDate) ? p.customer.startDate : todayInDubai();
    const proposedEnd =
      isDate(p.customer.endDate) && p.customer.endDate > proposedStart ? p.customer.endDate : expiryFromCommencement(proposedStart, config.contracts.minimumTermMonths);
    const nowIso = new Date().toISOString();

    const { data: newId, error } = await admin.rpc("amc_activate_contract", {
      p_contract: {
        ...(extra?.customer_id ? { customer_id: extra.customer_id } : {}),
        ...(extra?.property_id ? { property_id: extra.property_id } : {}),
        ...(extra?.enquiry_id ? { enquiry_id: extra.enquiry_id } : {}),
        submission_id: submissionId,
        proposal_number: p.submission.proposal_number,
        status: "draft",
        customer: p.customer,
        property: p.property,
        account_managers: p.managers,
        account_manager_names: p.managers.map((m) => String(m.name ?? "").trim()).filter(Boolean).join(", "),
        customer_name: String(p.customer.customerName ?? "").trim(),
        customer_ref: String(p.customer.customerId ?? "").trim() || null,
        property_label: propertyLabelOf(p.property),
        unit_type: (p.property.unitType as string | undefined) ?? null,
        /* Proposed dates; activation sets the commencement and term. */
        start_date: proposedStart,
        end_date: proposedEnd,
        term_months: termMonthsBetween(proposedStart, proposedEnd) || null,
        subtotal: p.commercial.subtotal,
        discount_percent: p.commercial.discountPercent,
        discount_amount: p.commercial.discountAmount,
        final_price: p.finalPrice,
        vat_amount: vatOnFinal(p.finalPrice),
        grand_total: grandTotalFromFinal(p.finalPrice),
        contract_settings_snapshot: p.signedSettings,
        renewed_from_contract_id: (p.submission.renewal_of_contract_id as string | null) ?? null,
        activated_by: actor.id,
        template: templateForCategory(p.property.propertyCategory as string | undefined),
        approved_version_no: Number(extra?.current_version ?? 1),
        client_approved_at: nowIso,
        status_changed_at: nowIso,
      },
      p_entitlements: p.entitlements.map((e) => ({
        service_id: e.serviceId,
        service_label: e.serviceLabel,
        sort_order: e.sortOrder ?? 0,
        frequency_type: e.frequencyType ?? null,
        entitlement_type: e.entitlementType,
        call_out_class: e.callOutClass,
        units: e.units,
        frequency: e.frequency,
        included_quantity: e.includedQuantity,
        base_price: e.basePrice,
        contracted_price: e.contractedPrice,
      })),
    });
    if (error) {
      /* The old status check (no 'draft'), or a column it lacks: not migrated. */
      if (error.code === "23514" || error.code === "42703" || error.code === "PGRST204") return { contractId: null, created: false, reason: "not migrated" };
      if (error.code === "23505") {
        const again = await contractRow(admin, { submissionId });
        return { contractId: (again?.id as string | undefined) ?? null, created: false };
      }
      throw new Error(error.message);
    }
    const contractId = String(newId);

    /* The signatories: the client and the configured internal signatories, in order. */
    const internalIds = config.contracts.internalSignatoryIds;
    const { data: people } = internalIds.length
      ? await admin.from("user_profile").select("id, full_name, email").in("id", internalIds)
      : { data: [] as Row[] };
    const byId = new Map(((people ?? []) as Row[]).map((u) => [String(u.id), u]));
    const internal = internalIds
      .filter((id) => byId.has(id))
      .map((id) => {
        const u = byId.get(id)!;
        return { userId: id, name: String(u.full_name ?? u.email ?? "Yalla Fix It"), email: (u.email as string | null) ?? null };
      });
    const planned = planSignatories(
      { name: String(p.customer.customerName ?? ""), email: (p.customer.customerEmail as string | undefined) || null },
      internal,
      config.contracts.signingOrder,
    );
    const { error: sigError } = await admin.from("amc_contract_signatories").insert(planned.map((s) => ({ ...s, contract_id: contractId })));
    if (sigError) console.error("[amc:contract] signatories not created:", sigError.message);

    await recordAmcAudit(admin, {
      entityType: "contract",
      entityId: contractId,
      eventType: "contract_created_from_approval",
      actorId: actor.id,
      actorLabel: actor.label,
      origin: actor.id ? "portal" : "client",
      payload: { submissionId, proposalNumber: p.submission.proposal_number, version: extra?.current_version ?? 1, signatories: planned.length },
    });
    await recordStatusChange(admin, { entityType: "contract", entityId: contractId, from: null, to: "draft", reason: "Client approved the proposal", actor: { id: actor.id, label: actor.label } });
    return { contractId, created: true };
  } catch (error) {
    console.error("[amc:contract] not created on approval:", error instanceof Error ? error.message : error);
    return { contractId: null, created: false, reason: "error" };
  }
}

/* ------------------------------------------------------------------ */
/* Sending and signing (DEV-374, 375)                                  */
/* ------------------------------------------------------------------ */

/** After the contract is sent: draft -> the status its signatures call for. Best effort. */
export async function contractSent(admin: Admin, submissionId: string, actor: Actor): Promise<void> {
  try {
    const c = await contractRow(admin, { submissionId });
    if (!c || c.status !== "draft") return;
    const { signatories } = await listSignatories(admin, String(c.id));
    const to = signatories.length ? statusFromSignatures(signatories.map(asState)) : "pending_client_signature";
    await setStatus(admin, String(c.id), "draft", to, {}, actor, "Contract sent for signature");
  } catch (error) {
    console.error("[amc:contract] status not moved on send:", error instanceof Error ? error.message : error);
  }
}

/** Marks one signatory signed and opens the next; returns the contract status the signatures now call for. */
async function signRow(
  admin: Admin,
  contractId: string,
  signatoryId: string,
  input: { method: "link" | "portal" | "scan"; signedAt: string; signedName: string; evidenceDocumentId?: string | null },
): Promise<{ status: ContractStatus; signatories: SignatoryRecord[] }> {
  const { data, error } = await admin
    .from("amc_contract_signatories")
    .update({ status: "signed", method: input.method, signed_at: input.signedAt, signed_name: input.signedName, evidence_document_id: input.evidenceDocumentId ?? null })
    .eq("id", signatoryId)
    .in("status", ["pending", "waiting"])
    .select("id");
  if (error) throw new ContractError(error.message, 500);
  if (!data?.length) throw new ContractError("That signature was already recorded.", 409);
  const { signatories } = await listSignatories(admin, contractId);
  const next = nextPendingSignatory(signatories.map(asState));
  if (next) await admin.from("amc_contract_signatories").update({ status: "pending" }).eq("id", next.id).eq("status", "waiting");
  return { status: statusFromSignatures(signatories.map(asState)), signatories };
}

/** Moves the contract to what its signatures call for; on the last one it is signed. */
async function afterSignature(admin: Admin, c: Row, status: ContractStatus, signatories: SignatoryRecord[], actor: Actor, route: "link" | "scan" | "portal") {
  const from = String(c.status);
  if (from === status) return;
  const client = signatories.find((s) => s.party === "client");
  const extra: Row =
    status === "signed"
      ? {
          signed_at: client?.signedAt ?? new Date().toISOString(),
          signed_by_name: client?.signedName ?? client?.name ?? String(c.customer_name ?? "Client"),
          signature_route: route === "portal" ? "link" : route,
        }
      : {};
  await setStatus(admin, String(c.id), from, status, extra, actor, status === "signed" ? "All signatures recorded" : "Signature recorded");
  if (status === "signed") {
    await prospectBecomesClient(admin, c.customer_id, actor, `Contract ${String(c.contract_number ?? "")} signed`);
    await closeAmcTodos(admin, { entityType: "contract", entityId: String(c.id), kind: "contract_follow_up" }, { status: "done", reason: "Signed" }).catch(() => 0);
    await notifyContractEvent(admin, { event: "contract_signed", contractId: String(c.id), actor: { id: actor.id, label: actor.label }, at: new Date().toISOString() }).catch(() => undefined);
  } else {
    const next = nextPendingSignatory(signatories.map(asState));
    const row = next ? signatories.find((s) => s.id === next.id) : null;
    if (row?.party === "internal" && row.userId) {
      await notifyUsers(admin, {
        event: "contract_signature_needed",
        userIds: [row.userId],
        title: `Contract ${String(c.contract_number ?? "")} is waiting for your signature`,
        body: `${String(c.customer_name ?? "")} · ${String(c.property_label ?? "")}`,
        link: `/extensions/amc-contracts/${String(c.id)}`,
        entityType: "contract",
        entityId: String(c.id),
        contractId: String(c.id),
        dedupeKey: `contract_signature_needed:${String(c.id)}:${row.id}`,
      });
    }
  }
}

/** The client signed on the link (the proposal's submission is already signed). Best effort. */
export async function clientSignedOnLink(admin: Admin, submissionId: string, name: string, signedAt: string): Promise<void> {
  try {
    const c = await contractRow(admin, { submissionId });
    if (!c || !AWAITING_SIGNATURE.includes(String(c.status) as ContractStatus)) return;
    const { signatories, migrated } = await listSignatories(admin, String(c.id));
    if (!migrated) return;
    const client = signatories.find((s) => s.party === "client" && s.status !== "signed");
    if (!client) return;
    const { status, signatories: after } = await signRow(admin, String(c.id), client.id, { method: "link", signedAt, signedName: name });
    await afterSignature(admin, c, status, after, { id: null, label: name }, "link");
  } catch (error) {
    console.error("[amc:contract] client signature not recorded on the contract:", error instanceof Error ? error.message : error);
  }
}

/** An internal signatory signs in the portal, in their turn. */
export async function signInternally(admin: Admin, contractId: string, user: { id: string; label: string | null }, typedName: string) {
  const c = await contractRow(admin, { id: contractId });
  if (!c) throw new ContractError("Contract not found.", 404);
  if (!AWAITING_SIGNATURE.includes(String(c.status) as ContractStatus)) throw new ContractError("This contract is not waiting for signatures.", 409);
  const { signatories } = await listSignatories(admin, contractId);
  const next = nextPendingSignatory(signatories.map(asState));
  const mine = next ? signatories.find((s) => s.id === next.id && s.party === "internal" && s.userId === user.id) : null;
  if (!mine) {
    const own = signatories.find((s) => s.userId === user.id && s.status !== "signed");
    throw new ContractError(own ? "It is not your turn to sign yet." : "You are not a signatory of this contract.", own ? 409 : 403);
  }
  const { status, signatories: after } = await signRow(admin, contractId, mine.id, { method: "portal", signedAt: new Date().toISOString(), signedName: typedName.trim() });
  await recordAmcAudit(admin, { entityType: "contract", entityId: contractId, eventType: "signed_internally", actorId: user.id, actorLabel: user.label, payload: { signatoryId: mine.id, typedName: typedName.trim() } });
  await afterSignature(admin, c, status, after, user, "portal");
  return { status };
}

/**
 * A signed scan (DEV-375 part 1): every open signature is recorded with the
 * scan as evidence, the contract is signed on the scan's date, and the
 * proposal is marked signed as the link would have done.
 */
export async function recordSignedScan(
  admin: Admin,
  contractId: string,
  input: { documentId: string; signedDate: string; signedByName: string },
  actor: { id: string; label: string | null },
) {
  const c = await contractRow(admin, { id: contractId });
  if (!c) throw new ContractError("Contract not found.", 404);
  if (!AWAITING_SIGNATURE.includes(String(c.status) as ContractStatus)) throw new ContractError("This contract is not waiting for signatures.", 409);
  const { data: doc } = await admin.from("amc_documents").select("id, level, entity_id").eq("id", input.documentId).maybeSingle<Row>();
  if (!doc || doc.level !== "contract" || doc.entity_id !== contractId) throw new ContractError("Upload the signed scan to this contract's documents first.", 400);
  if (input.signedDate > todayInDubai()) throw new ContractError("The signing date cannot be in the future.", 400);

  const signedAt = `${input.signedDate}T12:00:00+04:00`;
  const { signatories } = await listSignatories(admin, contractId);
  for (const s of signatories.filter((x) => x.status === "pending" || x.status === "waiting")) {
    await admin
      .from("amc_contract_signatories")
      .update({
        status: "signed",
        method: "scan",
        signed_at: signedAt,
        signed_name: s.party === "client" ? input.signedByName.trim() : s.name,
        evidence_document_id: input.documentId,
      })
      .eq("id", s.id)
      .in("status", ["pending", "waiting"]);
  }
  const nowIso = new Date().toISOString();
  await setStatus(
    admin,
    contractId,
    String(c.status),
    "signed",
    { signed_at: signedAt, signed_by_name: input.signedByName.trim(), signature_route: "scan", signed_scan_document_id: input.documentId, signed_scan_date: input.signedDate },
    actor,
    `Signed scan dated ${input.signedDate}`,
  );
  /* The proposal follows, as if signed on the link (live main reads 'signed'). */
  await admin
    .from("amc_submissions")
    .update({ status: "signed", signed_by_name: input.signedByName.trim(), signed_at: signedAt, updated_at: nowIso })
    .eq("id", String(c.submission_id))
    .in("status", ["proposal_approved", "contract_sent"]);
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: "signed_scan_recorded",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { documentId: input.documentId, signedDate: input.signedDate, signedByName: input.signedByName.trim() },
  });
  await prospectBecomesClient(admin, c.customer_id, actor, `Contract ${String(c.contract_number ?? "")} signed (scan)`);
  await closeAmcTodos(admin, { entityType: "contract", entityId: contractId, kind: "contract_follow_up" }, { status: "done", reason: "Signed scan" }).catch(() => 0);
  return { status: "signed" as const };
}

/* ------------------------------------------------------------------ */
/* Activation and status changes (DEV-372, 376)                        */
/* ------------------------------------------------------------------ */

export async function activateSignedContract(
  admin: Admin,
  contractId: string,
  input: { commencementDate: string; termMonths: number },
  actor: { id: string; label: string | null },
  config: AmcConfig,
) {
  const c = await contractRow(admin, { id: contractId });
  if (!c) throw new ContractError("Contract not found.", 404);
  if (!["signed", "pending_initial_payment"].includes(String(c.status))) {
    throw new ContractError(`A contract that is ${CONTRACT_STATUS_NAMES[String(c.status) as ContractStatus]?.toLowerCase() ?? c.status} cannot be activated.`, 409);
  }
  const termProblem = checkTerm(input.termMonths, config.contracts);
  if (termProblem) throw new ContractError(termProblem, 400);
  const endDate = expiryFromCommencement(input.commencementDate, input.termMonths);
  const nowIso = new Date().toISOString();
  await setStatus(
    admin,
    contractId,
    String(c.status),
    "active",
    { start_date: input.commencementDate, end_date: endDate, term_months: input.termMonths, activated_at: nowIso, activated_by: actor.id },
    actor,
    `Commences ${input.commencementDate} for ${input.termMonths} months (to ${endDate})`,
  );
  /* A renewal's predecessor is renewed. */
  if (c.renewed_from_contract_id) {
    const previous = await contractRow(admin, { id: String(c.renewed_from_contract_id) });
    if (previous && ["active", "expired", "on_hold"].includes(String(previous.status))) {
      await setStatus(admin, String(previous.id), String(previous.status), "renewed", {}, actor, `Renewed by ${String(c.contract_number ?? "")}`).catch(() => undefined);
    }
  }
  await prospectBecomesClient(admin, c.customer_id, actor, `Contract ${String(c.contract_number ?? "")} activated`);
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: "contract_activated",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { commencementDate: input.commencementDate, termMonths: input.termMonths, endDate },
  });
  await notifyContractEvent(admin, { event: "contract_activated", contractId, actor }).catch(() => undefined);
  return { status: "active" as const, endDate };
}

export async function changeContractStatus(admin: Admin, contractId: string, input: { to: ManualStatusTarget; reason: string }, actor: { id: string; label: string | null }) {
  const c = await contractRow(admin, { id: contractId });
  if (!c) throw new ContractError("Contract not found.", 404);
  const from = String(c.status) as ContractStatus;
  const problem = checkStatusChange(from, input.to);
  if (problem) throw new ContractError(problem, 409);
  const reason = input.reason.trim();
  const nowIso = new Date().toISOString();
  const extra: Row =
    input.to === "cancelled"
      ? { cancelled_at: nowIso, cancelled_by: actor.id, cancellation_reason: reason, status_reason: reason }
      : input.to === "active"
        ? { status_reason: null }
        : { status_reason: reason };
  await setStatus(admin, contractId, from, input.to, extra, actor, reason);
  return { status: input.to };
}

/** What a service covers besides its visits, while the contract is not yet active (DEV-373). */
export async function updateEntitlementTerms(
  admin: Admin,
  contractId: string,
  input: { entitlementId: string; labourCovered: boolean; materialCoverage: string; valueLimitAed: number | null; exclusions: string | null },
  actor: { id: string; label: string | null },
) {
  const c = await contractRow(admin, { id: contractId });
  if (!c) throw new ContractError("Contract not found.", 404);
  if (!PRE_ACTIVATION.includes(String(c.status) as ContractStatus)) throw new ContractError("An active contract's entitlements change through an amendment.", 409);
  const { data, error } = await admin
    .from("amc_contract_entitlements")
    .update({ labour_covered: input.labourCovered, material_coverage: input.materialCoverage, value_limit_aed: input.valueLimitAed, exclusions: input.exclusions?.trim() || null })
    .eq("id", input.entitlementId)
    .eq("contract_id", contractId)
    .select("id");
  if (error) throw new ContractError(error.code === "42703" ? LIFECYCLE_NOT_MIGRATED : error.message, error.code === "42703" ? 503 : 500);
  if (!data?.length) throw new ContractError("Service not found on this contract.", 404);
  await recordAmcAudit(admin, { entityType: "contract", entityId: contractId, eventType: "entitlement_terms_changed", actorId: actor.id, actorLabel: actor.label, payload: input });
}

/* ------------------------------------------------------------------ */
/* Sweeps                                                              */
/* ------------------------------------------------------------------ */

/** Active contracts past their end date become expired (stored, so lists and reports agree). */
export async function runContractExpirySweep(admin: Admin, now = new Date()) {
  const today = todayInDubai(now);
  const { data, error } = await admin.from("amc_contracts").select("id, status, end_date").eq("status", "active").lt("end_date", today).limit(200);
  if (error) {
    if (isMissingTable(error)) return { expired: 0, skipped: "not migrated" };
    throw new Error(error.message);
  }
  let expired = 0;
  for (const row of (data ?? []) as Row[]) {
    try {
      await setStatus(admin, String(row.id), "active", "expired", {}, { id: null, label: "Portal" }, `Ended on ${String(row.end_date)}`);
      expired += 1;
    } catch (e) {
      /* The old status check (before 20261007160000) refuses 'expired': stop quietly. */
      if (e instanceof ContractError && e.status === 409) return { expired, skipped: "not migrated" };
    }
  }
  return { expired, skipped: null };
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");

/**
 * Unsigned contracts (BRD 5.7, 6.1, 6.8 #2): when the client has not signed
 * for the configured days, a "Contract follow-up" to-do opens for the owner
 * and Email 2 goes again with a fresh link (the old one stops), up to the
 * configured number of reminders. Each reminder is claimed before it is
 * sent, so overlapping runs send once.
 */
export async function runUnsignedContractSweep(admin: Admin, config: AmcConfig, now = new Date()) {
  const result = { checked: 0, reminded: 0, followUps: 0, skipped: null as string | null };
  const { data, error } = await admin
    .from("amc_contracts")
    .select(
      "id, contract_number, customer_name, reminder_count, last_reminder_at, submission:amc_submissions!amc_contracts_submission_id_fkey(id, owner_id, status, contract_sent_at, customer, property, proposal_number, final_price, payment_plan, payment_plan_custom)",
    )
    .eq("status", "pending_client_signature")
    .limit(200);
  if (error) {
    if (isMissingTable(error) || error.code === "42703" || error.code === "PGRST204" || error.code === "22P02") return { ...result, skipped: "not migrated" };
    throw new Error(error.message);
  }
  const days = config.contracts.unsignedReminderDays;

  for (const c of (data ?? []) as Row[]) {
    const s = (Array.isArray(c.submission) ? c.submission[0] : c.submission) as Row | null;
    if (!s || s.status !== "contract_sent") continue;
    result.checked += 1;
    const last = String(c.last_reminder_at ?? s.contract_sent_at ?? "");
    if (!last || now.getTime() - new Date(last).getTime() < days * 86_400_000) continue;
    const ownerId = String(s.owner_id);
    const unsignedDays = Math.floor((now.getTime() - new Date(String(s.contract_sent_at ?? last)).getTime()) / 86_400_000);

    /* The follow-up to-do, once per contract. */
    try {
      const opened = await openAmcTodo(
        admin,
        {
          kind: "contract_follow_up",
          entityType: "contract",
          entityId: String(c.id),
          dedupeKey: `contract_follow_up:${String(c.id)}`,
          title: `Contract ${String(c.contract_number ?? "")} not signed (${unsignedDays} days)`,
          description: `${String(c.customer_name ?? "")}: resend the contract, upload a signed scan, or record why it is waiting.`,
          ownerId,
          assigneeIds: [ownerId],
          dueAt: new Date(now.getTime() + 86_400_000).toISOString(),
          escalateAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
        },
        config,
      );
      if (opened.created) result.followUps += 1;
    } catch (e) {
      console.error("[amc:contract] follow-up to-do not opened:", e instanceof Error ? e.message : e);
    }

    const count = Number(c.reminder_count ?? 0);
    if (count >= config.contracts.unsignedReminderMax) continue;
    const { data: claimed } = await admin
      .from("amc_contracts")
      .update({ reminder_count: count + 1, last_reminder_at: now.toISOString() })
      .eq("id", String(c.id))
      .eq("reminder_count", count)
      .select("id");
    if (!claimed?.length) continue;

    /* A fresh link: only its hash is stored, so the old one cannot be sent again. */
    const token = mintLinkToken();
    const { data: relinked } = await admin
      .from("amc_submissions")
      .update({ contract_token_hash: token.hash, contract_token_hint: token.hint, contract_token_expires_at: linkTokenExpiry(), updated_at: now.toISOString() })
      .eq("id", String(s.id))
      .eq("status", "contract_sent")
      .select("id");
    if (!relinked?.length) continue;
    const link = `${appUrl()}/amc/${token.raw}`;
    const customer = (s.customer ?? {}) as Row;
    const to = String(customer.customerEmail ?? "").trim();
    const { data: owner } = await admin.from("user_profile").select("full_name, email").eq("id", ownerId).maybeSingle<Row>();
    const texts = await contractShareTexts(admin, s, { config, link, owner: { name: String(owner?.full_name ?? owner?.email ?? "Yalla Fix It") } });
    const cc = [...new Set([String(owner?.email ?? ""), ...config.contracts.financeCcEmails].filter(Boolean))].filter((e) => e !== to);
    let outcome: "sent" | "failed" | "no_recipient" = "no_recipient";
    if (to) {
      try {
        const blocks = texts.body.split(/\n{2,}/);
        await sendEmail({
          to,
          ...(cc.length ? { cc } : {}),
          subject: texts.subject,
          html: clientEmailHtml({
            eyebrow: "AMC contract",
            heading: `Contract ${texts.contractNumber ?? ""} is ready to sign`.trim(),
            greeting: escapeEmailHtml(blocks[0] ?? ""),
            paragraphs: blocks.slice(1).map((b) => escapeEmailHtml(b).replace(/\n/g, "<br>")),
            details: [],
            cta: { label: "Review and sign", url: link },
            footnote: "A reminder: this link replaces the one sent earlier.",
          }),
        });
        outcome = "sent";
      } catch (e) {
        outcome = "failed";
        console.error("[amc:contract] reminder email failed:", e instanceof Error ? e.message.slice(0, 200) : e);
      }
    }
    await recordSend(admin, {
      submissionId: String(s.id),
      versionNo: 1,
      document: "contract",
      channel: "email",
      recipients: to ? [{ name: String(customer.customerName ?? ""), address: to }] : [],
      cc,
      outcome,
      tokenHint: token.hint,
      detail: `Unsigned reminder ${count + 1} of ${config.contracts.unsignedReminderMax}`,
      sentBy: null,
    });
    await recordAmcAudit(admin, {
      entityType: "contract",
      entityId: String(c.id),
      eventType: "unsigned_reminder_sent",
      actorId: null,
      actorLabel: "Portal",
      origin: "system",
      payload: { reminder: count + 1, outcome, tokenHint: token.hint },
    });
    await notifyUsers(admin, {
      event: "contract_unsigned",
      userIds: [ownerId],
      title: `Contract ${String(c.contract_number ?? "")} is still not signed`,
      body: `${String(c.customer_name ?? "")}: ${unsignedDays} days since it was sent. Reminder ${count + 1} ${outcome === "sent" ? "emailed" : "could not be emailed"}.`,
      link: `/extensions/amc-contracts/${String(c.id)}`,
      entityType: "contract",
      entityId: String(c.id),
      contractId: String(c.id),
      dedupeKey: `contract_unsigned:${String(c.id)}:${count + 1}`,
    });
    result.reminded += 1;
  }
  return result;
}
