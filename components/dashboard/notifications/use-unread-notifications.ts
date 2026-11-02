"use client";

import { useEffect, useState } from "react";

import { NOTIFICATIONS_CHANGED, notificationsService } from "@/modules/reporting/reporting-service";

/**
 * How many of the signed-in person's notifications are unread (30 Oct), for
 * the sidebar. Read once when the app opens, and again only when one is
 * marked read in the portal: no polling (30 Oct, the user's choice). One
 * small call (limit 1); a failure keeps the last count.
 */
export function useUnreadNotifications(enabled: boolean): number {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const read = () => {
      notificationsService
        .list({ limit: 1, unread: true })
        .then((page) => {
          if (alive) setUnread(page.unread);
        })
        .catch(() => undefined);
    };
    read();
    window.addEventListener(NOTIFICATIONS_CHANGED, read);
    return () => {
      alive = false;
      window.removeEventListener(NOTIFICATIONS_CHANGED, read);
    };
  }, [enabled]);

  return enabled ? unread : 0;
}
