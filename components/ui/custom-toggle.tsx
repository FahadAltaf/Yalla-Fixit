"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface CustomToggleProps {
  isEnabled?: boolean;
}

export const CustomToggle: React.FC<CustomToggleProps> = ({ isEnabled }) => {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-5 w-9 items-center rounded-full border transition-colors",
        isEnabled
          ? "bg-emerald-500 border-emerald-500"
          : "bg-muted border-muted-foreground/30"
      )}
      aria-pressed={!!isEnabled}
      aria-label="Toggle"
    >
      <span
        className={cn(
          "block h-4 w-4 rounded-full bg-white shadow transition-transform",
          isEnabled ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
};









