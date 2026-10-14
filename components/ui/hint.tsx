"use client";

import * as React from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type HintProps = {
  label?: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactElement;
} & Omit<React.ComponentPropsWithoutRef<typeof TooltipTrigger>, "children" | "asChild">;

/**
 * A hover hint in the shadcn tooltip, in place of the browser's native
 * `title` (which is slow to appear, unstyled and different on every OS).
 *
 * Wraps exactly one element that can take a ref (a native element, a
 * Button). With no label it shows nothing, but keeps the same tree, so a
 * hint that switches off (say, while something is being dragged) never
 * remounts the element under it. Props and the ref are passed through, so
 * it also works inside another `asChild` trigger.
 */
export const Hint = React.forwardRef<HTMLElement, HintProps>(function Hint(
  { label, side = "top", children, ...rest },
  ref,
) {
  const empty = label === undefined || label === null || label === "" || label === false;
  return (
    <Tooltip open={empty ? false : undefined}>
      <TooltipTrigger asChild ref={ref as React.Ref<HTMLButtonElement>} {...rest}>
        {children}
      </TooltipTrigger>
      {empty ? null : (
        <TooltipContent side={side} sideOffset={4}>
          {label}
        </TooltipContent>
      )}
    </Tooltip>
  );
});
