"use client";

import { useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import { useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { amcSettingsService, amcSubmissionsService } from "@/modules/amc-submissions";

import { buildAmcPdfFromSubmission, savedSettingsFor } from "./amc-document-utils";
import { AmcPreviewDialog, previewTitle, submissionPreviewData } from "./amc-preview-dialog";
import { AMC_APPROVALS_CHANGED } from "./amc-approval-notice";
import { AmcSendDialog, type AmcSendRequest } from "./amc-send-dialog";
import type { AmcSettings } from "./amc-settings";
import type { AmcDocumentType, AmcSubmission } from "./amc-types";

/* The PDF as base64, for the email attachment. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the PDF."));
    reader.readAsDataURL(blob);
  });
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/* A document not sent yet renders with the current settings; a sent one
   uses the text it was sent with (FR6.4). Loaded only when needed. */
async function settingsFor(
  submission: AmcSubmission,
  documentType: AmcDocumentType,
): Promise<AmcSettings | undefined> {
  if (savedSettingsFor(submission, documentType)) return undefined;
  return (await amcSettingsService.getSettings().catch(() => null))?.settings;
}

/**
 * Everything that can be DONE to an AMC proposal: approve it, send it back
 * with a reason, email it or copy its link, download it, view it.
 *
 * The list's row menu and the proposal's own page offer the same actions,
 * and they used to live inside the list alone. They are here now so both
 * run the same code: a proposal approved from its page behaves exactly as
 * one approved from the list.
 *
 * `onChanged` runs after anything that changes the proposal on the server
 * (a decision, a send), so the caller can read it again.
 */
export function useAmcActions({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const [sendBackFor, setSendBackFor] = useState<AmcSubmission | null>(null);
  const [sendBackReason, setSendBackReason] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [viewingKey, setViewingKey] = useState<string | null>(null);
  /* Email always asks first (check the address); Copy link asks only when
     a link already exists, since a new one stops the old one working. */
  const [sendRequest, setSendRequest] = useState<AmcSendRequest | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  /* The on-screen preview: which proposal, which document, and the
     settings a not-yet-sent document is worded with. */
  const [preview, setPreview] = useState<{
    submission: AmcSubmission;
    documentType: AmcDocumentType;
    settings?: AmcSettings;
  } | null>(null);

  /*
    FR5.2 — approve, or send back with a reason. The caller re-reads rather
    than patching in place: a decision changes which proposals the caller
    can see at all (FR3.2).
  */
  const decide = async (
    submission: AmcSubmission,
    action: "approve" | "send_back",
    reason?: string,
  ) => {
    /* Send back already asks, in its own dialog with the reason. */
    if (
      action === "approve" &&
      !(await confirm({
        title: "Approve this proposal?",
        description: `${submission.customer.customerName || "This proposal"}${submission.customer.proposalNumber ? ` (${submission.customer.proposalNumber})` : ""} will be approved and can then be sent to the client. It can't be edited after this.`,
        confirmText: "Approve",
      }))
    ) {
      return;
    }
    setDeciding(true);
    try {
      await amcSubmissionsService.decide(
        action === "approve"
          ? { action: "approve", id: submission.id }
          : { action: "send_back", id: submission.id, reason: reason ?? "" },
      );
      toast.success(
        action === "approve"
          ? "Approved. You can now send it to the client."
          : "Sent back to the owner with your note.",
      );
      setSendBackFor(null);
      setSendBackReason("");
      window.dispatchEvent(new Event(AMC_APPROVALS_CHANGED));
      await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(
        getErrorMessage(
          error,
          action === "approve"
            ? "Couldn't approve this proposal."
            : "Couldn't send this proposal back.",
        ),
      );
    } finally {
      setDeciding(false);
    }
  };

  /*
    FR5.4 / FR5.6 — send the document, or take the link to send over
    WhatsApp. Both mint a token and advance the status; only the delivery
    differs.
  */
  const send = async (
    submission: AmcSubmission,
    document: "proposal" | "contract",
    deliver: "email" | "link",
    to?: string,
  ) => {
    setSendingId(submission.id);
    const label = document === "proposal" ? "proposal" : "contract";
    /* One toast from start to finish: building the link or sending the
       email takes a moment, and a click with no feedback gets repeated. */
    const toastId = toast.loading(
      deliver === "link" ? `Creating the ${label} link…` : `Emailing the ${label} to the client…`,
    );
    try {
      /* Email carries the PDF, built with the text it will be sent with. */
      let pdf: { pdf_base64: string; pdf_filename: string } | undefined;
      if (deliver === "email") {
        toast.loading(`Preparing the ${label} PDF…`, { id: toastId });
        const built = await buildAmcPdfFromSubmission(
          submission,
          document,
          await settingsFor(submission, document),
        );
        pdf = { pdf_base64: await blobToBase64(built.blob), pdf_filename: built.filename };
        toast.loading(`Emailing the ${label} to the client…`, { id: toastId });
      }
      const result = await amcSubmissionsService.send({
        id: submission.id,
        document,
        deliver,
        to,
        ...pdf,
      });
      setSendRequest(null);

      if (deliver === "link") {
        await navigator.clipboard.writeText(result.link).catch(() => {
          /* Clipboard access can be refused; the link still has to reach
             the person, so it is shown rather than silently lost. */
          window.prompt("Copy this link and send it to the client:", result.link);
        });
        toast.success("Link copied. Paste it into WhatsApp or an email to send it.", {
          id: toastId,
        });
      } else if (result.warning) {
        toast.warning(result.warning, { id: toastId });
      } else {
        toast.success(
          document === "proposal"
            ? "Proposal emailed to the client."
            : "Contract emailed to the client.",
          { id: toastId },
        );
      }
      await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(getErrorMessage(error, "Couldn't send this document."), { id: toastId });
    } finally {
      setSendingId(null);
    }
  };

  /* A proposal or contract as PDF or Word, with a toast while it builds. */
  const download = async (
    submission: AmcSubmission,
    documentType: AmcDocumentType,
    fileFormat: "pdf" | "docx",
  ) => {
    const label = documentType === "proposal" ? "proposal" : "contract";
    setDownloadingId(submission.id);
    const toastId = toast.loading(
      `Preparing the ${label} (${fileFormat === "pdf" ? "PDF" : "Word"})…`,
    );
    try {
      const { blob, filename } = await buildAmcPdfFromSubmission(
        submission,
        documentType,
        await settingsFor(submission, documentType),
        fileFormat,
      );
      saveAs(blob, filename);
      toast.success(`Downloaded ${filename}`, { id: toastId });
    } catch (error) {
      console.error(error);
      toast.error(getErrorMessage(error, `Couldn't download the ${label}.`), { id: toastId });
    } finally {
      setDownloadingId(null);
    }
  };

  /*
    The document, on screen, in the preview popup -- not a PDF. It opens at
    once; the PDF and Word files are in its Download menu. A document not
    sent yet needs today's AMC Settings for its wording, loaded first.
  */
  const view = async (submission: AmcSubmission, documentType: AmcDocumentType) => {
    setViewingKey(`${submission.id}:${documentType}`);
    try {
      const needsLive =
        !savedSettingsFor(submission, "proposal") || !savedSettingsFor(submission, "contract");
      const settings = needsLive
        ? (await amcSettingsService.getSettings().catch(() => null))?.settings
        : undefined;
      setPreview({ submission, documentType, settings });
    } finally {
      setViewingKey(null);
    }
  };

  const closeSendBack = () => {
    setSendBackFor(null);
    setSendBackReason("");
  };

  /* Every dialog the actions can open, rendered once by the caller. */
  const dialogs = (
    <>
      {confirmDialog}
      {preview ? (
        <AmcPreviewDialog
          open
          onOpenChange={(open) => !open && setPreview(null)}
          title={previewTitle(preview.submission)}
          documentType={preview.documentType}
          onDocumentTypeChange={(documentType) =>
            setPreview((current) => (current ? { ...current, documentType } : current))
          }
          data={submissionPreviewData(preview.submission, preview.settings)}
          downloading={downloadingId === preview.submission.id}
          onDownload={(documentType, format) =>
            void download(preview.submission, documentType, format)
          }
        />
      ) : null}
      <AmcSendDialog
        key={
          sendRequest
            ? `${sendRequest.submission.id}:${sendRequest.document}:${sendRequest.deliver}`
            : "closed"
        }
        request={sendRequest}
        pending={Boolean(sendRequest) && sendingId === sendRequest?.submission.id}
        onCancel={() => setSendRequest(null)}
        onConfirm={(request, to) =>
          void send(request.submission, request.document, request.deliver, to)
        }
      />
      <Dialog open={Boolean(sendBackFor)} onOpenChange={(open) => !open && closeSendBack()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send back for changes</DialogTitle>
            <DialogDescription>
              The owner sees your note on their submission, makes the changes and resubmits.
              Nothing goes to the client.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="amc-send-back-reason">What needs changing?</Label>
            <Textarea
              id="amc-send-back-reason"
              rows={4}
              value={sendBackReason}
              onChange={(event) => setSendBackReason(event.target.value)}
              placeholder="e.g. The AC PPM frequency should be 4 visits, not 2."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeSendBack} disabled={deciding}>
              Cancel
            </Button>
            {/* FR5.2 requires a reason, so the action stays disabled until
                there is one rather than failing on the server. */}
            <Button
              onClick={() =>
                sendBackFor && void decide(sendBackFor, "send_back", sendBackReason.trim())
              }
              disabled={deciding || sendBackReason.trim().length === 0}
            >
              {deciding ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return {
    dialogs,
    approve: (submission: AmcSubmission) => void decide(submission, "approve"),
    sendBack: (submission: AmcSubmission) => setSendBackFor(submission),
    requestSend: (
      submission: AmcSubmission,
      document: "proposal" | "contract",
      deliver: "email" | "link",
    ) => setSendRequest({ submission, document, deliver }),
    download: (submission: AmcSubmission, documentType: AmcDocumentType, format: "pdf" | "docx") =>
      void download(submission, documentType, format),
    view: (submission: AmcSubmission, documentType: AmcDocumentType) =>
      void view(submission, documentType),
    deciding,
    sendingId,
    downloadingId,
    viewingKey,
  };
}
