"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { scheduleService } from "@/modules/scheduling";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, MailCheck, Zap } from "lucide-react";

type Approver = { id: string; name: string; email: string };

type Props = {
  scheduleVersionId: string;
  date: string;
  onOpenChange: (open: boolean) => void;
  // Called after a successful submit. `published` is true when it went straight
  // to FSM (no approval), false when it was routed to an approver.
  onSubmitted: (published: boolean) => void;
};

// E1: when submitting a day, choose an approver to route it to, or publish it
// straight to FSM with no approval.
export default function SubmitDialog({ scheduleVersionId, date, onOpenChange, onSubmitted }: Props) {
  const [approvers, setApprovers] = useState<Approver[] | null>(null);
  const [mode, setMode] = useState<"approve" | "skip">("approve");
  const [approverId, setApproverId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    scheduleService
      .listApprovers()
      .then((list) => {
        setApprovers(list);
        if (list.length > 0) setApproverId(list[0].id);
        else setMode("skip"); // nobody to approve → default to publish now
      })
      .catch(() => setApprovers([]));
  }, []);

  const handleConfirm = async () => {
    if (mode === "approve" && !approverId) {
      toast.error("Choose who should approve this day");
      return;
    }
    setSubmitting(true);
    try {
      const result =
        mode === "skip"
          ? await scheduleService.submit(scheduleVersionId, { skipApproval: true })
          : await scheduleService.submit(scheduleVersionId, { approverId });

      if (result.published) {
        const fails = (result.results ?? []).filter((r) => r.status === "failed");
        if (fails.length > 0) {
          const detail = fails
            .slice(0, 3)
            .map((r) => `${r.label || "An entry"} — ${r.error || "Zoho FSM rejected the change"}`)
            .join("; ");
          const more = fails.length > 3 ? ` (+${fails.length - 3} more)` : "";
          toast.warning(`Published, but ${fails.length} failed to sync: ${detail}${more}`, { duration: 12000 });
        } else {
          toast.success("Published to Zoho FSM (no approval needed)");
        }
      } else {
        const who = approvers?.find((a) => a.id === approverId)?.name ?? "the approver";
        toast.success(`Sent to ${who} for approval`);
      }
      onSubmitted(result.published);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  const noApprovers = approvers !== null && approvers.length === 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Submit {date}</DialogTitle>
        </DialogHeader>

        {approvers === null ? (
          <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading approvers…
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Route to an approver */}
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
                mode === "approve" ? "border-primary bg-primary/5" : "hover:bg-muted/40"
              } ${noApprovers ? "cursor-not-allowed opacity-55" : ""}`}
            >
              <input
                type="radio"
                name="submitmode"
                className="mt-1"
                checked={mode === "approve"}
                disabled={noApprovers}
                onChange={() => setMode("approve")}
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <MailCheck className="size-4" /> Send for approval
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  The day waits as Pending Approval and the chosen person is emailed.
                </p>
                {noApprovers ? (
                  <p className="mt-2 text-xs text-warning">
                    No approvers set. Turn on “Schedule approval emails” for a user in the Users module first.
                  </p>
                ) : (
                  <select
                    value={approverId}
                    onChange={(e) => setApproverId(e.target.value)}
                    onFocus={() => setMode("approve")}
                    className="border-input bg-transparent dark:bg-input/30 mt-2 h-9 w-full rounded-md border px-2 text-sm"
                  >
                    {approvers.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>

            {/* Publish now, no approval */}
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
                mode === "skip" ? "border-primary bg-primary/5" : "hover:bg-muted/40"
              }`}
            >
              <input
                type="radio"
                name="submitmode"
                className="mt-1"
                checked={mode === "skip"}
                onChange={() => setMode("skip")}
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Zap className="size-4" /> No approval needed — publish now
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Creates and reschedules the appointments in Zoho FSM straight away.
                </p>
              </div>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={submitting || approvers === null}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {mode === "skip" ? "Publish now" : "Send for approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
