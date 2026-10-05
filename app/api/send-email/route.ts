import { NextRequest, NextResponse } from "next/server";

import { verifyInternalRequest } from "@/lib/internal-signature";
import { MAX_BODY_BYTES, checkEmailRequest } from "@/lib/server/email-request-policy";
import { sendEmail } from "@/lib/server/send-email";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";

/**
 * Sends one email through Resend from the company address.
 *
 * This route used to send anything to anyone without asking who was
 * calling, which made it an open relay for the company's domain. It now
 * serves three callers and nothing else (rules and the caller list are in
 * lib/server/email-request-policy.ts):
 *
 *   1. Our own server code, through emailService, with a signed request
 *      (lib/internal-signature.ts).
 *   2. A signed-in, active portal user.
 *   3. Anyone else, only to a company mailbox, one recipient, no copies
 *      and no attachment: the public quotation review page telling the
 *      quotation's owner what the customer decided.
 *
 * Server code that can call Resend directly should use
 * lib/server/send-email.ts instead of this route.
 */
export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large" }, { status: 413 });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const caller = (await isTrustedCaller(request)) ? "trusted" : "anonymous";
  const verdict = checkEmailRequest(body, caller);
  if (!verdict.ok) {
    // An anonymous refusal is a 401: signing in is what would have helped.
    const status = verdict.status === 403 && caller === "anonymous" ? 401 : verdict.status;
    return NextResponse.json({ error: verdict.error }, { status });
  }

  try {
    const { data } = await sendEmail(verdict.request);
    return NextResponse.json({ data });
  } catch (error) {
    // Resend's own message only; never the request body or the key.
    const message = error instanceof Error ? error.message : "Failed to send email";
    console.error("send-email: Resend refused or failed:", message);
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}

async function isTrustedCaller(request: NextRequest): Promise<boolean> {
  if (await verifyInternalRequest(request.headers, "send-email")) return true;
  try {
    const { authUserId, profile } = await getAuthenticatedUserAccess();
    return !!authUserId && !!profile && profile.is_active !== false;
  } catch {
    return false;
  }
}
