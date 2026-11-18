"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The inbox (BRD 6.2), beside the theme switcher (17 Nov 2026): it moved
 * out of the sidebar menu. The count is the unread notifications.
 */
export function NotificationsButton({ unread }: { unread: number }) {
  const label = unread ? `Notifications: ${unread} unread` : "Notifications";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-8" asChild>
          <Link href="/notifications" aria-label={label}>
            <Bell className="size-[18px]" />
            {unread ? (
              <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
