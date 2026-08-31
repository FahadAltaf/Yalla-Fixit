"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
};

export default function RejectDialog({ open, onOpenChange, onConfirm, loading }: Props) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject this day?</DialogTitle>
          {/* Says what actually happens, so "Reject" is not a guess. */}
          <DialogDescription>
            The schedule goes back to the submitter as Rejected. Nothing is written to Zoho FSM, and they can
            reopen it for editing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="reject-reason">
            Reason <span className="text-muted-foreground font-normal">(required)</span>
          </Label>
          <Textarea
            id="reject-reason"
            placeholder="What needs to change before this day can be approved?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            autoFocus
          />
          <p className="text-muted-foreground text-xs">The submitter sees this, so be specific.</p>
        </div>

        <DialogFooter>
          {/* A destructive dialog needs a plain way out, not just Esc. */}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={loading || !reason.trim()}
            onClick={() => onConfirm(reason.trim())}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            Reject day
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
