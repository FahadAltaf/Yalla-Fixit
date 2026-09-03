"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import DateSelect from "@/components/ui/date-select";
import TimeSelect from "@/components/ui/time-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usersService } from "@/modules/users/services/users-service";
import type { User } from "@/types/types";

/**
 * FR-9.04 — books an approved additional visit.
 *
 * Separate from creating one on purpose. A visit is raised as a request,
 * quoted, sent and approved; only then is there a date to commit and an
 * inspector to send. Collapsing the two into one form is what let a visit
 * be scheduled before anyone had agreed to pay for it.
 *
 * The server refuses an unapproved visit regardless of what this form
 * does — the dialog surfaces that refusal rather than trying to
 * anticipate it, because the quotation can change state between opening
 * the form and submitting it.
 */
export function ScheduleVisitDialog({
  taskId,
  visit,
  open,
  onOpenChange,
  onScheduled,
}: {
  /** The ORIGINAL inspection: visits are addressed through their parent. */
  taskId: string;
  visit: { id: string; code: string; visit_number: number } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduled: () => void;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [inspectorId, setInspectorId] = useState<string>("");
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset per visit, so reopening for a different one never inherits the
  // last one's date.
  useEffect(() => {
    if (!open) return;
    setDate("");
    setTime("");
    setInspectorId("");
    setError(null);
    void usersService
      .getUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [open, visit?.id]);

  async function submit() {
    if (!visit || !date) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/snagging/tasks/${taskId}/visits/${visit.id}/schedule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduled_date: date,
            // Gulf time, matching how every other appointment is entered.
            appointment_at: time ? new Date(`${date}T${time}:00+04:00`).toISOString() : null,
            inspector_id: inspectorId || null,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        // The quotation gate speaks through this: its 409 explains
        // exactly which state the quote is in and what to do about it.
        throw new Error(body?.error ?? "Could not schedule this visit");
      }
      onScheduled();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not schedule this visit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule visit #{visit?.visit_number}</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{visit?.code}</span> — bookable
            once the client has approved this visit&apos;s quotation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="visit-date">Date</Label>
            <DateSelect id="visit-date" value={date} onChange={setDate} />
          </div>

          <div className="grid gap-2">
            <Label>Appointment time</Label>
            <TimeSelect value={time} onChange={setTime} aria-label="Appointment time" />
            <p className="text-muted-foreground text-xs">
              Optional. Leave empty if the slot is not agreed yet.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Inspector</Label>
            <Select value={inspectorId} onValueChange={setInspectorId}>
              <SelectTrigger>
                <SelectValue placeholder="Assign later" />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.full_name ?? user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/*
            The server's own words. A refusal here is nearly always the
            quotation gate, and it names the state the quote is in — which
            is the thing the coordinator has to act on.
          */}
          {error ? (
            <p className="text-danger bg-danger/10 flex items-start gap-2 rounded-md p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!date || saving}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Scheduling…
              </>
            ) : (
              <>
                <CalendarClock className="size-4" />
                Schedule visit
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
