"use client";

import { Clock } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/actions/utils";

/**
 * A time field, not a menu.
 *
 * This was a Popover + Command combobox over forty-eight fixed slots in
 * half-hour steps. Three problems came with that shape: an appointment at
 * 10:15 could not be entered at all, picking any time meant opening a
 * list and scrolling it, and the list opened pre-scrolled to whatever was
 * nearest — which is how "3:00 AM" ended up looking like a considered
 * choice for a site visit.
 *
 * A native time input is the shadcn pattern for this, and is better on
 * every count that matters here: it accepts any minute, it types (an
 * inspector enters "1015" without lifting a hand), it renders the
 * platform's own 12/24-hour convention, and on a phone it raises the
 * system time wheel instead of a web listbox.
 *
 * The value contract is unchanged — "HH:mm", 24-hour — so every caller
 * keeps working.
 */
export const TIME_STEP_MINUTES = 30;

/** "14:30" -> "2:30 PM". Kept for callers that render a time as prose. */
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
  placeholder,
  "aria-label": ariaLabel,
  id,
}: {
  /** "HH:mm", 24-hour. Empty string means unset. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  /**
   * Unused by a native time input, which shows its own --:-- when empty.
   * Accepted so existing call sites need no edit.
   */
  placeholder?: string;
  "aria-label"?: string;
  id?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Clock
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        id={id}
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder ?? "Time"}
        /*
          pl-9 clears the icon. The appearance reset drops WebKit's own
          inner spin buttons, which sit on top of the field's padding and
          look like a second, broken control next to ours.
        */
        className={cn(
          "pl-9",
          "[&::-webkit-calendar-picker-indicator]:opacity-0",
          "[&::-webkit-inner-spin-button]:appearance-none",
          "[&::-webkit-clear-button]:hidden",
        )}
      />
    </div>
  );
}
