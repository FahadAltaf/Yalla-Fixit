"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CloudUpload, FileUp, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  snaggingService,
  type SnaggingJobFsm,
  type SnaggingQuotation,
} from "@/modules/snagging";
import type { SnaggingTask } from "@/types/types";

import { FsmLogList } from "./fsm-sync-card";
import { SubmitButton, formatLocalDateTime } from "./shared";

/**
 * The approved job in Zoho FSM (SNG-189): the work order it was completed
 * as, whether the client report is attached for finance, a Retry, and the
 * job's FSM sync log.
 *
 * On the report page because the report is what finance needs: when the
 * server could not make the PDF on approval, "Attach report" builds the
 * same document the Download button gives and hands it to FSM.
 */
export function FsmJobCard({
  task,
  quotation,
  canEdit,
}: {
  task: SnaggingTask;
  quotation: SnaggingQuotation | null;
  canEdit: boolean;
}) {
  const [state, setState] = useState<SnaggingJobFsm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "sync" | "attach">(null);

  const load = useCallback(async () => {
    try {
      setState(await snaggingService.getTaskFsm(task.id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the FSM sync");
    }
  }, [task.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setBusy("sync");
    try {
      const result = await snaggingService.syncTaskFsm(task.id);
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
      const { buildInspectionReportPdf } = await import("./report-pdf-download");
      const { blob, filename } = await buildInspectionReportPdf(task, quotation);
      toast.loading("Attaching it to the work order…", { id });
      const result = await snaggingService.attachReportToFsm(task.id, blob, filename);
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
  const badge = !state
    ? null
    : !state.enabled
      ? { label: "Sync off", tone: "bg-muted text-muted-foreground" }
      : !state.ready
        ? { label: "Not set up", tone: "bg-muted text-muted-foreground" }
        : job?.fsm_error
          ? { label: "Failed", tone: "bg-destructive/10 text-destructive" }
          : job?.fsm_work_order_id && job.fsm_report_version
            ? { label: "Ready to invoice", tone: "bg-success/10 text-success" }
            : job?.fsm_work_order_id
              ? { label: "Report missing", tone: "bg-warning/10 text-warning" }
              : { label: "Not synced", tone: "bg-warning/10 text-warning" };

  return (
    <SectionCard
      title="Zoho FSM"
      icon={<CloudUpload />}
      description="The completed job in Zoho FSM, with this report attached for invoicing."
      action={badge ? <Badge className={`border-0 ${badge.tone}`}>{badge.label}</Badge> : null}
      bodyClassName="border-t px-5 py-4"
    >
      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : !state ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : !state.enabled ? (
        <p className="text-muted-foreground text-sm">
          Syncing with Zoho FSM is switched off. It starts once SNAGGING_FSM_SYNC is set to
          &quot;on&quot;.
        </p>
      ) : !state.ready ? (
        <p className="text-muted-foreground text-sm">
          The Zoho FSM sync needs its database migration applied first.
        </p>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Work order</dt>
            <dd className="font-medium">
              {job?.fsm_work_order_number ?? job?.fsm_work_order_id ?? "Not created yet"}
            </dd>
            <dt className="text-muted-foreground">FSM status</dt>
            <dd>{job?.fsm_status ?? "—"}</dd>
            <dt className="text-muted-foreground">Report</dt>
            <dd>{job?.fsm_report_version ? `Attached (version ${job.fsm_report_version})` : "Not attached"}</dd>
            <dt className="text-muted-foreground">Last synced</dt>
            <dd>{job?.fsm_synced_at ? formatLocalDateTime(job.fsm_synced_at) : "—"}</dd>
          </dl>

          {job?.fsm_error ? (
            <div className="bg-destructive/5 border-destructive/20 flex gap-2 rounded-md border p-3 text-sm">
              <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
              <p className="break-words">{job.fsm_error}</p>
            </div>
          ) : null}

          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <SubmitButton
                variant="outline"
                size="sm"
                onClick={() => void sync()}
                disabled={busy !== null}
                pending={busy === "sync"}
                pendingLabel="Syncing…"
                icon={<RefreshCw className="size-4" />}
              >
                {job?.fsm_error ? "Retry" : "Sync now"}
              </SubmitButton>
              <SubmitButton
                variant={job?.fsm_work_order_id && !job.fsm_report_version ? "default" : "outline"}
                size="sm"
                onClick={() => void attachReport()}
                disabled={busy !== null}
                pending={busy === "attach"}
                pendingLabel="Attaching…"
                icon={<FileUp className="size-4" />}
              >
                {job?.fsm_report_version ? "Attach the report again" : "Attach report"}
              </SubmitButton>
            </div>
          ) : null}

          <FsmLogList log={state.log} />
        </div>
      )}
    </SectionCard>
  );
}
