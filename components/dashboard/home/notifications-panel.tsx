"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

import { SectionCard, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import type { InAppNotification } from "@/lib/server/amc/notifications";
import { amcPlatformService } from "@/modules/amc-platform/amc-platform-service";

/**
 * BRD 6.2: notifications show on the home page until opened, then move to
 * the inbox. Lists what is still unread; opening one marks it read and goes
 * to the record. Hidden when there is nothing to open.
 */
export function HomeNotificationsPanel() {
  const router = useRouter();
  const [items, setItems] = useState<InAppNotification[] | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let gone = false;
    amcPlatformService
      .notifications({ limit: 5, unread: true })
      .then((page) => {
        if (gone) return;
        setItems(page.notifications);
        setUnread(page.unread);
      })
      .catch(() => {
        /* The home page must not break because of the notification list. */
        if (!gone) setItems([]);
      });
    return () => {
      gone = true;
    };
  }, []);

  if (items !== null && items.length === 0) return null;

  const open = (n: InAppNotification) => {
    setItems((list) => (list ?? []).filter((i) => i.id !== n.id));
    setUnread((u) => Math.max(0, u - 1));
    void amcPlatformService.markRead({ ids: [n.id] }).catch(() => undefined);
    if (n.link) router.push(n.link);
  };

  return (
    <SectionCard
      icon={<Bell />}
      title={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
      description="Waiting for you to open. Opened ones move to the inbox."
      bodyClassName="border-t"
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/notifications">Open inbox</Link>
        </Button>
      }
    >
      {items === null ? (
        <ListSkeleton rows={3} />
      ) : (
        <ul className="divide-y">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => open(n)} className="hover:bg-muted/60 flex w-full gap-3 px-5 py-3 text-left">
                <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  <span className="text-muted-foreground mt-0.5 block truncate text-sm">{n.body}</span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{timeAgo(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
