"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CloudUpload,
  FileText,
  FileUp,
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
export function FsmJobCard({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const [state, setState] = useState<SnaggingJobFsm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "sync" | "attach">(null);
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
    const id = toast.loading("Preparing the report for FSM…");
    try {
      // The whole report, as the report page loads it.
      const [{ buildInspectionReportPdf }, task, quotation] = await Promise.all([
        import("./report-pdf-download"),
        snaggingService.getTask(taskId, {}, ["snags", "checklist", "floor_plans", "visit_status"]),
        snaggingService.getQuotation(taskId).catch(() => null),
      ]);
      const { blob, filename } = await buildInspectionReportPdf(task, quotation);
      toast.loading("Attaching it to the work order…", { id });
      const result = await snaggingService.attachReportToFsm(taskId, blob, filename);
      if (result.ok) toast.success(result.message, { id });
      else toast.error(result.message, { id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not attach the report", { id });
    } finally {
      setBusy(null);
      void load();
    }
  }

  const job = state?.job ?? null;
  const estimate = state?.estimate ?? null;
  const problem = job?.fsm_error ?? estimate?.fsm_error ?? null;
  const badge = !state
    ? null
    : !state.enabled
      ? { label: "Sync off", tone: "bg-muted text-muted-foreground" }
      : !state.ready
        ? { label: "Not set up", tone: "bg-muted text-muted-foreground" }
        : problem
          ? { label: "Needs attention", tone: "bg-destructive/10 text-destructive" }
          : job?.fsm_work_order_id && job.fsm_report_version
            ? { label: "Ready to invoice", tone: "bg-success/10 text-success" }
            : job?.fsm_work_order_id
              ? { label: "Report missing", tone: "bg-warning/10 text-warning" }
              : { label: "Not synced", tone: "bg-warning/10 text-warning" };

  const log = state?.log ?? [];
  const total = state?.logTotal ?? 0;

  return (
    <SectionCard
      title="Zoho FSM"
      icon={<CloudUpload />}
      description="This job's quotation and work order in Zoho FSM, and every call made for them."
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
          {/* Where each record stands in FSM, one row each, like the History rows. */}
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
                  job?.fsm_work_order_id
                    ? `Work order ${job.fsm_work_order_number ?? job.fsm_work_order_id}`
                    : "Work order"
                }
                subtitle={job?.fsm_work_order_id ? (job.fsm_status ?? "—") : "Not created yet"}
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
                    : "Not attached to the work order"
                }
              />
            </li>
          </ul>

          {problem ? (
            <div className="bg-destructive/5 border-destructive/20 mx-5 mb-1 flex gap-2 rounded-md border p-3 text-sm">
              <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
              <p className="break-words">{problem}</p>
            </div>
          ) : null}

          {canEdit ? (
            <div className="flex flex-wrap gap-2 px-5 py-3">
              <SubmitButton
                variant="outline"
                size="sm"
                onClick={() => void sync()}
                disabled={busy !== null}
                pending={busy === "sync"}
                pendingLabel="Syncing…"
                icon={<RefreshCw className="size-4" />}
              >
                {problem ? "Retry" : "Sync now"}
              </SubmitButton>
              {job?.fsm_work_order_id ? (
                <SubmitButton
                  variant={job.fsm_report_version ? "outline" : "default"}
                  size="sm"
                  onClick={() => void attachReport()}
                  disabled={busy !== null}
                  pending={busy === "attach"}
                  pendingLabel="Attaching…"
                  icon={<FileUp className="size-4" />}
                >
                  {job.fsm_report_version ? "Attach the report again" : "Attach report"}
                </SubmitButton>
              ) : null}
            </div>
          ) : null}

          {/* Every FSM call linked to the job, newest first: the same rows and pager as History. */}
          <FsmEventList
            className="border-t"
            log={log}
            total={total}
            page={page}
            pageSize={pageSize}
            loading={logLoading}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}
    </SectionCard>
  );
}
