import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { clientAddress, rateLimited } from "@/lib/server/request-origin";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

const bodySchema = z.object({
  email: z.string().trim().email().max(254),
});

/**
 * POST /api/auth/check-email -- whether an account exists for this email.
 *
 * The login screen's first step. It used to ask /api/graphql directly, and
 * that route now demands a signed-in session, so every sign-in stopped at
 * "HTTP error! status: 401" -- there is no session before you sign in.
 *
 * This answers only yes or no, for one exact address (case aside). The
 * old lookup was an `ilike` taken straight from the box, so `%@gmail.com`
 * matched anyone; `%` and `_` are escaped here, and no profile field is
 * ever returned.
 */
export async function POST(req: NextRequest) {
  // Answers before sign-in, so it is an account-enumeration surface: throttle it.
  if (rateLimited(`check-email:${clientAddress(req.headers)}`, 30, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
  }

  try {
    const admin = await createAdminServerClient();
    const pattern = parsed.data.email.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data, error } = await admin
      .from("user_profile")
      .select("id")
      .ilike("email", pattern)
      .limit(1);
    if (error) throw new Error(error.message);
    return NextResponse.json({ exists: (data ?? []).length > 0 });
  } catch (error) {
    console.error("[auth/check-email]", error);
    return NextResponse.json(
      { error: "Unable to verify email. Please try again." },
      { status: 500 },
    );
  }
}
