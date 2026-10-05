"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ActionDialogContent } from "@/components/dashboard/shared/kaizen-states";
import { checkCorrection, formatQuantity, unitWord } from "@/lib/amc/contracts";
import {
  amcContractsService,
  type ContractDetail,
  type UsageEntry,
} from "@/modules/amc-contracts/amc-contracts-service";

import { externalRefLabel, formatContractDate } from "./contract-status";

type Entitlement = ContractDetail["entitlements"][number];

/**
 * Corrects a usage entry entered by mistake. The entry itself is never
 * edited or deleted: a correction entry is added that takes back some or
 * all of it, with a reason, and both show in the history. Nothing can take
 * back more than the entry recorded, or take usage below zero.
 */
export function CorrectUsageDialog({
  open,
  onOpenChange,
  contractId,
  entry,
  entitlement,
  onCorrected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  entry: UsageEntry;
  entitlement: Entitlement | undefined;
  onCorrected: () => void;
}) {
  const correctable = Math.max(0, entry.netQuantity);
  const [amount, setAmount] = useState(String(correctable));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount(String(Math.max(0, entry.netQuantity)));
      setReason("");
      setError(null);
    }
  }, [open, entry]);

  const value = Number(amount);
  const check = checkCorrection({
    original: { kind: entry.kind, quantity: entry.quantity },
    alreadyCorrected: entry.correctedQuantity,
    amount: value,
    reason,
    entitlementUsed: entitlement?.usedQuantity ?? 0,
  });
  const unit = entitlement ? unitWord(entitlement.entitlementType, 2) || "call-outs" : "";

  const submit = async () => {
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await amcContractsService.correctUsage(contractId, entry.id, { amount: value, reason: reason.trim() });
      toast.success("Correction recorded");
      onOpenChange(false);
      onCorrected();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the correction.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correct usage</DialogTitle>
          <DialogDescription>
            The original entry stays in the history. A correction entry takes back what was recorded
            by mistake.
          </DialogDescription>
        </DialogHeader>

        <dl className="bg-muted/40 grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
          <div className="col-span-2">
            <dt className="text-muted-foreground text-xs">Entry</dt>
            <dd className="font-medium">
              {entitlement?.serviceLabel ?? "Service"} · {formatContractDate(entry.occurredAt.slice(0, 10))}
            </dd>
            {entry.externalReference ? (
              <dd className="text-muted-foreground text-xs">
                {externalRefLabel(entry.externalType)} {entry.externalReference}
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Recorded</dt>
            <dd className="tabular-nums">{formatQuantity(entry.quantity)} {unit}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Still counting</dt>
            <dd className="tabular-nums">{formatQuantity(correctable)} {unit}</dd>
          </div>
        </dl>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="amc-correct-amount">Quantity to take back{unit ? ` (${unit})` : ""}</Label>
            <Input
              id="amc-correct-amount"
              type="number"
              inputMode="decimal"
              min={0}
              max={correctable}
              step={entitlement?.entitlementType === "hours" ? "0.25" : "1"}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="amc-correct-reason">Reason (required)</Label>
            <Textarea
              id="amc-correct-reason"
              rows={3}
              maxLength={1000}
              placeholder="e.g. Visit entered twice; WO731 was not an AMC visit"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {error || (!check.ok && reason.trim().length >= 3 && amount !== "") ? (
            <p className="text-destructive text-sm" role="alert">
              {error ?? (!check.ok ? check.error : "")}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !check.ok}>
            {busy ? "Saving…" : "Record correction"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
