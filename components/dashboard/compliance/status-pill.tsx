"use client";

import { cn } from "@/lib/actions/utils";
import type { ComplianceItemStatus } from "@/lib/compliance/status";
import { ITEM_STATUS_LABEL, ITEM_STATUS_TONE, type StatusTone } from "@/lib/compliance/statuses";

/*
  Colour plus text, always (NFR-5). Tones follow docs/DESIGN-SYSTEM.md:
  danger and warning are their own hues, distinct from brand red.
*/
const TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-success/10 text-success border-success/30",
  info: "bg-brand/10 text-brand border-brand/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  muted: "bg-muted text-muted-foreground border-border",
};

export function StatusPill({ status, days, className }: { status: ComplianceItemStatus; days?: number | null; className?: string }) {
  const label = ITEM_STATUS_LABEL[status];
  const suffix = days === undefined || days === null ? "" : status === "expired" ? (days === 0 ? " · today" : ` · ${Math.abs(days)}d ago`) : ` · ${days}d`;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE_CLASS[ITEM_STATUS_TONE[status]], className)}>
      {label}
      {suffix}
    </span>
  );
}

/** YYYY-MM-DD shown as "23 Oct 2026", with no timezone shift. */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
