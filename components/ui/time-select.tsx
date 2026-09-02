"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/actions/utils";

/**
 * A 12-hour AM/PM time picker in 30-minute steps.
 *
 * Built on the design system's Popover and Command rather than hand-rolled
 * positioning: the previous version measured the viewport itself to decide
 * whether to flip up, drew its own listbox, and reimplemented selection --
 * three things Popover and Command already do, and do with the keyboard
 * handling and focus trapping this one never had. Typing now filters, which
 * matters at forty-eight options: "2 pm" reaches the slot in three
 * keystrokes instead of a scroll.
 */
export const TIME_STEP_MINUTES = 30;

const TIME_OPTIONS = (() => {
  const opts: { value: string; label: string }[] = [];
  for (let m = 0; m < 24 * 60; m += TIME_STEP_MINUTES) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const value = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    opts.push({ value, label: formatTimeAmPm(value) });
  }
  return opts;
})();

export function formatTimeAmPm(hhmm: string) {
  const [h, min] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return "";
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

export default function TimeSelect({
  value,
  onChange,
  className,
  disabled,
  placeholder = "Select a time",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  /** Shown when no time is set yet; the value stays "". */
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);

  // An off-step value (07:40 from an older record) is kept selectable by
  // slotting it into the list; an empty value simply has no option.
  const known = !value || TIME_OPTIONS.some((o) => o.value === value);
  const options = known
    ? TIME_OPTIONS
    : [{ value, label: formatTimeAmPm(value) }, ...TIME_OPTIONS].sort((a, b) =>
        a.value.localeCompare(b.value),
      );

  // Opening on a set time should land on it, not at midnight.
  useEffect(() => {
    if (!open || !value) return;
    const id = window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-time-option="${value}"]`)
        ?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            // Matches Input (and DateSelect beside it) rather than the
            // Button pill: this is a form field, not an action.
            "h-8 w-full justify-between rounded-[12px] px-2.5 font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <Clock className="size-4 shrink-0 opacity-60" aria-hidden />
            {value ? formatTimeAmPm(value) : placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        // Matches the trigger, so the list never sits narrower than the
        // field it belongs to.
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command
          // The stored value is 24-hour ("14:30") but the label is 12-hour,
          // and people type what they see. Searching both means "14:30",
          // "2:30" and "pm" all find the same slot.
          filter={(itemValue, search) => {
            const option = options.find((o) => o.value === itemValue);
            const haystack =
              `${itemValue} ${option?.label ?? ""}`.toLowerCase();
            return haystack.includes(search.trim().toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Type a time…" />
          <CommandList>
            <CommandEmpty>No time matches.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  data-time-option={option.value}
                  onSelect={(selected) => {
                    onChange(selected);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4",
                      option.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
