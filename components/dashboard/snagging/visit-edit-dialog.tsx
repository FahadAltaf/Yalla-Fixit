"use client";

import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import TimeSelect from "@/components/ui/time-select";
import { toGulfInstant } from "@/lib/snagging/schedule-defaults";
import { snaggingService } from "@/modules/snagging";
import { usersService } from "@/modules/users/services/users-service";
import type { SnaggingJobVisit, User } from "@/types/types";

import { SubmitButton } from "./shared";

const UNASSIGNED = "__none__";

/** A stored instant, split into its GST date and time. */
function splitGst(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const shifted = new Date(new Date(iso).getTime() + 4 * 3600 * 1000);
  if (Number.isNaN(shifted.getTime())) return { date: "", time: "" };
  const text = shifted.toISOString();
  return { date: text.slice(0, 10), time: text.slice(11, 16) };
}

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
  onSaved: () => void;
  /**
   * Assigning books the visit. Once the client has approved the quotation
   * (or it is charged by link) there is nothing left to wait for but who
   * goes and when, so choosing them IS the booking -- a separate Book
   * button before it only added a step.
   */
  book?: boolean;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [inspectorId, setInspectorId] = useState(UNASSIGNED);
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
      const split = splitGst(visit.appointment_at);
      setInspectorId(visit.inspector_id ?? UNASSIGNED);
      setDate(split.date || visit.scheduled_date || "");
      setTime(split.time || "09:00");
      setNotes(visit.notes ?? "");
    }
  }

  useEffect(() => {
    if (!open || users.length > 0) return;
    let live = true;
    usersService
      .getUsers()
      .then((rows: User[]) => {
        if (live) setUsers(rows.filter((row) => row.is_active !== false));
      })
      .catch((error: unknown) => {
        if (live) {
          setUsersError(error instanceof Error ? error.message : "Could not load the staff list");
        }
      });
    return () => {
      live = false;
    };
  }, [open, users.length]);

  async function save() {
    if (!visit) return;
    setSaving(true);
    try {
      const appointment = date ? toGulfInstant(date, time || "09:00") : null;
      await snaggingService.updateVisit(taskId, visit.id, {
        inspector_id: inspectorId === UNASSIGNED ? null : inspectorId,
        scheduled_date: date || null,
        appointment_at: appointment ? appointment.toISOString() : null,
        notes: notes.trim() || null,
        ...(book ? { status: "scheduled" as const } : {}),
      });
      if (book) {
        const who = users.find((user) => user.id === inspectorId);
        toast.success(`Visit ${visit.visit_number} booked`, {
          description: `${who?.full_name || who?.email || "The inspector"} has it on their phone.`,
        });
      } else {
        toast.success(`Visit ${visit.visit_number} updated`);
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the visit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {book ? "Assign inspector" : "Visit"} {book ? `· Visit ${visit?.visit_number ?? ""}` : visit?.visit_number ?? ""}
          </DialogTitle>
          <DialogDescription>
            {book
              ? "Choose who goes back and when. Saving books the visit, and it appears in the inspector's Jobs list on their phone."
              : "Who goes back, and when. The inspector gets the job on their phone as soon as the visit is booked."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Inspector</Label>
            <Select value={inspectorId} onValueChange={setInspectorId}>
              <SelectTrigger className="w-full" aria-label="Inspector">
                <SelectValue placeholder="Choose an inspector" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Not assigned yet</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.full_name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {usersError ? <p className="text-destructive text-xs">{usersError}</p> : null}
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
            disabled={book && (inspectorId === UNASSIGNED || !date)}
            onClick={() => void save()}
          >
            {book ? "Assign and book" : "Save"}
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
