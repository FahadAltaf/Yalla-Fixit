"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarPlus,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FileText,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingTask } from "@/types/types";

import { AdditionalVisitDialog } from "./additional-visit-dialog";
import { SNAGGING_APPROVALS_CHANGED } from "./approval-notice";
import { DesnagQuotationDialog } from "./desnag-quotation-dialog";
import { OpenRoundDialog } from "./open-round-dialog";
import { RejectInspectionDialog } from "./reject-inspection-dialog";
import {
  StatCard,
  StatCardGrid,
  SubmitButton,
  TaskStatusBadge,
  useConfirm,
} from "./shared";

/**
 * The inspection at a glance, and the decision that can be taken on it.
 *
 * Carries the four numbers a manager decides on (snags, high severity,
 * area coverage, media received) and the Approve / Send back actions.
 * Split out of the review panel so the job detail page can pin it above
 * its tabs while the approvals workspace keeps it stacked — approving is
 * the point of both screens, so it should never be scrolled away from.
 */
export function InspectionHeaderCard({
  task,
  onChanged,
  onVisitsChanged,
  pending = {},
}: {
  task: SnaggingTask;
  /*
    Re-reads the job. Awaited: an action keeps its button busy until the
    page shows the result, so the old buttons never flash back first.
  */
  onChanged: () => void | Promise<unknown>;
  /** After a visit is added here; defaults to `onChanged`. */
  onVisitsChanged?: () => void | Promise<unknown>;
  /**
   * Sections of the job still on their way, where the page loads them
   * separately. The header renders from the core job at once; what depends
   * on the snags (the numbers, the approval check) or on the de-snag
   * quotation (its button) waits for those rather than showing a zero.
   */
  pending?: { snags?: boolean; desnag?: boolean };
}) {
  const { userProfile } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [working, setWorking] = useState(false);
  const [roundOpen, setRoundOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);

  const canCreate = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.CREATE,
  );

  /*
    Who may act on this inspection: the two people named on it.

    FR-6.01 — the reviewer checks the evidence, the approval manager
    decides. Both are named per job, on Setup, and neither a permission
    nor the admin role stands in for being named. That is a change:
    these gates used to admit anyone holding Snagging's `approve` grant
    plus every admin, so an administrator who was on no part of a job
    could sign off a report that goes to a client under the named
    manager's name. The server now refuses exactly what is refused here
    — the same two tests, in the same order — so a missing button is
    always "not your step" rather than a 403 waiting to happen.
  */
  const isApprovalManager = Boolean(
    task.approval_manager_id && userProfile?.id === task.approval_manager_id,
  );
  /*
    Where no reviewer is named the approval manager reviews it themselves,
    which is what keeps a job with nobody on that dropdown moving. Where a
    reviewer IS named the manager is not a stand-in for them: one person
    checks and a different person decides, or the second signature means
    nothing. Mirrors `isDesignatedReviewer` on the server exactly.
  */
  const isReviewer = task.reviewer_id
    ? userProfile?.id === task.reviewer_id
    : isApprovalManager;
  const canReview = isReviewer;
  const canDecide = isApprovalManager;
  const managerName = task.manager?.full_name ?? task.manager?.email ?? null;
  /*
    One person wearing both hats: no reviewer is named, so the approval
    manager checks the work and then decides on it. For them the review
    is finished on the same click that starts it, and Approve and Send
    back appear straight away — handing a job to yourself and then being
    shown a button to accept what you just handed over is a step that
    exists only in the data model.

    Where the reviewer and the manager are DIFFERENT people the two steps
    stay, because the gap between them is the review (FR-6.01).
  */
  const selfReview = isReviewer && isApprovalManager;
  /*
    Two ways to end up doing both halves, and they are not the same
    sentence. Either the job names nobody to review it and the manager
    picks that up by default, or the job names the manager themselves in
    both seats. Telling the second person "no reviewer is named" is
    simply false -- they are looking at their own name in the Reviewer
    field on the next tab.
  */
  const namedToBoth = selfReview && Boolean(task.reviewer_id);
  const reviewerName = task.reviewer?.full_name ?? task.reviewer?.email ?? null;
  // The reviewer's hand-off. Until this is set the server refuses both
  // approve and reject, so neither button is offered.
  const reviewComplete = Boolean(task.reviewed_at);

  const unitLabel = task.property?.unit_label ?? "this inspection";

  /*
    After a decision: re-read the job, then tell the module's "Waiting on
    you" notice to re-read its queue. Without the second half the job
    leaves this card and stays on the notice until the next poll, so the
    reviewer who has just cleared it is still being told to do it.
  */
  const decided = async () => {
    await onChanged();
    window.dispatchEvent(new Event(SNAGGING_APPROVALS_CHANGED));
  };

  const snags = useMemo(() => task.snags ?? [], [task]);
  const areas = task.areas ?? [];

  const highCount = snags.filter((snag) => snag.severity === "high").length;
  /*
    Every room counts, the way the client's report counts them.

    A room is walked once it is signed off on the original walk, or once
    the visit that added it is approved -- rooms have no finish tick on a
    visit, so that approval is their sign-off. Counting only the walk's
    rooms read "6 / 6" beside "Across 8 areas"; counting sign-offs alone
    held it at "6 / 7" on an approved job. A room from a visit still with
    the manager is neither: it is said separately.
  */
  const pendingVisits = new Set(task.unapproved_visit_ids ?? []);
  const fromPendingVisit = (area: (typeof areas)[number]) =>
    Boolean(area.visit_id && pendingVisits.has(area.visit_id));
  const walkedAreas = areas.filter(
    (area) => Boolean(area.confirmed_at) || Boolean(area.visit_id && !fromPendingVisit(area)),
  ).length;
  const awaitingReviewAreas = areas.filter(
    (area) => !area.confirmed_at && fromPendingVisit(area),
  ).length;
  // Only the original walk's rooms can be left unfinished.
  const unconfirmedWalkAreas = areas.filter((area) => !area.confirmed_at && !area.visit_id);
  const pendingArea = unconfirmedWalkAreas[0];

  /*
    What a de-snag round is measured on: the carried defects, and how many
    of them have been given a verdict. A defect raised ON this round is not
    counted — it is a new find, not something the round went back for.
  */
  /*
    A de-snag round, not merely "not the first visit".

    This read round_number > 1, which is also true of every additional
    visit — so a visit showed "Defects re-checked 0 / 0", a de-snagging
    metric, on a workflow that carries no defects to re-check. The two
    are different jobs and are told apart by visit_type, never by number.
  */
  const isRound = task.visit_type === "desnag";
  const carried = snags.filter(
    (snag) => (snag.round_created ?? 1) < (task.round_number ?? 1),
  );
  const carriedCount = carried.length;
  const ruledCount = carried.filter(
    (snag) => snag.status !== "pending_verification",
  ).length;
  const accessIssues = areas.filter(
    (area) => area.access_state && area.access_state !== "accessible",
  );
  const photoTotal = snags.reduce(
    (sum, snag) => sum + (snag.photos?.length ?? 0),
    0,
  );
  const snagsWithPhoto = snags.filter(
    (snag) => (snag.photos?.length ?? 0) > 0,
  ).length;

  const awaitingDecision =
    task.status === "submitted" || task.status === "in_review";

  // FR-6.07 — flag an approval that has waited longer than the 48h SLA.
  // The clock is read during render deliberately: this panel only ever
  // renders once its task has been fetched on the client, so there is no
  // server pass to disagree with. Deferring it to an effect instead just
  // costs a second render and flashes "not overdue" first.
  const submittedMs = task.submitted_at ? Date.parse(task.submitted_at) : NaN;
  const approvalOverdue =
    awaitingDecision &&
    !Number.isNaN(submittedMs) &&
    submittedMs + 48 * 60 * 60 * 1000 < Date.now();

  async function completeReview() {
    // Hands the inspection on; the reviewer cannot take it back after.
    const ok = await confirm({
      title: selfReview ? "Finish your review?" : "Complete your review?",
      description: namedToBoth
        ? `You are both the reviewer and the approval manager on ${unitLabel}. Approve and Send back appear once your review is done.`
        : selfReview
          ? `No reviewer is named on ${unitLabel}, so you review it as its approval manager. Approve and Send back appear once this is done.`
          : managerName
            ? `You are the reviewer on ${unitLabel}. Completing your review hands it to ${managerName} to approve or send back.`
            : `You are the reviewer on ${unitLabel}. Completing your review hands it to its approval manager to approve or send back.`,
      confirmText: "Complete review",
      /*
        The dialog does the work and stays open until the page shows the
        next step. It used to close on Confirm and leave the card to catch
        up, so the seconds in between looked like nothing had happened --
        and a failure landed as a toast over a card that still offered the
        button that had just failed.
      */
      action: async () => {
        setWorking(true);
        try {
          await snaggingService.completeReview(task.id);
          await decided();
        } finally {
          setWorking(false);
        }
      },
    });
    if (!ok) return;

    toast.success(
      selfReview
        ? "Review complete. You can approve it or send it back now."
        : managerName
          ? `Review complete. ${managerName} can now approve it or send it back.`
          : "Review complete. Its approval manager can now decide.",
    );
  }

  /*
    The reviewer's whole step, on one click.

    It was two: Start review, then a second button to hand the job on.
    Starting a review is not a decision anybody makes — nobody opens an
    inspection meaning to claim it and stop — and with the reviewer named
    on the job there is no queue to claim from either, so the first click
    only ever recorded that the second one was coming. Reviewing the
    evidence happens on the page, by reading it; this button is the
    reviewer saying they are satisfied, which is what "Complete review"
    means. The request still writes both stamps, so the audit trail keeps
    its start and its finish.
  */
  async function reviewAndHandOn() {
    const ok = await confirm({
      title: selfReview ? "Finish your review?" : "Complete your review?",
      description: namedToBoth
        ? `You are both the reviewer and the approval manager on ${unitLabel}. Approve and Send back appear once your review is done.`
        : selfReview
          ? `No reviewer is named on ${unitLabel}, so you review it as its approval manager. Approve and Send back appear once this is done.`
          : managerName
            ? `You are the reviewer on ${unitLabel}. Completing your review hands it to ${managerName} to approve or send back.`
            : `You are the reviewer on ${unitLabel}. Completing your review hands it to its approval manager to approve or send back.`,
      confirmText: "Complete review",
      /*
        Open, and undismissable, until the page shows what comes next.
        The dialog used to close the moment Confirm was pressed and the
        card caught up a second or two later, so the click appeared to do
        nothing at all.
      */
      action: async () => {
        setWorking(true);
        try {
          await snaggingService.reviewTask(task.id, undefined, { complete: true });
          await decided();
        } finally {
          setWorking(false);
        }
      },
    });
    if (!ok) return;

    toast.success(
      selfReview
        ? "Review complete. You can approve it or send it back now."
        : managerName
          ? `Review complete. ${managerName} can now approve it or send it back.`
          : "Review complete. Its approval manager can now decide.",
    );
  }

  async function approve() {
    // Approving accepts liability for the report and unlocks it for
    // delivery to the client, so it asks first — and says plainly what
    // is still outstanding, because the counts above are easy to skim
    // past.
    const outstanding = [
      snagsWithPhoto < snags.length
        ? `${snags.length - snagsWithPhoto} snag(s) have no photo`
        : null,
      unconfirmedWalkAreas.length > 0
        ? `${unconfirmedWalkAreas.length} area(s) not confirmed`
        : null,
      accessIssues.length > 0
        ? `${accessIssues.length} area(s) with access issues`
        : null,
    ].filter(Boolean);

    const ok = await confirm({
      title: `Approve ${task.property?.unit_label ?? "this inspection"}?`,
      description: outstanding.length
        ? `This accepts the inspection and lets the report go to the client. Still outstanding: ${outstanding.join(", ")}.`
        : "This accepts the inspection and lets the report go to the client.",
      confirmText: "Approve inspection",
      // Open until the page shows the approved job.
      action: async () => {
        setWorking(true);
        try {
          await snaggingService.approveTask(task.id);
          await decided();
        } finally {
          setWorking(false);
        }
      },
    });
    if (!ok) return;

    toast.success(
      "Inspection approved. Open the report to send it to the client.",
    );
  }

  /*
    How many defects carry into the round.

    Only counted for the dialog's summary — the server decides what
    actually carries, and now reads the whole family rather than this job
    alone, so a defect first raised on an earlier round is included there
    even though this list cannot see it.
  */
  const carryingCount = snags.filter(
    (snag) =>
      snag.status === "open" ||
      snag.status === "pending_verification" ||
      snag.status === "verified_poor_quality" ||
      snag.status === "verified_not_done",
  ).length;

  /*
    Where the de-snag stands, so the button offers the step it is at.

    A de-snag is a new job raised through Quotations (change 31): the
    client approves a quotation for the return visit first. The button
    used to open the round dialog straight away, and the server refused
    it after the date and time were filled in -- "no de-snag quotation
    yet, raise one from Quotations" -- with nothing on the page to do so.
  */
  const router = useRouter();
  const desnagQuote = task.desnag_quotation ?? null;
  const desnagStep: "quote" | "awaiting" | "open" =
    !desnagQuote ||
    desnagQuote.status === "rejected" ||
    (desnagQuote.status === "approved" && desnagQuote.job_id)
      ? "quote"
      : desnagQuote.status === "approved"
        ? "open"
        : "awaiting";

  // The amount is chosen inside the card's range before anything is raised.
  const [desnagQuoteOpen, setDesnagQuoteOpen] = useState(false);

  async function openRound(input: {
    scheduled_date: string;
    appointment_at: string | null;
  }) {
    setWorking(true);
    try {
      const round = await snaggingService.openRound(task.id, input);
      toast.success(
        `Round ${round.round_number} opened with ${round.carried_snags} snag(s)`,
      );
      window.location.href = `/snagging/${round.id}?tab=snags`;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not open a round",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {task.visit_type === "additional" ? (
                <Badge variant="outline">Additional visit</Badge>
              ) : task.round_number > 1 ? (
                <Badge variant="outline">Round {task.round_number}</Badge>
              ) : null}
              {task.visit_type === "additional" &&
              (task.visit_charge ?? 0) > 0 ? (
                <span className="text-muted-foreground text-xs">
                  Charge AED {task.visit_charge!.toLocaleString()}
                </span>
              ) : null}
              {approvalOverdue ? (
                <span className="bg-danger/10 text-danger inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold">
                  <AlertTriangle className="size-3.5" />
                  Approval overdue (48h SLA)
                </span>
              ) : null}
            </div>
            <div className="flex flex-row items-center gap-2">
              <h2 className="text-2xl">{task.property?.unit_label}</h2>
              <TaskStatusBadge status={task.status} />
              {/*
                No job code. It is an internal handle, and the unit label
                beside it is what people actually recognise; the round or
                visit badge above carries the one thing the code's suffix
                was telling anybody. The id stays behind a copy button
                because support still needs it.
              */}
              <CopyId id={task.id} />
            </div>
            <p className="text-muted-foreground text-sm">
              {[
                task.property?.building_name,
                task.property?.client_name,
                /*
                  Every inspector on the job, not whichever one the list
                  happened to return first. None of them is senior to
                  another, so naming one and dropping the rest credited
                  the wrong person as readily as the right one.
                */
                (() => {
                  const names = (task.assignees ?? [])
                    .filter((a) => a.role === "technician")
                    .map((a) => a.user_profile?.full_name ?? a.user_profile?.email)
                    .filter((name): name is string => Boolean(name));
                  return names.length > 0
                    ? `inspected by ${names.join(", ")}`
                    : null;
                })(),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {["submitted", "in_review", "approved", "delivered"].includes(
              task.status,
            ) ? (
              <Button asChild variant="outline">
                <Link href={`/snagging/${task.id}/report`}>
                  <FileText className="size-4" />
                  Report
                </Link>
              </Button>
            ) : null}
            {/*
              FR-6.01 — the chain has three stops, and the card shows the one
              it is at: pick it up, hand it on, decide. Each button is offered
              only to the person the server will accept it from, so a missing
              button is always "not your step" rather than a 403.
            */}
            {awaitingDecision && task.status === "submitted" && canReview ? (
              <SubmitButton
                onClick={() => void reviewAndHandOn()}
                pending={working}
                pendingLabel="Completing…"
                icon={<ClipboardCheck className="size-4" />}
              >
                Complete review
              </SubmitButton>
            ) : awaitingDecision &&
              task.status === "in_review" &&
              !reviewComplete &&
              canReview ? (
              /*
                A job already in review when it reached this card — one
                started before the two clicks became one, or left open by
                somebody else. Without this it would be stranded, so the
                hand-off keeps its own button; it reads the same as the
                one above because it does the same thing.
              */
              <SubmitButton
                onClick={() => void completeReview()}
                pending={working}
                pendingLabel="Completing…"
                icon={<ClipboardCheck className="size-4" />}
              >
                Complete review
              </SubmitButton>
            ) : awaitingDecision && reviewComplete && canDecide ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setRejectOpen(true)}
                  disabled={working}
                >
                  <XCircle className="size-4" />
                  Send back
                </Button>
                <SubmitButton
                  onClick={() => void approve()}
                  pending={working}
                  pendingLabel="Approving…"
                  // The approval checks the snags' photos first; it cannot
                  // until they have loaded.
                  disabled={pending.snags}
                  icon={<CheckCircle2 className="size-4" />}
                >
                  Approve inspection
                </SubmitButton>
              </>
            ) : awaitingDecision ? (
              /*
                Waiting on somebody else. Naming them turns a missing set of
                buttons into an answer — otherwise a coordinator is left
                wondering whether the page is broken or they simply are not
                the person it is waiting on.
              */
              /*
                Waiting on somebody, named. Each line says which of the
                two steps the job is at and who holds it, because with
                the buttons gone that is the whole answer to "why can I
                not do anything here". Where no reviewer is named the
                approval manager is reviewing it, so they are the one
                named — "the reviewer" would point at an empty seat.
              */
              <span className="text-muted-foreground text-sm">
                {task.status === "submitted"
                  ? (reviewerName ?? managerName)
                    ? `Waiting for ${reviewerName ?? managerName} to review it`
                    : "Nobody is named to review this. Assign a reviewer or an approval manager on Setup."
                  : !reviewComplete
                    ? (reviewerName ?? managerName)
                      ? `${reviewerName ?? managerName} is reviewing it`
                      : "Under review"
                    : managerName
                      ? `Reviewed. Waiting for ${managerName} to approve it`
                      : "Reviewed. No approval manager is named, so assign one on Setup."}
              </span>
            ) : null}
            {(task.status === "approved" || task.status === "delivered") &&
            canCreate &&
            !pending.desnag ? (
              <>
                {desnagStep === "quote" ? (
                  <SubmitButton
                    variant="outline"
                    onClick={() => setDesnagQuoteOpen(true)}
                    pending={false}
                    disabled={working}
                    icon={<RotateCcw className="size-4" />}
                  >
                    Quote de-snag
                  </SubmitButton>
                ) : desnagStep === "awaiting" ? (
                  <Button variant="outline" asChild>
                    <Link href={`/snagging/quotations/${desnagQuote!.id}`}>
                      <FileText className="size-4" />
                      De-snag quotation · {desnagQuote!.status === "draft" ? "Draft" : "Sent"}
                    </Link>
                  </Button>
                ) : (
                  <SubmitButton
                    variant="outline"
                    onClick={() => setRoundOpen(true)}
                    pending={working}
                    pendingLabel="Opening…"
                    icon={<RotateCcw className="size-4" />}
                  >
                    Open de-snag round
                  </SubmitButton>
                )}
                <Button
                  variant="outline"
                  onClick={() => setVisitOpen(true)}
                  disabled={working}
                >
                  <CalendarPlus className="size-4" />
                  Additional visit
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {/*
          While the send-back is still being answered, not only while the
          job sits at `rejected`.

          The inspector picking it up moves it to `in_progress`, and this
          banner — the reason, the category and the fix-by clock — went
          with it. Ops then had a job in progress with nothing on screen
          saying why it had come back, which is the one question anybody
          asks about a returned inspection. The reason stays on the record
          after the fix is approved, so the statuses past these two are
          what stops an approved job still wearing it.
        */}
        {(task.status === "rejected" || task.status === "in_progress") &&
        task.rejection_reason ? (
          <div className="border-danger/30 bg-danger/5 border-t px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-danger text-sm font-medium">
                {task.status === "rejected"
                  ? "Sent back for correction"
                  : "Being corrected"}
              </p>
              {task.rejection_category ? (
                <span className="bg-danger/10 text-danger rounded px-2 py-0.5 text-xs font-medium capitalize">
                  {task.rejection_category.replace(/_/g, " ")}
                </span>
              ) : null}
              {(task.rejection_count ?? 0) > 1 ? (
                <span className="text-muted-foreground text-xs">
                  · {task.rejection_count}× returned
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {task.rejection_reason}
            </p>
            {task.remediation_due_at ? (
              <RemediationDue due={task.remediation_due_at} />
            ) : null}
          </div>
        ) : awaitingDecision && !pending.snags ? (
          <div className="border-warning/30 bg-warning/5 border-t px-5 py-3">
            <p className="text-sm">
              {snagsWithPhoto === snags.length
                ? "Every snag has at least one photo."
                : `${snags.length - snagsWithPhoto} snag(s) have no photo yet.`}{" "}
              {/*
                Said to whoever is reading it. This line is on the card
                for everybody, and "approving accepts the records" is not
                what a reviewer is about to do — nor what a coordinator
                watching the job can do at all.
              */}
              {!reviewComplete && canReview
                ? "Completing your review accepts the snag records; media keeps arriving after."
                : canDecide
                  ? "Approving accepts the snag records; media keeps arriving after."
                  : "Whoever accepts it takes the snag records as they stand; media keeps arriving after."}
            </p>
          </div>
        ) : null}
      </Card>

      {/*
        The four numbers a manager decides on, in the same stat card
        every other page uses rather than a divided strip that only
        existed here.
      */}
      {pending.snags ? (
        <StatCardGrid columns={4}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[132px] rounded-xl" />
          ))}
        </StatCardGrid>
      ) : (
      <StatCardGrid columns={4}>
        <StatCard
          label="Snags"
          value={snags.length}
          headline={`Across ${areas.length} ${areas.length === 1 ? "area" : "areas"}`}
          /* A round's list is mostly defects carried in to be re-checked,
             not new finds, so the caption cannot claim otherwise. */
          caption={
            (task.round_number ?? 1) > 1
              ? "Carried in, plus new finds"
              : "Captured on this walk"
          }
        />
        <StatCard
          label="High severity"
          value={highCount}
          headline={
            highCount > 0 ? "Must clear before handover" : "None outstanding"
          }
          caption="Severity as recorded on site"
          tone={highCount > 0 ? "bad" : "good"}
        />
        {/*
          On an initial inspection, walking every room IS the job, so the
          rooms signed off is the progress worth showing.

          On a de-snag round it is not. The round's work is the verdict on
          each carried defect, and the inspector never confirms rooms there
          — so this card sat at "0 / 2 · Entrance still pending" on every
          round that ever ran, reading as work outstanding when the round
          could be complete. A round shows what it is actually measured on.
        */}
        {isRound ? (
          <StatCard
            label="Defects re-checked"
            value={`${ruledCount} / ${carriedCount}`}
            headline={
              ruledCount === carriedCount
                ? "Every carried defect answered"
                : `${carriedCount - ruledCount} still to check`
            }
            caption="Carried in from the previous visit"
            tone={ruledCount === carriedCount ? "good" : "progress"}
          />
        ) : (
          <StatCard
            label="Areas walked"
            value={`${walkedAreas} / ${areas.length}`}
            headline={
              pendingArea
                ? `${pendingArea.name} still pending`
                : awaitingReviewAreas > 0
                  ? `${awaitingReviewAreas} from a visit awaiting review`
                  : "All walked"
            }
            caption="Signed off on the walk or an approved visit"
            tone={pendingArea || awaitingReviewAreas > 0 ? "progress" : "good"}
          />
        )}
        {/*
          Labelled by what the ratio counts. "Media · 3 / 3" left the reader
          to work out what was being divided by what, with the answer in the
          caption two lines below -- and a snag with no photo is a hole in
          the report, so it is worth reading at a glance.
        */}
        <StatCard
          label="Snags with photos"
          value={`${snagsWithPhoto} / ${snags.length}`}
          headline={
            snags.length === 0
              ? "No snags recorded"
              : snagsWithPhoto === snags.length
                ? "Every snag has evidence"
                : `${snags.length - snagsWithPhoto} with no photo`
          }
          caption={`${photoTotal} ${photoTotal === 1 ? "file" : "files"} across the inspection`}
          tone={
            snags.length === 0
              ? "neutral"
              : snagsWithPhoto === snags.length
                ? "good"
                : "bad"
          }
        />
      </StatCardGrid>
      )}

      <RejectInspectionDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        taskId={task.id}
        onRejected={decided}
      />

      <AdditionalVisitDialog
        taskId={task.id}
        open={visitOpen}
        onOpenChange={setVisitOpen}
        // The new visit belongs in the page's visit list at once: the
        // alerts, the Visits tab and its count all read that list.
        onCreated={onVisitsChanged ?? onChanged}
      />

      <DesnagQuotationDialog
        open={desnagQuoteOpen}
        onOpenChange={setDesnagQuoteOpen}
        // Always the original inspection: that is what a de-snag returns
        // to, and what opening the round checks the quotation by.
        sourceJob={{
          id: task.parent_task_id ?? task.id,
          label: task.property?.unit_label ?? task.code,
          property_type: (task.property?.property_type as string | null) ?? null,
        }}
        onCreated={(quote) => {
          setDesnagQuoteOpen(false);
          router.push(`/snagging/quotations/${quote.id}`);
        }}
      />

      <OpenRoundDialog
        open={roundOpen}
        onOpenChange={setRoundOpen}
        roundNumber={task.round_number + 1}
        from={task.property?.unit_label ?? "this inspection"}
        carrying={carryingCount}
        busy={working}
        onConfirm={openRound}
      />

      {dialog}
    </>
  );
}

/** The remediation SLA deadline for a returned inspection (§5.3). */
function RemediationDue({ due }: { due: string }) {
  const deadline = new Date(due);
  // Same reason as the approval SLA above: client-only render.
  // eslint-disable-next-line react-hooks/purity
  const overdue = deadline.getTime() < Date.now();
  const when = deadline.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <p
      className={cn(
        "mt-1 text-xs",
        overdue ? "text-danger font-medium" : "text-muted-foreground",
      )}
    >
      {overdue ? `Fix overdue, was due ${when}` : `Fix due by ${when}`}
    </p>
  );
}

/**
 * Copies the job's id, for a support conversation that needs it.
 *
 * The id used to be the breadcrumb's page title, which told a reader
 * nothing and cost the one line that could have said which unit they
 * were looking at. It lives here instead: out of the way, one click when
 * somebody actually asks for it.
 */
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // A clipboard a browser refuses is not worth an error dialog; the
      // id is still selectable from the tooltip.
      toast.error("Could not copy the job ID");
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void copy()}
          aria-label={`Copy job ID ${id}`}
        >
          {copied ? (
            <Check className="text-success size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-mono text-xs">{id}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {copied ? "Copied" : "Click to copy the job ID"}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
