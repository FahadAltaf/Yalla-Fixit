"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The status filter for a table toolbar: one dropdown beside the search
 * box, rather than a row of pills under it. A count, when given, shows
 * beside each status so "how much is waiting" is still one glance.
 */
export function StatusSelect({
  options,
  value,
  onChange,
  label = "Filter by status",
}: {
  options: ReadonlyArray<{ value: string; label: string; count?: number }>;
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full whitespace-nowrap sm:w-48" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.value === "all" ? "All statuses" : option.label}
            {typeof option.count === "number" ? (
              <span className="text-muted-foreground ml-1 tabular-nums">({option.count})</span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
