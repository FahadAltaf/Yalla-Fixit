"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/actions/utils";

// Operating-date control for the schedule board: step a day at a time, or
// open the shadcn Calendar to jump. Replaces a bare <input type="date">,
// whose picker was the browser's own and looked nothing like the rest of
// the app.
//
// Dates are handled as local YYYY-MM-DD strings throughout the board --
// never via toISOString(), which would shift the day across a timezone.

function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromIso(value: string): Date | undefined {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

export default function DateNav({
  date,
  onChange,
  onStep,
  onToday,
  isToday,
}: {
  date: string;
  onChange: (iso: string) => void;
  onStep: (delta: number) => void;
  onToday: () => void;
  isToday: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = fromIso(date);

  return (
    // Wraps rather than pushing the page wider than the viewport on a phone.
    <div className="flex flex-wrap items-center gap-1">
      <Button size="icon" variant="outline" onClick={() => onStep(-1)} aria-label="Previous day">
        <ChevronLeft className="size-4" />
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="w-[150px] justify-start gap-2 font-normal tabular-nums sm:w-[190px]"
          >
            <CalendarIcon className="size-4 shrink-0" />
            {selected ? format(selected, "EEE, dd MMM yyyy") : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            captionLayout="dropdown"
            onSelect={(d) => {
              if (!d) return;
              onChange(toIso(d));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      <Button size="icon" variant="outline" onClick={() => onStep(1)} aria-label="Next day">
        <ChevronRight className="size-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onToday}
        disabled={isToday}
        className={cn(isToday && "opacity-50")}
      >
        Today
      </Button>
    </div>
  );
}
