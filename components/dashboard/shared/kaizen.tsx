"use client";

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Generic Kaizen presentation primitives, shared across dashboard
 * modules (snagging, scheduling, todos).
 *
 * These carry the design system's signature moves — the brand-red
 * eyebrow above a sentence-case title, stat cards with a coloured dot
 * that never means anything on its own, section cards with a hairline
 * header — so every module reads as one product rather than three that
 * happen to share a colour.
 */

/** Brand-red uppercase kicker above a sentence-case page title. */
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1.5">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="text-3xl">{title}</h1>
        {description ? (
          <p className="text-muted-foreground max-w-2xl text-[0.9375rem]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type StatTone = "neutral" | "progress" | "review" | "good" | "bad";

const TONE_DOT: Record<StatTone, string> = {
  neutral: "bg-ink/25",
  progress: "bg-warning",
  review: "bg-brand",
  good: "bg-success",
  bad: "bg-danger",
};

/**
 * A stat card: coloured dot, eyebrow label, figure, caption.
 *
 * The dot repeats a status colour, but the label and figure carry the
 * meaning on their own, so the card still reads to somebody who cannot
 * separate the hues.
 */
export function StatCard({
  label,
  value,
  caption,
  tone = "neutral",
  href,
}: {
  label: string;
  value: React.ReactNode;
  caption?: string;
  tone?: StatTone;
  href?: string;
}) {
  const body = (
    <Card
      className={cn(
        "gap-0 p-4",
        href && "kz-card-interactive hover:border-brand/30 cursor-pointer",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden />
        <span className="eyebrow truncate">{label}</span>
      </div>
      <p className="mt-2 text-3xl leading-none font-semibold tabular-nums">{value}</p>
      {caption ? <p className="text-muted-foreground mt-2 text-xs">{caption}</p> : null}
    </Card>
  );

  return href ? (
    <Link
      href={href}
      className="focus-visible:ring-ring rounded-lg focus-visible:ring-2 focus-visible:outline-none"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

/** Section card with a title row and an optional trailing action. */
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden p-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div>
          <h2 className="text-lg">{title}</h2>
          {description ? (
            <p className="text-muted-foreground mt-1 text-sm">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}

/**
 * A row of pill tabs / filters, the shape used on the jobs table and
 * the scheduling nav. Generic so both stay identical.
 */
export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: ReadonlyArray<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              "focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
              active
                ? "border-brand bg-brand text-white"
                : "border-border text-ink-soft hover:bg-mist-soft",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className={cn("tabular-nums", active ? "text-white/80" : "text-muted-foreground")}>
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Relative time, in the words the office uses. */
export function timeAgo(value?: string | null): string {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}
