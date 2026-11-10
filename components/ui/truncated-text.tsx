"use client";

import * as React from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/*
  Text that ends in "…" when its column is too narrow, and shows in full in
  a tooltip on hover (3 Nov). The tooltip opens only when the text was
  actually cut, so short text behaves like plain text.
*/

/** A value that may be plain text (shortened with its tooltip) or something richer (a link, a badge), shown as it is. */
export function TruncateIfText({ children, className }: { children: React.ReactNode; className?: string }) {
  return typeof children === "string" || typeof children === "number" ? (
    <TruncatedText text={String(children)} className={className} />
  ) : (
    <>{children}</>
  );
}

/**
 * One line, "…" when it does not fit, the whole of it in a tooltip on hover.
 * Give it `text`, or children when the line is made of several pieces (a
 * name and a date, a count and a list); the tooltip shows the same.
 */
export function TruncatedText({
  text,
  children,
  className,
}: {
  text?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [open, setOpen] = React.useState(false);
  const content = children ?? text;
  const cut = () => {
    const el = ref.current;
    return Boolean(el && el.scrollWidth > el.clientWidth);
  };
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && cut())}>
      <TooltipTrigger asChild>
        <span ref={ref} className={cn("block min-w-0 truncate", className)}>
          {content}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-80 break-words">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
