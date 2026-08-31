"use client";

import { Badge } from "@/components/ui/badge";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/actions/utils";
import {
  CarFrontIcon,
  MoonIcon,
  ServerIcon,
  SunIcon,
  UserRoundIcon,
  UserStarIcon,
  WrenchIcon,
} from "lucide-react";

// Presentation pieces for the technicians table, following the canonical
// table pattern used by the users table (identity avatar + two-line stack,
// icon-before-label on categorical columns, soft-tinted status pills).

// Identity column: avatar + bold name over the FSM resource id, which is
// what schedulers quote when something needs chasing in Zoho.
export function TechnicianIdentity({
  name,
  subtitle,
  seed,
  inactive,
}: {
  name: string;
  subtitle: string;
  seed: string;
  inactive?: boolean;
}) {
  return (
    <IdentityCell
      title={name}
      subtitle={subtitle}
      seed={seed}
      badge={
        inactive ? (
          <Badge variant="outline" className="text-muted-foreground px-1.5 py-0 text-[10px] font-normal">
            Inactive
          </Badge>
        ) : undefined
      }
    />
  );
}

// Categorical columns read as icon + label so the column can be scanned
// without reading every row. An unset value stays visibly muted rather than
// rendering an empty cell, so "not configured yet" is obvious at a glance.
const ROLE_ICONS: Record<string, React.ElementType> = {
  supervisor: UserStarIcon,
  driver: CarFrontIcon,
  technician: WrenchIcon,
};

const SERVICE_ICONS: Record<string, React.ElementType> = {
  "data center": ServerIcon,
  maintenance: WrenchIcon,
};

export function Unset({ label = "Not set" }: { label?: string }) {
  return <span className="text-muted-foreground/70 text-sm">{label}</span>;
}

export function RoleCell({ name }: { name?: string | null }) {
  if (!name) return <Unset />;
  const Icon = ROLE_ICONS[name.toLowerCase()] ?? UserRoundIcon;
  return (
    <span className="flex items-center gap-2 text-sm">
      <Icon className="text-muted-foreground size-4 shrink-0" />
      {name}
    </span>
  );
}

export function ServiceCell({ name }: { name?: string | null }) {
  if (!name) return <Unset />;
  const Icon = SERVICE_ICONS[name.toLowerCase()] ?? WrenchIcon;
  return (
    <span className="flex items-center gap-2 text-sm">
      <Icon className="text-muted-foreground size-4 shrink-0" />
      {name}
    </span>
  );
}

export function ShiftCell({ shift }: { shift?: string | null }) {
  if (!shift) return <Unset />;
  const Icon = shift === "night" ? MoonIcon : SunIcon;
  return (
    <span className="flex items-center gap-2 text-sm capitalize">
      <Icon className="text-muted-foreground size-4 shrink-0" />
      {shift}
    </span>
  );
}

// Availability reads as a soft-tinted pill rather than a hard-coloured badge,
// with the date range as muted supporting text underneath. Never colour
// alone -- the word carries the meaning.
export function AvailabilityCell({
  state,
  detail,
}: {
  state: "available" | "on-leave" | "upcoming";
  detail?: string;
}) {
  const styles = {
    available: "bg-muted text-muted-foreground",
    "on-leave": "bg-amber-600/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-400",
    upcoming: "bg-sky-600/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-400",
  } as const;
  const labels = { available: "Available", "on-leave": "On leave", upcoming: "Upcoming leave" } as const;

  return (
    <div className="flex flex-col items-start gap-1">
      <Badge className={cn("rounded-sm border-none font-normal", styles[state])}>{labels[state]}</Badge>
      {detail && <span className="text-muted-foreground text-xs">{detail}</span>}
    </div>
  );
}

// Skeleton rows mirror the real row shape -- circle for the avatar, two
// stacked bars for the identity stack, pills for the categorical columns --
// so nothing reflows when the data lands.
export function TechnicianRowSkeleton({ columns }: { columns: number }) {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="size-4 rounded-sm" />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      </TableCell>
      {Array.from({ length: columns - 3 }).map((_, i) => (
        <TableCell key={i}>
          <Skeleton className="h-4 w-20" />
        </TableCell>
      ))}
      <TableCell>
        <Skeleton className="ml-auto size-8 rounded-md" />
      </TableCell>
    </TableRow>
  );
}
