"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { addDays, differenceInCalendarMonths, format } from "date-fns";
import {
  Building2,
  TriangleAlert,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Circle,
  EyeIcon,
  FileText,
  GitBranch,
  History,
  Inbox,
  ListCheck,
  Loader2,
  MoreHorizontal,
  SquarePen,
  Phone,
  Link as LinkIcon,
  Mail,
  MessageCircle,
  Send,
  Undo2,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DataRow,
  ListPager,
  SectionCard,
  StatCard,
  StatCardGrid,
  TabCount,
  timeAgo,
} from "@/components/dashboard/shared/kaizen";
import { SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { amcRequest } from "@/lib/amc/http-cache";
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
  formatPaymentLabel,
} from "./amc-pricing";
import { ApprovalChecklistCard } from "./approval-checklist-card";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { termFeePhrase } from "./amc-date-utils";
import { formatPhoneForDocument } from "./amc-phone";
import { lastSentAt, sendableDocument } from "./amc-send-dialog";
import { amcStatusTone } from "./amc-status";
import { submissionToFormData } from "./amc-submission-mapper";
import { amcFormSchema } from "./amc-types";
import { canDecideProposal } from "@/lib/amc/workflow";
import { SignedContractAction } from "@/components/dashboard/extensions/amc-contracts/signed-contract-action";
import { SignedArchiveRow } from "@/components/dashboard/extensions/amc-contracts/signed-archive-row";
import { Fact, ServicesAndCost } from "./steps/review-step";
import {
  ProposalVersionsPanel,
  ReviseProposalDialog,
  canReviseProposal,
} from "./proposal-versions-panel";
import { ChangeOwnerDialog, takeOverProposal } from "./proposal-owner-dialog";
import {
  ApprovalsAndSendsPanel,
  RecordClientAnswerDialog,
  canRecordClientAnswer,
} from "./proposal-sharing-panel";
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
 * or contract PDF. This is the place to check them — the client, the
 * services and prices, and the history: who approved it, when it went to
 * the client, what the client answered.
 */

type Step = {
  label: string;
  at: string;
  note?: string | null;
  tone?: "good" | "bad";
};

/** "A", "A and B", "A, B and C". */
function listNames(names: readonly string[]) {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

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
    /* Prepared for WhatsApp: the link is live and the owner sends it from WhatsApp; no email is involved. */
    const viaWhatsapp = payload.deliver === "whatsapp";
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
        /* Marked sent with a working link, but the email did not go. */
        const notEmailed =
          !viaLink &&
          !viaWhatsapp &&
          (payload.outcome === "no_recipient" ||
            payload.outcome === "email_failed" ||
            payload.emailed === false);
        steps.push({
          label: viaLink
            ? `${doc} link ${resend ? "created again" : "created"}${by(event)}`
            : viaWhatsapp
              ? `${doc} shared on WhatsApp${resend ? " again" : ""}${by(event)}`
            : notEmailed
              ? `${doc} marked as sent, but the email was not delivered${by(event)}`
              : `${doc} ${resend ? "emailed again" : "emailed to the client"}${by(event)}`,
          at: event.at,
          note: notEmailed
            ? payload.outcome === "no_recipient"
              ? "No client email on the proposal; the link can be copied instead"
              : `${to ? `To ${to}. ` : ""}${typeof payload.error === "string" ? payload.error : "Delivery failed"}`
            : !viaLink && !viaWhatsapp && to
              ? `To ${to}`
              : null,
          tone: notEmailed ? "bad" : undefined,
        });
        break;
      }
      case "proposal_send_refused":
      case "contract_send_refused":
        steps.push({
          label: `${event.type === "proposal_send_refused" ? "Proposal" : "Contract"} not sent${by(event)}`,
          at: event.at,
          note: event.note,
          tone: "bad",
        });
        break;
      case "proposal_approved_by_client":
        steps.push({
          label: `${event.actor || "The client"} approved the proposal`,
          at: event.at,
          tone: "good",
        });
        break;
      case "proposal_rejected_by_client":
        steps.push({
          label: `${event.actor || "The client"} declined the proposal`,
          at: event.at,
          note: event.note,
          tone: "bad",
        });
        break;
      /* DEV-505: the contract record could not be made on the client's approval. */
      case "contract_creation_failed":
        steps.push({
          label: "Contract record not created",
          at: event.at,
          note: [CONTRACT_FAILURE_TEXT[String(payload.reason)] ?? String(payload.reason ?? ""), typeof payload.detail === "string" ? payload.detail : null].filter(Boolean).join(": ") || null,
          tone: "bad",
        });
        break;
      case "contract_created_from_approval":
        steps.push({ label: `Contract record created${by(event)}`, at: event.at, tone: "good" });
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

