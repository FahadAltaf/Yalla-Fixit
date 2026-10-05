"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ActionDialogContent } from "@/components/dashboard/shared/kaizen-states";
import { amcContractsService } from "@/modules/amc-contracts/amc-contracts-service";

/** Cancels an active contract. Approvers only; the reason is recorded. */
export function CancelContractDialog({
  open,
  onOpenChange,
  contractId,
  proposalNumber,
  onCancelled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  proposalNumber: string;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (reason.trim().length < 3) {
      setError("Give a reason.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await amcContractsService.cancel(contractId, reason.trim());
      toast.success(`AMC ${proposalNumber} cancelled`);
      onOpenChange(false);
      onCancelled();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the contract.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this contract?</DialogTitle>
          <DialogDescription>
            Coverage stops and no more usage can be recorded. The contract, its usage and its
            history are kept. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="amc-cancel-reason">Reason</Label>
          <Textarea
            id="amc-cancel-reason"
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep contract
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={busy}>
            {busy ? "Cancelling…" : "Cancel contract"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
