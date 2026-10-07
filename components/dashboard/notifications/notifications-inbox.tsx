"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";

import { PageHeading, PillTabs, SectionCard, timeAgo } from "@/components/dashboard/shared/kaizen";
import { DataState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { InAppNotification } from "@/lib/server/amc/notifications";
import { cn } from "@/lib/utils";
import { amcPlatformService } from "@/modules/amc-platform/amc-platform-service";

const PAGE = 30;
type Filter = "unread" | "all";

/**
 * The notifications inbox (BRD 6.2): everything the portal told you, newest
 * first. Unread ones also show on the home page until opened; opening one
 * marks it read and goes to the record.
 */
export function NotificationsInbox() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("unread");
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async (which: Filter) => {
    setLoading(true);
    setError(null);
    try {
      const page = await amcPlatformService.notifications({ limit: PAGE, unread: which === "unread" });
      setItems(page.notifications);
      setUnread(page.unread);
      setDone(page.notifications.length < PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notifications");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(filter), [load, filter]);

  const more = async () => {
    setLoadingMore(true);
    try {
      const page = await amcPlatformService.notifications({ limit: PAGE, offset: items.length, unread: filter === "unread" });
      setItems((list) => [...list, ...page.notifications]);
      setDone(page.notifications.length < PAGE);
    } finally {
      setLoadingMore(false);
    }
  };

  const open = (n: InAppNotification) => {
    if (!n.readAt) {
      setItems((list) => list.map((i) => (i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i)));
      setUnread((u) => Math.max(0, u - 1));
      void amcPlatformService.markRead({ ids: [n.id] }).catch(() => undefined);
    }
    if (n.link) router.push(n.link);
  };

  const markAll = async () => {
    setUnread(0);
    setItems((list) => (filter === "unread" ? [] : list.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() }))));
    await amcPlatformService.markRead({ all: true }).catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Inbox"
        title="Notifications"
        description="Approvals waiting, decisions, signatures, reminders and escalations. Unread ones also show on the home page until you open them."
        actions={
          <Button variant="outline" size="sm" disabled={unread === 0} onClick={() => void markAll()}>
            <CheckCheck className="size-4" />
            Mark all read
          </Button>
        }
      />
      <PillTabs<Filter>
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: "unread", label: "Unread", count: unread },
          { value: "all", label: "All" },
        ]}
      />
      <SectionCard title={filter === "unread" ? "Unread" : "All notifications"} bodyClassName="border-t">
        <DataState
          loading={loading}
          error={error}
          onRetry={() => void load(filter)}
          isEmpty={items.length === 0}
          skeleton={<ListSkeleton rows={6} />}
          empty={
            <div className="p-6">
              <EmptyState
                icon={<Bell className="size-5" />}
                title={filter === "unread" ? "You're all caught up" : "No notifications yet"}
                description={filter === "unread" ? "Nothing is waiting to be opened." : "Approvals, client answers, signatures and reminders will appear here."}
              />
            </div>
          }
        >
          <ul className="divide-y">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={cn("hover:bg-muted/60 flex w-full gap-3 px-5 py-3.5 text-left", !n.readAt && "bg-primary/5")}
                >
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{n.title}</span>
                    <span className="text-muted-foreground mt-0.5 block text-sm">{n.body}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{timeAgo(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          {!done ? (
            <div className="border-t px-5 py-3">
              <Button variant="ghost" size="sm" disabled={loadingMore} onClick={() => void more()}>
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            </div>
          ) : null}
        </DataState>
      </SectionCard>
    </div>
  );
}
