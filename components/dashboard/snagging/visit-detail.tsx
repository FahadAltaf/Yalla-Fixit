"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  CreditCard,
  FilePlus2,
  FileText,
  Loader2,
  MessageSquareWarning,
  Pencil,
  Undo2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { cn } from "@/lib/utils";
import { snaggingService, type SnaggingVisitDetail } from "@/modules/snagging";
import type { SnaggingTask } from "@/types/types";
import {
  ActionType,
  ResourceType,
} from "@/types/types";

import {
  DataState,
  SectionCard,
  StatCard,
  StatCardGrid,
  SubmitButton,
  formatLocalDateTime,
  useConfirm,
} from "./shared";
import { SnagWalkList } from "./snag-walk-list";
import { VisitEditDialog } from "./visit-edit-dialog";

/*
  Loaded when it is shown, as on the job page. It brings the PDF builder
  (html2canvas, jsPDF and three templates) with it, which every visit
  page was downloading up front.
*/
const QuotationPanel = dynamic(
  () => import("./quotation-panel").then((m) => m.QuotationPanel),
  { loading: () => <div className="bg-muted h-40 animate-pulse rounded-xl" /> },
);

const VISIT_LABEL: Record<string, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  in_progress: "On site",
  submitted: "Awaiting review",
  completed: "Completed",
  cancelled: "Cancelled",
};

const VISIT_TONE: Record<string, string> = {
  requested: "bg-warning/10 text-warning",
  scheduled: "bg-brand/10 text-brand",
  in_progress: "bg-brand/10 text-brand",
  submitted: "bg-warning/10 text-warning",
  completed: "bg-success/10 text-success",
  cancelled: "bg-mist text-ink-soft",
};

const CHECK_LABEL: Record<string, string> = {
  passed: "Checked",
  failed: "Checked, issue found",
  not_checked: "Not checked",
  pending: "Not answered",
};

/**
 * One additional visit, with everything that belongs to it (BA v2,
 * changes 25-30).
 *
 * The visit row on the job says where a visit stands; this page is where
 * it is run from. It collects what used to be scattered or missing: who
 * is going and when, how the client is paying, the rooms the trip is for,
 * what it found and what it answered on the checklist — and, once the
 * inspector submits, the manager's approve-or-send-back decision that
 * reissues the client's report.
 *
 * Everything is scoped to THIS visit. The job's other snags belong to the
 * report the client already has; this is what the return trip added.
 */
