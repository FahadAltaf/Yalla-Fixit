"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Date picker, in the shape the rest of the app uses.
 *
 * The alternative is <input type="date">, which draws the browser's own
 * calendar glyph, opens the browser's own picker, and shows an mm/dd/yyyy
 * placeholder no other field in the app has -- so the one date field on a
 * form looks like it belongs to a different product.
 *
 * Stores and returns the same YYYY-MM-DD string those endpoints already
 * expect, so it is a drop-in for the native input. Paired with TimeSelect on
 * the appointment forms, and matching it: both wear the Input silhouette
 * (h-8, rounded-[12px]) rather than the Button's pill.
 */
export default function DateSelect({
  id,
  value,
  onChange,
  className,
  disabled,
  placeholder = "Pick a date",
  "aria-label": ariaLabel,
  /** Days that cannot be chosen, e.g. `{ before: new Date() }`. */
  disabledDates,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  disabledDates?: React.ComponentProps<typeof Calendar>["disabled"];
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "h-8 w-full justify-start rounded-[12px] px-2.5 text-left font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="text-muted-foreground mr-2 size-4" />
          {selected ? format(selected, "dd MMM yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          disabled={disabledDates}
          onSelect={(date) => {
            onChange(date ? format(date, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
