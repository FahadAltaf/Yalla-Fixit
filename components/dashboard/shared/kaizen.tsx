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
          <p className="text-muted-foreground max-w-2xl text-[0.9375rem]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
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
 * The one metric tile the product uses. Every stat on every page is
 * this component — label, headline figure, an optional trend badge in
 * the corner, and a two-line footer saying what moved and over what
 * period. Pages differ in what they measure, never in how a measurement
 * looks.
 *
 * Trend direction is never colour alone: the badge carries an arrow and
 * a signed number, and the footer repeats the movement in words, so the
 * card reads to somebody who cannot separate the hues.
 *
 * Put a row of these inside StatCardGrid, which carries the surface
 * treatment and the column counts.
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
        interactive &&
          "kz-card-interactive hover:border-brand/30 cursor-pointer",
      )}
    >
      <CardHeader>
        <CardDescription className="truncate">{label}</CardDescription>
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
        // The project's CardFooter defaults to a tinted, bordered strip;
        // a stat card wants the footer to read as part of the same
        // surface, so those defaults are turned off here rather than at
        // every call site.
        <CardFooter className="flex-col items-start gap-1.5 border-t-0 bg-transparent pt-0 text-sm">
          {headline ? (
            <div
              className={cn(
                "line-clamp-1 flex gap-2 font-medium",
                TONE_TEXT[tone],
              )}
            >
              {headline}
              {trend ? <TrendIcon className="size-4" aria-hidden /> : null}
            </div>
          ) : null}
          {caption ? (
            <div className="text-muted-foreground">{caption}</div>
          ) : null}
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
        aria-label={
          selectLabel ?? `${label}: show the records behind this figure`
        }
        className="focus-visible:ring-ring block w-full rounded-lg text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        {body}
      </button>
    );
  }

  return body;
}

/**
 * Column counts for a row of stat cards, keyed off the width of the
 * content area rather than the window.
 *
 * A container query is the right unit here: collapsing the sidebar gives
 * the page a few hundred pixels back, and a viewport breakpoint cannot
 * see that. `@container/main` is declared on the dashboard shell's
 * <main>.
 */
const STAT_COLUMNS: Record<3 | 4 | 5, string> = {
  3: "@xl/main:grid-cols-2 @5xl/main:grid-cols-3",
  4: "@xl/main:grid-cols-2 @5xl/main:grid-cols-4",
  5: "@xl/main:grid-cols-2 @5xl/main:grid-cols-5",
};

/**
 * The row a set of StatCards sits in.
 *
 * It owns the surface treatment — the faint upward wash of brand colour
 * and the hairline shadow that lift a stat off the page — so a stat row
 * looks the same in every module without any page restating it.
 *
 * The cards are addressed by descendant rather than by direct child, as
 * the shadcn block does: a StatCard that links or opens a panel wraps
 * itself in an anchor or a button, and a child selector would skip
 * exactly those.
 */
export function StatCardGrid({
  columns = 4,
  className,
  children,
}: {
  columns?: 3 | 4 | 5;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4",
        /*
          A neutral wash, not a brand one.

          This used to lift every stat card with `from-primary/5`, which
          is brand red at five percent — so a card reading "First-time
          approval 100%" arrived faintly pink and looked like an alarm.
          The lift is worth keeping; the hue is not. A card that genuinely
          needs attention says so through its own tone instead (see the
          bad-tone treatment on StatCard).
        */
        "[&_[data-slot=card]]:from-muted/50 [&_[data-slot=card]]:to-card [&_[data-slot=card]]:bg-gradient-to-t [&_[data-slot=card]]:shadow-xs",
        "dark:[&_[data-slot=card]]:bg-card",
        STAT_COLUMNS[columns],
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Section card: a titled surface with an optional icon and trailing
 * action.
 *
 * The one card header the product uses. An icon in brand red sits with
 * the title, a muted description sits under it, and anything actionable
 * goes on the right — the shape the AMC forms already use, made shared
 * so a settings group, a list and a form all announce themselves the
 * same way.
 */
export function SectionCard({
  title,
  description,
  icon,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  /** Small lucide icon; rendered in brand red beside the title. */
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden p-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg">
            {icon ? (
              <span className="text-brand shrink-0 [&_svg]:size-[1.125rem]">
                {icon}
              </span>
            ) : null}
            {title}
          </h2>
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
              <span
                className={cn(
                  "tabular-nums",
                  active ? "text-white/80" : "text-muted-foreground",
                )}
              >
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

/**
 * The small uppercase label that opens a block inside a card.
 *
 * One level below SectionCard's title: a card says what it is, a
 * SubHeading says what this part of it is. Panels were each inventing
 * their own ("Areas (4)" in text-sm font-medium here, a bare <p> there),
 * which is how two lists sitting side by side end up looking like they
 * came from different products.
 */
export function SubHeading({
  children,
  count,
  action,
  className,
}: {
  children: React.ReactNode;
  /** Rendered beside the label, for a list that has a length worth knowing. */
  count?: number;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {children}
        {count !== undefined ? (
          <span className="text-muted-foreground/70 ml-1.5 tabular-nums">
            {count}
          </span>
        ) : null}
      </p>
      {action}
    </div>
  );
}

/**
 * One row of a list inside a card: an icon tile, a title with a muted
 * second line, and whatever belongs on the right.
 *
 * The shape the reference library uses for every list of records — a
 * transaction, an audit event, an area, a quotation line. Squared-off
 * tile rather than a circle, and the trailing slot right-aligned so
 * numbers in a column line up.
 */
export function DataRow({
  icon,
  title,
  subtitle,
  trailing,
  onClick,
  active,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  /** Marks the row as the one currently being shown elsewhere on screen. */
  active?: boolean;
  className?: string;
}) {
  const content = (
    <>
      {icon ? (
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground [&_svg]:size-4",
            active ? "border-brand/30 bg-brand-50 text-brand" : "bg-muted/50",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        {subtitle ? (
          <div className="text-muted-foreground truncate text-sm">
            {subtitle}
          </div>
        ) : null}
      </div>
      {trailing ? (
        <div className="shrink-0 text-right text-sm">{trailing}</div>
      ) : null}
    </>
  );

  const shared = cn(
    "flex w-full items-center gap-3 px-5 py-3 text-left",
    active && "bg-brand-50/40",
    className,
  );

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        shared,
        "hover:bg-muted/50 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:-outline-offset-2",
      )}
    >
      {content}
    </button>
  ) : (
    <div className={shared}>{content}</div>
  );
}
