import type { SupabaseClient } from "@supabase/supabase-js";

import { buildAmcDocumentModel } from "@/components/dashboard/extensions/amc/amc-document-model";
import { computeAmcData } from "@/components/dashboard/extensions/amc/amc-pricing";
import { getAmcSettingsDefaults, resolveAmcSettings } from "@/components/dashboard/extensions/amc/amc-settings";
import { submissionToFormData } from "@/components/dashboard/extensions/amc/amc-submission-mapper";
import type { AmcSubmission } from "@/components/dashboard/extensions/amc/amc-types";
import { REVISABLE_STATUSES, VERSION_REASON_LABELS, planFromLegacyTerms, type VersionReason } from "@/lib/amc/proposal-rules";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError, isMissingFunction, isMissingTable } from "@/lib/server/amc/contracts";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { AMC_DOCUMENTS_BUCKET, renderAmcDocumentHtml, renderPdf, sha256Hex } from "@/lib/server/amc/signed-archive";
import { recordStatusChange } from "@/lib/server/amc/status-history";

/**
 * Proposal versions (BRD 5.4, DEV-367). The proposal row is always the
 * active version; revising a shared proposal locks the active one in
 * amc_submission_versions, with the document as it was printed on the
 * server, and opens V(n+1) as a draft (amc_lock_proposal_version, one
 * transaction). A locked version is never changed or deleted.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string; label: string | null };

export const VERSIONS_NOT_MIGRATED =
  "Proposal versions need the AMC database update 20261007140000, which has not been applied to this database yet.";

export interface ProposalVersionLine {
  serviceId: string;
  included: boolean;
  units: number;
  frequency: number;
  basePrice: number | null;
  price: number;
}

export interface ProposalVersion {
  id: string;
  versionNo: number;
  reason: VersionReason | null;
  summary: string | null;
  startedAt: string;
  startedBy: string | null;
  lockedAt: string;
  lockedBy: string | null;
  statusAtLock: string;
  finalPrice: number;
  discountPercent: number;
  paymentPlan: string | null;
  validUntil: string | null;
  contentType: "application/pdf" | "text/html";
  byteSize: number;
  /** The priced lines, for comparing versions side by side. */
  lines: ProposalVersionLine[];
}

const personName = (r: Row | null) => ((r?.full_name as string | null) || (r?.email as string | null) || null);

function mapVersion(r: Row): ProposalVersion {
  const snapshot = (r.snapshot ?? {}) as Row;
  const services = (Array.isArray(snapshot.services) ? snapshot.services : []) as Row[];
  return {
    id: String(r.id),
    versionNo: Number(r.version_no),
    reason: (r.reason as VersionReason | null) ?? null,
    summary: (r.summary as string | null) ?? null,
    startedAt: String(r.started_at),
    startedBy: personName(r.starter as Row | null),
    lockedAt: String(r.locked_at),
    lockedBy: personName(r.locker as Row | null),
    statusAtLock: String(r.status_at_lock),
    finalPrice: Number(r.final_price),
    discountPercent: Number(r.discount_percent ?? 0),
    paymentPlan: (r.payment_plan as string | null) ?? null,
    validUntil: (r.valid_until as string | null) ?? null,
    contentType: r.content_type as ProposalVersion["contentType"],
    byteSize: Number(r.byte_size),
    lines: services.map((s) => ({
      serviceId: String(s.serviceId),
      included: s.included === true,
      units: Number(s.units ?? 1),
      frequency: Number(s.frequency ?? 1),
      basePrice: s.basePrice === null || s.basePrice === undefined ? null : Number(s.basePrice),
      price: Number(s.price ?? 0),
    })),
  };
}

const VERSION_COLUMNS =
  "id, version_no, reason, summary, started_at, locked_at, status_at_lock, final_price, discount_percent, payment_plan, valid_until, content_type, byte_size, snapshot, " +
  "starter:user_profile!amc_submission_versions_started_by_fkey(full_name, email), locker:user_profile!amc_submission_versions_locked_by_fkey(full_name, email)";

