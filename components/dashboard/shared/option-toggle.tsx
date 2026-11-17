"use client";

import { useId } from "react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * A yes/no about a job or a unit, as one row (13 Nov 2026): an icon tile,
 * what it means, and a switch on the right.
 *
 * It replaces the tick-box cards (NOC required, external areas, furnished,
 * out of hours), which sat beside the document rows (Title deed, NOC) with a
 * different shape: a small checkbox top-left, smaller type, no icon. Now both
 * read as the same kind of row, so a Documents block is one even column.
 */
export function OptionToggle({
  checked,
  onChange,
  title,
  description,
  icon,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A lucide icon, shown in the tile (tinted while switched on). */
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        /* px-5 py-3, as the document rows (DataRow) it sits beside, so the icon tiles line up. */
        "flex items-center gap-3 rounded-lg border px-5 py-3 text-left transition-colors",
        checked ? "border-brand/40 bg-brand-50" : "hover:bg-muted/40",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md border transition-colors [&_svg]:size-4",
            checked ? "border-brand/30 bg-brand-50 text-brand" : "bg-muted/50 text-muted-foreground",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        {description ? <span className="text-muted-foreground mt-0.5 block text-sm leading-relaxed">{description}</span> : null}
      </span>
      <Switch id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} disabled={disabled} className="shrink-0" />
    </label>
  );
}
