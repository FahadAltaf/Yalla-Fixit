import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { UUID_PATTERN } from "@/lib/server/finance/route-helpers";
import {
  SavedFilterError,
  deleteNamedFilter,
  filtersSchema,
  readSavedFilters,
  rememberLastUsed,
  reportAccess,
  reportKeySchema,
  saveNamedFilter,
} from "@/lib/server/reports/access";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * A person's own report filters (BRD 5.2 B1 "selections persist per user",
 * B5 "saved filters per user"; DEV-455). Only for a report the person can
 * open, and only their own rows.
 *
 *   GET    ?report=quotations              last used + saved
 *   PUT    { report, filters }             remember the last used
 *   POST   { report, name, filters }       save (same name replaces)
 *   DELETE ?id=<uuid>                      delete a saved one
 */

export const dynamic = "force-dynamic";

async function gateFor(report: unknown) {
  const key = reportKeySchema.safeParse(report);
  if (!key.success) return { response: NextResponse.json({ error: "Unknown report" }, { status: 400 }) } as const;
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return { response: gate.response } as const;
  if (!reportAccess(gate.access.accessUser, key.data).view) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { report: key.data, userId: gate.access.profile.id } as const;
}

function failure(error: unknown, what = "save the filters") {
  if (error instanceof SavedFilterError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Saved report filters error:", error);
  return NextResponse.json({ error: `Could not ${what}` }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const g = await gateFor(req.nextUrl.searchParams.get("report"));
  if ("response" in g) return g.response;
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await readSavedFilters(admin, g.userId, g.report), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "load your saved filters");
  }
}

const lastUsedSchema = z.object({ report: z.string(), filters: filtersSchema }).strict();

export async function PUT(req: NextRequest) {
  const body = lastUsedSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
  const g = await gateFor(body.data.report);
  if ("response" in g) return g.response;
  try {
    const admin = await createAdminServerClient();
    await rememberLastUsed(admin, g.userId, g.report, body.data.filters);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

const saveSchema = z
  .object({ report: z.string(), name: z.string().trim().min(1).max(60), filters: filtersSchema })
  .strict();

export async function POST(req: NextRequest) {
  const body = saveSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Give the filters a name (up to 60 characters)" }, { status: 400 });
  const g = await gateFor(body.data.report);
  if ("response" in g) return g.response;
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await saveNamedFilter(admin, g.userId, g.report, body.data.name, body.data.filters));
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  try {
    const admin = await createAdminServerClient();
    const deleted = await deleteNamedFilter(admin, gate.access.profile.id, id);
    return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}
