"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/actions/utils";
import { ChevronDown } from "lucide-react";

// A 12-hour AM/PM time picker in 30-minute steps (YFI). Built as a custom
// popover rather than a native <select> because the native dropdown opened
// UPWARD over the field near the bottom of a dialog (YFI note on O-2). This
// one always opens downward (flipping up only if there truly isn't room) and
// scrolls, so the field is never covered.
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
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

export default function TimeSelect({
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const known = TIME_OPTIONS.some((o) => o.value === value);
  const options = known
    ? TIME_OPTIONS
    : [{ value, label: formatTimeAmPm(value) }, ...TIME_OPTIONS].sort((a, b) => a.value.localeCompare(b.value));

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Once open, bring the selected option into view (no state change here, so
  // it stays out of the "setState in effect" rule).
  useLayoutEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView({ block: "center" });
  }, [open]);

  // Prefer opening downward; flip up only when there isn't room below and
  // there's more room above. Measured at click time, not in an effect.
  const toggleOpen = () => {
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      setFlipUp(below < 220 && rect.top > below);
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleOpen}
        className={cn(
          "border-input bg-transparent dark:bg-input/30 flex h-9 w-full items-center justify-between rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          className,
        )}
      >
        <span>{formatTimeAmPm(value)}</span>
        <ChevronDown className="size-4 opacity-60" />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          className={cn(
            "bg-popover absolute z-50 max-h-56 w-full overflow-y-auto rounded-md border p-1 shadow-md",
            flipUp ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                data-selected={selected}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center rounded px-2 py-1.5 text-left text-sm",
                  selected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
