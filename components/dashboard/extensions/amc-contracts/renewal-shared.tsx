"use client";

import { useId, useState, type ReactNode } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { MANUAL_OUTCOMES, RENEWAL_OUTCOME_LABELS, type RenewalOutcome, type RenewalStage } from "@/lib/amc/renewal-outcomes";
import { cn } from "@/lib/utils";
import { renewalsService } from "@/modules/amc-contracts/renewals-service";

/**
 * Pieces the Renewals list and a contract's Renewal tab share (Phase 13):
 * the stage and outcome badges, the "in N days" wording, and the dialog
 * that records an outcome by hand.
 */

export const RENEWAL_STAGE_LABELS: Record<RenewalStage, string> = {
  not_due: "Not due",
  due: "Due",
  idle: "Idle",
  overdue: "Ended",
  settled: "Settled",
};

const STAGE_TONE: Record<RenewalStage, string> = {
  not_due: "bg-mist text-ink-soft",
  due: "bg-brand-50 text-brand",
  idle: "bg-warning/10 text-warning",
  overdue: "bg-danger/10 text-danger",
  settled: "bg-mist text-ink-soft",
};

const STAGE_HINT: Record<RenewalStage, string> = {
  not_due: "Not inside the renewal window yet",
  due: "Inside the renewal window",
  idle: "Reminded, and nothing done since: management has been told",
  overdue: "Ended without a renewal",
  settled: "Renewed, or the outcome is final",
};

const OUTCOME_TONE: Record<RenewalOutcome, string> = {
  renewed: "bg-success/10 text-success",
  renewed_revised_scope: "bg-success/10 text-success",
  under_negotiation: "bg-brand-50 text-brand",
  not_renewed: "bg-danger/10 text-danger",
  lapsed: "bg-warning/10 text-warning",
};

const OUTCOME_HINTS: Record<(typeof MANUAL_OUTCOMES)[number], string> = {
  under_negotiation: "The client is talking terms. Keeps it from being marked lapsed when it ends.",
  not_renewed: "The client said no. Say why; reminders stop.",
  lapsed: "It ended and nobody renewed it. Reminders stop.",
};

export function Tint({ tone, title, children, className }: { tone: string; title?: string; children: ReactNode; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", tone, className)} title={title}>
      {children}
    </Badge>
  );
}

export function RenewalStageBadge({ stage }: { stage: RenewalStage }) {
  return (
    <Tint tone={STAGE_TONE[stage]} title={STAGE_HINT[stage]}>
      {RENEWAL_STAGE_LABELS[stage]}
    </Tint>
  );
}

export function RenewalOutcomeBadge({ outcome }: { outcome: RenewalOutcome | null }) {
  if (!outcome) return <span className="text-muted-foreground text-sm">—</span>;
  return <Tint tone={OUTCOME_TONE[outcome] ?? "bg-mist text-ink-soft"}>{RENEWAL_OUTCOME_LABELS[outcome] ?? outcome}</Tint>;
}

/** A proposal's status, plainly ("proposal_sent" -> "Proposal sent"). */
export function ProposalStatusBadge({ status }: { status: string }) {
  const text = status.replace(/_/g, " ");
  const tone = /rejected|cancel/.test(status) ? "bg-danger/10 text-danger" : /approved|signed|active|accepted/.test(status) ? "bg-success/10 text-success" : "bg-mist text-ink-soft";
  return <Tint tone={tone}>{text.charAt(0).toUpperCase() + text.slice(1)}</Tint>;
}

/** "in 12 days", "today", "3 days ago". */
export function daysLeftLabel(days: number): string {
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  const ago = Math.abs(days);
  return `${ago} day${ago === 1 ? "" : "s"} ago`;
}

/**
 * Records a renewal's outcome by hand: Under negotiation, Not renewed (a
 * reason is required) or Lapsed. Renewed is recorded when the renewal
 * contract starts. Mount it with a `key` that changes on every open.
 */
export function RecordOutcomeDialog({
  open,
  onOpenChange,
  contractId,
  contractNumber,
  current,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string | null;
  contractNumber: string;
  current?: RenewalOutcome | null;
  onRecorded: () => void;
}) {
  const initial = current && (MANUAL_OUTCOMES as readonly string[]).includes(current) ? (current as (typeof MANUAL_OUTCOMES)[number]) : "under_negotiation";
  const [outcome, setOutcome] = useState<(typeof MANUAL_OUTCOMES)[number]>(initial);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const base = useId();

  const needsReason = outcome === "not_renewed";
  const valid = !needsReason || reason.trim().length >= 3;

  const submit = async () => {
    if (!contractId || !valid) return;
    setBusy(true);
    try {
      await renewalsService.recordOutcome(contractId, { outcome, reason: reason.trim() || null });
      toast.success(`Recorded: ${RENEWAL_OUTCOME_LABELS[outcome]}`);
      onOpenChange(false);
      onRecorded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the outcome.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record the renewal outcome</DialogTitle>
          <DialogDescription>
            AMC {contractNumber || "contract"}. Renewed is recorded on its own when the renewal contract starts.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <RadioGroup value={outcome} onValueChange={(v) => setOutcome(v as (typeof MANUAL_OUTCOMES)[number])} aria-label="Outcome">
            {MANUAL_OUTCOMES.map((o) => (
              <label
                key={o}
                htmlFor={`${base}-${o}`}
                className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm", outcome === o && "border-brand/40 bg-brand-50")}
              >
                <RadioGroupItem id={`${base}-${o}`} value={o} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="font-medium">{RENEWAL_OUTCOME_LABELS[o]}</span>
                  <span className="text-muted-foreground text-xs">{OUTCOME_HINTS[o]}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <div className="grid gap-2">
            <Label htmlFor={`${base}-reason`}>{needsReason ? "Why it was not renewed" : "Note (optional)"}</Label>
            <Textarea
              id={`${base}-reason`}
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={needsReason ? "e.g. Moving out, went with another provider, price" : "Anything the next person should know"}
            />
            {needsReason && !valid ? <p className="text-muted-foreground text-xs">A reason of at least 3 characters is required.</p> : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void submit()} pending={busy} pendingLabel="Saving…" disabled={!valid || !contractId} icon={<Flag className="size-4" />}>
            Record outcome
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
