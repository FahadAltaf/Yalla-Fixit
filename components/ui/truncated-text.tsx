"use client";

import * as React from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/*
  Text that ends in "…" when its column is too narrow, and shows in full in
  a tooltip on hover (3 Nov). The tooltip opens only when the text was
  actually cut, so short text behaves like plain text.
*/
export function TruncatedText({ text, className }: { text: string; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [open, setOpen] = React.useState(false);
  const cut = () => {
    const el = ref.current;
    return Boolean(el && el.scrollWidth > el.clientWidth);
  };
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && cut())}>
      <TooltipTrigger asChild>
        <span ref={ref} className={cn("block min-w-0 truncate", className)}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-80 break-words">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
