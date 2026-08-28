"use client";

import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

const TONE_TEXT: Record<StatTone, string> = {
  neutral: "text-foreground",
  progress: "text-warning",
  review: "text-brand",
  good: "text-success",
  bad: "text-danger",
};

/**
 * A metric tile, in the shadcn section-card shape: label, headline
 * figure, an optional trend badge in the corner, and a two-line footer
 * that says what moved and over what period.
 *
 * Trend direction is never colour alone — the badge carries an arrow and
 * a signed number, and the footer repeats the movement in words, so the
 * card reads to somebody who cannot separate the hues.
 */
export function StatCard({
  label,
  value,
  caption,
  headline,
  trend,
  tone = "neutral",
  href,
  onSelect,
  selectLabel,
}: {
  label: string;
  value: React.ReactNode;
  /** The muted second footer line: what the figure is measured over. */
  caption?: string;
  /** The bold first footer line: what changed. */
  headline?: string;
  /** Corner badge, e.g. { value: "+12.5%", direction: "up" }. */
  trend?: { value: string; direction: "up" | "down" };
  tone?: StatTone;
  href?: string;
  /**
   * Opens the records behind the figure in place, for a card whose
   * detail is a panel rather than another page. Ignored when `href` is
   * set — a tile that both navigates and opens a panel is a tile nobody
   * can predict.
   */
  onSelect?: () => void;
  /** What the button announces, when the label alone is not a sentence. */
  selectLabel?: string;
}) {
  const TrendIcon = trend?.direction === "down" ? TrendingDown : TrendingUp;

  const interactive = Boolean(href) || Boolean(onSelect);

  const body = (
    <Card
      className={cn(
        "@container/card h-full",
        interactive && "kz-card-interactive hover:border-brand/30 cursor-pointer",
      )}
    >
      <CardHeader>
        <CardDescription className="truncate text-sm">{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {value}
        </CardTitle>
        {trend ? (
          <CardAction>
            <Badge variant="outline" className="gap-1">
              <TrendIcon className="size-3.5" aria-hidden />
              {trend.value}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      {headline || caption ? (
        <CardFooter className="flex-col items-start gap-1 border-t-0 bg-transparent pt-0 text-sm">
          {headline ? (
            <div className={cn("line-clamp-1 flex items-center gap-1.5 font-medium", TONE_TEXT[tone])}>
              {headline}
              {trend ? <TrendIcon className="size-4" aria-hidden /> : null}
            </div>
          ) : null}
          {caption ? <div className="text-muted-foreground text-xs">{caption}</div> : null}
        </CardFooter>
      ) : null}
    </Card>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="focus-visible:ring-ring block rounded-lg focus-visible:ring-2 focus-visible:outline-none"
      >
        {body}
      </Link>
    );
  }

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-label={selectLabel ?? `${label}: show the records behind this figure`}
        className="focus-visible:ring-ring block w-full rounded-lg text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        {body}
      </button>
    );
  }

  return body;
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
