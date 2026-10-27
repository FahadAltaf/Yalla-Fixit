"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/* "2026-09-01" ↔ a local date, so the day never shifts with the time zone. */
const toDate = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toText = (date: Date) => format(date, "yyyy-MM-dd");

/**
 * shadcn's date range picker (27 Oct): one button with the dates, opening a
 * two-month calendar. The range is applied once both ends are picked; a click
 * after a whole range starts a new one.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  min,
  max,
  label = "Dates",
  className,
}: {
  /** "YYYY-MM-DD". */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  min?: string;
  max?: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const shown: DateRange | undefined = draft ?? (from ? { from: toDate(from), to: to ? toDate(to) : undefined } : undefined);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setDraft(undefined);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("justify-start font-normal whitespace-nowrap", className)} aria-label={label}>
          <CalendarIcon className="size-4" />
          {from ? (
            <span className="tabular-nums">
              {format(toDate(from), "MMM dd, yyyy")}
              {to ? ` - ${format(toDate(to), "MMM dd, yyyy")}` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground">Pick dates</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          numberOfMonths={2}
          defaultMonth={shown?.from ?? (max ? toDate(max) : undefined)}
          selected={shown}
          onSelect={(range, day) => {
            /* A click after a whole range starts a new one, rather than stretching the old. */
            const next: DateRange = draft?.from && !draft.to ? (range ?? { from: day }) : { from: day, to: undefined };
            if (next.from && next.to) {
              setDraft(undefined);
              setOpen(false);
              onChange(toText(next.from), toText(next.to));
            } else {
              setDraft(next);
            }
          }}
          disabled={[...(min ? [{ before: toDate(min) }] : []), ...(max ? [{ after: toDate(max) }] : [])]}
        />
      </PopoverContent>
    </Popover>
  );
}
