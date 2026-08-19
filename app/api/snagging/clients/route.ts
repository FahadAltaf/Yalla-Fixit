import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Clients for the new-job picker.
 *
 * There is no separate clients table: a client is whoever a property
 * was raised for, so the list is the distinct client rows already on
 * `snagging_properties`. Deriving it rather than keeping a second table
 * keeps the schema lean and means a client can never drift out of sync
 * with the properties that reference it.
 */
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const search = req.nextUrl.searchParams.get("search")?.trim();

    const admin = await createAdminServerClient();
    let query = admin
      .from("snagging_properties")
      .select("client_name, client_email, client_phone, developer_name")
      .not("client_name", "is", null)
      .order("client_name", { ascending: true })
      .limit(400);

    if (search) {
      const term = `%${search}%`;
      query = query.or(
        [`client_name.ilike.${term}`, `client_email.ilike.${term}`].join(","),
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    // Collapse to one entry per client. A client keyed by name+email so
    // two different people who share a name are not merged, while the
    // same person across several units appears once.
    const byKey = new Map<
      string,
      { client_name: string; client_email: string | null; client_phone: string | null; developer_name: string | null; property_count: number }
    >();

    for (const row of data ?? []) {
      const key = `${row.client_name?.toLowerCase()}|${row.client_email?.toLowerCase() ?? ""}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.property_count += 1;
        existing.client_email ??= row.client_email;
        existing.client_phone ??= row.client_phone;
        existing.developer_name ??= row.developer_name;
      } else {
        byKey.set(key, {
          client_name: row.client_name,
          client_email: row.client_email,
          client_phone: row.client_phone,
          developer_name: row.developer_name,
          property_count: 1,
        });
      }
    }

    const clients = [...byKey.values()].sort((a, b) =>
      a.client_name.localeCompare(b.client_name),
    );

    return NextResponse.json({ data: clients });
  } catch (error) {
    console.error("Snagging clients GET error:", error);
    return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
  }
}
