"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";

type Action = "approve" | "reject";

interface Props {
  estimateId?: string;
  quotationNumber: string;
  currentStatus: string | null;
  setCurrentStatus: (status: string) => void;
}

export function ActionSection({ estimateId, quotationNumber, setCurrentStatus }: Props) {
  const [isLoading, setIsLoading] = useState<Action | null>(null);
  const [lastAction, setLastAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<Action | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const performAction = async (action: Action) => {
    if (!estimateId) {
      toast.error("This quotation cannot be updated in Zoho (missing estimate id).");
      return;
    }

    setIsLoading(action);
    setError(null);

    try {
      const res = await fetch("/api/estimates/transition", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          record_id: estimateId,
          action,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        setError("We couldn't update this quotation in Zoho. Please try again or contact support.");
        toast.error("Failed to update quotation in Zoho.");
        return;
      }

      setLastAction(action);
      setCurrentStatus(action === "approve" ? "Approved" : "Rejected");
      toast.success(
        action === "approve"
          ? `Quotation ${quotationNumber} approved successfully.`
          : `Quotation ${quotationNumber} rejected successfully.`
      );
    } catch (err) {
      console.error(err);
      setError("Unexpected error while talking to Zoho. Please try again.");
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(null);
    }
  };

  const handleAction = (action: Action) => {
    setConfirmAction(action);
    setIsDialogOpen(true);
  };

  const disabled = !estimateId || !!isLoading;

  return (
    <section className="space-y-4 rounded-lg border bg-slate-50 px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">Approve or reject this quotation</p>
          <p className="text-xs text-slate-600">
            Your choice will be saved in our system. 
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => handleAction("approve")}
          >
            {isLoading === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => handleAction("reject")}
          >
            {isLoading === "reject" ? "Rejecting…" : "Reject"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {lastAction && !error && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          {lastAction === "approve" ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <p>
            Quotation has been{" "}
            <span className="font-semibold">
              {lastAction === "approve" ? "approved" : "rejected"}
            </span>{" "}
            in Zoho FSM.
          </p>
        </div>
      )}

      {!estimateId && (
        <p className="text-[11px] text-slate-500">
          This quotation was loaded successfully, but it does not include a Zoho estimate id.
          You can still review the details in the email/PDF, but approve/reject must be handled manually in Zoho.
        </p>
      )}

      <ConfirmationAlertDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        title={
          confirmAction === "approve"
            ? "Confirm approval"
            : "Confirm rejection"
        }
        description={
          confirmAction === "approve"
            ? "Are you sure you want to approve this quotation in Zoho FSM?"
            : "Are you sure you want to reject this quotation in Zoho FSM?"
        }
        confirmText={confirmAction === "approve" ? "Approve" : "Reject"}
        cancelText="Cancel"
        loading={!!isLoading}
        variant={confirmAction === "reject" ? "destructive" : "default"}
        onConfirm={async () => {
          if (!confirmAction) return;
          await performAction(confirmAction);
          setIsDialogOpen(false);
        }}
      />
    </section>
  );
}

