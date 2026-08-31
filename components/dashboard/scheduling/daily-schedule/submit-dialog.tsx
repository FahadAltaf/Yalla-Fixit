"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { scheduleService } from "@/modules/scheduling";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/actions/utils";
import { Loader2, MailCheck, Zap } from "lucide-react";

// The operating date arrives as YYYY-MM-DD; show it the way the rest of the
// board does rather than as a raw ISO string in the title.
function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

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
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Submit {formatDate(date)}</DialogTitle>
          <DialogDescription>
            Choose whether this day needs sign-off, or publish it to Zoho FSM straight away.
          </DialogDescription>
        </DialogHeader>

        {approvers === null ? (
          // Mirrors the option cards below, so the dialog does not resize
          // when the approver list lands.
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-start gap-3 rounded-md border p-3">
                <Skeleton className="mt-0.5 size-4 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-full max-w-[15rem]" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as "approve" | "skip")}
            className="gap-3"
          >
            {/* Route to an approver */}
            <Label
              htmlFor="submit-mode-approve"
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal transition-colors",
                mode === "approve" ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                noApprovers && "cursor-not-allowed opacity-55",
              )}
            >
              <RadioGroupItem id="submit-mode-approve" value="approve" disabled={noApprovers} className="mt-0.5" />
              <div className="flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <MailCheck className="size-4" /> Send for approval
                </span>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  The day waits as Pending Approval and the chosen person is emailed.
                </p>
                {noApprovers ? (
                  <p className="text-warning mt-2 text-xs">
                    No approvers set. Turn on “Schedule approval emails” for a user in the Users module first.
                  </p>
                ) : (
                  <Select
                    value={approverId}
                    onValueChange={(v) => {
                      setApproverId(v);
                      setMode("approve");
                    }}
                  >
                    <SelectTrigger className="mt-2 w-full" aria-label="Approver">
                      <SelectValue placeholder="Choose an approver" />
                    </SelectTrigger>
                    <SelectContent>
                      {approvers.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </Label>

            {/* Publish now, no approval */}
            <Label
              htmlFor="submit-mode-skip"
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal transition-colors",
                mode === "skip" ? "border-primary bg-primary/5" : "hover:bg-muted/40",
              )}
            >
              <RadioGroupItem id="submit-mode-skip" value="skip" className="mt-0.5" />
              <div className="flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Zap className="size-4" /> No approval needed — publish now
                </span>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Creates and reschedules the appointments in Zoho FSM straight away.
                </p>
              </div>
            </Label>
          </RadioGroup>
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
