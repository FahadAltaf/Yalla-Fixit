"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  Download,
  FileType,
  EyeIcon,
  FileText,
  Hash,
  History,
  Loader2,
  PencilIcon,
  Phone,
  Link as LinkIcon,
  Mail,
  Send,
  Undo2,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrencyAED } from "@/utils/format-currency";
import { amcSubmissionsService } from "@/modules/amc-submissions";

import {
  computeAmcData,
  formatDesignationLabel,
  formatDisplayDate,
  formatPaymentTermsLabel,
} from "./amc-pricing";
import { formatPhoneForDocument } from "./amc-phone";
import { lastSentAt, sendableDocument } from "./amc-send-dialog";
import { amcStatusTone } from "./amc-status";
import { submissionToFormData } from "./amc-submission-mapper";
import {
  AMC_STATUS_LABELS,
  isAmcSubmissionEditable,
  type AmcDocumentType,
  type AmcHistoryEvent,
  type AmcSubmission,
} from "./amc-types";

/**
 * A submission, read-only, in a popup: everything the team entered and everything
 * that has happened to it since.
 *
 * Once a submission is sent for review it can no longer be edited (FR3.4),
 * which used to leave its details reachable only by opening the proposal
 * or contract PDF. This is the place to check them — the customer, the
 * services and prices, and the history: who approved it, when it went to
 * the client, what the client answered.
 */

type Step = {
  label: string;
  at: string;
  note?: string | null;
  tone?: "good" | "bad";
};

function formatWhen(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : format(date, "d MMM yyyy, HH:mm");
}

/*
  The full history, from the audit trail: every round of approval, every
  send and every client answer, with who did it. The submission row only
  keeps the latest date of each kind, so it is the fallback.
*/
function buildTimelineFromEvents(
  s: AmcSubmission,
  events: AmcHistoryEvent[],
): Step[] {
  const steps: Step[] = [{ label: "Created", at: s.created_at }];
  const by = (event: AmcHistoryEvent) =>
    event.actor ? ` by ${event.actor}` : "";

  for (const event of events) {
    const payload = event.payload ?? {};
    const resend = payload.resend === true;
    const viaLink = payload.deliver === "link";
    const to = typeof payload.to === "string" ? payload.to : null;

    switch (event.type) {
      case "submitted_for_approval":
        steps.push({
          label: `Submitted for approval${by(event)}`,
          at: event.at,
        });
        break;
      case "resubmitted_after_client_changes":
        steps.push({
          label: `Resubmitted for approval with the client's changes${by(event)}`,
          at: event.at,
        });
        break;
      case "approved":
        steps.push({
          label: `Approved internally${by(event)}`,
          at: event.at,
          tone: "good",
        });
        break;
      case "sent_back":
        steps.push({
          label: `Sent back${by(event)}`,
          at: event.at,
          note: event.note,
          tone: "bad",
        });
        break;
      case "proposal_sent":
      case "contract_sent": {
        const doc = event.type === "proposal_sent" ? "Proposal" : "Contract";
        steps.push({
          label: viaLink
            ? `${doc} link ${resend ? "created again" : "created"}${by(event)}`
            : `${doc} ${resend ? "emailed again" : "emailed to the client"}${by(event)}`,
          at: event.at,
          note: !viaLink && to ? `To ${to}` : null,
        });
        break;
      }
      case "proposal_approved_by_client":
        steps.push({
          label: `${event.actor || "The client"} approved the proposal`,
          at: event.at,
          tone: "good",
        });
        break;
      case "proposal_rejected_by_client":
        steps.push({
          label: `${event.actor || "The client"} asked for changes`,
          at: event.at,
          note: event.note,
          tone: "bad",
        });
        break;
      case "contract_signed":
        steps.push({
          label: `Contract signed${event.actor ? ` by ${event.actor}` : ""}`,
          at: event.at,
          tone: "good",
        });
        break;
      default:
        steps.push({
          label: event.type
            .replace(/_/g, " ")
            .replace(/^./, (c) => c.toUpperCase()),
          at: event.at,
          note: event.note,
        });
    }
  }
  return steps.sort((a, b) => a.at.localeCompare(b.at));
}

