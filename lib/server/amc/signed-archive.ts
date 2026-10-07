import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { computeAmcData } from "@/components/dashboard/extensions/amc/amc-pricing";
import { submissionToFormData } from "@/components/dashboard/extensions/amc/amc-submission-mapper";
import { getAmcSettingsDefaults, resolveAmcSettings } from "@/components/dashboard/extensions/amc/amc-settings";
import {
  AMC_FOOTER,
  buildAmcDocumentModel,
  type AmcDocumentModel,
  type Block,
  type Cell,
  type Run,
} from "@/components/dashboard/extensions/amc/amc-document-model";
import type { AmcSubmission } from "@/components/dashboard/extensions/amc/amc-types";
import { recordedSignature, signatureCaption } from "@/lib/amc/signature";
import { recordAmcAudit } from "@/lib/server/amc/audit";

/**
 * The archived signed contract.
 *
 * When a client signs, the contract they signed is preserved: its exact
 * content (the same document model the PDF and Word files are drawn from)
 * with the signature, built from the signed proposal and the wording
 * frozen when the contract was sent (contract_settings_snapshot). The live
 * AMC Settings are never read, so a later settings edit cannot change an
 * archived contract. The content's hash is kept, and the rendered file is
 * stored in the private `amc-documents` bucket with its own hash.
 *
 * The file is a PDF printed by headless Chrome (the Snagging report path).
 * On a host with no browser it falls back to the same document as a
 * self-contained HTML file, and says so: the content and its hash are the
 * archive either way.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

export const AMC_DOCUMENTS_BUCKET = "amc-documents";
const TABLE = "amc_signed_documents";
const ARCHIVE_COLUMNS =
  "id, submission_id, proposal_number, signed_by_name, signed_at, archived_when, settings_source, content_sha256, storage_path, content_type, byte_size, file_sha256, created_at";

export class ArchiveError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}

export interface SignedArchiveRecord {
  id: string;
  submissionId: string;
  proposalNumber: string;
  signedByName: string;
  signedAt: string;
  archivedWhen: "at_signing" | "after_signing";
  settingsSource: "contract_settings_snapshot" | "settings_snapshot";
  contentSha256: string;
  storagePath: string;
  contentType: "application/pdf" | "text/html";
  byteSize: number;
  fileSha256: string;
  createdAt: string;
}

export interface SignedContractContent {
  version: 1;
  documentType: "signed_contract";
  proposalNumber: string;
  /** When the contract (and its wording) was sent to the client. */
  contractSentAt: string | null;
  settingsSource: SignedArchiveRecord["settingsSource"];
  signature: {
    method: "typed_name";
    typedName: string;
    signedAt: string;
    caption: string;
  };
  model: AmcDocumentModel;
}

/* ------------------------------------------------------------------ */
/* Content (pure)                                                      */
/* ------------------------------------------------------------------ */

/**
 * The signed contract's content, from the signed row alone. Throws when
 * the row is not signed or has no saved wording: an archive is never built
 * from today's settings.
 */
