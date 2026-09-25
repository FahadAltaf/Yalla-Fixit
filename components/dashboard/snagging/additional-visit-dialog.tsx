"use client";

import { useEffect, useState } from "react";
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
import DateSelect from "@/components/ui/date-select";
import TimeSelect from "@/components/ui/time-select";
import {
  isPastSlot,
  nextBookableSlot,
  toLocalInstant,
} from "@/lib/snagging/schedule-defaults";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { snaggingService } from "@/modules/snagging";

import { InspectorPicker } from "./inspector-picker";
import { ActionDialogContent, SubmitButton } from "./shared";

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
  onCreated,
  defaultInspectorIds,
  inspectorNames,
}: {
  taskId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Who the job's work currently sits with. The visit opens on them,
   * since the usual case is that the same people go back.
   */
  defaultInspectorIds?: string[];
  /** Their names, so the picker reads properly before the staff list lands. */
  inspectorNames?: Record<string, string>;
  /** The panel reloads itself; the visit is a row on it, not a new page. */
  onCreated?: () => void | Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [time, setTime] = useState("");
  const [chargeMethod, setChargeMethod] = useState<"quotation" | "payment_link">(
    "quotation",
  );
  const [paymentRef, setPaymentRef] = useState("");
  const [inspectorIds, setInspectorIds] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  /*
    Opened on the next plausible slot, matching the de-snag round dialog.

    The date used to be optional and blank, so a visit could be raised with
    no date at all and quietly inherited the original inspection's — the
    record then claimed a return trip happened on the day of the first one.
  */
  useEffect(() => {
    if (!open) return;
    const slot = nextBookableSlot();
    setScheduledDate(slot.date);
    setTime(slot.time);
    // Re-seeded on each open, so a list edited and then cancelled does
    // not survive into the next visit.
    setInspectorIds(defaultInspectorIds ?? []);
  }, [open, defaultInspectorIds]);

  const appointment = toLocalInstant(scheduledDate, time);
  const inPast = isPastSlot(scheduledDate, time);
  const ready = Boolean(scheduledDate) && Boolean(time) && !inPast && !working;

  async function submit() {
    // The button is disabled while working, but a double Enter can still
    // land twice — and this one bills the client.
    if (working) return;
    setWorking(true);
    try {
      const visit = await snaggingService.createVisit(taskId, {
        reason: reason.trim() || undefined,
        scheduled_date: scheduledDate,
        appointment_at: appointment ? appointment.toISOString() : null,
        technician_ids: inspectorIds,
        charge_method: chargeMethod,
        payment_reference:
          chargeMethod === "payment_link" ? paymentRef.trim() || undefined : undefined,
      });
      const charge =
        visit.charge && visit.charge > 0
          ? ` · AED ${visit.charge.toLocaleString()}`
          : "";
      toast.success(`Visit ${visit.visit_number} added${charge}`);
      /*
        Stays on the job. The visit is an appointment ON this record now
        (change 25), so there is no second job to navigate to — the panel
        the dialog was opened from is where it appears, and it is there
        before the dialog closes.
      */
      await onCreated?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not schedule the visit",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionDialogContent busy={working} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an additional visit</DialogTitle>
          <DialogDescription>
            A chargeable return trip on this job. It uses the job&apos;s own
            areas and checklist, and anything found joins this
            inspection&apos;s report rather than becoming a second one.
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="visit-date">Requested date</Label>
              {/* A visit is booked forwards, so yesterday is not a choice. */}
              <DateSelect
                id="visit-date"
                value={scheduledDate}
                onChange={setScheduledDate}
                disabledDates={{
                  before: new Date(new Date().setHours(0, 0, 0, 0)),
                }}
                aria-label="Requested date"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="visit-time">Requested time</Label>
              <TimeSelect
                id="visit-time"
                value={time}
                onChange={setTime}
                aria-label="Requested time"
              />
            </div>
          </div>

          {/*
            Who goes back (change 25).

            Asked while booking rather than afterwards, and opened on
            whoever holds the job, since the usual case is that the same
            people go back. A visit takes a set of inspectors, like the
            job itself: a villa re-walked by two people had to be booked
            under one of them, and the other never got it on their phone.
          */}
          <div className="grid gap-2">
            <Label htmlFor="visit-inspectors">Inspectors</Label>
            <InspectorPicker
              value={inspectorIds}
              onChange={setInspectorIds}
              names={inspectorNames}
              disabled={working}
            />
            <p className="text-muted-foreground text-xs">
              {inspectorIds.length === 0
                ? "Nobody is assigned yet; the visit can be given to somebody later."
                : chargeMethod === "quotation"
                  ? "The visit reaches their phones once it is booked, which is after the client approves the quotation."
                  : "The visit reaches their phones once it is booked."}
            </p>
          </div>

          {/*
            Change 26 / BR-14 — how the client pays for it.

            A return visit is usually a penalty rather than work the client
            chose to buy, so the team often sends a payment link instead of
            raising a quotation. Asked here because the two routes diverge
            straight away: only the quotation one waits for an approval
            before anybody can be booked.
          */}
          <div className="grid gap-2">
            <Label>Charged by</Label>
            <div className="bg-muted inline-flex w-fit rounded-md p-0.5">
              {(
                [
                  ["quotation", "Quotation"],
                  ["payment_link", "Payment link"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setChargeMethod(value)}
                  aria-pressed={chargeMethod === value}
                  className={
                    chargeMethod === value
                      ? "bg-background text-foreground rounded px-3 py-1 text-xs font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground rounded px-3 py-1 text-xs font-medium"
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              {chargeMethod === "quotation"
                ? "Raise the quotation from this job, then book the visit once the client approves it."
                : "No quotation needed. Send the client a link and book the visit as soon as it is paid."}
            </p>
          </div>

          {chargeMethod === "payment_link" ? (
            <div className="grid gap-2">
              <Label htmlFor="visit-payment-ref">Payment reference</Label>
              <Input
                id="visit-payment-ref"
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                placeholder="Link reference or receipt number"
              />
              <p className="text-muted-foreground text-xs">
                Optional now, but it is what proves the visit was paid for
                when somebody asks later.
              </p>
            </div>
          ) : null}

          {inPast ? (
            <p className="text-destructive text-sm">
              {appointment
                ? "That time has already passed. Pick a later one."
                : "That date has already passed. Pick a later one."}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={working}
          >
            Cancel
          </Button>
          <SubmitButton
            onClick={() => void submit()}
            disabled={!ready}
            pending={working}
            pendingLabel="Adding…"
            icon={<CalendarPlus className="size-4" />}
          >
            Add visit
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
