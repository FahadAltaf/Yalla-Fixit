import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { buildMyCompliance } from "@/lib/server/reports/disputes";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * A technician's own compliance (BRD §6.7: "own compliance, misses and
 * monthly statement; raise disputes"). Any signed-in account; the
 * technician is the one linked to it, so nobody sees another's.
 *
 * Query: month (YYYY-MM, this month by default).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

export async function GET(req: NextRequest) {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;

  const query = querySchema.safeParse({ month: req.nextUrl.searchParams.get("month") || undefined });
  if (!query.success) return NextResponse.json({ error: "Invalid month" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await buildMyCompliance(admin, gate.access.profile.id, query.data.month), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("My compliance error:", error);
    return NextResponse.json({ error: "Could not load your compliance" }, { status: 500 });
  }
}