/* The history, from the dates the submission carries, oldest first. */
function buildTimeline(s: AmcSubmission): Step[] {
  const steps: Step[] = [{ label: "Created", at: s.created_at }];
  if (s.submitted_at)
    steps.push({ label: "Submitted for approval", at: s.submitted_at });
  if (s.decided_at) {
    /* decided_at is the latest decision. It was a send-back if the
       submission is back with its owner, or was resubmitted after it. */
    const sentBack =
      s.status === "sent_back" ||
      (s.status === "awaiting_approval" &&
        Boolean(s.submitted_at) &&
        s.decided_at < (s.submitted_at ?? ""));
    steps.push(
      sentBack
        ? {
            label: "Sent back",
            at: s.decided_at,
            note: s.sent_back_reason,
            tone: "bad",
          }
        : { label: "Approved internally", at: s.decided_at, tone: "good" },
    );
  }
  if (s.proposal_sent_at)
    steps.push({ label: "Proposal sent to client", at: s.proposal_sent_at });
  if (s.client_decided_at) {
    steps.push(
      s.client_decision === "rejected"
        ? {
            label: `${s.client_decided_by_name || "The client"} asked for changes`,
            at: s.client_decided_at,
            note: s.client_rejected_reason,
            tone: "bad",
          }
        : {
            label: `${s.client_decided_by_name || "The client"} approved the proposal`,
            at: s.client_decided_at,
            tone: "good",
          },
    );
  }
  if (s.contract_sent_at)
    steps.push({ label: "Contract sent to client", at: s.contract_sent_at });
  if (s.signed_at) {
    steps.push({
      label: `Contract signed${s.signed_by_name ? ` by ${s.signed_by_name}` : ""}`,
      at: s.signed_at,
      tone: "good",
    });
  }
  return steps.sort((a, b) => a.at.localeCompare(b.at));
}

