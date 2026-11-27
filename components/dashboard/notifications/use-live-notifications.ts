"use client";

import { createElement, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { Bell } from "lucide-react";
import { toast } from "sonner";

import { LIVE_TOASTER } from "@/context/theme-provider-wrapper";
import { NOTIFICATION_ARRIVED, NOTIFICATIONS_CHANGED, notificationsService } from "@/modules/reporting/reporting-service";

type LiveAccess = { url: string; key: string; token: string; expiresAt: number | null; userId: string };
type Row = { id?: string; title?: string; body?: string; link?: string | null; channel?: string; status?: string };

const TABLES = ["portal_notifications", "amc_notifications"] as const;

async function fetchAccess(): Promise<LiveAccess | null> {
  try {
    const res = await fetch("/api/notifications/live", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as LiveAccess;
  } catch {
    return null;
  }
}

/** A portal path only (the tables refuse anything else), so Open never leaves the portal. */
function safeLink(link: string | null | undefined): string | null {
  return typeof link === "string" && /^\/[^/]/.test(link) ? link : null;
}

/**
 * New notifications as they arrive (23 Nov 2026): a message in the corner
 * that stays until it is closed, with Open when it points somewhere, and the
 * bell count and inbox refresh at once.
 *
 * Supabase Realtime on portal_notifications and amc_notifications, filtered
 * to the signed-in person; the database policy sends nobody else's. Until
 * migration 20261123110000 is applied nothing arrives and the portal works
 * as before (the bell still updates when the inbox is opened).
 */
export function useLiveNotifications(enabled: boolean) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let client: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;
    let token: string | null = null;
    let renewTimer: ReturnType<typeof setTimeout> | null = null;
    /* When the token runs out (ms), to renew on waking only when it is due. */
    let expiresAtMs: number | null = null;
    const shown = new Set<string>();

    const scheduleRenew = (expiresAt: number | null) => {
      if (renewTimer) clearTimeout(renewTimer);
      expiresAtMs = expiresAt ? expiresAt * 1000 : null;
      /* A minute before the token runs out; at least 30 s, at most an hour. */
      const wait = expiresAt ? expiresAt * 1000 - Date.now() - 60_000 : 30 * 60_000;
      renewTimer = setTimeout(() => void renew(), Math.min(Math.max(wait, 30_000), 60 * 60_000));
    };

    const renew = async () => {
      const access = await fetchAccess();
      if (!alive) return;
      if (!access) {
        scheduleRenew(null);
        return;
      }
      token = access.token;
      void client?.realtime.setAuth();
      scheduleRenew(access.expiresAt);
    };

    const show = (row: Row) => {
      if (!row.id || shown.has(row.id)) return;
      if (row.channel !== "in_app" || row.status !== "delivered") return;
      shown.add(row.id);
      const id = row.id;
      const link = safeLink(row.link);
      toast(row.title || "New notification", {
        id,
        toasterId: LIVE_TOASTER,
        description: row.body || undefined,
        icon: createElement(Bell, { className: "size-4", "aria-hidden": true }),
        duration: Infinity,
        closeButton: true,
        action: link
          ? {
              label: "Open",
              onClick: () => {
                void notificationsService.markRead({ ids: [id] }).catch(() => undefined);
                router.push(link);
              },
            }
          : undefined,
      });
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
      window.dispatchEvent(new Event(NOTIFICATION_ARRIVED));
    };

    void (async () => {
      const access = await fetchAccess();
      if (!alive || !access) return;
      token = access.token;
      client = createClient(access.url, access.key, {
        accessToken: async () => token,
        realtime: { params: { eventsPerSecond: 5 } },
      });
      let ch = client.channel(`inbox:${access.userId}`);
      for (const table of TABLES) {
        ch = ch.on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table, filter: `recipient_user_id=eq.${access.userId}` },
          (payload) => show(payload.new as Row),
        );
      }
      channel = ch.subscribe();
      scheduleRenew(access.expiresAt);
    })();

    /*
      A laptop waking from sleep: the timer may have missed the renewal.
      Only when the token is near its end (27 Nov 2026): every return to the
      tab used to ask for a new one.
    */
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !client) return;
      if (expiresAtMs === null || expiresAtMs - Date.now() < 2 * 60_000) void renew();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (renewTimer) clearTimeout(renewTimer);
      if (client && channel) void client.removeChannel(channel);
      client = null;
    };
  }, [enabled, router]);
}
