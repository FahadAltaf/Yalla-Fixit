import { generateAmcPDFBlob } from "./amc-pdf-utils";
import { computeAmcData } from "./amc-pricing";
import { submissionToFormData } from "./amc-submission-mapper";
import type { AmcDocumentType, AmcFormData, AmcSubmission } from "./amc-types";

const PDF_OPTIONS = {
  scale: 2,
  imageFormat: "JPEG" as const,
  imageQuality: 0.92,
};

export function resolveViewDocumentType(
  submission: AmcSubmission,
): AmcDocumentType {
  const docs = submission.generated_documents ?? [];
  if (docs.includes("contract")) return "contract";
  if (docs.includes("proposal")) return "proposal";
  return "proposal";
}

export function getAmcPdfFilename(
  proposalNumber: string,
  documentType: AmcDocumentType,
): string {
  const safeName = proposalNumber.replace(/[\s/\\:*?"<>|]/g, "_");
  const prefix =
    documentType === "proposal" ? "AMC_Proposal" : "AMC_Contract";
  return `${prefix}_${safeName}.pdf`;
}

export async function generateAmcPdfBlobFromFormData(
  formData: AmcFormData,
  documentType: AmcDocumentType,
) {
  const pdfData = computeAmcData(formData, documentType);
  return generateAmcPDFBlob(pdfData, PDF_OPTIONS);
}

export async function downloadAmcPdf(
  formData: AmcFormData,
  documentType: AmcDocumentType,
) {
  const blob = await generateAmcPdfBlobFromFormData(formData, documentType);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = getAmcPdfFilename(formData.proposalNumber, documentType);
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function openAmcPdfInNewTab(
  formData: AmcFormData,
  documentType: AmcDocumentType,
) {
  const blob = await generateAmcPdfBlobFromFormData(formData, documentType);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function openAmcPdfFromSubmission(submission: AmcSubmission) {
  const formData = submissionToFormData(submission);
  const documentType = resolveViewDocumentType(submission);
  await openAmcPdfInNewTab(formData, documentType);
}
