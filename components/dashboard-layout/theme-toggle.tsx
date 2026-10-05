"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type Theme, useTheme } from "@/context/ThemeContext";

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * Light, dark or follow the device, chosen per person.
 *
 * The theme was only settable in Appearance settings, which is an admin
 * screen that sets it for everyone. That is the right place for the
 * organisation's default and the wrong place for "I want dark right
 * now", so the choice lives here as well, one click from any page.
 *
 * Whoever picks here picks for themselves: the choice is kept in their
 * own browser (ThemeContext writes `theme` to localStorage) and from
 * then on it beats the organisation default on this device, which is
 * why switching no longer reverts the moment settings reload.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = OPTIONS.find((option) => option.value === theme) ?? OPTIONS[0];
  const Current = current.Icon;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <Current className="size-[18px]" />
              <span className="sr-only">Theme: {current.label}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Theme: {current.label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-40">
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className={value === theme ? "bg-accent" : undefined}
          >
            <Icon className="size-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
