"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarOff, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatZonedDate } from "@/lib/scheduling/org-time";
import { reportingService, type PublicHoliday } from "@/modules/reporting/reporting-service";

/**
 * Public holidays (BRD 5.2 B2; DEV-443). A holiday counts zero available
 * hours for every technician, so nobody looks under-utilized on it. None
 * are set until someone adds them (D-16): the reports say so.
 */
export function PublicHolidays({ canEdit, onChanged }: { canEdit: boolean; onChanged?: () => void }) {
  const [holidays, setHolidays] = useState<PublicHoliday[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setHolidays((await reportingService.listHolidays()).holidays);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load public holidays");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!date || !name.trim()) {
      toast.error("Give the holiday a date and a name.");
      return;
    }
    setBusy(true);
    try {
      setHolidays((await reportingService.saveHoliday({ date, name: name.trim() })).holidays);
      setDate("");
      setName("");
      toast.success("Holiday saved");
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the holiday");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (holiday: PublicHoliday) => {
    setBusy(true);
    try {
      setHolidays((await reportingService.removeHoliday(holiday.id)).holidays);
      toast.success(`${holiday.name} removed`);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the holiday");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      icon={<CalendarOff />}
      title="Public holidays"
      description="Days that count zero available hours for every technician. Saving a date that is already listed renames it."
      bodyClassName="border-t"
    >
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-3 border-b px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="holiday-date" className="text-xs">
              Date
            </Label>
            <Input id="holiday-date" type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <Label htmlFor="holiday-name" className="text-xs">
              Name
            </Label>
            <Input
              id="holiday-name"
              maxLength={120}
              placeholder="e.g. National Day"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
            />
          </div>
          <Button onClick={() => void add()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add holiday
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="p-5">
          <ErrorState title="Could not load public holidays" message={error} onRetry={() => void load()} />
        </div>
      ) : holidays === null ? (
        <div className="p-5">
          <ListSkeleton rows={3} />
        </div>
      ) : holidays.length === 0 ? (
        <EmptyState
          className="border-0"
          icon={<CalendarOff className="size-5" />}
          title="No public holidays yet"
          description="Until they are added, a public holiday counts as a normal working day in available hours."
        />
      ) : (
        <ul className="divide-y">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
              <div className="flex flex-col">
                <span className="font-medium">{h.name}</span>
                <span className="text-muted-foreground text-xs">{formatZonedDate(`${h.date}T08:00:00Z`)}</span>
              </div>
              {canEdit ? (
                <Button variant="ghost" size="sm" onClick={() => void remove(h)} disabled={busy} aria-label={`Remove ${h.name}`}>
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
