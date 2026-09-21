import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

/**
 * A table cell's text with a small muted icon in front of it -- the
 * icon-before-label pattern the users table uses for its role and status
 * columns, so every table reads the same way.
 */
export function IconText({
  icon: Icon,
  children,
  muted,
  className,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
  /** For an empty or placeholder value ("Unassigned", "—"). */
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm whitespace-nowrap",
        muted && "text-muted-foreground",
        className,
      )}
    >
      <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      {children}
    </span>
  );
}
