"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CloudUpload,
  FileText,
  FileUp,
  History,
  Paperclip,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { DataRow, SectionCard } from "@/components/dashboard/shared/kaizen";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { snaggingService, type SnaggingJobFsm } from "@/modules/snagging";

import { FsmEventList } from "./fsm-activity";
import { useReportProgress } from "./report-progress-dialog";
import { SubmitButton, formatLocalDateTime } from "./shared";

/**
 * This job in Zoho FSM (SNG-187 to 191), in the job's Activity tab: its
 * quotation as an estimate, the work order the approved job became, whether
 * the client report is attached for finance, and every FSM call made for
 * either, laid out like the History beside it.
 *
 * When the server could not make the PDF on approval, "Attach report"
 * builds the same document the report page's Download gives and hands it
 * to FSM: it loads the full report first, because the job page holds only
 * a summary of the snags.
 */
export function FsmJobCard({
  taskId,
  canEdit,
  jobStatus,
}: {
  taskId: string;
  canEdit: boolean;
  /** The job's status: the work order only exists once it is approved. */
  jobStatus?: string | null;
}) {
  const [state, setState] = useState<SnaggingJobFsm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "sync" | "attach">(null);
  /* Attaching the report, in a popup that ticks off each step. */
  const reportProgress = useReportProgress();
  // The activity is paged on the server, like the History card.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  // The page the rows on screen answer; loading until it is the current one.
  const [shownPage, setShownPage] = useState<string | null>(null);
  const pageKey = `${page}:${pageSize}`;
  const logLoading = shownPage !== pageKey;

  const load = useCallback(async () => {
    try {
      setState(await snaggingService.getTaskFsm(taskId, { page, pageSize }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the FSM sync");
    } finally {
      setShownPage(`${page}:${pageSize}`);
    }
  }, [taskId, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setBusy("sync");
    try {
      const result = await snaggingService.syncTaskFsm(taskId);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The FSM sync failed");
    } finally {
      setBusy(null);
      void load();
    }
  }

  async function attachReport() {
    setBusy("attach");
    try {
      /*
        The report page's PDF, saved as the report version's file -- the one
        the client gets -- and sent to the work order from there, so FSM and
        the client always hold the same document.
      */
      const saved = await reportProgress.run(taskId, {
        title: "Attaching the report",
        successMessage:
          "Report version {version} is saved. It is being attached to the work order now; this card shows it in a few seconds.",
        failureMessage: "The report was not attached.",
      });
      /* The attach runs on the server after the save answers: read again once it has had time to land. */
      if (saved) setTimeout(() => void load(), 8000);
    } finally {
      setBusy(null);
      void load();
    }
  }

  const job = state?.job ?? null;
  const estimate = state?.estimate ?? null;
  const problem = job?.fsm_error ?? estimate?.fsm_error ?? null;
  /*
    The work order is made when the inspection is approved (SNG-189), so
    before then there is nothing to send: the card says what will happen,
    not that something is missing.
  */
  const approved = jobStatus === "approved" || jobStatus === "delivered";
  const workOrder = Boolean(job?.fsm_work_order_id);
  /* A work order still open in FSM is not ready to invoice; completing it is a step that can be retried (SNG-189, 191). */
  const incomplete = workOrder && !/completed|closed/i.test(job?.fsm_status ?? "");
  const badge = !state
    ? null
    : !state.enabled
      ? { label: "Sync off", tone: "bg-muted text-muted-foreground" }
      : !state.ready
        ? { label: "Not set up", tone: "bg-muted text-muted-foreground" }
        : problem
          ? { label: "Needs attention", tone: "bg-destructive/10 text-destructive" }
          : incomplete
            ? { label: "Not completed in FSM", tone: "bg-warning/10 text-warning" }
          : workOrder && job?.fsm_report_version
            ? { label: "Ready to invoice", tone: "bg-success/10 text-success" }
            : workOrder
              ? { label: "Report missing", tone: "bg-warning/10 text-warning" }
              : approved
                ? { label: "Work order not created", tone: "bg-warning/10 text-warning" }
                : estimate?.fsm_estimate_id
                  ? { label: "Inspection not approved yet", tone: "bg-muted text-muted-foreground" }
                  : { label: "Not in FSM yet", tone: "bg-muted text-muted-foreground" };
  // Send only once there is something it would create: an approved job with no work order.
  const canSend = canEdit && (Boolean(problem) || (approved && !workOrder) || (approved && incomplete));
  const canAttach = canEdit && workOrder;

  const log = state?.log ?? [];
  const total = state?.logTotal ?? 0;
  const live = Boolean(state && state.enabled && state.ready && !error);

  return (
    <div className="flex flex-col gap-4">
      {reportProgress.dialog}
      {/* Where each record stands in FSM. */}
      <SectionCard
        title="Zoho FSM"
        icon={<CloudUpload />}
        description="This job's estimate, work order and report in Zoho FSM."
        action={badge ? <Badge className={`border-0 ${badge.tone}`}>{badge.label}</Badge> : null}
        bodyClassName="border-t"
      >
        {error ? (
          <p className="text-destructive p-5 text-sm">{error}</p>
        ) : !state ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-9 w-1/2" />
          </div>
        ) : !state.enabled ? (
          <p className="text-muted-foreground p-5 text-sm">
            Syncing with Zoho FSM is switched off. It starts once SNAGGING_FSM_SYNC is set to
            &quot;on&quot;.
          </p>
        ) : !state.ready ? (
          <p className="text-muted-foreground p-5 text-sm">
            The Zoho FSM sync needs its database migration applied first.
          </p>
        ) : (
          <>
            <ul className="divide-y">
              <li>
                <DataRow
                  icon={<FileText aria-hidden />}
                  title={
                    estimate?.fsm_estimate_id
                      ? `Estimate ${estimate.fsm_estimate_number ?? estimate.fsm_estimate_id}`
                      : "Estimate"
                  }
                  subtitle={estimate?.fsm_estimate_id ? (estimate.fsm_status ?? "—") : "Not in FSM yet"}
                />
              </li>
              <li>
                <DataRow
                  icon={<Wrench aria-hidden />}
                  title={
                    workOrder
                      ? `Work order ${job?.fsm_work_order_number ?? job?.fsm_work_order_id}`
                      : "Work order"
                  }
                  subtitle={
                    workOrder
                      ? (job?.fsm_status ?? "—")
                      : approved
                        ? "Not created yet"
                        : "Created when the inspection is approved"
                  }
                  trailing={
                    job?.fsm_synced_at ? (
                      <span className="text-muted-foreground text-xs">
                        Synced {formatLocalDateTime(job.fsm_synced_at)}
                      </span>
                    ) : null
                  }
                />
              </li>
              <li>
                <DataRow
                  icon={<Paperclip aria-hidden />}
                  title="Inspection report"
                  subtitle={
                    job?.fsm_report_version
                      ? `Attached to the work order (version ${job.fsm_report_version})`
                      : workOrder
                        ? "Not attached to the work order"
                        : "Attached to the work order once it is created"
                  }
                />
              </li>
            </ul>

            {problem ? (
              <div className="bg-destructive/5 border-destructive/20 mx-5 mb-3 flex gap-2 rounded-md border p-3 text-sm">
                <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
                <p className="break-words">{problem}</p>
              </div>
            ) : null}

            {canSend || canAttach ? (
              <div className="flex flex-wrap gap-2 border-t px-5 py-3">
                {canSend ? (
                  <SubmitButton
                    variant="outline"
                    size="sm"
                    onClick={() => void sync()}
                    disabled={busy !== null}
                    pending={busy === "sync"}
                    pendingLabel="Syncing…"
                    icon={<RefreshCw className="size-4" />}
                  >
                    {problem ? "Retry" : incomplete ? "Complete the work order in FSM" : "Create the work order"}
                  </SubmitButton>
                ) : null}
                {canAttach ? (
                  <SubmitButton
                    variant={job?.fsm_report_version ? "outline" : "default"}
                    size="sm"
                    onClick={() => void attachReport()}
                    disabled={busy !== null}
                    pending={busy === "attach"}
                    pendingLabel="Attaching…"
                    icon={<FileUp className="size-4" />}
                  >
                    {job?.fsm_report_version ? "Attach the report again" : "Attach report"}
                  </SubmitButton>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </SectionCard>

      {/* Every FSM call for the job, its quotations and its client: a card of its own. */}
      {live ? (
        <SectionCard
          title="FSM activity"
          icon={<History />}
          description="Every call made to Zoho FSM for this job, its quotations and its client, newest first."
          bodyClassName="border-t"
        >
          <FsmEventList
            log={log}
            total={total}
            page={page}
            pageSize={pageSize}
            loading={logLoading}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </SectionCard>
      ) : null}
    </div>
  );
}