/* Why a contract record was not made (lib/server/amc/contract-lifecycle.ts CONTRACT_CREATION_FAILURES). */
const CONTRACT_FAILURE_TEXT: Record<string, string> = {
  "no services": "The approved version has no services",
  "not migrated": "The database is missing the contract update",
  error: "The database refused it",
};

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

/* A rejected proposal is either declined or sent back for changes; the reason says which (link and manual answers both prefix it). */
const REVISION_PREFIX = "Revision requested: ";
function clientAskedForChanges(reason: string | null | undefined): boolean {
  return Boolean(reason?.startsWith(REVISION_PREFIX));
}

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
const TABS = new Set(["record", "services", "versions", "approvals", "history"]);

export function SubmissionDetails({
  submission,
  onView,
  canApprove = false,
  deciding = false,
  onApprove,
  onSendBack,
  onSend,
  sending = false,
  onReject,
  onShare,
  onChanged,
}: {
  submission: AmcSubmission;
  onView: (submission: AmcSubmission, documentType: AmcDocumentType) => void;
  /* FR5.2: an approver decides from here as well as from the list. */
  canApprove?: boolean;
  deciding?: boolean;
  onApprove?: (submission: AmcSubmission) => void;
  onSendBack?: (submission: AmcSubmission) => void;
  /* Email or link, through the same confirmation as the list. */
  onSend?: (
    submission: AmcSubmission,
    document: "proposal" | "contract",
    deliver: "email" | "link" | "whatsapp",
  ) => void;
  sending?: boolean;
  /* Phase 5: reject at the approver's level; share on the default channel; re-read after a recorded answer. */
  onReject?: (submission: AmcSubmission) => void;
  onShare?: (submission: AmcSubmission) => void;
  onChanged?: () => void;
}) {
  const details = useMemo(() => {
    const form = submissionToFormData(submission);
    const data = computeAmcData(form, "proposal");
    /* DEV-263: the clauses and scopes reworded on this proposal, so the approver knows to read them. */
    const editedWording = [
      ...Object.keys(form.clauseOverrides ?? {}).map(
        (id) => data.settings.clauseList.find((clause) => clause.id === id)?.title,
      ),
      ...Object.keys(form.scopeOverrides ?? {}).map((id) => {
        const service = data.settings.services.find((item) => item.id === id);
        return service ? `Scope of ${service.label}` : undefined;
      }),
    ].filter((title): title is string => Boolean(title));
    return { form, data, editedWording };
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

  const { form, data, editedWording } = details;
  const { totals } = data;
  const title = submission.customer.customerName || "Unnamed client";
  const awaiting = submission.status === "awaiting_approval";
  /* DEV-368 (20 Nov 2026 review): the owner, or the team by role, works on it. */
  const canAct = (submission.can_act ?? submission.is_own !== false);
  const canEdit = isAmcSubmissionEditable(submission.status) && canAct;
  /* FR5.1 from the proposal's own page, as the wizard's last step does it: a draft, or one sent back. */
  const submittable = canAct && (submission.status === "draft" || submission.status === "sent_back");
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const submitForApproval = () => {
    /* The wizard's own checks first, so nothing half-filled goes up the ladder. */
    const parsed = amcFormSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(`Finish the proposal before submitting it: ${parsed.error.issues[0]?.message ?? "a required field is empty"}.`, {
        action: { label: "Edit", onClick: () => router.push(`/extensions/amc/${submission.id}/edit`) },
      });
      return;
    }
    void confirm({
      title: submission.status === "sent_back" ? "Submit this proposal again?" : "Submit this proposal?",
      description:
        "The approval rules are checked now (discount, value, payment plan, floor rates). Within them it is ready to share at once; otherwise it goes up the approval ladder, and nothing reaches the client until it is approved.",
      confirmText: "Submit",
      action: async () => {
        const { outcome, warning } = await amcSubmissionsService.decide({ action: "submit", id: submission.id });
        toast.success(
          outcome && "outcome" in outcome
            ? outcome.outcome === "pending"
              ? `Sent to ${outcome.levelName} for approval. Nothing goes to the client until it is approved.`
              : outcome.outcome === "covered"
                ? "Approved: this version asks for no more than the last one was approved for. Share it with the client now."
                : "No approval needed. Share it with the client now."
            : "Sent for approval. Nothing goes to the client until the approver has reviewed it.",
        );
        if (warning) toast.warning(warning);
        onChanged?.();
      },
    });
  };
  /* Approver rights, less the creator's own proposal when self-approval
     is switched off (lib/amc/workflow.ts). */
  const canDecide = canDecideProposal({ canApprove, isOwner: submission.is_own !== false });
  /* Sent by its owner or the team by role (DEV-368), as on the server. */
  const sendable = onSend && canAct ? sendableDocument(submission) : null;
  /* DEV-505: approved by the client, and the contract record is missing (null = looked and not found). */
  const contractMissing = ["proposal_approved", "contract_sent", "signed"].includes(submission.status) && submission.contract_id === null;
  const [creatingContract, setCreatingContract] = useState(false);
  const createContract = async () => {
    setCreatingContract(true);
    try {
      await amcRequest("/api/amc-submissions/contract", { method: "POST", body: JSON.stringify({ id: submission.id }) });
      toast.success("Contract record created");
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the contract record.");
    } finally {
      setCreatingContract(false);
    }
  };
  const resend = sendable ? lastSentAt(submission, sendable) : null;
  const baseStage = STAGE[submission.status] ?? { next: "", tone: "neutral" as const };
  // Someone who cannot send it is told who does.
  const sender = !canAct ? submission.owner_name || "the owner" : null;
  const stage =
    sender && submission.status === "approved"
      ? { ...baseStage, next: `Approved. ${sender} sends it to the client` }
      : sender && submission.status === "proposal_approved"
        ? { ...baseStage, next: `Client accepted. ${sender} sends the contract` }
        : submission.status === "proposal_rejected" && !clientAskedForChanges(submission.client_rejected_reason)
          ? { ...baseStage, next: "The client declined it. Revise it to send again" }
          : baseStage;
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
    // The router's own state, so Next leaves the entry alone: a new ?tab=
    // through Next re-keys the page and remounts it, refetching everything.
    window.history.replaceState(window.history.state, "", `?${query.toString()}`);
  }, []);
  /* A stale or mistyped ?tab= falls back to the record rather than
     leaving the page below the tab bar empty. */
  const activeTab = TABS.has(tab ?? "") ? (tab as string) : "record";
  const mounted = useMemo(() => new Set([...opened, activeTab]), [opened, activeTab]);
  /* A tab's body, mounted on first open and kept after. */
  const panel = (value: string, children: ReactNode) =>
    mounted.has(value) ? (
      <TabsContent
        value={value}
        forceMount
        className="mt-4 flex flex-col gap-6 data-[state=inactive]:hidden"
      >
        {children}
      </TabsContent>
    ) : null;

  /* The History tab, a page at a time: a proposal that has been round the
     ladder a few times carries an entry for every step of every round. */
  const [historyPage, setHistoryPage] = useState(0);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const historyRows = orderedTimeline.slice(
    historyPage * historyPageSize,
    (historyPage + 1) * historyPageSize,
  );

  /* The header's own dialogs, opened from its "More" menu. */
  const [reviseOpen, setReviseOpen] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const isOwn = submission.is_own !== false;
  const revisable = canReviseProposal(submission);
  const answerable = canAct && canRecordClientAnswer(submission);
  /* DEV-368: take it over, or give it to someone else. */
  const ownerActions =
    canAct
      ? {
          takeOver: isOwn
            ? null
            : () =>
                void confirm({
                  title: "Take over this proposal?",
                  description: `You become its owner instead of ${submission.owner_name || "its current owner"}: you edit, send and revise it, and get its notices. The change is kept on its history.`,
                  confirmText: "Take over",
                  action: async () => {
                    await takeOverProposal(submission.id);
                    toast.success("You own this proposal now");
                    onChanged?.();
                  },
                }),
          change: () => setOwnerOpen(true),
        }
      : null;
  const canDecideNow = canDecide && awaiting;
  /* Who decides the open level, named, so nobody waits on a button they will never get. */
  const deciders = submission.approval_deciders;
  const decidersText = deciders
    ? deciders.names === null
      ? "anyone whose role has the AMC approve permission"
      : deciders.names.length
        ? listNames(deciders.names)
        : "nobody yet: add an approver in AMC Settings or AMC Configuration"
    : null;
  /*
    Who decides, said plainly (23 Nov 2026). When the level's only named
    approver wrote the proposal, it goes to the AMC approvers instead, and
    the page says why rather than naming them as that level's approvers.
  */
  const levelName = deciders?.levelName || "this level";
  const insteadBy =
    deciders?.names === null
      ? "anyone whose role has the AMC approve permission decides it instead"
      : deciders?.names?.length
        ? `${listNames(deciders.names)} decide${deciders.names.length === 1 ? "s" : ""} it instead`
        : "nobody else can decide it yet: add an approver in AMC Settings or AMC Configuration";
  const decidedBy = !decidersText
    ? ""
    : deciders?.skippedOwner
      ? isOwn
        ? `You are the ${levelName} approver, but you wrote this proposal, so ${insteadBy}.`
        : `The ${levelName} approver is ${deciders.skippedOwner}, who wrote this proposal and cannot approve it, so ${insteadBy}.`
      : `${deciders?.levelName ? `${deciders.levelName} is decided by ` : "It is decided by "}${decidersText}.`;
  const waitingBody = !decidersText
    ? "It is locked while it waits. Nothing goes to the client until it is approved."
    : isOwn
      ? `${decidedBy} Nothing goes to the client until it is approved.`
      : `${decidedBy} It is locked while it waits.`;
  /*
    Where the ladder stands (24 Nov 2026): after level 1 approves, the
    proposal waits for the next level, which the same person may also decide.
    Saying "level 2 of 2, AMC department head approved" shows it moved on.
  */
  const progress = deciders?.progress ?? null;
  const atLevel = progress && progress.of > 1 ? `Level ${progress.position} of ${progress.of}: ${deciders?.levelName ?? "approval"}` : null;
  const approvedBefore = progress?.approved.length
    ? progress.approved.map((a) => `${a.levelName} approved${a.by ? ` by ${a.by}` : ""}${a.at ? ` on ${format(new Date(a.at), "d MMM yyyy")}` : ""}`).join("; ") + "."
    : "";
  const thenNext = progress?.nextLevelName ? ` After this level it goes to ${progress.nextLevelName}.` : "";
  const belowFloorNote = submission.below_floor ? " One or more lines are priced below the floor rate: see What to check before approving." : "";

  /* The one thing on this proposal that needs somebody's attention. */
  const attention =
    submission.status === "sent_back" && submission.sent_back_reason
      ? { tone: "bad" as const, title: "Sent back by the approver", body: submission.sent_back_reason }
      : submission.status === "proposal_rejected" && submission.client_rejected_reason
        ? {
          tone: "bad" as const,
          title: `${clientAskedForChanges(submission.client_rejected_reason) ? "The client asked for changes" : "The client declined the proposal"}${submission.client_decided_by_name ? ` (${submission.client_decided_by_name})` : ""}`,
          body: clientAskedForChanges(submission.client_rejected_reason)
            ? submission.client_rejected_reason.slice(REVISION_PREFIX.length)
            : submission.client_rejected_reason,
        }
        : awaiting
          ? {
            tone: "warn" as const,
            title: canDecide
              ? atLevel
                ? `Waiting for your decision · ${atLevel}`
                : "Waiting for your decision"
              : atLevel
                ? `Waiting for approval · ${atLevel}`
                : "Waiting for the approver",
            body: [
              approvedBefore,
              canDecide
                ? `Read it through, preview the documents, then approve it or send it back with a note.${thenNext}`
                : `${waitingBody}${thenNext}`,
              belowFloorNote.trim(),
            ]
              .filter(Boolean)
              .join(" "),
          }
        : submission.below_floor && (submission.status === "draft" || submission.status === "sent_back")
          ? {
            tone: "warn" as const,
            title: "Priced below the floor rate",
            body: "After the discount, one or more lines are under the rate card's floor. The approver sees this when deciding.",
          }
          : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {/* The proposal at a glance, and what can be done with it. */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">AMC proposal</Badge>
              {submission.customer.proposalNumber ? (
                <Badge variant="outline" className="tabular-nums">
                  {submission.customer.proposalNumber}
                </Badge>
              ) : null}
              {(submission.current_version ?? 1) > 1 ? (
                <Badge variant="outline">V{submission.current_version}</Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl">{title}</h2>
              <Badge variant="secondary" className={`border-0 font-medium ${amcStatusTone(submission.status)}`}>
                {AMC_STATUS_LABELS[submission.status] ?? submission.status}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {[
                form.propertyAddress,
                sentenceCase(data.propertyTypeLabel),
                !isOwn && submission.owner_name
                  ? `submitted by ${submission.owner_name}`
                  : "yours",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          {/*
            Two or three buttons, the one this proposal is waiting on last;
            everything else is under More, so the row reads as "the next
            step" rather than as every action the page can take.
          */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => onView(submission, "proposal")}>
              <EyeIcon className="size-4" />
              Preview
            </Button>

            {/* Downloads live in Preview (23 Nov 2026): More holds the other actions only. */}
            <MoreActions
              revise={
                revisable
                  ? {
                      /* Approved and not sent: it reopens as a draft of the same version. */
                      label: `${submission.status === "approved" ? "Revise before sending" : "Revise"} (V${(submission.current_version ?? 1) + 1})`,
                      onSelect: () => setReviseOpen(true),
                    }
                  : null
              }
              recordAnswer={answerable ? () => setAnswerOpen(true) : null}
              owner={ownerActions}
              reject={null}
              rejectDisabled={deciding}
            />
            <ChangeOwnerDialog open={ownerOpen} onOpenChange={setOwnerOpen} proposalId={submission.id} onChanged={onChanged} />

            <SignedContractAction submission={submission} />

            {canDecideNow ? (
              <>
                {onReject ? (
                  <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={deciding}
                    onClick={() => onReject(submission)}
                  >
                    <XCircle className="size-4" />
                    Reject
                  </Button>
                ) : null}
                <Button variant="outline" disabled={deciding} onClick={() => onSendBack?.(submission)}>
                  <Undo2 className="size-4" />
                  Return
                </Button>
                <SubmitButton
                  pending={deciding}
                  pendingLabel="Approving…"
                  icon={<CheckCircle2 className="size-4" />}
                  onClick={() => onApprove?.(submission)}
                >
                  Approve
                </SubmitButton>
              </>
            ) : contractMissing && canAct ? (
              <SubmitButton pending={creatingContract} pendingLabel="Creating…" icon={<FileText className="size-4" />} onClick={() => void createContract()}>
                Create contract record
              </SubmitButton>
            ) : sendable && onSend ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button disabled={sending} aria-busy={sending}>
                    {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    {resend ? `Send ${sendable} again` : `Send ${sendable}`}
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {sendable === "proposal" && onShare ? (
                    <>
                      <DropdownMenuItem onClick={() => onShare(submission)}>
                        <Send className="size-4" />
                        Share ({submission.property.propertyCategory === "commercial" ? "email" : "WhatsApp"})
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  <DropdownMenuItem onClick={() => onSend(submission, sendable, "whatsapp")}>
                    <MessageCircle className="size-4" />
                    WhatsApp
                  </DropdownMenuItem>
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
            ) : submittable ? (
              <>
                <Button asChild variant="outline">
                  <Link href={`/extensions/amc/${submission.id}/edit`}>
                    <SquarePen className="size-4" />
                    Edit
                  </Link>
                </Button>
                <Button onClick={submitForApproval}>
                  <Send className="size-4" />
                  {submission.status === "sent_back" ? "Submit again" : "Submit for approval"}
                </Button>
              </>
            ) : canEdit ? (
              <Button asChild>
                <Link href={`/extensions/amc/${submission.id}/edit`}>
                  <SquarePen className="size-4" />
                  Edit
                </Link>
              </Button>
            ) : null}
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

      {confirmDialog}
      {revisable ? (
        <ReviseProposalDialog submission={submission} open={reviseOpen} onOpenChange={setReviseOpen} />
      ) : null}
      {answerable ? (
        <RecordClientAnswerDialog
          submission={submission}
          open={answerOpen}
          onOpenChange={setAnswerOpen}
          onRecorded={() => onChanged?.()}
        />
      ) : null}

      {/* The four figures that matter, under the header as on a job. */}
      <StatCardGrid columns={4}>
        <StatCard
          label="Grand total"
          value={<Money value={totals.grandTotal} />}
          headline={`${formatCurrencyAED(totals.finalPrice)} ${termFeePhrase(totals.termMonths)} before VAT`}
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
          caption={`Paid ${formatPaymentLabel(form, totals.termMonths).toLowerCase()}`}
        />
        <StatCard
          label="Stage"
          value={AMC_STATUS_LABELS[submission.status] ?? submission.status}
          headline={submission.status === "awaiting_approval" && submission.approval_deciders?.progress && submission.approval_deciders.progress.of > 1 ? `Level ${submission.approval_deciders.progress.position} of ${submission.approval_deciders.progress.of}: ${submission.approval_deciders.levelName}` : stage.next}
          caption={`Updated ${timeAgo(submission.updated_at)}`}
          tone={stage.tone}
        />
      </StatCardGrid>

      {/* What the approver checks against the rules (23 Nov 2026); before submitting, what will need approval. */}
      {submission.approval_checklist?.length ? (
        <ApprovalChecklistCard checks={submission.approval_checklist} waiting={submission.status === "awaiting_approval"} />
      ) : null}

      {contractMissing ? (
        <Alert variant="danger">
          <TriangleAlert className="text-danger" />
          <AlertTitle>The contract record was not created</AlertTitle>
          <AlertDescription>
            The client approved this proposal, but its contract was not made, so the contract cannot be sent or signed yet. The reason is in the History tab.
            {canAct ? " Choose Create contract record to try again." : ` Ask ${submission.owner_name || "the owner"} to create it.`}
          </AlertDescription>
        </Alert>
      ) : null}

      {/*
        The record, in tabs, the same shape as a job page. The header above
        stays put, because the actions are there and they apply whichever
        tab is open.
      */}
      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
          {/*
            "Details" rather than "Property & client": the tab holds the
            property, the client, the contract dates and everyone named on
            it, and a title that lists two of those four reads as though the
            rest are somewhere else.
          */}
          <TabsTrigger value="record">Details</TabsTrigger>
          <TabsTrigger value="services">
            Services &amp; cost
            <TabCount value={data.frequencyRows.length} />
          </TabsTrigger>
          <TabsTrigger value="versions">
            Versions
            <TabCount value={submission.current_version ?? 1} />
          </TabsTrigger>
          <TabsTrigger value="approvals">Approvals &amp; sends</TabsTrigger>
          <TabsTrigger value="history">
            History
            <TabCount value={timeline.length} />
          </TabsTrigger>
        </TabsList>

        {panel(
          "record",
          <>
            {/* Signed: the archived signed contract, apart from the
                generated documents in the Download menu. */}
            {submission.status === "signed" ? <SignedArchiveRow submissionId={submission.id} /> : null}

            {/*
              As on main: what the proposal is written for in one card, its
              facts in a grid, and everyone named on it in a card of its own
              under it. Four small cards side by side read as four records
              rather than one proposal.
            */}
            <SectionCard
              icon={<Building2 />}
              title="Property and customer"
              description="What the proposal and the contract are written for."
              bodyClassName="px-5 pb-5"
            >
              <dl className="grid gap-x-6 gap-y-4 rounded-lg border p-4 sm:grid-cols-2 xl:grid-cols-4">
                <Fact label="Customer">{form.customerName}</Fact>
                <Fact label="Customer ID">{form.customerId}</Fact>
                <Fact label="Phone">{formatPhoneForDocument(form.customerPhone)}</Fact>
                <Fact label="Email">{form.customerEmail}</Fact>
                <Fact label="Property category">{sentenceCase(form.propertyCategory)}</Fact>
                <Fact label="Unit type">{sentenceCase(form.unitType)}</Fact>
                <Fact label="Property detail">{form.propertyDetail}</Fact>
                <Fact label="Address">{form.propertyAddress}</Fact>
                <Fact label="Contract period">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarRange className="text-muted-foreground size-3.5" aria-hidden />
                    {formatDisplayDate(form.startDate) || "—"} → {data.endDate || "—"}
                  </span>
                </Fact>
                <Fact label="Payment terms">{formatPaymentLabel(form, totals.termMonths)}</Fact>
                <Fact label="Proposal number">
                  {submission.customer.proposalNumber
                    ? `${submission.customer.proposalNumber}${(submission.current_version ?? 1) > 1 ? ` · V${submission.current_version}` : ""}`
                    : null}
                </Fact>
                <Fact label="Property type">{sentenceCase(data.propertyTypeLabel)}</Fact>
                <Fact label="Valid until">
                  {submission.valid_until ? formatDisplayDate(submission.valid_until) : "Set when the proposal is sent"}
                </Fact>
                {submission.enquiry_id ? (
                  <Fact label="Enquiry">
                    <Link
                      href={`/extensions/amc-contracts/enquiries/${submission.enquiry_id}`}
                      className="hover:text-brand underline underline-offset-2"
                    >
                      Open the enquiry
                    </Link>
                  </Fact>
                ) : null}
              </dl>
            </SectionCard>

            <SectionCard
              icon={<Users />}
              title="Contacts"
              description="Who the team coordinates with on the client's side, and who the client calls on ours."
              bodyClassName="space-y-6 px-5 pb-5"
            >
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
            </SectionCard>
          </>,
        )}

        {panel(
          "services",
          <SectionCard
            icon={<ListCheck />}
            title="Services and cost"
            description="As it appears in the documents, with the total before and after 5% VAT."
            bodyClassName="px-5 pb-5"
          >
            <ServicesAndCost rows={data.frequencyRows} totals={totals} />
            {editedWording.length > 0 ? (
              <div className="mt-3 rounded-lg border border-dashed p-3 text-sm">
                <p className="font-medium">Contract wording edited for this proposal</p>
                <p className="text-muted-foreground mt-0.5">
                  {editedWording.join(", ")}. Preview the contract to read the edited text.
                </p>
              </div>
            ) : null}
          </SectionCard>,
        )}

        {panel("versions", <ProposalVersionsPanel submission={submission} />)}
        {panel("approvals", <ApprovalsAndSendsPanel submission={submission} />)}

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
                onValueChange={(value) => {
                  setHistoryOrder(value as "desc" | "asc");
                  setHistoryPage(0);
                }}
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
              square, what happened, who by, and when on the right.
            */}
            <ol className="divide-y">
              {historyRows.map((step, index) => {
                const Icon =
                  step.tone === "good"
                    ? CheckCircle2
                    : step.tone === "bad"
                      ? XCircle
                      : Circle;
                return (
                  <li key={`${step.label}-${historyPage}-${index}`}>
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
            <ListPager
              page={historyPage}
              pageSize={historyPageSize}
              total={orderedTimeline.length}
              onPageChange={setHistoryPage}
              onPageSizeChange={setHistoryPageSize}
              noun="events"
              className="border-t"
            />
          </SectionCard>,
        )}
      </Tabs>
    </div>
  );
}

/**
 * The header's "More" menu: the actions that are not this proposal's next
 * step. The documents are downloaded from Preview (23 Nov 2026).
 */
function MoreActions({
  revise,
  recordAnswer,
  owner = null,
  reject,
  rejectDisabled,
}: {
  revise: { label: string; onSelect: () => void } | null;
  recordAnswer: (() => void) | null;
  /** DEV-368: take it over, or change its owner. */
  owner?: { takeOver: (() => void) | null; change: () => void } | null;
  reject: (() => void) | null;
  rejectDisabled: boolean;
}) {
  if (!revise && !recordAnswer && !reject && !owner) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <MoreHorizontal className="size-4" />
          More
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
              {/* BRD 5.4: a shared proposal is changed through a new version. */}
              {revise ? (
                <DropdownMenuItem onClick={revise.onSelect}>
                  <GitBranch className="size-4" />
                  {revise.label}
                </DropdownMenuItem>
              ) : null}
              {/* BRD 5.6: an answer given outside the link, with evidence. */}
              {recordAnswer ? (
                <DropdownMenuItem onClick={recordAnswer}>
                  <Inbox className="size-4" />
                  Record the client&apos;s answer
                </DropdownMenuItem>
              ) : null}
              {/* DEV-368: the team by role picks a proposal up. */}
              {owner?.takeOver ? (
                <DropdownMenuItem onClick={owner.takeOver}>
                  <UserCheck className="size-4" />
                  Take over
                </DropdownMenuItem>
              ) : null}
              {owner ? (
                <DropdownMenuItem onClick={owner.change}>
                  <Users className="size-4" />
                  Change owner…
                </DropdownMenuItem>
              ) : null}
              {reject ? (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={rejectDisabled}
                  onClick={reject}
                >
                  <XCircle className="size-4" />
                  Reject…
                </DropdownMenuItem>
              ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
