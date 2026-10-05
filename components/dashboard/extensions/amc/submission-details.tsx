"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { addDays, differenceInCalendarMonths, format } from "date-fns";
import {
  Building2,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Circle,
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
  Users,
  XCircle,
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
  DataRow,
  SectionCard,
  StatCard,
  StatCardGrid,
  TabCount,
  timeAgo,
} from "@/components/dashboard/shared/kaizen";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Money } from "@/components/ui/money";
import { formatCurrencyAED } from "@/utils/format-currency";
import { amcSubmissionsService } from "@/modules/amc-submissions";

import {
  computeAmcData,
  formatDesignationLabel,
  formatDisplayDate,
  formatPaymentTermsLabel,
} from "./amc-pricing";
import { IdentityCell } from "@/components/ui/entity-avatar";
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
 * A group of contacts, as one list rather than a card each.
 *
 * It was a grid of bordered boxes, each holding a 40px circle with a
 * generic person icon beside three lines of small text. Four people cost
 * two rows of mostly empty cards, the heaviest thing on screen was an
 * icon that said nothing (every one of them identical), and the numbers
 * sat at four different x-positions, so comparing them meant hunting.
 *
 * One bordered list, rows divided: the name and role on the left in the
 * shape every other list in the product uses (IdentityCell), the number
 * on the right where the numbers line up under each other and can be
 * read down. Denser, and the only thing with weight is the name.
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
      {/*
        Its own label rather than SubHeading.

        SubHeading sets small caps with a count beside it, which is right
        for the lists it was built for and wrong for two groups of two:
        the count repeats what you can see without counting, and the caps
        shout a word that is only there to say which list is which. It is
        a shared component used in other extensions, so the change is
        here rather than in it.
      */}
      <p className="text-muted-foreground text-xs font-medium">{title}</p>
      {listed.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm">
          {empty}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {listed.map((person, index) => {
            const phone = formatPhoneForDocument(person.phone ?? "");
            return (
              <li
                key={index}
                className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
              >
                <IdentityCell
                  title={person.name || "No name"}
                  subtitle={person.role || null}
                />
                {phone ? (
                  /* A number on a contact is there to be rung. */
                  <a
                    href={`tel:${(person.phone ?? "").replace(/\s+/g, "")}`}
                    className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1.5 tabular-nums"
                  >
                    <Phone className="size-3.5" aria-hidden />
                    {phone}
                  </a>
                ) : (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    No number
                  </span>
                )}
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
/** The tabs this page has, and the only values ?tab= may carry. */
const TABS = new Set(["record", "services", "history"]);

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
  /* Oldest first is how a trail is read; newest first is how it is
     checked. The job page offers both, so this does too. */
  const [historyOrder, setHistoryOrder] = useState<"desc" | "asc">("desc");

  /* `timeline` is built oldest first; this is the copy the tab draws. */
  const orderedTimeline = useMemo(
    () => (historyOrder === "asc" ? timeline : [...timeline].reverse()),
    [timeline, historyOrder],
  );

  /*
    Which tab is open, and the ones opened so far.

    The tab is in the URL so a link can point at one and a refresh keeps
    the reader where they were, as the job page does it. A tab stays
    mounted once opened, hidden rather than unmounted, so returning to one
    shows it exactly as it was left.
  */
  const [tab, setTabState] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("tab");
    if (asked) setTabState(asked);
  }, []);
  const setTab = useCallback((next: string) => {
    setTabState(next);
    setOpened((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    const query = new URLSearchParams(window.location.search);
    query.set("tab", next);
    window.history.replaceState(null, "", `?${query.toString()}`);
  }, []);
  /* A stale or mistyped ?tab= falls back to the record rather than
     leaving the page below the tab bar empty. */
  const activeTab = TABS.has(tab ?? "") ? (tab as string) : "record";
  const mounted = useMemo(() => new Set([...opened, activeTab]), [opened, activeTab]);
  /* A tab's body, mounted on first open and kept after. */
  const panel = (value: string, children: ReactNode) =>
    mounted.has(value) ? (
      <TabsContent value={value} forceMount className="mt-4 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

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
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
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

      {/*
        The record, in tabs.

        It was one column: the property, the services, the contacts and
        then every event, so reading the cost meant scrolling past the
        address and reading the history meant scrolling past everything.
        Same shape as a job page now. The header above stays put, because
        the actions are there and they apply whichever tab is open.
      */}
      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
          {/*
            "Details" rather than "Property & customer": the tab now
            holds the property, the customer, the contract dates and
            everyone named on it, and a title that lists two of those
            four reads as though the rest are somewhere else.
          */}
          <TabsTrigger value="record">Details</TabsTrigger>
          <TabsTrigger value="services">
            Services &amp; cost
            <TabCount value={data.frequencyRows.length} />
          </TabsTrigger>
          <TabsTrigger value="history">
            History
            <TabCount value={timeline.length} />
          </TabsTrigger>
        </TabsList>

        {panel(
          "record",
          <div className="flex flex-col gap-4">
            {/*
              The four figures, on the tab the page opens on rather than
              above the bar. They describe the proposal as a whole, and
              this is the tab that describes the proposal as a whole; on
              the cost and contact tabs they repeated what was already in
              front of you.
            */}
            <StatCardGrid columns={4}>
              <StatCard
                label="Grand total"
                value={<Money value={totals.grandTotal} />}
                headline={`${formatCurrencyAED(totals.finalPrice)} a year before VAT`}
                caption={
                  totals.discountAmount > 0
                    ? `${totals.discountPercent}% discount applied`
                    : "No discount"
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

            <Card className="min-w-0 gap-0 p-4 sm:p-6">
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
            </Card>

            {/*
              Everyone named on the proposal, in a card of its own.

              They were a tab, which gave two or three names a whole page
              and put them a click from the property they are contacts
              for. Folding them into the card above instead needed a rule
              across the middle to keep them apart, which is a card doing
              the job of two. The page stacks cards the way a job page
              stacks its panels, so this is one of those.
            */}
            <Card className="min-w-0 gap-0 p-4 sm:p-6">
              <ReviewSection
                icon={Users}
                title="Contacts"
                /*
                  What the two lists are for, rather than how many rows
                  are about to appear underneath. The count was already
                  there to be seen, and said nothing about why a reader
                  would want either group.
                */
                description="Who the team coordinates with on the client's side, and who the client calls on ours."
              >
                {/*
                  The two groups sit directly on the card. They used to be
                  boxed inside it, which put a border around a border around
                  each person's own bordered card: three frames deep before
                  you reached a name.
                */}
                <div className="space-y-6">
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
            </Card>
          </div>,
        )}

        {panel(
          "services",
          <Card className="min-w-0 gap-0 p-4 sm:p-6">
            <ReviewSection
              icon={ListCheck}
              title="Services and cost"
              description="As it appears in the documents, with the total before and after 5% VAT."
            >
              <ServicesAndCost rows={data.frequencyRows} totals={totals} />
            </ReviewSection>
          </Card>,
        )}

        {panel(
          "history",
            <SectionCard
              icon={<History />}
              title="History"
              description={`Every recorded action on this proposal. ${timeline.length} ${
                timeline.length === 1 ? "event" : "events"
              }.`}
              bodyClassName="border-t"
              action={
                <Select
                  value={historyOrder}
                  onValueChange={(value) => setHistoryOrder(value as "desc" | "asc")}
                >
                  <SelectTrigger size="sm" className="w-[130px]" aria-label="Sort history">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">Newest first</SelectItem>
                    <SelectItem value="asc">Oldest first</SelectItem>
                  </SelectContent>
                </Select>
              }
            >
              {/*
                The same row a job's history uses: an icon in its own
                square, what happened, who by, and when on the right. The
                dot-and-rail timeline this replaced drew a vertical line
                down the page for a list that is almost always two or
                three entries long, and it looked nothing like the history
                a reader sees on a job.
              */}
              <ol className="divide-y">
                {orderedTimeline.map((step, index) => {
                  const Icon =
                    step.tone === "good"
                      ? CheckCircle2
                      : step.tone === "bad"
                        ? XCircle
                        : Circle;
                  return (
                    <li key={`${step.label}-${index}`}>
                      <DataRow
                        icon={<Icon aria-hidden />}
                        title={step.label}
                        subtitle={step.note ? step.note : undefined}
                        trailing={
                          <span className="text-muted-foreground text-xs">
                            {formatWhen(step.at)}
                          </span>
                        }
                      />
                    </li>
                  );
                })}
              </ol>
            </SectionCard>
        )}
      </Tabs>
    </div>
  );
}
