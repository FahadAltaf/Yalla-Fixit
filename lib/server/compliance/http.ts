// Small helpers shared by the compliance routes.

import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { todayInZone } from "@/lib/scheduling/org-time";
import type { ServiceError } from "./employees";

/** Today's calendar date in the org zone (Asia/Dubai), never the machine clock. */
export function complianceToday(): string {
  return todayInZone();
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function fail(error: ServiceError) {
  return NextResponse.json({ error: error.error, fields: error.fields ?? undefined }, { status: error.status });
}

/** Unexpected failures: logged on the server, generic to the client (NFR-4: never echo input). */
export function serverError(context: string, error: unknown) {
  console.error(`[compliance] ${context}:`, error);
  return NextResponse.json({ error: "Something went wrong. Please try again" }, { status: 500 });
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<{ data: T } | { response: NextResponse }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    return { response: NextResponse.json({ error: "Check the highlighted fields", fields: fieldErrors(result.error) }, { status: 400 }) };
  }
  return { data: result.data };
}

/** Flatten a zod error into { "identity.emirates_id_number": "message" }. */
export function fieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
