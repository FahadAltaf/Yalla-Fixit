"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { snaggingService } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingTask } from "@/types/types";

import { AdditionalVisitDialog } from "./additional-visit-dialog";
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
}: {
  task: SnaggingTask;
  onChanged: () => void;
}) {
  const { userProfile } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [working, setWorking] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);

  const canApprove = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.APPROVE,
  );
  const canCreate = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.CREATE,
  );

  /*
    Who may actually decide this inspection.

    All four decision endpoints — review, approve, reject, deliver —
    refuse anyone who is not this job's named approval manager, admins
    aside: "the `approve` permission alone is not enough" (FR-6.01).
    The buttons used to follow only the permission, so a colleague with
    approve rights on other jobs saw Approve here, pressed it, and got a
    403 that read like a fault rather than a rule. They now apply the
    same test the server does, and the card names who it waits on.
  */
  const isApprovalManager = Boolean(
    task.approval_manager_id && userProfile?.id === task.approval_manager_id,
  );
  const canDecide =
    canApprove && (isAdminUser(userProfile) || isApprovalManager);
  const managerName = task.manager?.full_name ?? task.manager?.email ?? null;

  const snags = useMemo(() => task.snags ?? [], [task]);
  const areas = task.areas ?? [];

  const highCount = snags.filter((snag) => snag.severity === "high").length;
  const confirmedAreas = areas.filter((area) => area.confirmed_at).length;
  const pendingArea = areas.find((area) => !area.confirmed_at);

  /*
    What a de-snag round is measured on: the carried defects, and how many
    of them have been given a verdict. A defect raised ON this round is not
    counted — it is a new find, not something the round went back for.
  */
  const isRound = (task.round_number ?? 1) > 1;
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

  async function startReview() {
    setWorking(true);
    try {
      await snaggingService.reviewTask(task.id);
      toast.success(
        "Review started. Approve or send it back when you're done.",
      );
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start the review",
      );
    } finally {
      setWorking(false);
    }
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
      confirmedAreas < areas.length
        ? `${areas.length - confirmedAreas} area(s) not confirmed`
        : null,
      accessIssues.length > 0
        ? `${accessIssues.length} area(s) with access issues`
        : null,
    ].filter(Boolean);

    const ok = await confirm({
      title: `Approve ${task.code}?`,
      description: outstanding.length
        ? `This accepts the inspection and lets the report go to the client. Still outstanding: ${outstanding.join(", ")}.`
        : "This accepts the inspection and lets the report go to the client.",
      confirmText: "Approve inspection",
    });
    if (!ok) return;

    setWorking(true);
    try {
      await snaggingService.approveTask(task.id);
      toast.success(
        "Inspection approved. Open the report to send it to the client.",
      );
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not approve");
    } finally {
      setWorking(false);
    }
  }

  async function openRound() {
    // Opening a round creates a new inspection and navigates away from
    // this one; a reviewer who meant to open the report should not lose
    // their place to a mis-click.
    const carrying = snags.filter(
      (snag) =>
        snag.status === "open" ||
        snag.status === "pending_verification" ||
        snag.status === "verified_poor_quality" ||
        snag.status === "verified_not_done",
    ).length;

    const ok = await confirm({
      title: `Open a de-snag round for ${task.code}?`,
      description: `This creates round ${task.round_number + 1} with the ${carrying} still-open snag(s) carried into it, and takes you to the new round.`,
      confirmText: "Open round",
    });
    if (!ok) return;

    setWorking(true);
    try {
      const round = await snaggingService.openRound(task.id, {});
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
              {/* <span className="text-muted-foreground font-mono text-xs">{task.code}</span> */}
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
                The job code is what people quote to each other; the id is
                what support needs. The code reads inline, the id hides
                behind a copy button rather than taking a line of its own.
              */}
              <span className="text-muted-foreground font-mono text-xs">
                {task.code}
              </span>
              <CopyId id={task.id} />
            </div>
            <p className="text-muted-foreground text-sm">
              {[
                task.property?.building_name,
                task.property?.client_name,
                task.assignees?.find((a) => a.role === "technician")
                  ?.user_profile?.full_name
                  ? `inspected by ${task.assignees.find((a) => a.role === "technician")?.user_profile?.full_name}`
                  : null,
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
            {awaitingDecision && canDecide ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setRejectOpen(true)}
                  disabled={working}
                >
                  <XCircle className="size-4" />
                  Send back
                </Button>
                {task.status === "submitted" ? (
                  // FR-6.01 — the review must be picked up (submitted →
                  // in_review, audited) before it can be approved. Approve
                  // only appears once the inspection is under review.
                  <SubmitButton
                    onClick={() => void startReview()}
                    pending={working}
                    pendingLabel="Starting…"
                    icon={<ClipboardCheck className="size-4" />}
                  >
                    Start review
                  </SubmitButton>
                ) : (
                  <SubmitButton
                    onClick={() => void approve()}
                    pending={working}
                    pendingLabel="Approving…"
                    icon={<CheckCircle2 className="size-4" />}
                  >
                    Approve inspection
                  </SubmitButton>
                )}
              </>
            ) : awaitingDecision ? (
              /*
                Waiting on somebody else. Naming them turns a missing set
                of buttons into an answer — otherwise a coordinator is
                left wondering whether the page is broken or they simply
                are not the person.
              */
              <span className="text-muted-foreground text-sm">
                {managerName
                  ? `Awaiting sign-off by ${managerName}`
                  : "Awaiting sign-off by this job's approval manager"}
              </span>
            ) : null}
            {(task.status === "approved" || task.status === "delivered") &&
              canCreate ? (
              <>
                <SubmitButton
                  variant="outline"
                  onClick={() => void openRound()}
                  pending={working}
                  pendingLabel="Opening…"
                  icon={<RotateCcw className="size-4" />}
                >
                  Open de-snag round
                </SubmitButton>
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

        {task.status === "rejected" && task.rejection_reason ? (
          <div className="border-danger/30 bg-danger/5 border-t px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-danger text-sm font-medium">
                Sent back for correction
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
        ) : awaitingDecision ? (
          <div className="border-warning/30 bg-warning/5 border-t px-5 py-3">
            <p className="text-sm">
              {snagsWithPhoto === snags.length
                ? "Every snag has at least one photo."
                : `${snags.length - snagsWithPhoto} snag(s) have no photo yet.`}{" "}
              Approving accepts the snag records; media keeps arriving after.
            </p>
          </div>
        ) : null}
      </Card>

      {/*
        The four numbers a manager decides on, in the same stat card
        every other page uses rather than a divided strip that only
        existed here.
      */}
      <StatCardGrid columns={4}>
        <StatCard
          label="Snags"
          value={snags.length}
          headline={`Across ${areas.length} ${areas.length === 1 ? "area" : "areas"}`}
          /* A round's list is mostly defects carried in to be re-checked,
             not new finds, so the caption cannot claim otherwise. */
          caption={
            (task.round_number ?? 1) > 1 ? "Carried in, plus new finds" : "Captured on this walk"
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
            label="Areas confirmed"
            value={`${confirmedAreas} / ${areas.length}`}
            headline={
              pendingArea ? `${pendingArea.name} still pending` : "All walked"
            }
            caption="Rooms the inspector signed off"
            tone={pendingArea ? "progress" : "good"}
          />
        )}
        <StatCard
          label="Media"
          value={`${snagsWithPhoto} / ${snags.length}`}
          headline={`${photoTotal} ${photoTotal === 1 ? "file" : "files"} received`}
          caption="Snags carrying at least one photo"
        />
      </StatCardGrid>

      <RejectInspectionDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        taskId={task.id}
        onRejected={onChanged}
      />

      <AdditionalVisitDialog
        taskId={task.id}
        open={visitOpen}
        onOpenChange={setVisitOpen}
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
    timeZone: "Asia/Dubai",
  });
  return (
    <p
      className={cn(
        "mt-1 text-xs",
        overdue ? "text-danger font-medium" : "text-muted-foreground",
      )}
    >
      {overdue ? `Fix overdue — was due ${when}` : `Fix due by ${when}`}
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
