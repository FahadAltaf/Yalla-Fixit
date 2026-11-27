"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Bell, CalendarDays, CheckCheck, ClipboardCheck, FileSignature, Inbox, ListTodo, ReceiptText, ShieldCheck, Users, type LucideIcon } from "lucide-react";

import { PageHeading, SectionCard, timeAgo } from "@/components/dashboard/shared/kaizen";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { TablePager } from "@/components/data-table/table-pager";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { InAppNotification } from "@/lib/server/notifications/inbox";
import { cn } from "@/lib/utils";
import { NotificationIcon } from "./notification-icon";
import { NOTIFICATION_MODULES, NOTIFICATION_MODULE_LABELS, type NotificationModule } from "@/lib/notifications/modules";
import { Badge } from "@/components/ui/badge";
import { NOTIFICATION_ARRIVED, notificationsService } from "@/modules/reporting/reporting-service";

const PAGE_SIZE = 20;

/* Each module's icon in the list, as its menu shows it. */
const MODULE_ICONS: Record<NotificationModule, LucideIcon> = {
  amc: FileSignature,
  snagging: ClipboardCheck,
  invoicing: ReceiptText,
  scheduling: CalendarDays,
  workforce: Users,
  compliance: ShieldCheck,
  todos: ListTodo,
  reports: BarChart3,
};
type Filter = "unread" | "all";

/**
 * The notifications inbox (BRD §6.2): everything the portal told you, newest
 * first. Unread ones also show on the home page until opened; opening one
 * marks it read and goes to the record. The same shape as the AMC inbox on
 * amc-hardening, over the shared portal_notifications table.
 *
 * 27 Nov 2026: on a wide screen the page fits the window, the modules stay
 * where they are and only the list scrolls, with page numbers under it
 * ("Showing 1 to 20 of 64") in place of Show more.
 */
