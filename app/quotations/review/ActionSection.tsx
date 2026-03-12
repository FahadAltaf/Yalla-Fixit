"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { emailService } from "@/lib/email-service";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import { generateQuotationEmail } from "./generate-email";

type Action = "approve" | "reject";

interface Props {
  estimateId?: string;
  quotationNumber: string;
  currentStatus: string | null;
  setCurrentStatus: (status: string) => void;
  ownerEmail?: string;
  ownerName?: string;
  customerName?: string;
  customerEmail?: string;
  quotationDate?: string;
}

export function ActionSection({
  estimateId,
  quotationNumber,
  ownerEmail,
  customerName,
  setCurrentStatus,
  ownerName,
  quotationDate
}: Props) {
  const [isLoading, setIsLoading] = useState<Action | null>(null);
  const [lastAction, setLastAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);



  const sendOwnerEmail = async (action: Action) => {
    if (!ownerEmail) return;

    const note = action === "reject" && feedback.trim() ? `${feedback.trim()}` : "";
    const subject =
      action === "approve"
        ? `Quotation ${quotationNumber} approved by customer`
        : `Quotation ${quotationNumber} rejected by customer`;


    const html = generateQuotationEmail({
      status: action === "approve" ? "accepted" : "rejected",
      companyName: "Yalla Fixit",
      quotationNumber: quotationNumber,
      quotationDate,
      validUntil: new Date(new Date().setDate(new Date().getDate() + 30)).toLocaleDateString(),
      ownerName: ownerName ?? undefined,
      customerName: customerName,
      notes: note,
      rejectionReason: action === "reject" ? feedback.trim() : undefined,
      logoUrl: "https://portal.yallafixit.ae/yalla-fixit.png",
    });


    try {
      await emailService.sendEmail({
        to: ownerEmail,
        subject,
        html,
      });
    } catch (err) {
      console.error("Failed to send owner notification email", err);
      toast.error(
        "Quotation updated, but we could not notify the owner by email."
      );
    }
  };

  const performAction = async (action: Action) => {
    if (!estimateId) {
      toast.error(
        "This quotation cannot be updated in Zoho (missing estimate id)."
      );
      return;
    }

    setIsLoading(action);
    setError(null);

    const note = action === "reject" && feedback.trim() ? `${feedback.trim()}` : `Accepted by ${customerName}`;

    try {
      const res = await fetch("/api/estimates/transition", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          record_id: estimateId,
          action,
          notes: note,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        setError(
          "We couldn't update this quotation in Zoho. Please try again or contact support."
        );
        toast.error("Failed to update quotation in Zoho.");
        return;
      }

      setLastAction(action);
      setCurrentStatus(action === "approve" ? "Approved2" : "Rejected2");
      toast.success(
        action === "approve"
          ? `Quotation ${quotationNumber} approved successfully.`
          : `Quotation ${quotationNumber} rejected successfully.`
      );

      await sendOwnerEmail(action);
    } catch (err) {
      console.error(err);
      setError(
        "Unexpected error while talking to Zoho. Please try again."
      );
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(null);
    }
  };

  const handleAction = (action: Action) => {
    if (action === "reject") {
      setIsRejectDialogOpen(true);
      return;
    }
    setIsDialogOpen(true);
  };

  const disabledApprove = !estimateId || !!isLoading;
  const disabledReject = !estimateId || !!isLoading;

  return (
    <section className="space-y-4 rounded-lg border bg-white px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">
            Approve or reject this quotation
          </p>
          <p className="text-xs text-slate-600">
            Your choice will be saved in our system
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={disabledApprove}
            onClick={() => handleAction("approve")}
          >
            {isLoading === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabledReject}
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
          This quotation was loaded successfully, but it does not
          include a Zoho estimate id. You can still review the details
          in the email/PDF, but approve/reject must be handled manually
          in Zoho.
        </p>
      )}

      <ConfirmationAlertDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        title="Confirm Approval"
        description="Are you sure you want to approve this quotation? This action cannot be undone."
        confirmText="Approve"
        cancelText="Cancel"
        loading={isLoading === "approve"}
        onConfirm={async () => {
          await performAction("approve");
          setIsDialogOpen(false);
        }}
      />

      <AlertDialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <AlertDialogContent className="max-w-md!">
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this quotation</AlertDialogTitle>
            <AlertDialogDescription>
              Please share a short reason for rejecting this quotation. This will be sent to the Yalla Fixit team for better handling.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium text-slate-800">
              Reason for rejection
            </p>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Example: Price is above budget, scope not aligned, or timing does not work."
              className="text-xs"
            />
            <p className="text-[11px] text-slate-500">
              This note will be stored with the quotation and shared with the team.
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading === "reject"}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isLoading === "reject"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!feedback.trim()) {
                  toast.error("Please provide a short reason before rejecting this quotation.");
                  return;
                }
                await performAction("reject");
                setIsRejectDialogOpen(false);
              }}
            >
              {isLoading === "reject" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Reject quotation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

