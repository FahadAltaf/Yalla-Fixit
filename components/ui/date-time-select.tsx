"use client";

import DateSelect from "@/components/ui/date-select";
import TimeSelect from "@/components/ui/time-select";
import { cn } from "@/lib/utils";

/** Today, as YYYY-MM-DD on this device. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A date and a time, as the shadcn calendar beside the time field (the
 * pair the appointment forms use), in place of <input type="datetime-local">,
 * whose browser picker and mm/dd/yyyy text look like another product.
 *
 * Same value contract as that input, so it is a drop-in: "YYYY-MM-DDTHH:mm"
 * (local time), or "" when unset. Picking only a date keeps the time already
 * there, or takes `defaultTime`; typing only a time takes today's date.
 */
export default function DateTimeSelect({
  id,
  value,
  onChange,
  className,
  disabled,
  min,
  max,
  defaultTime = "10:00",
  step,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  /** Earliest / latest day that can be picked, YYYY-MM-DD (or a full value). */
  min?: string;
  max?: string;
  /** The time a date picked on its own gets, "HH:mm". */
  defaultTime?: string;
  /** Seconds between times in the field's stepper (900 = quarter hours). */
  step?: number;
  "aria-label"?: string;
}) {
  const [date = "", time = ""] = value ? value.split("T") : [];
  const hhmm = time.slice(0, 5);
  const label = ariaLabel ?? "Date and time";

  return (
    // Side by side when there is room for both, stacked in a narrow column.
    <div className={cn("@container min-w-0", className)}>
      <div className="grid grid-cols-1 gap-2 @[17rem]:grid-cols-[minmax(0,1fr)_7.5rem]">
        <DateSelect
          id={id}
          value={date}
          min={min?.slice(0, 10)}
          max={max?.slice(0, 10)}
          disabled={disabled}
          aria-label={`${label}: date`}
          onChange={(d) => onChange(d ? `${d}T${hhmm || defaultTime}` : "")}
        />
        <TimeSelect
          value={hhmm}
          step={step}
          disabled={disabled}
          aria-label={`${label}: time`}
          onChange={(t) =>
            onChange(
              t
                ? `${date || today()}T${t}`
                : date
                  ? `${date}T${defaultTime}`
                  : "",
            )
          }
        />
      </div>
    </div>
  );
}