export async function listProposalVersions(admin: Admin, submissionId: string): Promise<{ versions: ProposalVersion[]; migrated: boolean }> {
  const { data, error } = await admin
    .from("amc_submission_versions")
    .select(VERSION_COLUMNS)
    .eq("submission_id", submissionId)
    .order("version_no", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { versions: [], migrated: false };
    throw new ContractError(error.message, 500);
  }
  return { versions: ((data ?? []) as unknown as Row[]).map(mapVersion), migrated: true };
}

/* ------------------------------------------------------------------ */
/* Locking                                                             */
/* ------------------------------------------------------------------ */

type SubmissionRow = AmcSubmission & {
  proposal_number?: string | null;
  property_type?: string | null;
  current_version?: number | null;
};

/** Everything the locked version's document renders from, and what the client was told. */
export function versionSnapshot(row: SubmissionRow, settings: unknown) {
  return {
    version: 1,
    versionNo: Number(row.current_version ?? 1),
    proposalNumber: String(row.proposal_number ?? row.customer?.proposalNumber ?? ""),
    property: row.property,
    propertyType: row.property_type ?? null,
    customer: row.customer,
    services: row.services,
    documentOptions: row.document_options ?? null,
    discountPercent: Number(row.discount_percent ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    finalPrice: Number(row.final_price ?? 0),
    paymentPlan: row.payment_plan ?? planFromLegacyTerms(row.customer?.paymentTerms),
    paymentPlanCustom: row.payment_plan_custom ?? null,
    validUntil: row.valid_until ?? null,
    proposalSentAt: row.proposal_sent_at ?? null,
    client: {
      decision: row.client_decision ?? null,
      decidedAt: row.client_decided_at ?? null,
      decidedBy: row.client_decided_by_name ?? null,
      rejectedReason: row.client_rejected_reason ?? null,
    },
    /* The wording it was sent with (FR6.4), kept even though V(n+1) takes the current wording. */
    settings,
  };
}

const esc = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Revises a shared proposal: prints and stores the active version, locks
 * it, and opens the next as a draft. The owner's action (the route checks).
 */
export async function reviseProposal(
  admin: Admin,
  input: { id: string; reason: VersionReason; summary: string },
  actor: Actor,
  opts: { renderPdf?: (html: string) => Promise<Uint8Array | null> } = {},
): Promise<{ versionNo: number; lockedVersionNo: number }> {
  const { data, error } = await admin.from("amc_submissions").select("*").eq("id", input.id).maybeSingle<SubmissionRow>();
  if (error) throw new ContractError(error.message, 500);
  if (!data) throw new ContractError("Not found", 404);
  if (!(REVISABLE_STATUSES as readonly string[]).includes(data.status)) {
    throw new ContractError(`A proposal that is ${data.status.replace(/_/g, " ")} has not been shared, so it is edited in place.`, 409);
  }
  const lockedVersionNo = Number(data.current_version ?? 1);

  /* The document as the client was sent it: its frozen wording, its send date. */
  const settings = resolveAmcSettings(getAmcSettingsDefaults(), data.settings_snapshot ?? (await readAmcSettings(admin)));
  const snapshot = versionSnapshot(data, settings);
  const contentSha = sha256Hex(JSON.stringify(snapshot));
  const model = buildAmcDocumentModel(computeAmcData(submissionToFormData(data), "proposal", settings, data.proposal_sent_at ?? null));
  const number = snapshot.proposalNumber || "AMC";
  const lockedOn = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" });
  const html = renderAmcDocumentHtml(
    `AMC proposal ${number} V${lockedVersionNo}`,
    model,
    `<p class="archive">Version V${lockedVersionNo} of proposal ${esc(number)}, locked on ${esc(lockedOn)} when V${lockedVersionNo + 1} was opened (${esc(
      VERSION_REASON_LABELS[input.reason],
    )}). Content SHA-256: ${esc(contentSha)}</p>`,
  );
  const pdf = await (opts.renderPdf ?? renderPdf)(html);
  const file = pdf ?? new TextEncoder().encode(html);
  const contentType = pdf ? "application/pdf" : "text/html";
  const path = `proposal-versions/${data.id}/v${lockedVersionNo}-${Date.now()}.${pdf ? "pdf" : "html"}`;

  const { error: uploadError } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).upload(path, file, { contentType, upsert: false });
  if (uploadError) throw new ContractError(`Could not store the version's document: ${uploadError.message}`, 500);

  const { data: next, error: lockError } = await admin.rpc("amc_lock_proposal_version", {
    p_submission_id: data.id,
    p_expected_version: lockedVersionNo,
    p_reason: input.reason,
    p_summary: input.summary.trim(),
    p_actor: actor.id,
    p_snapshot: snapshot,
    p_content_sha256: contentSha,
    p_storage_path: path,
    p_content_type: contentType,
    p_byte_size: file.byteLength,
    p_file_sha256: sha256Hex(file),
  });
  if (lockError) {
    await admin.storage.from(AMC_DOCUMENTS_BUCKET).remove([path]);
    if (isMissingFunction(lockError) || isMissingTable(lockError)) throw new ContractError(VERSIONS_NOT_MIGRATED, 503);
    if (lockError.code === "40001") throw new ContractError("Someone else revised this proposal a moment ago. Reload it.", 409);
    if (lockError.code === "23514") throw new ContractError(lockError.message.replace(/^amc_version:\s*/, ""), 409);
    if (lockError.code === "P0002") throw new ContractError("Not found", 404);
    throw new ContractError(lockError.message, 500);
  }
  const versionNo = Number(next ?? lockedVersionNo + 1);

  await recordAmcAudit(admin, {
    entityType: "submission",
    entityId: data.id,
    eventType: "proposal_revised",
    actorId: actor.id,
    actorLabel: actor.label,
    justification: input.summary.trim(),
    payload: { lockedVersion: lockedVersionNo, newVersion: versionNo, reason: input.reason, finalPrice: snapshot.finalPrice, contentType, contentSha256: contentSha },
  });
  await recordStatusChange(admin, {
    entityType: "submission",
    entityId: data.id,
    from: data.status,
    to: "draft",
    reason: `V${versionNo}: ${VERSION_REASON_LABELS[input.reason]} · ${input.summary.trim()}`,
    actor,
    details: { lockedVersion: lockedVersionNo, newVersion: versionNo },
  });
  return { versionNo, lockedVersionNo };
}

/** A short-lived link to a locked version's document. */
export async function proposalVersionUrl(admin: Admin, submissionId: string, versionNo: number, ttlSeconds = 300): Promise<string> {
  const { data, error } = await admin
    .from("amc_submission_versions")
    .select("storage_path, content_type, snapshot")
    .eq("submission_id", submissionId)
    .eq("version_no", versionNo)
    .maybeSingle<Row>();
  if (error) {
    if (isMissingTable(error)) throw new ContractError(VERSIONS_NOT_MIGRATED, 503);
    throw new ContractError(error.message, 500);
  }
  if (!data) throw new ContractError("That version does not exist.", 404);
  const number = String(((data.snapshot ?? {}) as Row).proposalNumber ?? "AMC").replace(/[^\w-]+/g, "_");
  const ext = data.content_type === "application/pdf" ? "pdf" : "html";
  const { data: signed, error: urlError } = await admin.storage
    .from(AMC_DOCUMENTS_BUCKET)
    .createSignedUrl(String(data.storage_path), ttlSeconds, { download: `Proposal-${number}-V${versionNo}.${ext}` });
  if (urlError || !signed?.signedUrl) throw new ContractError(urlError?.message ?? "Could not open the version.", 500);
  return signed.signedUrl;
}