export default function VisitDetail({ taskId, visitId }: { taskId: string; visitId: string }) {
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.EDIT);
  const canApprove = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.APPROVE);

  const [detail, setDetail] = useState<SnaggingVisitDetail | null>(null);
  /*
    The whole job, for the Snags tab. That tab is the job's own snag list
    (SnagWalkList), and it needs what the job page gives it — the floor
    plans a snag is pinned on, the areas, the photos — so the visit reads
    it rather than a second, thinner copy that would drift from it.
  */
  const [task, setTask] = useState<SnaggingTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | "quote" | "book" | "approve" | "send_back">(null);
  const [editOpen, setEditOpen] = useState(false);
  /* True when the edit dialog is booking the visit by assigning it. */
  const [bookMode, setBookMode] = useState(false);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [reason, setReason] = useState("");
  // The tab is linkable (?tab=quotation), so "Send quotation" anywhere in
  // the app lands on this visit's quotation rather than a separate page.
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "snags");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [visitDetail, job] = await Promise.all([
        snaggingService.getVisit(taskId, visitId),
        // The snag list's sections; not visit status or the de-snag quotation.
        snaggingService.getTask(taskId, {}, ["snags", "checklist", "floor_plans"]),
      ]);
      setDetail(visitDetail);
      setTask(job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the visit");
    } finally {
      setLoading(false);
    }
  }, [taskId, visitId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visit = detail?.visit ?? null;
  const quote = detail?.quotation ?? null;
  const byQuote = visit?.charge_method !== "payment_link";

  async function raiseQuotation() {
    if (!visit) return;
    setPending("quote");
    const id = toast.loading("Raising the quotation…");
    try {
      const created = await snaggingService.raiseVisitQuotation(taskId, visit.id);
      toast.success(`Quotation ${created.quote_number} raised`, {
        id,
        description: "Send it to the client. Book the visit once they approve.",
      });
      // Stay here: the Quotation tab is where it is sent from.
      await load();
      setTab("quotation");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not raise the quotation", { id });
    } finally {
      setPending(null);
    }
  }

  /*
    Open the Quotation tab, get a quotation -- the rule the job's own tab
    follows. Once per visit page, only for someone who may edit, and only
    while the visit is waiting on one: never over an existing quotation,
    and never over a rejected one, where raising again is a decision.
  */
  const [autoRaiseFailed, setAutoRaiseFailed] = useState(false);
  const raiseOnOpen = useCallback(async () => {
    try {
      await snaggingService.raiseVisitQuotation(taskId, visitId);
      await load();
    } catch (err) {
      setAutoRaiseFailed(true);
      toast.error(err instanceof Error ? err.message : "Could not prepare the quotation");
    }
  }, [taskId, visitId, load]);

  async function approve() {
    if (!visit) return;
    const ok = await confirm({
      title: `Approve visit ${visit.visit_number}?`,
      description:
        "Its findings are added to the client's report, which is issued as a new version. The earlier version is kept.",
      confirmText: "Approve visit",
    });
    if (!ok) return;
    setPending("approve");
    const id = toast.loading("Approving the visit…");
    try {
      const result = await snaggingService.reviewVisit(taskId, visit.id, { decision: "approve" });
      // Refresh before the toast so the buttons have changed by the time it shows.
      await load();
      if (result.generation?.status === "failed") {
        toast.warning(`Visit ${visit.visit_number} approved`, {
          id,
          description: "The new report version could not be issued.",
        });
      } else {
        toast.success(`Visit ${visit.visit_number} approved`, {
          id,
          description: result.generation
            ? `Report version ${result.generation.version} is being generated.`
            : undefined,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not approve the visit", { id });
    } finally {
      setPending(null);
    }
  }

  async function sendBack() {
    if (!visit) return;
    setPending("send_back");
    try {
      await snaggingService.reviewVisit(taskId, visit.id, {
        decision: "send_back",
        reason: reason.trim(),
      });
      toast.success(`Visit ${visit.visit_number} sent back to the inspector`);
      setSendBackOpen(false);
      setReason("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the visit back");
    } finally {
      setPending(null);
    }
  }

  /*
    The one thing this visit is waiting on, as a button. The same route
    the row on the job follows, so the two never disagree about what is
    next.
  */
  function nextStep() {
    if (!visit || !canEdit) return null;
    // The review decision lives in the review card under the header,
    // beside the explanation of what each choice does.
    if (visit.status === "submitted") return null;
    if (visit.status !== "requested") {
      if (visit.status === "scheduled" && !visit.inspector_id) {
        return (
          <Button onClick={() => setEditOpen(true)}>
            <UserRound className="size-4" />
            Assign inspector
          </Button>
        );
      }
      return null;
    }
    if (byQuote && !quote) {
      return (
        <Button onClick={() => setTab("quotation")}>
          <FilePlus2 className="size-4" />
          Raise quotation
        </Button>
      );
    }
    if (byQuote && quote?.status === "rejected") {
      return (
        <SubmitButton
          pending={pending === "quote"}
          pendingLabel="Raising…"
          icon={<FilePlus2 className="size-4" />}
          onClick={() => void raiseQuotation()}
        >
          {quote ? "Raise new quotation" : "Raise quotation"}
        </SubmitButton>
      );
    }
    if (byQuote && quote && (quote.status === "draft" || quote.status === "sent")) {
      return (
        <Button onClick={() => setTab("quotation")}>
          <FileText className="size-4" />
          {quote.status === "draft" ? "Send quotation" : "View quotation"}
        </Button>
      );
    }
    // Paid for: assigning the inspector and date books it.
    return (
      <Button
        onClick={() => {
          setBookMode(true);
          setEditOpen(true);
        }}
      >
        <UserRound className="size-4" />
        Assign inspector
      </Button>
    );
  }

  /* A tab's count, drawn the way the job page draws its own. */
  const tabCount = (value: number) =>
    value > 0 ? (
      <Badge variant="secondary" className="ml-1.5 px-1.5 font-normal tabular-nums">
        {value}
      </Badge>
    ) : null;

  /*
    This visit's defects, in the job's own shape. Everything else about the
    job stays as it is — its plans and areas are the same rooms — but the
    list shows only what the return trip added, which is what this page
    is about.
  */
  const visitTask: SnaggingTask | null = task
    ? { ...task, snags: (task.snags ?? []).filter((snag) => snag.visit_id === visitId) }
    : null;

  const snags = detail?.snags ?? [];
  const highCount = snags.filter((snag) => snag.severity === "high").length;
  const photographed = snags.filter((snag) => snag.photos.length > 0).length;
  const checklistCount = detail?.checklist.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/snagging/${taskId}?tab=visits`}
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" />
        Additional visits
      </Link>

      <DataState
        loading={loading}
        error={error}
        onRetry={() => void load()}
        retrying={loading}
        errorTitle="Could not load the visit"
        skeleton={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-28 w-full rounded-xl" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-32 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        }
      >
        {visit && detail ? (
          <div className="flex flex-col gap-4">
            {/*
              The job page's header card, for the visit. Only what belongs to
              THIS trip: no report link (the visit's findings reach the report
              through approval), no de-snag round, no add-visit — those are
              the job's verbs, and they live on the job.
            */}
            <Card className="gap-0 p-0">
              <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">Additional visit {visit.visit_number}</Badge>
                    <span className="text-muted-foreground text-xs">
                      AED {(visit.charge ?? 0).toLocaleString()} + VAT · charged by{" "}
                      {byQuote ? "quotation" : "payment link"}
                    </span>
                  </div>
                  <div className="flex flex-row flex-wrap items-center gap-2">
                    <h2 className="text-2xl">{detail.job?.unit_label ?? `Visit ${visit.visit_number}`}</h2>
                    <Badge
                      variant="secondary"
                      className={cn("border-0 font-medium", VISIT_TONE[visit.status] ?? "")}
                    >
                      {VISIT_LABEL[visit.status] ?? visit.status}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {[
                      detail.job?.building_name,
                      visit.appointment_at
                        ? formatLocalDateTime(visit.appointment_at)
                        : visit.scheduled_date ?? "no date yet",
                      // Everyone attending, not just the first of them.
                      visit.inspectors?.length
                        ? `${visit.inspectors.length === 1 ? "inspector" : "inspectors"} ${visit.inspectors
                            .map((person) => person.full_name ?? person.email)
                            .filter(Boolean)
                            .join(", ")}`
                        : visit.inspector?.full_name
                          ? `inspector ${visit.inspector.full_name}`
                          : "no inspector yet",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {canEdit && visit.status !== "completed" && visit.status !== "cancelled" ? (
                    <Button variant="outline" onClick={() => setEditOpen(true)}>
                      <Pencil className="size-4" />
                      Edit visit
                    </Button>
                  ) : null}
                  {nextStep()}
                </div>
              </div>
            </Card>

            {/* The manager's note, kept in front of whoever reopens it. */}
            {visit.review_note && visit.status === "in_progress" ? (
              <Alert variant="destructive">
                <MessageSquareWarning />
                <AlertTitle>Sent back by the manager</AlertTitle>
                <AlertDescription>{visit.review_note}</AlertDescription>
              </Alert>
            ) : null}

            {/*
              The review, where the reviewer lands.

              Approve and Send back were two small buttons in the header,
              next to nothing that said a decision was due or what either
              did, so a submitted visit read as finished and nobody knew how
              to review it. The card says what to check, what each choice
              does, and carries both.
            */}
            {visit.status === "submitted" ? (
              <Alert className="border-warning/40 bg-warning/5 px-4 py-3 *:[svg]:text-warning">
                <ClipboardList />
                <AlertTitle>Visit {visit.visit_number} is ready for review</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-3">
                  <ul className="list-disc space-y-1 pl-4">
                    <li>
                      Check the snags and checklist answers this visit recorded,
                      in the tabs below.
                    </li>
                    <li>
                      <span className="text-foreground font-medium">Approve</span>{" "}
                      adds them to the client&apos;s report and issues it as a new
                      version. The earlier version is kept.
                    </li>
                    <li>
                      <span className="text-foreground font-medium">Send back</span>{" "}
                      reopens the visit on the inspector&apos;s phone with your
                      note. The client&apos;s report is not touched.
                    </li>
                  </ul>
                  {canEdit && canApprove ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <SubmitButton
                        pending={pending === "approve"}
                        pendingLabel="Approving…"
                        icon={<Check className="size-4" />}
                        onClick={() => void approve()}
                        disabled={pending !== null}
                      >
                        Approve visit {visit.visit_number}
                      </SubmitButton>
                      <Button
                        variant="outline"
                        onClick={() => setSendBackOpen(true)}
                        disabled={pending !== null}
                      >
                        <Undo2 className="size-4" />
                        Send back to inspector
                      </Button>
                    </div>
                  ) : (
                    <span>
                      You can read this visit, but approving or sending it back
                      needs approval rights on Snagging.
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}



            {/*
              The job page's tabs, cut down to what a visit owns. Areas & plan
              and History are the job's; the rooms that matter to a return trip
              are its own tab, and everything else here is scoped to it.
            */}
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
                <TabsTrigger value="snags">
                  Snags
                  {tabCount(snags.length)}
                </TabsTrigger>
                <TabsTrigger value="checklist">
                  Checklist
                  {tabCount(checklistCount)}
                </TabsTrigger>
                <TabsTrigger value="quotation">
                  {byQuote ? "Quotation" : "Payment"}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="snags" className="mt-4 flex flex-col gap-6">
                <StatCardGrid columns={4}>
                  <StatCard
                    label="Snags on this visit"
                    value={snags.length}
                    caption={
                      visit.status === "completed"
                        ? "In the client's report"
                        : "Join the report once approved"
                    }
                  />
                  <StatCard
                    label="High severity"
                    value={highCount}
                    headline={highCount > 0 ? "Must clear before handover" : undefined}
                    tone={highCount > 0 ? "bad" : "neutral"}
                  />
                  <StatCard
                    label="Checklist rechecked"
                    value={checklistCount}
                    caption="Items the earlier visit could not check"
                  />
                  <StatCard
                    label="Snags with photos"
                    value={`${photographed} / ${snags.length}`}
                    headline={
                      snags.length > 0 && photographed === snags.length
                        ? "Every snag has evidence"
                        : undefined
                    }
                    tone={snags.length > 0 && photographed === snags.length ? "good" : "neutral"}
                  />
                </StatCardGrid>
                {/*
                  The job's own snag list — severity filters, sort, the
                  numbered rows with their photos and plan pins — given only
                  this visit's defects.
                */}
                {visitTask ? (
                  <SnagWalkList
                    task={visitTask}
                    canEdit={canEdit}
                    onSnagsChanged={() => void load()}
                    onAreasChanged={() => void load()}
                  />
                ) : null}
              </TabsContent>

              <TabsContent value="checklist" className="mt-4">
                <SectionCard
                  title="Checklist answered on this visit"
                  description="Only the items the earlier visit could not check are asked again."
                  icon={<ClipboardList />}
                  bodyClassName="border-t"
                >
                  {checklistCount === 0 ? (
                    <EmptyState
                      icon={<ClipboardList className="size-6" />}
                      title="No checklist answers yet"
                      description="Items rechecked on this visit appear here."
                      className="py-8"
                    />
                  ) : (
                    <ul className="divide-y">
                      {detail.checklist.map((item) => (
                        <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                          <div className="min-w-0">
                            <p className="font-medium">{item.label}</p>
                            <p className="text-muted-foreground text-sm">
                              {[item.group_name, item.reason].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "border-0 font-medium",
                              item.status === "passed"
                                ? "bg-success/10 text-success"
                                : item.status === "failed"
                                  ? "bg-danger/10 text-danger"
                                  : "bg-warning/10 text-warning",
                            )}
                          >
                            {CHECK_LABEL[item.status] ?? item.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>
              </TabsContent>

              <TabsContent value="quotation" className="mt-4">
                {/*
                  The same panel the job's Quotation tab uses — same card,
                  same document, same Download / WhatsApp / Send — pointed at
                  this visit's quotation. Before one exists, or on a payment
                  link, there is no document to show, so a plain card says
                  what the route is instead.
                */}
                {byQuote &&
                !quote &&
                canEdit &&
                visit.status === "requested" &&
                !autoRaiseFailed ? (
                  <AutoRaise run={raiseOnOpen} />
                ) : byQuote && quote ? (
                  <QuotationPanel
                    task={{ id: taskId, status: (detail.job?.status ?? "approved") as never }}
                    quotationId={quote.id}
                    visitNumber={visit.visit_number}
                    onChanged={load}
                  />
                ) : (
                  <SectionCard
                    title={byQuote ? "Quotation" : "Payment link"}
                    description={
                      byQuote
                        ? autoRaiseFailed
                          ? "The quotation could not be prepared. Try again; the client approves it before the visit is booked."
                          : "No quotation yet. The client approves one before the visit is booked."
                        : "No quotation needed. The visit is booked once the link is paid."
                    }
                    icon={byQuote ? <FileText /> : <CreditCard />}
                    bodyClassName="border-t p-5"
                  >
                    {byQuote ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-muted-foreground text-sm">
                          AED {(visit.charge ?? 0).toLocaleString()} + VAT, fixed per visit.
                        </p>
                        {canEdit && visit.status === "requested" ? (
                          <SubmitButton
                            size="sm"
                            pending={pending === "quote"}
                            pendingLabel="Raising…"
                            icon={<FilePlus2 className="size-4" />}
                            onClick={() => void raiseQuotation()}
                          >
                            {quote ? "Raise new quotation" : "Raise quotation"}
                          </SubmitButton>
                        ) : null}
                      </div>
                    ) : (
                      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-3 text-sm">
                        <dt className="text-muted-foreground">Charge</dt>
                        <dd>AED {(visit.charge ?? 0).toLocaleString()} + VAT</dd>
                        <dt className="text-muted-foreground">Reference</dt>
                        <dd className="font-mono text-xs">{visit.payment_reference || "Not recorded"}</dd>
                      </dl>
                    )}
                  </SectionCard>
                )}
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
      </DataState>

      <VisitEditDialog
        taskId={taskId}
        visit={visit}
        open={editOpen}
        book={bookMode}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setBookMode(false);
        }}
        onSaved={() => void load()}
      />

      {confirmDialog}
      <Dialog open={sendBackOpen} onOpenChange={setSendBackOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send visit {visit?.visit_number} back</DialogTitle>
            <DialogDescription>
              The visit reopens on the inspector&apos;s phone with your note, and
              the snags it raised can be corrected. The client&apos;s report is not
              touched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="send-back-reason">What needs doing</Label>
            <Textarea
              id="send-back-reason"
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="The balcony photo is too dark to show the crack; retake it in daylight."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendBackOpen(false)} disabled={pending !== null}>
              Cancel
            </Button>
            <SubmitButton
              pending={pending === "send_back"}
              pendingLabel="Sending back…"
              disabled={reason.trim().length < 3}
              onClick={() => void sendBack()}
            >
              Send back
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The Quotation tab while the visit's quotation is being raised on open.
 * Raises once per mount; the page reloads with the quotation when done.
 */
function AutoRaise({ run }: { run: () => Promise<void> }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);
  return (
    <SectionCard title="Quotation" icon={<FileText />} bodyClassName="border-t">
      <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-16 text-sm">
        <Loader2 className="size-5 animate-spin" />
        Preparing the quotation for this visit…
      </div>
    </SectionCard>
  );
}