export function buildSignedContractContent(row: AmcSubmission & { proposal_number?: string | null }): SignedContractContent {
  const signature = recordedSignature(row);
  if (!signature) throw new ArchiveError("Only a signed contract can be archived.", 409);
  const snapshot = row.contract_settings_snapshot ?? row.settings_snapshot ?? null;
  if (!snapshot) {
    throw new ArchiveError("This contract has no saved wording, so it cannot be archived exactly.", 409);
  }
  const settingsSource = row.contract_settings_snapshot ? "contract_settings_snapshot" : "settings_snapshot";
  const data = computeAmcData(
    submissionToFormData(row),
    "contract",
    /* The snapshot is the merged settings as sent; the code defaults only
       fill keys a very old snapshot did not have. */
    resolveAmcSettings(getAmcSettingsDefaults(), snapshot),
    row.contract_sent_at ?? null,
  );
  return {
    version: 1,
    documentType: "signed_contract",
    proposalNumber: String(row.proposal_number ?? ""),
    contractSentAt: row.contract_sent_at ?? null,
    settingsSource,
    signature: {
      method: "typed_name",
      typedName: signature.name,
      signedAt: signature.signedAt,
      caption: signatureCaption(signature),
    },
    model: buildAmcDocumentModel(data),
  };
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** The content's hash: of its JSON, built in a fixed key order. */
export function contentHash(content: SignedContractContent): string {
  return sha256Hex(JSON.stringify(content));
}

/* ------------------------------------------------------------------ */
/* HTML (pure)                                                         */
/* ------------------------------------------------------------------ */

const BRAND = "#C1272D";
const MUTED = "#595959";
const LINE = "#D0D0D0";

const esc = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function runs(list: Run[]): string {
  return list
    .map((r) => {
      const color = r.tone === "brand" ? BRAND : r.tone === "muted" ? MUTED : r.tone === "white" ? "#fff" : "inherit";
      const body = esc(r.text);
      return `<span style="color:${color}${r.bold ? ";font-weight:700" : ""}">${body}</span>`;
    })
    .join("");
}

function cellHtml(c: Cell, tag: "td" | "th"): string {
  const bg = c.shade === "brand" ? BRAND : c.shade === "label" ? "#EDEDED" : c.shade === "zebra" ? "#F5F5F5" : "#fff";
  const color = c.shade === "brand" ? "#fff" : "inherit";
  const lines = c.lines.map((line) => `<div>${runs(line)}</div>`).join("");
  return `<${tag} style="background:${bg};color:${color};text-align:${c.align ?? "left"};border:1px solid ${LINE};padding:4px 6px;vertical-align:top">${lines}</${tag}>`;
}

function blockHtml(b: Block): string {
  switch (b.kind) {
    case "contactStrip":
      return `<div class="strip">${esc(AMC_FOOTER.address)} · ${esc(AMC_FOOTER.phone)} · ${esc(AMC_FOOTER.hotline)}</div>`;
    case "banner":
      return `<div class="banner">${esc(b.text)}</div>`;
    case "meta":
      return `<div class="meta">${b.items.map((i) => `<span><b>${esc(i.label)}:</b> ${esc(i.value)}</span>`).join("")}</div>`;
    case "label":
      return `<div class="label">${esc(b.text)}</div>`;
    case "table": {
      const total = b.widths.reduce((s, w) => s + w, 0) || 1;
      const cols = b.widths.map((w) => `<col style="width:${((w / total) * 100).toFixed(2)}%">`).join("");
      const head = b.header ? `<thead><tr>${b.header.map((c) => cellHtml(c, "th")).join("")}</tr></thead>` : "";
      const body = b.rows.map((row) => `<tr>${row.map((c) => cellHtml(c, "td")).join("")}</tr>`).join("");
      const width = b.width ? `width:${b.width}%;margin-left:auto` : "width:100%";
      return `<table style="${width}"><colgroup>${cols}</colgroup>${head}<tbody>${body}</tbody></table>`;
    }
    case "heading":
      return `<h2><span class="num">${esc(b.number)}</span> ${esc(b.text)}</h2>`;
    case "subheading":
      return `<h3>${b.number ? `<span class="num">${esc(b.number)}</span> ` : ""}${esc(b.text)}</h3>`;
    case "paragraph":
      return `<p>${runs(b.runs)}</p>`;
    case "bullets":
      return `<ul>${b.items.map((i) => `<li>${runs(i)}</li>`).join("")}</ul>`;
    case "numbered":
      return `<div>${b.items.map((i) => `<p><span class="num">${esc(i.number)}</span> ${runs(i.runs)}</p>`).join("")}</div>`;
    case "term":
      return `<p><span class="num">${esc(b.number)}</span> ${runs(b.runs)}</p>`;
    case "signatures":
      return `<div class="sigs">${[b.left, b.right]
        .map((party) => `<div><div class="muted">${esc(party)}</div><div class="sigline"></div><div class="muted small">Name / Signature / Stamp</div></div>`)
        .join("")}</div>`;
  }
}

/**
 * An AMC document (proposal or contract) as one self-contained HTML page:
 * no external assets, so the file reads the same in ten years. `tail` is
 * HTML placed after the document (an acceptance record, an archive note).
 * Used for the signed-contract archive and the locked proposal versions.
 */
export function renderAmcDocumentHtml(title: string, model: AmcDocumentModel, tail: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 10pt; line-height: 1.4; margin: 0; }
  .banner { background: ${BRAND}; color: #fff; font-weight: 700; font-size: 13pt; padding: 6px 10px; margin: 14px 0 8px; }
  .strip, .muted { color: ${MUTED}; } .strip { font-size: 8pt; border-bottom: 1px solid ${LINE}; padding-bottom: 4px; }
  .small { font-size: 8pt; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 6px 0; }
  .label { font-weight: 700; margin: 12px 0 4px; }
  h2 { font-size: 12pt; margin: 16px 0 6px; } h3 { font-size: 10.5pt; margin: 10px 0 4px; }
  .num { color: ${BRAND}; font-weight: 700; }
  table { border-collapse: collapse; margin: 6px 0; font-size: 9.5pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  ul { margin: 4px 0 4px 18px; padding: 0; }
  .sigs { display: flex; gap: 40px; margin-top: 28px; } .sigs > div { flex: 1; }
  .sigline { height: 56px; border-bottom: 1px solid ${MUTED}; }
  .record { border: 2px solid ${BRAND}; padding: 10px 14px; margin-top: 24px; page-break-inside: avoid; }
  .record h2 { margin-top: 0; color: ${BRAND}; }
  .record table td { border: 1px solid ${LINE}; padding: 4px 8px; }
  .archive { margin-top: 16px; font-size: 8pt; color: ${MUTED}; word-break: break-all; }
</style></head>
<body>
${model.blocks.map(blockHtml).join("\n")}
${tail}
</body></html>`;
}

/**
 * The archived contract as one self-contained HTML page. The acceptance
 * record states what the signature is, and only that.
 */
export function renderSignedContractHtml(content: SignedContractContent, contentSha256: string): string {
  const s = content.signature;
  const signedAt = new Date(s.signedAt);
  const date = signedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" });
  const time = signedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Dubai" });
  return renderAmcDocumentHtml(
    `Signed AMC contract ${content.proposalNumber}`,
    content.model,
    `<section class="record">
  <h2>Electronic acceptance record</h2>
  <table style="width:100%">
    <tr><td style="width:30%"><b>Signed by</b></td><td>The client, online, through the Yalla Fix It client portal</td></tr>
    <tr><td><b>Typed name</b></td><td>${esc(s.typedName)}</td></tr>
    <tr><td><b>Signed date</b></td><td>${esc(date)}</td></tr>
    <tr><td><b>Signed time</b></td><td>${esc(time)} (UAE time, GMT+4)</td></tr>
    <tr><td><b>Contract reference</b></td><td>${esc(content.proposalNumber)}</td></tr>
  </table>
  <p class="small">${esc(s.caption)}. The client accepted this contract by typing their name on a private link sent to them. This is a record of that typed-name acceptance; it is not a cryptographic digital signature, and no handwritten or certificate-based signature was captured.</p>
</section>
<p class="archive">Archived copy of the contract as signed. Wording: ${
    content.settingsSource === "contract_settings_snapshot" ? "as sent with the contract" : "as sent with the proposal"
  }${content.contractSentAt ? ` (${esc(new Date(content.contractSentAt).toISOString())})` : ""}. Content SHA-256: ${esc(contentSha256)}</p>`,
  );
}

/* ------------------------------------------------------------------ */
/* Storage and record                                                  */
/* ------------------------------------------------------------------ */

function mapRecord(r: Row): SignedArchiveRecord {
  return {
    id: String(r.id),
    submissionId: String(r.submission_id),
    proposalNumber: String(r.proposal_number),
    signedByName: String(r.signed_by_name),
    signedAt: String(r.signed_at),
    archivedWhen: r.archived_when as SignedArchiveRecord["archivedWhen"],
    settingsSource: r.settings_source as SignedArchiveRecord["settingsSource"],
    contentSha256: String(r.content_sha256),
    storagePath: String(r.storage_path),
    contentType: r.content_type as SignedArchiveRecord["contentType"],
    byteSize: Number(r.byte_size),
    fileSha256: String(r.file_sha256),
    createdAt: String(r.created_at),
  };
}

const notMigrated = (error: { code?: string } | null | undefined) =>
  error?.code === "42P01" || error?.code === "PGRST205";

/** The archive of a submission's signed contract, or null. */
export async function signedArchiveFor(admin: Admin, submissionId: string): Promise<SignedArchiveRecord | null> {
  const { data, error } = await admin
    .from(TABLE)
    .select(ARCHIVE_COLUMNS)
    .eq("submission_id", submissionId)
    .eq("document_type", "signed_contract")
    .maybeSingle<Row>();
  if (error) {
    if (notMigrated(error)) return null;
    throw new ArchiveError(error.message, 500);
  }
  return data ? mapRecord(data) : null;
}

/** Renders the PDF, or null when this host has no browser to print with. */
export async function renderPdf(html: string): Promise<Uint8Array | null> {
  try {
    const { renderPdfFromHtml } = await import("@/lib/server/snagging/report-pdf-headless");
    const { pdf } = await renderPdfFromHtml(html);
    return pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf as ArrayBuffer);
  } catch (error) {
    console.error("AMC signed archive: PDF rendering unavailable, keeping HTML:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Archives a signed contract once. Safe to call again (and concurrently):
 * the first archive wins and is returned; nothing is ever replaced.
 */
export async function archiveSignedContract(
  admin: Admin,
  submissionId: string,
  opts: {
    when: SignedArchiveRecord["archivedWhen"];
    actor: { id: string | null; label: string | null } | null;
    /** The PDF printer; headless Chrome by default. Tests pass their own. */
    renderPdf?: (html: string) => Promise<Uint8Array | null>;
  },
): Promise<SignedArchiveRecord> {
  const existing = await signedArchiveFor(admin, submissionId);
  if (existing) return existing;

  const { data: row, error } = await admin.from("amc_submissions").select("*").eq("id", submissionId).maybeSingle<AmcSubmission>();
  if (error) throw new ArchiveError(error.message, 500);
  if (!row) throw new ArchiveError("Not found", 404);

  const content = buildSignedContractContent(row);
  const contentSha = contentHash(content);
  const html = renderSignedContractHtml(content, contentSha);
  const pdf = await (opts.renderPdf ?? renderPdf)(html);
  const file = pdf ?? new TextEncoder().encode(html);
  const contentType = pdf ? "application/pdf" : "text/html";
  const safeNumber = content.proposalNumber.replace(/[^\w-]+/g, "_") || "AMC";
  /* A unique path per attempt: a losing concurrent attempt removes its own file. */
  const path = `signed-contracts/${submissionId}/${Date.now()}-${safeNumber}-signed.${pdf ? "pdf" : "html"}`;

  const { error: uploadError } = await admin.storage
    .from(AMC_DOCUMENTS_BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (uploadError) throw new ArchiveError(`Could not store the signed contract: ${uploadError.message}`, 500);

  const { data: inserted, error: insertError } = await admin
    .from(TABLE)
    .insert({
      submission_id: submissionId,
      document_type: "signed_contract",
      proposal_number: content.proposalNumber,
      signed_by_name: content.signature.typedName,
      signed_at: content.signature.signedAt,
      archived_when: opts.when,
      settings_source: content.settingsSource,
      content,
      content_sha256: contentSha,
      storage_bucket: AMC_DOCUMENTS_BUCKET,
      storage_path: path,
      content_type: contentType,
      byte_size: file.byteLength,
      file_sha256: sha256Hex(file),
      created_by: opts.actor?.id ?? null,
    })
    .select(ARCHIVE_COLUMNS)
    .single<Row>();
  if (insertError) {
    await admin.storage.from(AMC_DOCUMENTS_BUCKET).remove([path]);
    if (insertError.code === "23505") {
      const winner = await signedArchiveFor(admin, submissionId);
      if (winner) return winner;
    }
    throw new ArchiveError(`Could not record the signed contract: ${insertError.message}`, 500);
  }
  const record = mapRecord(inserted);

  await recordAmcAudit(admin, {
    entityType: "submission",
    entityId: submissionId,
    eventType: "signed_document_archived",
    actorId: opts.actor?.id ?? null,
    actorLabel: opts.actor?.label ?? null,
    origin: opts.actor?.id ? "portal" : "system",
    payload: {
      archivedWhen: record.archivedWhen,
      contentType: record.contentType,
      byteSize: record.byteSize,
      contentSha256: record.contentSha256,
      fileSha256: record.fileSha256,
    },
  });
  return record;
}

/** A short-lived link to the archived file, for someone already authorised. */
export async function signedArchiveUrl(admin: Admin, record: SignedArchiveRecord, ttlSeconds = 300): Promise<string> {
  const ext = record.contentType === "application/pdf" ? "pdf" : "html";
  const { data, error } = await admin.storage
    .from(AMC_DOCUMENTS_BUCKET)
    .createSignedUrl(record.storagePath, ttlSeconds, {
      download: `Signed-contract-${record.proposalNumber.replace(/[^\w-]+/g, "_")}.${ext}`,
    });
  if (error || !data?.signedUrl) throw new ArchiveError(error?.message ?? "Could not open the signed contract.", 500);
  return data.signedUrl;
}

/**
 * Who may open or create the archive of a proposal's signed contract: its
 * owner and the AMC approvers, the same people who may see the proposal.
 * Archiving after the fact is an approver's or the owner's explicit action;
 * nothing archives an older signed contract on its own.
 */
export function canAccessSignedArchive(who: { userId: string; canApprove: boolean }, ownerId: string | null): boolean {
  return who.canApprove || (!!ownerId && ownerId === who.userId);
}
