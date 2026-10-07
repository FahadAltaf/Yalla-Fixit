"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Link as LinkIcon, MessageCircle, Plus, Send, TriangleAlert } from "lucide-react";

import { SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ActionDialogContent } from "@/components/dashboard/shared/kaizen-states";
import { defaultShareChannel, whatsappNumber } from "@/lib/amc/approval-ladder";

import type { AmcSubmission } from "./amc-types";

export type AmcSendDeliver = "email" | "link" | "whatsapp";

export type AmcSendRequest = {
  submission: AmcSubmission;
  document: "proposal" | "contract";
  deliver: AmcSendDeliver;
};

/** What the dialog confirms: the channel, and for a proposal its contacts. */
export interface AmcSendChoice {
  deliver: AmcSendDeliver;
  /** Contract email: the one address (as before). */
  to?: string;
  /** Proposal (Phase 5): the contacts it goes to, and whether the owner is copied. */
  recipients?: Array<{ name: string; address: string }>;
  ccOwner?: boolean;
}

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

/** The channel a proposal is shared on by default: WhatsApp for residential, email for commercial (BRD 5.6). */
export function shareChannelFor(submission: AmcSubmission): "email" | "whatsapp" {
  return defaultShareChannel(submission.property.propertyCategory);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Option = { key: string; name: string; address: string; checked: boolean };

/** The proposal's own contacts that can receive it on this channel. */
function contactOptions(submission: AmcSubmission, channel: "email" | "whatsapp"): Option[] {
  const c = submission.customer;
  const people =
    channel === "email"
      ? [{ name: c.customerName, address: c.customerEmail }]
      : [
          { name: c.customerName, address: c.customerPhone },
          ...c.coordinationContacts.map((p) => ({ name: p.name, address: p.phone })),
        ];
  const seen = new Set<string>();
  return people
    .filter((p) => p.address?.trim())
    .filter((p) => (channel === "email" ? EMAIL_PATTERN.test(p.address.trim()) : !!whatsappNumber(p.address)))
    .filter((p) => {
      const key = channel === "email" ? p.address.trim().toLowerCase() : whatsappNumber(p.address)!;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p, i) => ({ key: `${channel}-${i}`, name: p.name?.trim() || "", address: p.address.trim(), checked: i === 0 }));
}

/**
 * Sending a proposal or contract, the way snagging sends a quotation:
 * check the address before the email goes, and say so plainly when a new
 * link will stop the one the client already has from working.
 *
 * A proposal (BRD 5.6, Phase 5) is shared by email (Email 1, to one or more
 * contacts, the owner in copy), by WhatsApp (the message is prepared with
 * the link to send from WhatsApp) or as a link; WhatsApp is the default for
 * residential, email for commercial. A contract is emailed or linked as
 * before.
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
  onConfirm: (request: AmcSendRequest, choice: AmcSendChoice) => void;
}) {
  const isProposal = request?.document === "proposal";
  /* The channel asked for; "Share" asks for the category's default (shareChannelFor). */
  const [deliver, setDeliver] = useState<AmcSendDeliver>(() => request?.deliver ?? "email");
  /* Keyed by the request in the list, so each send starts from the
     customer email saved on the proposal. */
  const [recipient, setRecipient] = useState(
    () => request?.submission.customer.customerEmail?.trim() ?? "",
  );
  const [options, setOptions] = useState<Record<"email" | "whatsapp", Option[]>>(() => ({
    email: request ? contactOptions(request.submission, "email") : [],
    whatsapp: request ? contactOptions(request.submission, "whatsapp") : [],
  }));
  const [extra, setExtra] = useState("");
  const [ccOwner, setCcOwner] = useState(true);

  const label = request?.document === "contract" ? "contract" : "proposal";
  const sentAt = request ? lastSentAt(request.submission, request.document) : null;
  const customer = request?.submission.customer.customerName?.trim() || "the client";
  const channel = deliver === "email" || deliver === "whatsapp" ? deliver : null;
  const chosen = channel ? options[channel].filter((o) => o.checked) : [];
  const extraValid =
    channel === "email" ? EMAIL_PATTERN.test(extra.trim()) : channel === "whatsapp" ? !!whatsappNumber(extra) : false;
  const contractEmailValid = EMAIL_PATTERN.test(recipient.trim());
  const ready = isProposal ? deliver === "link" || chosen.length > 0 : deliver !== "email" || contractEmailValid;

  const addExtra = () => {
    if (!channel || !extraValid) return;
    setOptions((all) => ({
      ...all,
      [channel]: [...all[channel], { key: `${channel}-x${all[channel].length}`, name: "", address: extra.trim(), checked: true }],
    }));
    setExtra("");
  };

  const confirm = () => {
    if (!request) return;
    if (isProposal) {
      onConfirm(request, {
        deliver,
        recipients: chosen.map((o) => ({ name: o.name, address: o.address })),
        ccOwner,
      });
    } else {
      onConfirm(request, { deliver, to: deliver === "email" ? recipient.trim() : undefined });
    }
  };

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <ActionDialogContent busy={pending} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isProposal
              ? sentAt
                ? "Share the proposal again"
                : "Share the proposal"
              : deliver === "email"
                ? sentAt
                  ? `Email the ${label} again?`
                  : `Email the ${label} to the client`
                : sentAt
                  ? `Get a new ${label} link?`
                  : `Get the ${label} link?`}
          </DialogTitle>
          <DialogDescription>
            {isProposal
              ? deliver === "email"
                ? `Emails ${customer} the proposal (Email 1) with a secure link to approve it, reject it or ask for a change, and the PDF attached.`
                : deliver === "whatsapp"
                  ? "Prepares the WhatsApp message with a secure link; you send it from WhatsApp. The proposal is marked as shared."
                  : `Creates a secure link for ${customer} and copies it. The proposal is marked as shared.`
              : deliver === "email"
                ? `Emails ${customer} a secure link to review and sign the contract, with the contract attached as a PDF.`
                : sentAt
                  ? "Copies a new link to paste into WhatsApp or an email."
                  : `Creates a secure link for ${customer} and copies it, ready to paste into WhatsApp or an email. The ${label} is marked as sent.`}
          </DialogDescription>
        </DialogHeader>

        {isProposal ? (
          <div className="bg-muted inline-flex w-fit rounded-full p-0.5 text-sm" role="tablist" aria-label="Channel">
            {(["whatsapp", "email", "link"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={deliver === c}
                onClick={() => setDeliver(c)}
                className={`rounded-full px-3 py-1 ${deliver === c ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              >
                {c === "whatsapp" ? "WhatsApp" : c === "email" ? "Email" : "Link only"}
              </button>
            ))}
          </div>
        ) : null}

        {isProposal && channel ? (
          <div className="grid gap-2">
            <Label>{channel === "email" ? "Send to" : "Prepare for"}</Label>
            {options[channel].length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No {channel === "email" ? "email address" : "mobile number"} on the proposal. Add one below.
              </p>
            ) : (
              <ul className="divide-y rounded-md border text-sm">
                {options[channel].map((o) => (
                  <li key={o.key}>
                    <label className="flex items-center gap-2 px-3 py-2">
                      <Checkbox
                        checked={o.checked}
                        onCheckedChange={(checked) =>
                          setOptions((all) => ({
                            ...all,
                            [channel]: all[channel].map((x) => (x.key === o.key ? { ...x, checked: checked === true } : x)),
                          }))
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {o.name ? <span className="font-medium">{o.name} · </span> : null}
                        {o.address}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input
                value={extra}
                onChange={(event) => setExtra(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && addExtra()}
                placeholder={channel === "email" ? "another@email.com" : "050 123 4567"}
                aria-label={channel === "email" ? "Another email address" : "Another mobile number"}
              />
              <Button type="button" variant="outline" onClick={addExtra} disabled={!extraValid}>
                <Plus className="size-4" />
                Add
              </Button>
            </div>
            {channel === "email" ? (
              <label className="text-muted-foreground flex items-center gap-2 text-xs">
                <Switch checked={ccOwner} onCheckedChange={setCcOwner} aria-label="Copy me" />
                Copy me (the coordinator)
              </label>
            ) : null}
          </div>
        ) : null}

        {!isProposal && deliver === "email" ? (
          <div className="grid gap-2">
            <Label htmlFor="amc-send-recipient">Client email</Label>
            <Input
              id="amc-send-recipient"
              type="email"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="client@email.com"
              aria-invalid={recipient.trim().length > 0 && !contractEmailValid}
              autoFocus
            />
            <p className="text-muted-foreground text-xs">
              Check the address before sending. Changing it here sends to this
              address only; the proposal keeps the email it was saved with.
            </p>
            {recipient.trim().length > 0 && !contractEmailValid ? (
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
              Sharing again creates a new link, and the one the client already
              has stops working. Make sure they use the new one.
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <SubmitButton
            onClick={confirm}
            disabled={!ready}
            pending={pending}
            pendingLabel={deliver === "email" ? "Sending…" : "Preparing…"}
            icon={
              deliver === "email" ? (
                <Send className="size-4" />
              ) : deliver === "whatsapp" ? (
                <MessageCircle className="size-4" />
              ) : (
                <LinkIcon className="size-4" />
              )
            }
          >
            {deliver === "email"
              ? sentAt
                ? `Send ${label} again`
                : `Send ${label}`
              : deliver === "whatsapp"
                ? "Prepare WhatsApp message"
                : sentAt
                  ? "Get new link"
                  : "Create and copy link"}
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