export function NotificationsInbox() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("unread");
  /* One part of the portal, or all of it (26 Nov 2026). */
  const [module, setModule] = useState<NotificationModule | null>(null);
  const [page, setPage] = useState(0);
  const [byModule, setByModule] = useState<Partial<Record<NotificationModule, number>>>({});
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (which: Filter, mod: NotificationModule | null, at: number) => {
    const size = PAGE_SIZE;
    setLoading(true);
    setError(null);
    try {
      const result = await notificationsService.list({ limit: size, offset: at * size, unread: which === "unread", module: mod });
      /* A page emptied under us (all read, or fewer now): go to the last one there is. */
      const count = result.total ?? result.notifications.length;
      const last = Math.max(0, Math.ceil(count / size) - 1);
      if (at > last && count > 0) {
        setPage(last);
        return;
      }
      setItems(result.notifications);
      setTotal(count);
      setUnread(result.unread);
      setByModule(result.unreadByModule ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter, module, page);
  }, [load, filter, module, page]);

  /* A new notification arrived live (23 Nov 2026): show it without a reload. */
  useEffect(() => {
    const reload = () => void load(filter, module, page);
    window.addEventListener(NOTIFICATION_ARRIVED, reload);
    return () => window.removeEventListener(NOTIFICATION_ARRIVED, reload);
  }, [load, filter, module, page]);

  /* Another page, module or view starts at the top of the list. */
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [filter, module, page]);

  const choose = (next: { filter?: Filter; module?: NotificationModule | null }) => {
    if (next.filter !== undefined) setFilter(next.filter);
    if (next.module !== undefined) setModule(next.module);
    setPage(0);
  };

  const open = (n: InAppNotification) => {
    if (!n.readAt) {
      setItems((list) => list.map((i) => (i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i)));
      setUnread((u) => Math.max(0, u - 1));
      setByModule((m) => ({ ...m, [n.module]: Math.max(0, (m[n.module] ?? 0) - 1) }));
      void notificationsService.markRead({ ids: [n.id] }).catch(() => undefined);
    }
    if (n.link) router.push(n.link);
  };

  const markAll = async () => {
    setUnread(0);
    setByModule({});
    setItems((list) => list.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
    await notificationsService.markRead({ all: true }).catch(() => undefined);
    /* Unread is empty now: show it from the start. */
    if (filter === "unread") {
      setPage(0);
      void load(filter, module, 0);
    }
  };

  return (
    /* The window's height less the top bar and the page's padding: the page itself does not scroll on a wide screen. */
    <div className="flex flex-col gap-6 lg:h-[calc(100dvh-7.5rem)] lg:min-h-[28rem]">
      <PageHeading
        eyebrow="Inbox"
        title="Notifications"
        description="Items waiting for you, decisions and alerts. Unread ones also show on the home page until you open them."
        actions={
          <Button variant="outline" size="sm" disabled={unread === 0} onClick={() => void markAll()}>
            <CheckCheck className="size-4" />
            Mark all read
          </Button>
        }
      />
      {/*
        One inbox, by part of the portal (26 Nov 2026): the modules down the
        left like mail folders, each with its unread count (a dropdown on a
        phone); Unread / All in the list's own header.
      */}
      <div className="grid items-start gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-stretch">
        <nav aria-label="Modules" className="bg-card hidden rounded-xl border p-2 lg:block lg:max-h-full lg:self-start lg:overflow-y-auto">
          <ul className="grid gap-0.5">
            {([null, ...NOTIFICATION_MODULES] as Array<NotificationModule | null>).map((m) => {
              const on = module === m;
              const count = m ? (byModule[m] ?? 0) : unread;
              const Icon = m ? MODULE_ICONS[m] : Inbox;
              return (
                <li key={m ?? "all"}>
                  <button
                    type="button"
                    aria-current={on ? "page" : undefined}
                    onClick={() => choose({ module: m })}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      on ? "bg-primary/10 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", on && "text-primary")} />
                    <span className="min-w-0 flex-1 truncate">{m ? NOTIFICATION_MODULE_LABELS[m] : "All modules"}</span>
                    {count ? (
                      <span className="bg-primary text-primary-foreground min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold tabular-nums">
                        {count}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-3 lg:min-h-0">
          <div className="lg:hidden">
            <Select value={module ?? "all"} onValueChange={(v) => choose({ module: v === "all" ? null : (v as NotificationModule) })}>
              <SelectTrigger className="w-full" aria-label="Module">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {([null, ...NOTIFICATION_MODULES] as Array<NotificationModule | null>).map((m) => {
                  const count = m ? (byModule[m] ?? 0) : unread;
                  return (
                    <SelectItem key={m ?? "all"} value={m ?? "all"}>
                      {m ? NOTIFICATION_MODULE_LABELS[m] : "All modules"}
                      {count ? ` (${count})` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <SectionCard
            title={module ? NOTIFICATION_MODULE_LABELS[module] : "All modules"}
            className="lg:min-h-0 lg:flex-1"
            bodyClassName="border-t flex flex-col lg:min-h-0 lg:flex-1"
            action={
              <div role="tablist" aria-label="Show" className="bg-muted inline-flex items-center gap-0.5 rounded-full p-1 text-sm">
                {(
                  [
                    ["unread", `Unread${unread ? ` (${unread})` : ""}`],
                    ["all", "All"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={filter === v}
                    onClick={() => choose({ filter: v })}
                    className={cn(
                      "rounded-full px-3 py-1 font-medium whitespace-nowrap transition-colors",
                      filter === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {/* Only this part scrolls on a wide screen; the pager stays under it. */}
            <div ref={listRef} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <DataState
                loading={loading && items.length === 0}
                error={error}
                onRetry={() => void load(filter, module, page)}
                isEmpty={items.length === 0}
                skeleton={<ListSkeleton rows={6} />}
                empty={
                  <div className="p-6">
                    <EmptyState
                      icon={<Bell className="size-5" />}
                      title={filter === "unread" ? "You're all caught up" : module ? `No ${NOTIFICATION_MODULE_LABELS[module]} notifications yet` : "No notifications yet"}
                      description={filter === "unread" ? "Nothing is waiting to be opened." : "Invoicing items, queries, alerts and reports will appear here."}
                    />
                  </div>
                }
              >
                <ul className={cn("divide-y transition-opacity", loading && "opacity-60")} aria-busy={loading}>
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => open(n)}
                        className={cn("hover:bg-muted/60 flex w-full items-start gap-3 px-5 py-3.5 text-left", !n.readAt && "bg-primary/5")}
                      >
                        {/* The kind of notice at a glance (26 Nov 2026): its icon, tinted by how urgent it is. */}
                        <NotificationIcon event={n.event} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{n.title}</span>
                          <span className="text-muted-foreground mt-0.5 block text-sm">{n.body}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 pt-0.5">
                          {module ? null : (
                            <Badge variant="secondary" className="hidden font-normal sm:inline-flex">
                              {NOTIFICATION_MODULE_LABELS[n.module]}
                            </Badge>
                          )}
                          <span className="text-muted-foreground text-xs tabular-nums">{timeAgo(n.createdAt)}</span>
                          <span className={cn("size-2 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-label={n.readAt ? undefined : "Unread"} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </DataState>
            </div>
            {total > 0 ? (
              /* The footer every table has: "Showing 1 to 20 of 64 entries", then the pages. */
              <div className="shrink-0 border-t">
                <TablePager currentPage={page} pageSize={PAGE_SIZE} rowCount={total} loading={loading} onPageChange={setPage} />
              </div>
            ) : null}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
