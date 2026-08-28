"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/actions/utils";

// Date filter for the Todos filter grid.
//
// Replaces <Input type="date">, whose picker and mm/dd/yyyy placeholder came
// from the browser and matched nothing else in the filter bar. Popover +
// Calendar is the standard shadcn date-picker pattern used elsewhere in the
// app (see the AMC DatePickerField).
//
// Values stay as local YYYY-MM-DD strings, matching what the filters already
// send to the API -- never toISOString(), which would shift the day across a
// timezone.

function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromIso(value?: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

export default function DateFilter({
  value,
  onChange,
  placeholder = "Any date",
  ariaLabel,
}: {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = fromIso(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={ariaLabel}
          className={cn(
            "w-full justify-start gap-2 font-normal",
            !selected && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="size-4 shrink-0" />
          <span className="truncate">{selected ? format(selected, "dd MMM yyyy") : placeholder}</span>
          {selected && (
            // Clearing a date filter should not mean opening the calendar to
            // hunt for a "none" option.
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date"
              className="hover:bg-muted ml-auto rounded-sm p-0.5"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange("");
                }
              }}
            >
              <X className="size-3.5" />
            </span>
          )}
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
  );
}
