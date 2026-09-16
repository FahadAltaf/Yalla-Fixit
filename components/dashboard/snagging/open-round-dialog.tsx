"use client";

import { useEffect, useState } from "react";

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
import { Label } from "@/components/ui/label";
import TimeSelect from "@/components/ui/time-select";
import {
  isPastSlot,
  nextBookableSlot,
  toGulfInstant,
} from "@/lib/snagging/schedule-defaults";

/**
 * Books the de-snag round before it is opened.
 *
 * A round used to be opened straight from a confirm dialog and silently
 * inherited the original inspection's date, so the record claimed the
 * re-check happened on the day of the first visit. Nobody could tell when
 * a round was actually due, and a developer's remediation window was
 * measured from the wrong day.
 *
 * So the date is asked for, and it has to be in the future: a re-check is
 * a visit that has not happened yet. The server enforces the same rule —
 * this form states it early rather than letting someone fill the whole
 * thing in and be refused on submit.
 */
export function OpenRoundDialog({
  open,
  onOpenChange,
  roundNumber,
  from,
  carrying,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roundNumber: number;
  /** What the round is being opened against, named the way people say it. */
  from: string;
  /** How many defects carry into the round, stated before committing. */
  carrying: number;
  busy?: boolean;
  onConfirm: (input: {
    scheduled_date: string;
    appointment_at: string | null;
  }) => void | Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  /*
    Opened on the next plausible slot rather than empty.

    An empty pair meant every round was booked by typing a date and a time
    from scratch, and the one thing the form insists on — that the slot has
    not already passed — was the coordinator's problem to satisfy. It starts
    an hour out and is re-derived on each open, so a dialog left sitting and
    reopened later never offers a stale time.
  */
  useEffect(() => {
    if (!open) return;
    const slot = nextBookableSlot();
    setDate(slot.date);
    setTime(slot.time);
  }, [open]);

  // A time on today's date has to be later than now; the date alone only
  // has to be today or after. Mirrors the server's two-part rule.
  const appointment = toGulfInstant(date, time);
  const inPast = isPastSlot(date, time);

  const ready = Boolean(date) && Boolean(time) && !inPast && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open round {roundNumber}</DialogTitle>
          <DialogDescription>
            {carrying} defect{carrying === 1 ? "" : "s"} carr
            {carrying === 1 ? "ies" : "y"} forward from {from}. Book the
            re-check, and you will be taken to the new round.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="round-date">Visit date</Label>
            {/* A re-check is booked forwards, so yesterday is not offered. */}
            <DateSelect
              id="round-date"
              value={date}
              onChange={setDate}
              disabledDates={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
              aria-label="Visit date"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="round-time">Appointment time</Label>
            <TimeSelect
              value={time}
              onChange={setTime}
              aria-label="Appointment time"
            />
          </div>
        </div>

        {inPast ? (
          <p className="text-destructive text-sm">
            {appointment
              ? "That time has already passed. Pick a later one."
              : "That date has already passed. Pick a later one."}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            disabled={!ready}
            onClick={() =>
              void onConfirm({
                scheduled_date: date,
                appointment_at: appointment ? appointment.toISOString() : null,
              })
            }
          >
            {busy ? "Opening…" : `Open round ${roundNumber}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
