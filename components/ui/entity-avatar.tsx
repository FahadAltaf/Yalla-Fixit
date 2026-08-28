"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/actions/utils";

// The identity avatar used by every table that has a "who" or "what" column.
//
// Colour is hashed from a stable seed (an id, not a display name) against a
// fixed palette, so the same entity gets the same colour on every screen and
// across reloads -- and it costs no network request, unlike a generated
// avatar service.

const AVATAR_COLORS = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  "bg-lime-600/15 text-lime-700 dark:text-lime-300",
];

function paletteIndex(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash) % AVATAR_COLORS.length;
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function EntityAvatar({
  name,
  seed,
  className,
}: {
  name: string;
  seed: string;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-8 shrink-0", className)}>
      <AvatarFallback className={cn("text-xs font-medium", AVATAR_COLORS[paletteIndex(seed)])}>
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}

// Avatar + bold primary line over a muted secondary line. The standard shape
// for any column that identifies something by a name plus a qualifier
// (customer + address, technician + id, company + domain).
export function IdentityCell({
  title,
  subtitle,
  seed,
  badge,
}: {
  title: string;
  subtitle?: string | null;
  seed: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <EntityAvatar name={title} seed={seed} />
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 truncate font-medium">
          {title}
          {badge}
        </span>
        {subtitle ? (
          <span className="text-muted-foreground truncate text-xs">{subtitle}</span>
        ) : null}
      </div>
    </div>
  );
}
