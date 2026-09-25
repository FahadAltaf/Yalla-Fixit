"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import TimeSelect from "@/components/ui/time-select";
import { splitInstant, toLocalInstant } from "@/lib/snagging/schedule-defaults";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingJobVisit } from "@/types/types";

import { InspectorPicker } from "./inspector-picker";
import { ActionDialogContent, SubmitButton } from "./shared";


/**
 * Who goes, and when (BA v2, change 25).
 *
 * A visit is an appointment on the job, so it carries its own inspector
 * and its own slot — the person who walked the unit the first time is
 * not necessarily the one who goes back. Add visit asks only for a date,
 * so until this there was no way to put anybody on one: the row read
 * "Not assigned" and the phone of the inspector meant to go had nothing
 * on it.
 *
 * Used by the visit row and the visit page, so both edit the same way.
 */
export function VisitEditDialog({
  taskId,
  visit,
  open,
  onOpenChange,
  onSaved,
  book = false,
}: {
  taskId: string;
  visit: SnaggingJobVisit | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<unknown>;
  /**
   * Assigning books the visit. Once the client has approved the quotation
   * (or it is charged by link) there is nothing left to wait for but who
   * goes and when, so choosing them IS the booking -- a separate Book
   * button before it only added a step.
   */
  book?: boolean;
}) {
  const [inspectorIds, setInspectorIds] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  /*
    Seeded from the visit each time it opens, compared during render so
    a second visit's dialog never paints one frame of the first one's
    values.
  */
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = open && visit ? visit.id : null;
  if (key !== seededFor) {
    setSeededFor(key);
    if (visit) {
      const split = splitInstant(visit.appointment_at);
      /*
        Everyone on the visit, not just its first inspector: the whole set
        is what this dialog edits, and sending one back would quietly drop
        the others.
      */
      setInspectorIds(
        visit.inspectors?.length
          ? visit.inspectors.map((person) => person.id)
          : visit.inspector_id
            ? [visit.inspector_id]
            : [],
      );
      setDate(split.date || visit.scheduled_date || "");
      setTime(split.time || "09:00");
      setNotes(visit.notes ?? "");
    }
  }

  async function save() {
    if (!visit) return;
    setSaving(true);
    try {
      const appointment = date ? toLocalInstant(date, time || "09:00") : null;
      await snaggingService.updateVisit(taskId, visit.id, {
        technician_ids: inspectorIds,
        scheduled_date: date || null,
        appointment_at: appointment ? appointment.toISOString() : null,
        notes: notes.trim() || null,
        ...(book ? { status: "scheduled" as const } : {}),
      });
      if (book) {
        toast.success(`Visit ${visit.visit_number} booked`, {
          description:
            inspectorIds.length === 1
              ? "The inspector has it on their phone."
              : `${inspectorIds.length} inspectors have it on their phones.`,
        });
      } else {
        toast.success(`Visit ${visit.visit_number} updated`);
      }
      // The page shows the change before the dialog closes.
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the visit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionDialogContent busy={saving} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {book ? "Assign inspector" : "Visit"} {book ? `· Visit ${visit?.visit_number ?? ""}` : visit?.visit_number ?? ""}
          </DialogTitle>
          <DialogDescription>
            {book
              ? "Choose who goes back and when. Saving books the visit, and it appears in their Jobs list on their phones."
              : "Who goes back, and when. They get the job on their phones as soon as the visit is booked."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-visit-inspectors">Inspectors</Label>
            <InspectorPicker
              value={inspectorIds}
              onChange={setInspectorIds}
              names={Object.fromEntries(
                (visit?.inspectors ?? []).map((person) => [
                  person.id,
                  (person.full_name || person.email) ?? person.id,
                ]),
              )}
              disabled={saving}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-visit-date">Date</Label>
              <DateSelect
                id="edit-visit-date"
                value={date}
                onChange={setDate}
                disabledDates={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
                aria-label="Visit date"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-visit-time">Time</Label>
              <TimeSelect
                id="edit-visit-time"
                value={time}
                onChange={setTime}
                aria-label="Visit time"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-visit-notes">Notes for the inspector</Label>
            <Textarea
              id="edit-visit-notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Power is back on in the kitchen; the balcony door key is with security."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton
            pending={saving}
            pendingLabel={book ? "Booking…" : "Saving…"}
            // A booking needs somebody to go and a day to go on.
            disabled={book && (inspectorIds.length === 0 || !date)}
            onClick={() => void save()}
          >
            {book ? "Assign and book" : "Save"}
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
