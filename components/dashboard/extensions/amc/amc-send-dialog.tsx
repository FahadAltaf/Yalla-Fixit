"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Link as LinkIcon, Send, TriangleAlert } from "lucide-react";

import { SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { AmcSubmission } from "./amc-types";

export type AmcSendRequest = {
  submission: AmcSubmission;
  document: "proposal" | "contract";
  deliver: "email" | "link";
};

/* The document that can go to the client now, if any: the proposal once
   approved (or again once sent), the contract once the client approved
   the proposal (or again once sent). */
export function sendableDocument(
  submission: AmcSubmission,
): "proposal" | "contract" | null {
  if (submission.status === "approved" || submission.status === "proposal_sent")
    return "proposal";
  if (
    submission.status === "proposal_approved" ||
    submission.status === "contract_sent"
  )
    return "contract";
  return null;
}

/* When this document last went to the client, if it has. */
export function lastSentAt(
  submission: AmcSubmission,
  document: "proposal" | "contract",
): string | null {
  const sent =
    document === "proposal"
      ? submission.status === "proposal_sent"
      : submission.status === "contract_sent";
  if (!sent) return null;
  return (
    (document === "proposal"
      ? submission.proposal_sent_at
      : submission.contract_sent_at) ?? submission.updated_at
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sending a proposal or contract, the way snagging sends a quotation:
 * check the address before the email goes, and say so plainly when a new
 * link will stop the one the client already has from working.
 *
 * Every send asks first: email to check the address, a link because
 * creating one marks the document as sent.
 */
export function AmcSendDialog({
  request,
  pending,
  onCancel,
  onConfirm,
}: {
  request: AmcSendRequest | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (request: AmcSendRequest, to?: string) => void;
}) {
  /* Keyed by the request in the list, so each send starts from the
     customer email saved on the proposal. */
  const [recipient, setRecipient] = useState(
    () => request?.submission.customer.customerEmail?.trim() ?? "",
  );

  const label = request?.document === "contract" ? "contract" : "proposal";
  const sentAt = request
    ? lastSentAt(request.submission, request.document)
    : null;
  const isEmail = request?.deliver === "email";
  const emailValid = EMAIL_PATTERN.test(recipient.trim());
  const customer =
    request?.submission.customer.customerName?.trim() || "the client";

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEmail
              ? sentAt
                ? `Email the ${label} again?`
                : `Email the ${label} to the client`
              : sentAt
                ? `Get a new ${label} link?`
                : `Get the ${label} link?`}
          </DialogTitle>
          <DialogDescription>
            {isEmail
              ? label === "proposal"
                ? `Emails ${customer} a secure link to review the proposal and approve it or ask for changes, with the proposal attached as a PDF.`
                : `Emails ${customer} a secure link to review and sign the contract, with the contract attached as a PDF.`
              : sentAt
                ? "Copies a new link to paste into WhatsApp or an email."
                : `Creates a secure link for ${customer} and copies it, ready to paste into WhatsApp or an email. The ${label} is marked as sent.`}
          </DialogDescription>
        </DialogHeader>

        {isEmail ? (
          <div className="grid gap-2">
            <Label htmlFor="amc-send-recipient">Client email</Label>
            <Input
              id="amc-send-recipient"
              type="email"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="client@email.com"
              aria-invalid={recipient.trim().length > 0 && !emailValid}
              autoFocus
            />
            <p className="text-muted-foreground text-xs">
              Check the address before sending. Changing it here sends to this
              address only; the proposal keeps the email it was saved with.
            </p>
            {recipient.trim().length > 0 && !emailValid ? (
              <p className="text-destructive text-xs">
                Enter a valid email address.
              </p>
            ) : null}
          </div>
        ) : null}

        {sentAt ? (
          <Alert className="border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <TriangleAlert className="size-4" />
            <AlertTitle>
              A link was already sent on{" "}
              {format(new Date(sentAt), "d MMM yyyy, HH:mm")}
            </AlertTitle>
            <AlertDescription className="text-current/80">
              {isEmail ? "Sending again" : "Getting a new link"} creates a new
              link, and the one the client already has stops working. Make sure
              they use the new one.
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <SubmitButton
            onClick={() =>
              request &&
              onConfirm(request, isEmail ? recipient.trim() : undefined)
            }
            disabled={isEmail && !emailValid}
            pending={pending}
            pendingLabel={isEmail ? "Sending…" : "Creating…"}
            icon={
              isEmail ? (
                <Send className="size-4" />
              ) : (
                <LinkIcon className="size-4" />
              )
            }
          >
            {isEmail
              ? sentAt
                ? `Send ${label} again`
                : `Send ${label}`
              : sentAt
                ? "Get new link"
                : "Create and copy link"}
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
