import { NextResponse } from "next/server";

import { QueueError } from "./queue";

/** The signed-in person, as recorded on queue events. */
export function actorOf(profile: { id: string; full_name?: string | null; email?: string | null }) {
  return { id: profile.id, label: (profile.full_name ?? "").trim() || profile.email || "Unknown user" };
}

/** A refusal from the queue functions as its HTTP answer; anything else is a 500. */
export function queueErrorResponse(error: unknown, context: string) {
  if (error instanceof QueueError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`${context}:`, error);
  return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
