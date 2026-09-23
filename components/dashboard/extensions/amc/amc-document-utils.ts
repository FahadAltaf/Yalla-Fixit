import { generateAmcPDFBlob, type AmcBuildProgress } from "./amc-pdf-utils";
import { computeAmcData } from "./amc-pricing";
import { submissionToFormData } from "./amc-submission-mapper";
import type {
  AmcComputedData,
  AmcDocumentSource,
  AmcDocumentType,
  AmcFormData,
  AmcSubmission,
} from "./amc-types";
import {
  getAmcSettingsDefaults,
  resolveAmcSettings,
  type AmcSettings,
} from "./amc-settings";

/* About 150 dpi JPEG: crisp, and small enough to attach to an email. */
const PDF_OPTIONS = {
  scale: 1.6,
  imageFormat: "JPEG" as const,
  imageQuality: 0.82,
};

/* Every document can be had as a PDF or as an editable Word file. Both
   are drawn from the same document model, so they always match. */
export type AmcFileFormat = "pdf" | "docx";

export type BuiltAmcFile = { blob: Blob; filename: string };

export function resolveViewDocumentType(
  submission: AmcSubmission,
): AmcDocumentType {
  const docs = submission.generated_documents ?? [];
  if (docs.includes("contract")) return "contract";
  if (docs.includes("proposal")) return "proposal";
  return "proposal";
}

export function getAmcFilename(
  proposalNumber: string,
  documentType: AmcDocumentType,
  format: AmcFileFormat = "pdf",
): string {
  const safeName = (proposalNumber || "Draft").replace(/[\s/\\:*?"<>|]/g, "_");
  const prefix = documentType === "proposal" ? "AMC_Proposal" : "AMC_Contract";
  return `${prefix}_${safeName}.${format}`;
}

/* The Word writer is only loaded when someone asks for a Word file. */
async function renderAmcFile(
  data: AmcComputedData,
  format: AmcFileFormat,
  onProgress?: (progress: AmcBuildProgress) => void,
): Promise<BuiltAmcFile> {
  const blob =
    format === "docx"
      ? await (await import("./amc-docx")).generateAmcDocxBlob(data)
      : await generateAmcPDFBlob(data, { ...PDF_OPTIONS, onProgress });
  return {
    blob,
    filename: getAmcFilename(
      data.formData.proposalNumber,
      data.documentType,
      format,
    ),
  };
}

/*
  Building a document, separate from showing it: the preview popup
  (amc-preview-dialog.tsx) shows it on screen; these only build the PDF or
  Word file and say what to call it.
*/
export async function buildAmcPdf(
  formData: AmcFormData,
  documentType: AmcDocumentType,
  settings?: AmcSettings,
  documentDate?: string | null,
  format: AmcFileFormat = "pdf",
  onProgress?: (progress: AmcBuildProgress) => void,
): Promise<BuiltAmcFile> {
  return renderAmcFile(
    computeAmcData(formData, documentType, settings, documentDate),
    format,
    onProgress,
  );
}

/**
 * FR6.4: the AMC Settings a document was sent with, or null when it has
 * not been sent yet and should show the current settings.
 *
 * Each document keeps the text of the moment it went out: the proposal
 * its copy from the proposal send, the contract its own copy from the
 * contract send. Contracts sent before the contract had its own copy went
 * out with the proposal's, so they fall back to it.
 */
export function savedSettingsFor(
  submission: Pick<
    AmcSubmission,
    "status" | "settings_snapshot" | "contract_settings_snapshot"
  >,
  documentType: AmcDocumentType,
): AmcSettings | null {
  if (documentType === "proposal") return submission.settings_snapshot ?? null;
  if (submission.contract_settings_snapshot)
    return submission.contract_settings_snapshot;
  return submission.status === "contract_sent" || submission.status === "signed"
    ? (submission.settings_snapshot ?? null)
    : null;
}

/*
  Built files, kept for the session. Viewing a proposal and then
  downloading or emailing it would otherwise build the same PDF two or
  three times. The key covers everything that changes the output: the
  submission's last update, the document, the format and the settings.
*/
const BUILT_CACHE = new Map<string, Promise<BuiltAmcFile>>();
const BUILT_CACHE_LIMIT = 8;

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export async function buildAmcPdfFromSubmission(
  submission: AmcSubmission,
  documentType?: AmcDocumentType,
  /* Live settings, for a submission that has not been sent yet. */
  liveSettings?: AmcSettings,
  format: AmcFileFormat = "pdf",
): Promise<BuiltAmcFile> {
  const type = documentType ?? resolveViewDocumentType(submission);
  const key = [
    submission.id,
    submission.updated_at,
    type,
    format,
    hashText(
      JSON.stringify([
        liveSettings ?? null,
        savedSettingsFor(submission, type),
      ]),
    ),
  ].join("|");

  const cached = BUILT_CACHE.get(key);
  if (cached) return cached;

  const build = buildUncached(submission, type, liveSettings, format);
  BUILT_CACHE.set(key, build);
  /* A failed build is not kept, so Try again really tries again. */
  build.catch(() => BUILT_CACHE.delete(key));
  while (BUILT_CACHE.size > BUILT_CACHE_LIMIT) {
    BUILT_CACHE.delete(BUILT_CACHE.keys().next().value as string);
  }
  return build;
}

function buildUncached(
  submission: AmcSubmission,
  type: AmcDocumentType,
  liveSettings: AmcSettings | undefined,
  format: AmcFileFormat,
): Promise<BuiltAmcFile> {
  return buildAmcPdf(
    submissionToFormData(submission),
    type,
    /* FR6.4: sent, the text it was sent with. Not sent yet, the current
       settings, so the view shows what the client will receive. */
    resolveAmcSettings(
      liveSettings ?? getAmcSettingsDefaults(),
      savedSettingsFor(submission, type),
    ),
    type === "contract"
      ? submission.contract_sent_at
      : submission.proposal_sent_at,
    format,
  );
}

/**
 * What the client link (FR5.5, FR5.7) receives to rebuild the document.
 */
export type AmcClientDocument = {
  source: AmcDocumentSource;
  documentType: AmcDocumentType;
  settings: AmcSettings | null;
  sentAt: string | null;
};

/**
 * Render data for the client link. The same computation the dashboard
 * uses, so the client reads exactly the document the team previewed and
 * sent: the frozen settings (FR6.4) and the date it went out.
 */
export function computeAmcClientData(
  input: AmcClientDocument,
): AmcComputedData {
  return computeAmcData(
    submissionToFormData(input.source),
    input.documentType,
    resolveAmcSettings(getAmcSettingsDefaults(), input.settings),
    input.sentAt,
  );
}

/** Download on the client link, as PDF or Word. */
export async function buildAmcPdfForClient(
  input: AmcClientDocument,
  format: AmcFileFormat = "pdf",
): Promise<BuiltAmcFile> {
  return renderAmcFile(computeAmcClientData(input), format);
}
