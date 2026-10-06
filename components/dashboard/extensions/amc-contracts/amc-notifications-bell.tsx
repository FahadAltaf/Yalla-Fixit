"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { amcContractsService, type InAppNotification } from "@/modules/amc-contracts/amc-contracts-service";

import { formatDateTime } from "./contract-status";

/**
 * The caller's AMC notifications: approvals waiting, decisions, client
 * answers, signatures, allowances running out, contracts ending. Read from
 * amc_notifications (in-app rows). Shows nothing on a database without it.
 */
export function AmcNotificationsBell({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [migrated, setMigrated] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await amcContractsService.notifications();
      setItems(data.notifications);
      setUnread(data.unread);
      setMigrated(data.migrated);
    } catch {
      /* A notification list that fails to load must not break the page. */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openItem = async (n: InAppNotification) => {
    if (!n.readAt) {
      setItems((list) => list.map((i) => (i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i)));
      setUnread((u) => Math.max(0, u - 1));
      void amcContractsService.markNotificationsRead({ ids: [n.id] }).catch(() => undefined);
    }
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  };

  const markAll = async () => {
    setItems((list) => list.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
    setUnread(0);
    await amcContractsService.markNotificationsRead({ all: true }).catch(() => undefined);
  };

  if (!migrated) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className={cn("relative size-8", className)} aria-label={`AMC notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 min-w-4 rounded-full px-1 text-[10px] leading-4 font-medium tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="text-sm font-medium">AMC notifications</div>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={unread === 0} onClick={() => void markAll()}>
            <CheckCheck className="size-3.5" />
            Mark all read
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">
              {loading ? "Loading…" : "Nothing yet. Approvals, client answers and signatures will appear here."}
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void openItem(n)}
                    className={cn("hover:bg-muted/60 flex w-full gap-3 px-4 py-3 text-left", !n.readAt && "bg-primary/5")}
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{n.title}</span>
                      <span className="text-muted-foreground mt-0.5 block text-xs">{n.body}</span>
                      <span className="text-muted-foreground mt-1 block text-[11px] tabular-nums">{formatDateTime(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