/* "RESIDENTIAL - OFFICE" reads as shouting in a popup. */
function sentenceCase(value: string | null | undefined) {
  const text = (value ?? "").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function Stat({
  label,
  value,
  strong,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${strong ? "border-primary/20 bg-primary/5" : "bg-muted/30"}`}
    >
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={`mt-0.5 text-sm tabular-nums ${strong ? "text-primary font-semibold" : "font-medium"}`}
      >
        {value}
      </p>
    </div>
  );
}

function Panel({
  icon,
  title,
  aside,
  flush,
  children,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside ? (
          <span className="text-muted-foreground ml-auto text-xs">{aside}</span>
        ) : null}
      </header>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value || "—"}</dd>
    </div>
  );
}

function People({
  people,
  empty,
}: {
  people: { name?: string; phone?: string; role?: string }[];
  empty: string;
}) {
  const listed = people.filter(
    (person) => person.name?.trim() || person.phone?.trim(),
  );
  if (listed.length === 0) {
    return <p className="text-muted-foreground text-sm">{empty}</p>;
  }
  return (
    <ul className="space-y-3">
      {listed.map((person, index) => (
        <li key={index} className="flex items-start gap-3 text-sm">
          <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
            <UserRound className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{person.name || "No name"}</span>
              {person.role ? (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 text-[11px] font-normal"
                >
                  {person.role}
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs tabular-nums">
              {formatPhoneForDocument(person.phone ?? "") || "No phone"}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SubmissionDetailsDialog({
  submission,
  onOpenChange,
  onView,
  onEdit,
  canApprove = false,
  deciding = false,
  onApprove,
  onSendBack,
  onDownload,
  downloading = false,
  onSend,
  sending = false,
}: {
  submission: AmcSubmission | null;
  onOpenChange: (open: boolean) => void;
  onView: (submission: AmcSubmission, documentType: AmcDocumentType) => void;
  onEdit: (id: string) => void;
  /* FR5.2: an approver decides from here as well as from the list. */
  canApprove?: boolean;
  deciding?: boolean;
  onApprove?: (submission: AmcSubmission) => void;
  onSendBack?: (submission: AmcSubmission) => void;
  /* PDF or Word, like every other document screen. */
  onDownload?: (
    submission: AmcSubmission,
    documentType: AmcDocumentType,
    format: "pdf" | "docx",
  ) => void;
  downloading?: boolean;
  /* Email or link, through the same confirmation as the list. */
  onSend?: (
    submission: AmcSubmission,
    document: "proposal" | "contract",
    deliver: "email" | "link",
  ) => void;
  sending?: boolean;
}) {
  const details = useMemo(() => {
    if (!submission) return null;
    const form = submissionToFormData(submission);
    const data = computeAmcData(form, "proposal");
    return { form, data };
  }, [submission]);

  /* The audit trail, loaded when the popup opens and after any change. */
  const [history, setHistory] = useState<{
    key: string;
    events: AmcHistoryEvent[];
  } | null>(null);
  const historyKey = submission
    ? `${submission.id}:${submission.updated_at}`
    : null;
  useEffect(() => {
    if (!historyKey || !submission) return;
    let cancelled = false;
    amcSubmissionsService
      .getHistory(submission.id)
      .then((response) => {
        if (!cancelled)
          setHistory({ key: historyKey, events: response.events });
      })
      .catch((error) => {
        /* The dates on the submission are still shown. */
        console.error(error);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey]);

  const timeline = useMemo(() => {
    if (!submission) return [];
    const events = history?.key === historyKey ? history.events : null;
    return events && events.length > 0
      ? buildTimelineFromEvents(submission, events)
      : buildTimeline(submission);
  }, [submission, history, historyKey]);

  const title = submission?.customer.customerName || "Unnamed customer";
  const awaiting = submission?.status === "awaiting_approval";
  const canEdit =
    Boolean(submission) &&
    isAmcSubmissionEditable(submission!.status) &&
    submission!.is_own !== false;
  /* With no Edit or Approve on the right, the document buttons move there. */
  const sendable = submission && onSend ? sendableDocument(submission) : null;
  const resend =
    submission && sendable ? lastSentAt(submission, sendable) : null;
  const hasPrimary = canEdit || (canApprove && awaiting) || Boolean(sendable);

  return (
    <Dialog open={Boolean(submission)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {submission && details && (
          <>
            <DialogHeader className="gap-4 border-b px-6 pt-6 pb-5 text-left">
              <div className="flex items-start gap-3 pr-8">
                <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                  <UserRound className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="text-xl leading-tight">
                      {title}
                    </DialogTitle>
                    <Badge
                      variant="secondary"
                      className={`border-none ${amcStatusTone(submission.status)}`}
                    >
                      {AMC_STATUS_LABELS[submission.status] ??
                        submission.status}
                    </Badge>
                  </div>
                  <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1.5">
                      <Hash className="size-3.5" aria-hidden />
                      {submission.customer.proposalNumber || "No number yet"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="size-3.5" aria-hidden />
                      {sentenceCase(details.data.propertyTypeLabel)}
                    </span>
                    {submission.is_own === false && submission.owner_name ? (
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound className="size-3.5" aria-hidden />
                        Submitted by {submission.owner_name}
                      </span>
                    ) : null}
                  </DialogDescription>
                </div>
              </div>

              {/* The figures an approver looks at first. */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label="Total (incl. VAT)"
                  value={formatCurrencyAED(details.data.totals.grandTotal)}
                  strong
                />
                <Stat
                  label="Annual fee"
                  value={formatCurrencyAED(details.data.totals.finalPrice)}
                />
                <Stat
                  label="Contract period"
                  value={`${formatDisplayDate(details.form.startDate) || "—"} to ${details.data.endDate || "—"}`}
                />
                <Stat
                  label="Payment terms"
                  value={formatPaymentTermsLabel(details.form.paymentTerms)}
                />
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-6 p-6">
                <div className="min-w-0 space-y-6">
                  {submission.status === "sent_back" &&
                    submission.sent_back_reason && (
                      <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm">
                        <p className="font-medium">Sent back by the approver</p>
                        <p className="mt-1 whitespace-pre-line">
                          {submission.sent_back_reason}
                        </p>
                      </div>
                    )}

                  <div className="grid gap-4 md:grid-cols-2">
                    <Panel icon={<UserRound />} title="Customer">
                      <dl className="space-y-2.5">
                        <Field label="Name" value={details.form.customerName} />
                        <Field
                          label="Customer ID"
                          value={details.form.customerId}
                        />
                        <Field
                          label="Phone"
                          value={formatPhoneForDocument(
                            details.form.customerPhone,
                          )}
                        />
                        <Field
                          label="Email"
                          value={details.form.customerEmail}
                        />
                      </dl>
                    </Panel>

                    <Panel icon={<Building2 />} title="Property">
                      <dl className="space-y-2.5">
                        <Field
                          label="Address"
                          value={details.form.propertyAddress}
                        />
                        <Field
                          label="Detail"
                          value={details.form.propertyDetail}
                        />
                        <Field
                          label="Type"
                          value={sentenceCase(details.data.propertyTypeLabel)}
                        />
                      </dl>
                    </Panel>

                    <Panel icon={<Phone />} title="Coordination contacts">
                      <People
                        people={details.form.coordinationContacts.map(
                          (contact) => ({
                            name: contact.name,
                            phone: contact.phone,
                            role: contact.designation
                              ? sentenceCase(
                                  formatDesignationLabel(contact.designation),
                                )
                              : "",
                          }),
                        )}
                        empty="No coordination contacts."
                      />
                    </Panel>

                    <Panel icon={<Users />} title="Account managers">
                      <People
                        people={(details.form.accountManagers ?? []).map(
                          (manager) => ({
                            name: manager.name,
                            phone: manager.phone,
                            role: "",
                          }),
                        )}
                        empty="No account managers."
                      />
                    </Panel>
                  </div>

                  <Panel
                    icon={<Wrench />}
                    title="Services"
                    aside={`${details.data.frequencyRows.length} selected`}
                    flush
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40 text-muted-foreground text-xs">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium">
                              Service
                            </th>
                            <th className="px-4 py-2 text-right font-medium">
                              Units
                            </th>
                            <th className="px-4 py-2 text-left font-medium">
                              Frequency
                            </th>
                            <th className="px-4 py-2 text-right font-medium">
                              Price
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {details.data.frequencyRows.map((row) => (
                            <tr key={row.scope}>
                              <td className="px-4 py-2.5">{row.scope}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">
                                {row.units}
                              </td>
                              <td className="text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                                {row.frequency}
                              </td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                                {formatCurrencyAED(row.price)}
                              </td>
                            </tr>
                          ))}
                          {details.data.frequencyRows.length === 0 && (
                            <tr>
                              <td
                                colSpan={4}
                                className="text-muted-foreground px-4 py-4 text-center"
                              >
                                No services selected.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <dl className="bg-muted/20 space-y-1.5 border-t px-4 py-3 text-sm">
                      {[
                        ["Subtotal", details.data.totals.subtotal],
                        ...(details.data.totals.discountAmount > 0
                          ? [
                              [
                                `Discount (${details.data.totals.discountPercent}%)`,
                                -details.data.totals.discountAmount,
                              ],
                            ]
                          : []),
                        [
                          "Annual fee (excl. VAT)",
                          details.data.totals.finalPrice,
                        ],
                        ["VAT (5%)", details.data.totals.vatAmount],
                      ].map(([label, value]) => (
                        <div
                          key={label as string}
                          className="text-muted-foreground flex justify-between gap-4"
                        >
                          <dt>{label}</dt>
                          <dd className="tabular-nums">
                            {formatCurrencyAED(value as number)}
                          </dd>
                        </div>
                      ))}
                      <div className="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
                        <dt>Total</dt>
                        <dd className="tabular-nums">
                          {formatCurrencyAED(details.data.totals.grandTotal)}
                        </dd>
                      </div>
                    </dl>
                  </Panel>
                </div>

                <div className="min-w-0">
                  <Panel
                    icon={<History />}
                    title="History"
                    aside={`${timeline.length} ${timeline.length === 1 ? "event" : "events"}`}
                  >
                    <ol className="relative space-y-5">
                      {timeline.map((step, index) => (
                        <li
                          key={`${step.label}-${index}`}
                          className="relative flex gap-3"
                        >
                          {index < timeline.length - 1 && (
                            <span
                              className="bg-border absolute top-4 left-[5px] h-[calc(100%+0.75rem)] w-px"
                              aria-hidden
                            />
                          )}
                          <span
                            className={`relative mt-1 size-[11px] shrink-0 rounded-full ring-4 ring-background ${
                              step.tone === "good"
                                ? "bg-green-600"
                                : step.tone === "bad"
                                  ? "bg-destructive"
                                  : "bg-muted-foreground/40"
                            }`}
                            aria-hidden
                          />
                          <div className="min-w-0 text-sm">
                            <p className="leading-snug font-medium">
                              {step.label}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {formatWhen(step.at)}
                            </p>
                            {step.note && (
                              <p className="bg-muted/50 text-muted-foreground mt-1.5 rounded-md px-2 py-1.5 text-xs whitespace-pre-line">
                                {step.note}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </Panel>
                </div>
              </div>
            </div>

            <DialogFooter
              className={`m-0 flex-row flex-wrap items-center gap-2 rounded-none border-t px-6 py-4 ${hasPrimary ? "sm:justify-between" : "justify-end sm:justify-end"}`}
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => onView(submission, "proposal")}
                >
                  <FileText className="size-4" /> View proposal
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onView(submission, "contract")}
                >
                  <EyeIcon className="size-4" /> View contract
                </Button>
                {onDownload && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" disabled={downloading}>
                        {downloading ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Download className="size-4" />
                        )}
                        Download
                        <ChevronDown className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                      {(["proposal", "contract"] as const).map(
                        (documentType, index) => (
                          <div key={documentType}>
                            {index > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                              {documentType === "proposal"
                                ? "Proposal"
                                : "Contract"}
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() =>
                                onDownload(submission, documentType, "pdf")
                              }
                            >
                              <FileText className="size-4" />
                              PDF
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                onDownload(submission, documentType, "docx")
                              }
                            >
                              <FileType className="size-4" />
                              Word (.docx)
                            </DropdownMenuItem>
                          </div>
                        ),
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {hasPrimary && (
                <div className="flex flex-wrap gap-2">
                  {canEdit && (
                    <Button onClick={() => onEdit(submission.id)}>
                      <PencilIcon className="size-4" /> Edit
                    </Button>
                  )}
                  {sendable && onSend && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button disabled={sending}>
                          {sending ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Send className="size-4" />
                          )}
                          {resend
                            ? `Send ${sendable} again`
                            : `Send ${sendable}`}
                          <ChevronDown className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem
                          onClick={() => onSend(submission, sendable, "email")}
                        >
                          <Mail className="size-4" />
                          Email to client
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onSend(submission, sendable, "link")}
                        >
                          <LinkIcon className="size-4" />
                          {resend ? "Get a new link" : "Copy link"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {canApprove && awaiting && (
                    <>
                      <Button
                        variant="outline"
                        disabled={deciding}
                        onClick={() => onSendBack?.(submission)}
                      >
                        <Undo2 className="size-4" /> Send back
                      </Button>
                      <Button
                        disabled={deciding}
                        onClick={() => onApprove?.(submission)}
                      >
                        {deciding ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-4" />
                        )}
                        Approve
                      </Button>
                    </>
                  )}
                </div>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
