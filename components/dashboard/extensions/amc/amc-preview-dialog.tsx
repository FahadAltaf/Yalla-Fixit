"use client";

import { ChevronDown, Download, FileText, FileType, Loader2 } from "lucide-react";

import { PillTabs } from "@/components/dashboard/shared/kaizen";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { submissionToFormData } from "./amc-submission-mapper";
import { savedSettingsFor } from "./amc-document-utils";
import { computeAmcData } from "./amc-pricing";
import { getAmcSettingsDefaults, resolveAmcSettings, type AmcSettings } from "./amc-settings";
import type { AmcComputedData, AmcDocumentType, AmcSubmission } from "./amc-types";
import { AmcDocumentSheet } from "./templates/AmcDocumentSheet";

/**
 * The proposal or the contract, on screen, in a popup.
 *
 * The same sheet the Review step used to show inline -- the on-screen twin
 * of the PDF, built from the same document model -- so it opens at once
 * instead of waiting for a PDF to be laid out page by page. It is the one
 * preview the portal uses: from the Review step, the proposal list and a
 * proposal's own page. The PDF and Word files are one click away in
 * Download.
 */
export function AmcPreviewDialog({
  open,
  onOpenChange,
  title,
  documentType,
  onDocumentTypeChange,
  data,
  onDownload,
  downloading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names what is open: the customer, and the proposal number if it has one. */
  title: string;
  documentType: AmcDocumentType;
  onDocumentTypeChange: (documentType: AmcDocumentType) => void;
  data: Record<AmcDocumentType, AmcComputedData>;
  onDownload?: (documentType: AmcDocumentType, format: "pdf" | "docx") => void;
  downloading?: boolean;
}) {
  const label = documentType === "proposal" ? "proposal" : "contract";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="gap-3 border-b px-6 pt-5 pb-4 text-left">
          <div className="pr-8">
            <DialogTitle className="text-lg">{title}</DialogTitle>
            <DialogDescription>
              Exactly what the client receives. Switch between the proposal and the contract.
            </DialogDescription>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PillTabs<AmcDocumentType>
              value={documentType}
              onChange={onDocumentTypeChange}
              tabs={[
                { value: "proposal", label: "Proposal" },
                { value: "contract", label: "Contract" },
              ]}
            />
            {onDownload ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" disabled={downloading}>
                    {downloading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    Download {label}
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onDownload(documentType, "pdf")}>
                    <FileText className="size-4" />
                    PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDownload(documentType, "docx")}>
                    <FileType className="size-4" />
                    Word (.docx)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </DialogHeader>

        <div className="bg-muted/50 min-h-0 flex-1 overflow-auto">
          <div className="flex items-start justify-center p-6">
            <div className="overflow-hidden rounded bg-white shadow-lg ring-1 ring-black/5">
              <AmcDocumentSheet data={data[documentType]} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Both documents for a saved proposal, with the wording each would be
 * printed with (FR6.4): a document already sent uses the text it was sent
 * with; one not sent yet uses today's AMC Settings -- the same rule the
 * PDF follows, so the preview and the download never disagree.
 */
export function submissionPreviewData(
  submission: AmcSubmission,
  liveSettings?: AmcSettings,
): Record<AmcDocumentType, AmcComputedData> {
  const form = submissionToFormData(submission);
  const build = (type: AmcDocumentType) =>
    computeAmcData(
      form,
      type,
      resolveAmcSettings(liveSettings ?? getAmcSettingsDefaults(), savedSettingsFor(submission, type)),
      type === "contract" ? submission.contract_sent_at : submission.proposal_sent_at,
    );
  return { proposal: build("proposal"), contract: build("contract") };
}

/** A popup title that says which proposal is open. */
export function previewTitle(submission: Pick<AmcSubmission, "customer">): string {
  return [submission.customer.customerName || "Unnamed customer", submission.customer.proposalNumber]
    .filter(Boolean)
    .join(" · ");
}
