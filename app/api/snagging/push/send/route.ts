import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Sends one alert to the inspector's phones.
 *
 * Called by a Supabase database webhook on insert into
 * snagging_notifications, not by the portal's own code. The alerts are
 * written by triggers precisely so that every path which changes a job
 * raises one, and no route can forget; sending has to hang off the same
 * place or it would drift from them immediately.
 *
 * Not a user request, so it authenticates with a shared secret rather
 * than a session. Without the secret this would be an open endpoint that
 * pushes arbitrary text to any inspector's lock screen.
 */

const SECRET = process.env.SNAGGING_PUSH_WEBHOOK_SECRET ?? "";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** What Supabase sends for an insert. Only the new row matters. */
type WebhookBody = {
  type?: string;
  record?: {
    id?: string;
    user_id?: string;
    job_id?: string | null;
    visit_id?: string | null;
    type?: string;
    title?: string;
    body?: string;
  };
};

export async function POST(req: NextRequest) {
  try {
    if (!SECRET) {
      console.error("[snagging/push/send] no webhook secret configured");
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    }
    /*
      A plain header comparison. The secret is a long random string and
      the endpoint is not a login, so there is nothing here worth timing.
    */
    if (req.headers.get("x-webhook-secret") !== SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as WebhookBody;
    const row = body.record;
    if (!row?.user_id || !row.title) {
      return NextResponse.json({ data: { sent: 0, reason: "nothing to send" } });
    }

    const admin = await createAdminServerClient();
    const { data: devices, error } = await admin
      .from("snagging_push_tokens")
      .select("token")
      .eq("user_id", row.user_id);
    if (error) throw new Error(error.message);

    const tokens = (devices ?? []).map((d) => d.token as string);
    /*
      An inspector with no registered device is the ordinary case for
      office staff, and for anyone who has not opened the app since this
      shipped. It is not an error.
    */
    if (tokens.length === 0) {
      return NextResponse.json({ data: { sent: 0, reason: "no devices" } });
    }

    const messages = tokens.map((to) => ({
      to,
      title: row.title,
      body: row.body ?? "",
      sound: "default" as const,
      /*
        Carried through to the tap handler, which opens the job rather
        than dropping the inspector on the jobs list to find it.
      */
      data: {
        notificationId: row.id ?? null,
        jobId: row.job_id ?? null,
        visitId: row.visit_id ?? null,
        type: row.type ?? null,
      },
    }));

    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    const result = (await response.json()) as {
      data?: { status: string; message?: string; details?: { error?: string } }[];
    };

    /*
      Expo answers per message. A token for an app that has been
      uninstalled comes back DeviceNotRegistered, and it will never work
      again, so the row goes rather than being retried for ever.
    */
    const dead: string[] = [];
    (result.data ?? []).forEach((entry, index) => {
      if (entry.status === "error" && entry.details?.error === "DeviceNotRegistered") {
        dead.push(tokens[index]);
      } else if (entry.status === "error") {
        console.error("[snagging/push/send] expo refused a message:", entry.message);
      }
    });
    if (dead.length > 0) {
      await admin.from("snagging_push_tokens").delete().in("token", dead);
    }

    return NextResponse.json({
      data: { sent: tokens.length - dead.length, removed: dead.length },
    });
  } catch (error) {
    /*
      Answered 200 deliberately. Supabase retries a failed webhook, and a
      retry would send the alert a second time to every phone that did
      get it. A missed banner is better than a duplicate one, and the
      alert itself is already safely in the table either way.
    */
    console.error("[snagging/push/send]", error);
    return NextResponse.json({ data: { sent: 0, error: true } });
  }
}
