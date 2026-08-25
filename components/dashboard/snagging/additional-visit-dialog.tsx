"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { snaggingService } from "@/modules/snagging";

import { SubmitButton } from "./shared";

/**
 * Books an additional (chargeable) snagging visit on a property (Q1-Q6).
 *
 * Unlike a de-snag round this is a fresh inspection pass, so the dialog
 * asks only for a reason and an optional date — the areas are copied
 * clean and the charge is fixed from the pricing config server-side.
 */
export function AdditionalVisitDialog({
  taskId,
  open,
  onOpenChange,
}: {
  taskId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [working, setWorking] = useState(false);

  async function submit() {
    // The button is disabled while working, but a double Enter can still
    // land twice — and this one bills the client.
    if (working) return;
    setWorking(true);
    try {
      const visit = await snaggingService.scheduleVisit(taskId, {
        reason: reason.trim() || undefined,
        scheduled_date: scheduledDate || undefined,
      });
      const charge =
        visit.visit_charge && visit.visit_charge > 0
          ? ` · AED ${visit.visit_charge.toLocaleString()}`
          : "";
      toast.success(`Additional visit ${visit.code} scheduled${charge}`);
      onOpenChange(false);
      window.location.href = `/snagging/${visit.id}`;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not schedule the visit");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule an additional visit</DialogTitle>
          <DialogDescription>
            A fresh, chargeable inspection pass on this property. It copies the same areas but
            carries no snags forward, and the additional-visit charge is taken from the current
            pricing.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="visit-reason">Reason</Label>
            <Textarea
              id="visit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Client requested a re-check after the handover snags were addressed"
              rows={3}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="visit-date">Scheduled date (optional)</Label>
            <Input
              id="visit-date"
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
            Cancel
          </Button>
          <SubmitButton
            onClick={() => void submit()}
            pending={working}
            pendingLabel="Scheduling…"
            icon={<CalendarPlus className="size-4" />}
          >
            Schedule visit
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
