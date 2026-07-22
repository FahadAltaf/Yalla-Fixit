"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { parseIsoDate, toIsoDate } from "../amc-date-utils";

interface DatePickerFieldProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minDate?: string;
  disabled?: boolean;
  id?: string;
}

export function DatePickerField({
  value,
  onChange,
  placeholder = "Pick a date",
  minDate,
  disabled = false,
  id,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const selectedDate = parseIsoDate(value);
  const minimumDate = parseIsoDate(minDate);
  const calendarMonth = selectedDate ?? minimumDate ?? new Date();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-2 size-4 shrink-0" />
          {selectedDate ? format(selectedDate, "dd MMM yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          key={minDate ?? "no-min-date"}
          mode="single"
          selected={selectedDate}
          defaultMonth={calendarMonth}
          disabled={minimumDate ? { before: minimumDate } : undefined}
          onSelect={(date) => {
            if (!date) return;
            onChange(toIsoDate(date));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
