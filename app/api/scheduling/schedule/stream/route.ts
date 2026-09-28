import { NextRequest } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Live changes to a day's schedule, pushed to the wall display.
 *
 * The display used to poll the full schedule route every 20 seconds. That
 * route is not cheap -- it resolves the day's version, joins assignments,
 * technicians and two user profiles, and on the first open of a day it
 * imports the day's appointments from Zoho FSM. Every screen paid that
 * every 20 seconds, and the board was still up to 20 seconds stale.
 *
 * This inverts it. One watcher per date runs a small fingerprint query on
 * a short interval and pushes an event when the day actually changes; the
 * display refetches only then. So:
 *
 *   - N screens cost ONE query per tick, not N heavy loads per 20s
 *   - an edit shows up in about a second rather than up to twenty
 *   - the expensive route runs only when something really moved
 *
 * Server-sent events rather than websockets or Supabase Realtime: the
 * portal exposes no browser Supabase key, and publishing one to make a
 * client subscription work would widen the app's surface for a read-only
 * board. SSE needs no key, no new dependency, and reconnects on its own.
 *
 * This holds an open connection, so it must run on the Node runtime and
 * never be cached or statically rendered.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How often a watcher asks the database whether the day has changed. */
const TICK_MS = 2_000;

/** A comment down the wire, so proxies do not close an idle connection. */
const HEARTBEAT_MS = 25_000;

type Watcher = {
  fingerprint: string;
  timer: ReturnType<typeof setInterval>;
  /** Every connected screen looking at this date. */
  listeners: Set<(fingerprint: string) => void>;
};

/*
  One watcher per date, shared by every screen showing it. Lives for as
  long as at least one connection does, and is torn down with the last.
  Module scope, so it is per server process -- which is what we want: the
  portal runs as a long-lived Node server, not per-request lambdas.
*/
const watchers = new Map<string, Watcher>();

/**
 * A short string that changes whenever the day's board would look
 * different: which entries exist, when each was last edited, and how many
 * technicians each carries.
 *
 * Assignments have no `updated_at` of their own, so their COUNT stands in
 * for them -- adding or removing a technician moves it, and an assignment
 * row is never edited in place.
 */
async function fingerprintOf(date: string): Promise<string> {
  const admin = await createAdminServerClient();

  const { data: version } = await admin
    .from("schedule_versions")
    .select("id")
    .eq("schedule_date", date)
    .eq("is_current", true)
    .maybeSingle();

  // No version yet is itself a stable answer: the day is empty until the
  // board is opened, and the display should not thrash while it is.
  if (!version) return "none";

  const { data, error } = await admin
    .from("schedule_entries")
    .select("id, updated_at, schedule_entry_assignments(count)")
    .eq("schedule_version_id", version.id);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    id: string;
    updated_at: string | null;
    schedule_entry_assignments?: Array<{ count: number }> | null;
  }>;

  return rows
    .map(
      (row) =>
        `${row.id}:${row.updated_at ?? ""}:${row.schedule_entry_assignments?.[0]?.count ?? 0}`,
    )
    // Sorted, so the database returning the same rows in a different order
    // is not mistaken for a change.
    .sort()
    .join("|");
}

function watcherFor(date: string): Watcher {
  const existing = watchers.get(date);
  if (existing) return existing;

  const watcher: Watcher = {
    fingerprint: "",
    timer: setInterval(async () => {
      try {
        const next = await fingerprintOf(date);
        if (next === watcher.fingerprint) return;
        watcher.fingerprint = next;
        watcher.listeners.forEach((notify) => notify(next));
      } catch {
        // A failed tick is ignored: the screens keep their last good board
        // and the next tick tries again. Telling them to refetch on an
        // error would turn a database blip into a stampede.
      }
    }, TICK_MS),
    listeners: new Set(),
  };

  watchers.set(date, watcher);
  return watcher;
}

function release(date: string, notify: (fingerprint: string) => void) {
  const watcher = watchers.get(date);
  if (!watcher) return;
  watcher.listeners.delete(notify);
  if (watcher.listeners.size === 0) {
    clearInterval(watcher.timer);
    watchers.delete(date);
  }
}

export async function GET(req: NextRequest) {
  const { profile, accessUser } = await getAuthenticatedUserAccess();
  if (!profile || !accessUser) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) {
    return new Response("Forbidden", { status: 403 });
  }

  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response("Missing or invalid field: date (YYYY-MM-DD)", {
      status: 400,
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let open = true;
      const send = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
        }
      };

      const notify = () => send("event: change\ndata: {}\n\n");

      const watcher = watcherFor(date);
      watcher.listeners.add(notify);

      // Opens with the current state, so a screen that connects mid-day
      // paints from a real load rather than waiting for the first edit.
      send("event: change\ndata: {}\n\n");

      const heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);

      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        release(date, notify);
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      };

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx buffers proxied responses by default, which holds events
      // back until the buffer fills -- exactly what this route exists to
      // avoid.
      "X-Accel-Buffering": "no",
    },
  });
}
