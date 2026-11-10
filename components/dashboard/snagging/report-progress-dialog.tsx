"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import { ActionDialogContent } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { snaggingService } from "@/modules/snagging";

import { publishReportPdf } from "./report-publish";

/* The steps publishReportPdf reports, in order, as the popup lists them. */
const STAGES = ["Preparing the report", "Building the PDF", "Saving it and sending it to Zoho FSM"] as const;
const FSM_STEP = "Work order created and completed in Zoho FSM";

type Step = { label: string; done: boolean };
type State = {
  title: string;
  steps: Step[];
  status: "running" | "done" | "failed";
  /* "warn": saved, but FSM is not finished (switched off, refused, or still working). */
  tone?: "good" | "warn";
  message?: string;
  reportHref?: string;
};

/**
 * Waits for the job's work order: made, completed and carrying this report
 * version. Up to about two minutes, then says where to look instead.
 */
async function watchWorkOrder(taskId: string, version: number): Promise<{ tone: "good" | "warn"; message: string }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const fsm = await snaggingService.getTaskFsm(taskId, { page: 0, pageSize: 1 }).catch(() => null);
    if (fsm && (!fsm.enabled || !fsm.ready)) {
      return { tone: "warn", message: "Zoho FSM sync is switched off, so no work order is made." };
    }
    const job = fsm?.job ?? null;
    const completed = /completed|closed/i.test(job?.fsm_status ?? "");
    if (job?.fsm_work_order_id && completed && (job.fsm_report_version ?? 0) >= version) {
      return {
        tone: "good",
        message: `In Zoho FSM it is work order ${job.fsm_work_order_number ?? job.fsm_work_order_id}, completed, with the report attached.`,
      };
    }
    if (job?.fsm_error) {
      return { tone: "warn", message: `Zoho FSM: ${job.fsm_error}. The job's Activity tab has Retry.` };
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return {
    tone: "warn",
    message: "Zoho FSM is still working on the work order. The job's Activity tab shows it when it is done.",
  };
}

/**
 * The report's PDF being made and saved, in a popup rather than a toast in
 * the corner (Sharon, Oct 2026): what has been done is ticked off, the step
 * running has a spinner, and it cannot be closed while it runs, since
 * leaving the page stops the PDF. It ends on the outcome, with the report
 * one click away. The same popup as creating a job.
 */
export function useReportProgress() {
  const [state, setState] = useState<State | null>(null);

  /**
   * Makes and saves the report, showing each step. `done` is the first
   * line, already ticked (what led here: "Inspection approved").
   */
  async function run(
    taskId: string,
    options: {
      title: string;
      done?: string;
      versionId?: string | null;
      successMessage: string;
      failureMessage: string;
      reportHref?: string;
      /** After an approval: wait for the Zoho FSM work order and say which it is. */
      watchFsm?: boolean;
    },
  ): Promise<boolean> {
    const lead: Step[] = options.done ? [{ label: options.done, done: true }] : [];
    setState({
      title: options.title,
      steps: [...lead, ...STAGES.map((label) => ({ label, done: false }))],
      status: "running",
      reportHref: options.reportHref,
    });
    /* A stage starting means every stage before it is done. */
    const reached = (stage: string) =>
      setState((current) => {
        if (!current) return current;
        const at = STAGES.indexOf(stage as (typeof STAGES)[number]);
        if (at < 0) return current;
        return {
          ...current,
          steps: current.steps.map((step) => {
            const index = STAGES.indexOf(step.label as (typeof STAGES)[number]);
            return index >= 0 && index < at ? { ...step, done: true } : step;
          }),
        };
      });
    try {
      const saved = await publishReportPdf(taskId, { versionId: options.versionId, onStage: reached });
      const savedMessage = options.successMessage.replace("{version}", String(saved.version));
      if (!options.watchFsm) {
        setState((current) =>
          current && {
            ...current,
            status: "done",
            steps: current.steps.map((step) => ({ ...step, done: true })),
            message: savedMessage,
          },
        );
        return true;
      }

      /*
        The work order is made on the server after approval answers, which
        takes half a minute or so: looking in FSM straight away found
        nothing, and read as if approving made no work order (UAT retest).
        The popup waits for it and says which one it is.
      */
      setState((current) =>
        current && {
          ...current,
          steps: [...current.steps.map((step) => ({ ...step, done: true })), { label: FSM_STEP, done: false }],
        },
      );
      const outcome = await watchWorkOrder(taskId, saved.version);
      setState((current) =>
        current && {
          ...current,
          status: "done",
          tone: outcome.tone,
          steps: current.steps.map((step) => (step.label === FSM_STEP ? { ...step, done: outcome.tone === "good" } : step)),
          message: `${savedMessage} ${outcome.message}`,
        },
      );
      return true;
    } catch (error) {
      setState((current) =>
        current && {
          ...current,
          status: "failed",
          message: `${options.failureMessage} ${error instanceof Error ? error.message : "Something went wrong."}`,
        },
      );
      return false;
    }
  }

  const running = state?.status === "running";
  const dialog = (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        // Nothing closes it while the PDF is being made.
        if (!open && !running) setState(null);
      }}
    >
      <ActionDialogContent busy={running} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          <DialogDescription>
            {running
              ? "Keep this page open while the report is made, saved and sent to Zoho FSM. It takes up to a minute."
              : state?.status === "done"
                ? "The report is saved."
                : "The report was not saved."}
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 py-1">
          {(state?.steps ?? []).map((step, index) => {
            /* The first step not done is the one running, or the one that failed. */
            const current = !step.done && state?.steps.findIndex((s) => !s.done) === index;
            const failed = current && state?.status === "failed";
            return (
              <li key={`${step.label}-${index}`} className="flex items-start gap-3 text-sm">
                {step.done ? (
                  <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" aria-label="Done" />
                ) : failed ? (
                  <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" aria-label="Failed" />
                ) : current ? (
                  <Loader2 className="text-muted-foreground mt-0.5 size-4 shrink-0 animate-spin" aria-label="In progress" />
                ) : (
                  <span className="border-muted-foreground/40 mt-0.5 size-4 shrink-0 rounded-full border" aria-label="Waiting" />
                )}
                <span className={cn("min-w-0", step.done || !current ? "text-muted-foreground" : "font-medium")}>{step.label}</span>
              </li>
            );
          })}
        </ol>
        {state && state.status !== "running" && state.message ? (
          <p
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              state.status === "failed"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : state.tone === "warn"
                  ? "border-warning/30 bg-warning/5"
                  : "border-success/30 bg-success/5",
            )}
            role={state.status === "failed" ? "alert" : undefined}
          >
            {state.message}
          </p>
        ) : null}
        {state && state.status !== "running" ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => setState(null)}>
              Close
            </Button>
            {state.reportHref ? (
              <Button asChild>
                <Link href={state.reportHref}>Open the report</Link>
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </ActionDialogContent>
    </Dialog>
  );

  return { run, dialog };
}
