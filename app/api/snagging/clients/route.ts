import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Clients for the new-job picker.
 *
 * Clients are their own record now (`snagging_clients`), reused across
 * jobs. GET searches them for the picker; POST creates one when the
 * inspector adds someone new from the "+" dialog. The response keeps the
 * client_name/client_email/client_phone shape the wizard already reads,
 * plus the id so a picked client can be linked by id.
 */

type ClientRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
};

function toOption(row: ClientRow) {
  return {
    id: row.id,
    client_name: row.name,
    client_email: row.email,
    client_phone: row.phone,
    company: row.company,
  };
}

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
      .from("snagging_clients")
      .select("id, name, email, phone, company")
      .order("name", { ascending: true })
      .limit(400);

    if (search) {
      const term = `%${search}%`;
      query = query.or(
        [`name.ilike.${term}`, `email.ilike.${term}`, `phone.ilike.${term}`].join(","),
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: (data ?? []).map(toOption) });
  } catch (error) {
    console.error("Snagging clients GET error:", error);
    return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.CREATE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.client_name ?? body?.name ?? "").trim();
    if (name.length < 2) {
      return NextResponse.json({ error: "Client name is required" }, { status: 400 });
    }
    const email = emptyToNull(body?.client_email ?? body?.email);
    const phone = emptyToNull(body?.client_phone ?? body?.phone);
    const company = emptyToNull(body?.company);

    const admin = await createAdminServerClient();

    // Reuse a matching client (same name + email) rather than piling up
    // duplicates when the same person is added twice.
    const { data: existing } = await admin
      .from("snagging_clients")
      .select("id, name, email, phone, company")
      .ilike("name", name)
      .limit(20);
    const match = (existing ?? []).find(
      (c) => (c.email ?? "").toLowerCase() === (email ?? "").toLowerCase(),
    );
    if (match) {
      return NextResponse.json({ data: toOption(match) }, { status: 200 });
    }

    const { data, error } = await admin
      .from("snagging_clients")
      .insert({ name, email, phone, company, created_by: profile.id })
      .select("id, name, email, phone, company")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: toOption(data) }, { status: 201 });
  } catch (error) {
    console.error("Snagging clients POST error:", error);
    return NextResponse.json({ error: "Failed to save client" }, { status: 500 });
  }
}

function emptyToNull(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}
