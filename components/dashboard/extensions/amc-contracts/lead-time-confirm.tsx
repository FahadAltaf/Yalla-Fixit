"use client";

import { useCallback, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";
import { isLeadTimeWarning } from "@/lib/amc/lead-time";

/** Runs a booking, asking "book anyway?" when the day is inside the lead time. */
export type LeadTimeGuard = <T>(run: (insideLeadTime: boolean) => Promise<T>) => Promise<T>;

/** Thrown when the user keeps the lead time: nothing was booked. */
export class LeadTimeKept extends Error {
  constructor() {
    super("Not booked: pick a later day, or book anyway once the pass is arranged.");
    this.name = "LeadTimeKept";
  }
}

/**
 * DEV-493: wraps a booking so a day inside the property's access lead time
 * asks "book anyway?" first. `guard(run)` calls run(false); when the API
 * answers with the lead-time warning it shows it, and on Book anyway calls
 * run(true). Keeping the lead time throws LeadTimeKept. Render `dialog`.
 */
export function useLeadTimeConfirm() {
  const [message, setMessage] = useState<string | null>(null);
  const answer = useRef<((go: boolean) => void) | null>(null);

  const settle = useCallback((go: boolean) => {
    answer.current?.(go);
    answer.current = null;
    setMessage(null);
  }, []);

  const guard: LeadTimeGuard = useCallback(async <T,>(run: (insideLeadTime: boolean) => Promise<T>): Promise<T> => {
    try {
      return await run(false);
    } catch (e) {
      const text = e instanceof Error ? e.message : "";
      if (!isLeadTimeWarning(text)) throw e;
      const go = await new Promise<boolean>((resolve) => {
        answer.current = resolve;
        setMessage(text);
      });
      if (!go) throw new LeadTimeKept();
      return run(true);
    }
  }, []);

  const dialog = (
    <ConfirmationAlertDialog
      isOpen={message !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      title="Book inside the access lead time?"
      description={`${message ?? ""} Booking anyway is recorded in the history.`}
      confirmText="Book anyway"
      cancelText="Pick another day"
      icon={<TriangleAlert className="text-warning size-5" />}
      onConfirm={() => settle(true)}
    />
  );

  return { guard, dialog };
}
