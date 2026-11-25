"use client";

import { useCallback, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { ActionDialogContent } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isExpiredBookingWarning } from "@/lib/amc/expired-booking";

/** Runs a booking, asking an approver for the reason when the contract has expired. */
export type ExpiredBookingGuard = <T>(run: (expiredReason: string | null) => Promise<T>) => Promise<T>;

/**
 * DEV-496 (BRD v0.4 5.16): a booking on an expired contract needs an
 * approval and is logged. `guard(run)` calls run(null); when the API says
 * the contract has expired (the caller is an AMC approver), it shows why
 * and asks for the reason, then calls run(reason). Closing it throws.
 * Someone who may not approve gets the API's refusal as it is.
 */
export function useExpiredBookingApproval() {
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const answer = useRef<((reason: string | null) => void) | null>(null);

  const settle = useCallback((value: string | null) => {
    answer.current?.(value);
    answer.current = null;
    setMessage(null);
  }, []);

  const guard: ExpiredBookingGuard = useCallback(async <T,>(run: (expiredReason: string | null) => Promise<T>): Promise<T> => {
    try {
      return await run(null);
    } catch (e) {
      const text = e instanceof Error ? e.message : "";
      if (!isExpiredBookingWarning(text)) throw e;
      setReason("");
      const given = await new Promise<string | null>((resolve) => {
        answer.current = resolve;
        setMessage(text);
      });
      if (!given) throw new Error("Not booked: the contract has expired.");
      return run(given);
    }
  }, []);

  const dialog = (
    <Dialog open={message !== null} onOpenChange={(open) => !open && settle(null)}>
      <ActionDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="text-warning size-5" />
            Book on an expired contract?
          </DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5 py-1">
          <Label htmlFor="expired-booking-reason">Why it is booked anyway</Label>
          <Textarea
            id="expired-booking-reason"
            rows={3}
            maxLength={500}
            value={reason}
            placeholder="e.g. Renewal agreed with the client, paperwork in progress"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(null)}>
            Cancel
          </Button>
          <Button disabled={reason.trim().length < 3} onClick={() => settle(reason.trim())}>
            Approve and book
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );

  return { guard, dialog };
}
