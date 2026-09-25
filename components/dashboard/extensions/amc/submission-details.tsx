"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, differenceInCalendarMonths, format } from "date-fns";
import {
  Building2,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Download,
  FileType,
  EyeIcon,
  FileText,
  History,
  ListCheck,
  Loader2,
  PencilIcon,
  Phone,
  Link as LinkIcon,
  Mail,
  Send,
  Undo2,
  UserRound,
  Users,
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
  SectionCard,
  StatCard,
  StatCardGrid,
  SubHeading,
  timeAgo,
} from "@/components/dashboard/shared/kaizen";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
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
import { Fact, ReviewSection, ServicesAndCost } from "./steps/review-step";
import {
  AMC_STATUS_LABELS,
  isAmcSubmissionEditable,
  type AmcDocumentType,
  type AmcHistoryEvent,
  type AmcSubmission,
} from "./amc-types";

/**
 * A submission, read-only, on its own page: everything the team entered and everything
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

/**
 * A group of contacts as cards: a person icon, the name in full, the
 * role, and the number as a link that dials. They were a cramped list in a
 * narrow box, which cut the names off.
 */
function ContactGroup({
  title,
  people,
  empty,
}: {
  title: string;
  people: { name?: string; phone?: string; role?: string }[];
  empty: string;
}) {
  const listed = people.filter((person) => person.name?.trim() || person.phone?.trim());
  return (
    <div className="space-y-3">
      <SubHeading count={listed.length}>{title}</SubHeading>
      {listed.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm">
          {empty}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {listed.map((person, index) => {
            const phone = formatPhoneForDocument(person.phone ?? "");
            return (
              <li key={index} className="flex items-center gap-3 rounded-lg border p-3">
                <span
                  className="bg-brand-50 text-brand flex size-10 shrink-0 items-center justify-center rounded-full"
                  aria-hidden
                >
                  <UserRound className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={person.name}>
                    {person.name || "No name"}
                  </p>
                  {person.role ? (
                    <p className="text-muted-foreground truncate text-xs">{person.role}</p>
                  ) : null}
                  {phone ? (
                    <a
                      href={`tel:${(person.phone ?? "").replace(/\s+/g, "")}`}
                      className="text-muted-foreground hover:text-foreground mt-0.5 inline-flex items-center gap-1.5 text-xs tabular-nums"
                    >
                      <Phone className="size-3" aria-hidden />
                      {phone}
                    </a>
                  ) : (
                    <p className="text-muted-foreground mt-0.5 text-xs">No phone</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* Where the proposal stands, and what happens next -- the fourth tile. */
const STAGE: Record<
  AmcSubmission["status"],
  { next: string; tone: "neutral" | "progress" | "review" | "good" | "bad" }
> = {
  draft: { next: "Not submitted for approval yet", tone: "neutral" },
  awaiting_approval: { next: "Waiting for the approver", tone: "review" },
  sent_back: { next: "Back with the owner for changes", tone: "bad" },
  approved: { next: "Approved. Ready to send the proposal", tone: "progress" },
  proposal_sent: { next: "With the client to review", tone: "progress" },
  proposal_rejected: { next: "The client asked for changes", tone: "bad" },
  proposal_approved: { next: "Client accepted. Send the contract", tone: "progress" },
  contract_sent: { next: "Contract with the client to sign", tone: "progress" },
  signed: { next: "Signed by the client", tone: "good" },
};

/* The contract's length in months, counting the last day as a whole day. */
function termMonths(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return null;
  return differenceInCalendarMonths(addDays(to, 1), from);
}

/**
 * The proposal's page body (/extensions/amc/<id>), in the same shape as a
 * snagging job: a header card with the actions and anything that needs
 * attention, the four figures that matter as stat tiles, then the record
 * itself laid out exactly as the Review step showed it before submission,
 * with the history beside it. The actions are the list's own
 * (useAmcActions).
 */
export function SubmissionDetails({
  submission,
  onView,
  canApprove = false,
  deciding = false,
  onApprove,
  onSendBack,
  onDownload,
  downloading = false,
  onSend,
  sending = false,
}: {
  submission: AmcSubmission;
  onView: (submission: AmcSubmission, documentType: AmcDocumentType) => void;
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
    const form = submissionToFormData(submission);
    const data = computeAmcData(form, "proposal");
    return { form, data };
  }, [submission]);

  /* The audit trail, loaded with the page and after any change. */
  const [history, setHistory] = useState<{
    key: string;
    events: AmcHistoryEvent[];
  } | null>(null);
  const historyKey = `${submission.id}:${submission.updated_at}`;
  useEffect(() => {
    let cancelled = false;
    amcSubmissionsService
      .getHistory(submission.id)
      .then((response) => {
        if (!cancelled) setHistory({ key: historyKey, events: response.events });
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
    const events = history?.key === historyKey ? history.events : null;
    return events && events.length > 0
      ? buildTimelineFromEvents(submission, events)
      : buildTimeline(submission);
  }, [submission, history, historyKey]);

  const { form, data } = details;
  const { totals } = data;
  const title = submission.customer.customerName || "Unnamed customer";
  const awaiting = submission.status === "awaiting_approval";
  const canEdit = isAmcSubmissionEditable(submission.status) && submission.is_own !== false;
  /*
    Sending is the owner's, as it is on the server.

    An approver decides whether a proposal may go out; they do not send
    it. Offering the button to somebody the server will refuse reads as a
    fault rather than a rule -- and the document carries the owner's
    account manager and contacts, so it goes out in their name.
  */
  const sendable =
    onSend && submission.is_own !== false ? sendableDocument(submission) : null;
  const resend = sendable ? lastSentAt(submission, sendable) : null;
  const stage = STAGE[submission.status] ?? { next: "", tone: "neutral" as const };
  const months = termMonths(form.startDate, form.endDate);
  const contactCount =
    form.coordinationContacts.filter((c) => c.name?.trim() || c.phone?.trim()).length +
    (form.accountManagers ?? []).filter((m) => m.name?.trim() || m.phone?.trim()).length;

  /* The one thing on this proposal that needs somebody's attention. */
  const attention =
    submission.status === "sent_back" && submission.sent_back_reason
      ? { tone: "bad" as const, title: "Sent back by the approver", body: submission.sent_back_reason }
      : submission.status === "proposal_rejected" && submission.client_rejected_reason
        ? {
            tone: "bad" as const,
            title: `The client asked for changes${submission.client_decided_by_name ? ` (${submission.client_decided_by_name})` : ""}`,
            body: submission.client_rejected_reason,
          }
        : awaiting
          ? {
              tone: "warn" as const,
              title: canApprove ? "Waiting for your decision" : "Waiting for the approver",
              body: canApprove
                ? "Read it through, preview the documents, then approve it or send it back with a note."
                : "It is locked while it waits. Nothing goes to the client until it is approved.",
            }
          : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {/* The proposal at a glance, and what can be done with it. */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0 space-y-1.5">
            <p className="eyebrow">
              AMC proposal{submission.customer.proposalNumber ? ` · ${submission.customer.proposalNumber}` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl">{title}</h2>
              <Badge variant="secondary" className={`border-none ${amcStatusTone(submission.status)}`}>
                {AMC_STATUS_LABELS[submission.status] ?? submission.status}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {[
                form.propertyAddress,
                sentenceCase(data.propertyTypeLabel),
                submission.is_own === false && submission.owner_name
                  ? `submitted by ${submission.owner_name}`
                  : "yours",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* The documents on screen, then as files. */}
            <Button variant="outline" onClick={() => onView(submission, "proposal")}>
              <EyeIcon className="size-4" /> Preview
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
                <DropdownMenuContent align="end" className="w-48">
                  {(["proposal", "contract"] as const).map((documentType, index) => (
                    <div key={documentType}>
                      {index > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                        {documentType === "proposal" ? "Proposal" : "Contract"}
                      </DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => onDownload(submission, documentType, "pdf")}>
                        <FileText className="size-4" />
                        PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onDownload(submission, documentType, "docx")}>
                        <FileType className="size-4" />
                        Word (.docx)
                      </DropdownMenuItem>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {canEdit && (
              <Button asChild>
                <Link href={`/extensions/amc/${submission.id}/edit`}>
                  <PencilIcon className="size-4" /> Edit
                </Link>
              </Button>
            )}
            {sendable && onSend && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button disabled={sending}>
                    {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    {resend ? `Send ${sendable} again` : `Send ${sendable}`}
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => onSend(submission, sendable, "email")}>
                    <Mail className="size-4" />
                    Email to client
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onSend(submission, sendable, "link")}>
                    <LinkIcon className="size-4" />
                    {resend ? "Get a new link" : "Copy link"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canApprove && awaiting && (
              <>
                <Button variant="outline" disabled={deciding} onClick={() => onSendBack?.(submission)}>
                  <Undo2 className="size-4" /> Send back
                </Button>
                <Button disabled={deciding} onClick={() => onApprove?.(submission)}>
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
        </div>

        {attention ? (
          <div
            className={
              attention.tone === "bad"
                ? "border-danger/30 bg-danger/5 border-t px-5 py-4"
                : "border-warning/30 bg-warning/5 border-t px-5 py-3"
            }
          >
            <p className={`text-sm font-medium ${attention.tone === "bad" ? "text-danger" : ""}`}>
              {attention.title}
            </p>
            <p className="text-muted-foreground mt-1 text-sm whitespace-pre-line">{attention.body}</p>
          </div>
        ) : null}
      </Card>

      {/* The four figures that matter, in the product's one stat tile. */}
      <StatCardGrid columns={4}>
        <StatCard
          label="Grand total"
          value={<Money value={totals.grandTotal} />}
          headline={`${formatCurrencyAED(totals.finalPrice)} a year before VAT`}
          caption={
            totals.discountAmount > 0 ? `${totals.discountPercent}% discount applied` : "No discount"
          }
        />
        <StatCard
          label="Services"
          value={data.frequencyRows.length}
          headline={data.frequencyRows.length === 1 ? "Service" : "Services"}
          caption="Each with its own frequency and price"
        />
        <StatCard
          label="Contract term"
          value={months !== null ? `${months} ${months === 1 ? "month" : "months"}` : "—"}
          headline={`${formatDisplayDate(form.startDate) || "—"} to ${data.endDate || "—"}`}
          caption={`Paid ${formatPaymentTermsLabel(form.paymentTerms).toLowerCase()}`}
        />
        <StatCard
          label="Stage"
          value={AMC_STATUS_LABELS[submission.status] ?? submission.status}
          headline={stage.next}
          caption={`Updated ${timeAgo(submission.updated_at)}`}
          tone={stage.tone}
        />
      </StatCardGrid>

      {/* The record, laid out exactly as the Review step showed it. */}
      <Card className="min-w-0 gap-0 p-0">
          <div className="space-y-8 p-4 sm:p-6">
            <ReviewSection
              icon={Building2}
              title="Property and customer"
              description="What the proposal and the contract are written for."
            >
              <dl className="grid gap-x-6 gap-y-4 rounded-lg border p-4 sm:grid-cols-2 xl:grid-cols-4">
                <Fact label="Customer">{form.customerName}</Fact>
                <Fact label="Customer ID">{form.customerId}</Fact>
                <Fact label="Phone">{formatPhoneForDocument(form.customerPhone)}</Fact>
                <Fact label="Email">{form.customerEmail}</Fact>
                <Fact label="Property category">
                  <span className="capitalize">{form.propertyCategory}</span>
                </Fact>
                <Fact label="Unit type">
                  <span className="capitalize">{form.unitType}</span>
                </Fact>
                <Fact label="Property detail">{form.propertyDetail}</Fact>
                <Fact label="Address">{form.propertyAddress}</Fact>
                <Fact label="Contract period">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarRange className="text-muted-foreground size-3.5" aria-hidden />
                    {formatDisplayDate(form.startDate)} → {data.endDate || "—"}
                  </span>
                </Fact>
                <Fact label="Payment terms">{formatPaymentTermsLabel(form.paymentTerms)}</Fact>
                <Fact label="Proposal number">{submission.customer.proposalNumber}</Fact>
                <Fact label="Property type">{sentenceCase(data.propertyTypeLabel)}</Fact>
              </dl>
            </ReviewSection>

            <ReviewSection
              icon={ListCheck}
              title="Services and cost"
              description="As it appears in the documents, with the total before and after 5% VAT."
            >
              <ServicesAndCost rows={data.frequencyRows} totals={totals} />
            </ReviewSection>

            <ReviewSection
              icon={Users}
              title="Contacts"
              description={`${contactCount} ${contactCount === 1 ? "person" : "people"} named in the contract.`}
            >
              <div className="space-y-6 rounded-lg border p-4">
                <ContactGroup
                  title="Coordination contacts"
                  people={form.coordinationContacts.map((contact) => ({
                    name: contact.name,
                    phone: contact.phone,
                    role: contact.designation
                      ? sentenceCase(formatDesignationLabel(contact.designation))
                      : "",
                  }))}
                  empty="No coordination contacts on this proposal."
                />
                <ContactGroup
                  title="Account managers"
                  people={(form.accountManagers ?? []).map((manager) => ({
                    name: manager.name,
                    phone: manager.phone,
                    role: "Account manager",
                  }))}
                  empty="No account managers on this proposal."
                />
              </div>
            </ReviewSection>
          </div>
      </Card>

      {/*
        Everything that has happened to it, oldest first, under the record:
        a full-width list reads better than a narrow column beside it, and
        the timeline grows with every round of approval.
      */}
      <SectionCard
        icon={<History />}
        title="History"
        description={`${timeline.length} ${timeline.length === 1 ? "event" : "events"}, oldest first.`}
        bodyClassName="px-5 pb-5"
      >
        <ol className="relative">
          {timeline.map((step, index) => (
            <li key={`${step.label}-${index}`} className="relative flex gap-4 pb-5 last:pb-0">
              {index < timeline.length - 1 && (
                <span className="bg-border absolute top-4 left-[5px] h-full w-px" aria-hidden />
              )}
              <span
                className={`relative mt-1.5 size-[11px] shrink-0 rounded-full ring-4 ring-background ${
                  step.tone === "good"
                    ? "bg-green-600"
                    : step.tone === "bad"
                      ? "bg-destructive"
                      : "bg-muted-foreground/40"
                }`}
                aria-hidden
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0 text-sm">
                  <p className="leading-snug font-medium">{step.label}</p>
                  {step.note && (
                    <p className="bg-muted/50 text-muted-foreground mt-1.5 max-w-3xl rounded-md px-2.5 py-1.5 text-xs whitespace-pre-line">
                      {step.note}
                    </p>
                  )}
                </div>
                <p className="text-muted-foreground shrink-0 text-xs tabular-nums sm:pt-0.5">
                  {formatWhen(step.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </SectionCard>
    </div>
  );
}
