import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { likeTerm, pageParams } from "@/lib/server/snagging/search";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Clients — for the new-job picker, and for the Clients page.
 *
 * Clients are their own record now (`snagging_clients`), reused across
 * jobs. GET searches them; POST creates one when the coordinator adds
 * someone new from the "+" dialog; PATCH edits one.
 *
 * PATCH exists because a client could only be created, never corrected: a
 * phone number typed wrong in the job wizard stayed wrong on every
 * quotation and every job that client ever had, and the only way to change
 * it was to make a second client (BA v2, change 8 / FR-1.11).
 *
 * The response keeps the client_name/client_email/client_phone shape the
 * wizard already reads, plus the id so a picked client can be linked by id.
 */

type ClientRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes?: string | null;
  created_at?: string | null;
};

function toOption(row: ClientRow, jobCount?: number) {
  return {
    id: row.id,
    client_name: row.name,
    client_email: row.email,
    client_phone: row.phone,
    company: row.company,
    notes: row.notes ?? null,
    created_at: row.created_at ?? null,
    /*
      How much work this client has given us. Undefined for the picker,
      which neither needs it nor should pay for the extra query — it is
      the Clients page that has a column for it.
    */
    job_count: jobCount,
  };
}

export async function GET(req: NextRequest) {
  try {
    // const { profile, accessUser } = await getRequestUserAccess(req);
    // if (!profile || !accessUser) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // }
    // if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
    //   return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // }

    const params = req.nextUrl.searchParams;
    const term = likeTerm(params.get("search"));
    /* The Clients page asks for counts; the job picker does not. */
    const withCounts = params.get("with_counts") === "true";
    /*
      The Clients page reads a page at a time (?page=); the pickers ask
      for the few best matches (?limit=). Neither reads the whole table.
    */
    const paged = params.has("page");
    const { from, to } = pageParams(params, { defaultSize: 10, maxSize: 100 });
    const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 50);

    // Sorted on the server, over every client, not just the page shown.
    const SORTABLE: Record<string, string> = {
      client_name: "name",
      client_phone: "phone",
      client_email: "email",
      created_at: "created_at",
    };
    const sortColumn = SORTABLE[params.get("sortBy") ?? ""] ?? "name";
    const ascending = params.get("sortDirection") !== "desc";

    const admin = await createAdminServerClient();
    let query = admin
      .from("snagging_clients")
      .select("id, name, email, phone, company, notes, created_at", {
        count: paged ? "exact" : undefined,
      })
      .order(sortColumn, { ascending, nullsFirst: false })
      .order("id");
    query = paged ? query.range(from, to) : query.limit(limit);

    if (term) {
      query = query.or(
        [
          `name.ilike.${term}`,
          `email.ilike.${term}`,
          `phone.ilike.${term}`,
          `company.ilike.${term}`,
        ].join(","),
      );
    }

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    const totalCount = paged ? (count ?? 0) : undefined;

    if (!withCounts) {
      return NextResponse.json({
        data: (data ?? []).map((row) => toOption(row)),
        totalCount,
      });
    }

    /*
      One query for every client's job count rather than one per row.

      Only the ids on this page are asked for, so a long client list does
      not turn into a table scan; `head: true` means the rows never come
      back, only the count.
    */
    // One head-only count per client on the page: exact however many
    // jobs a client has, where reading their job rows stopped at 1,000.
    const counts = new Map<string, number>(
      await Promise.all(
        (data ?? []).map(async (row) => {
          const { count: jobs, error: jobError } = await admin
            .from("snagging_jobs")
            .select("id", { count: "exact", head: true })
            .eq("client_id", row.id);
          if (jobError) throw new Error(jobError.message);
          return [row.id as string, jobs ?? 0] as const;
        }),
      ),
    );

    return NextResponse.json({
      data: (data ?? []).map((row) => toOption(row, counts.get(row.id) ?? 0)),
      totalCount,
    });
  } catch (error) {
    console.error("Snagging clients GET error:", error);
    return NextResponse.json(
      { error: "Failed to load clients" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.CREATE)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.client_name ?? body?.name ?? "").trim();
    if (name.length < 2) {
      return NextResponse.json(
        { error: "Client name is required" },
        { status: 400 },
      );
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
    return NextResponse.json(
      { error: "Failed to save client" },
      { status: 500 },
    );
  }
}

/**
 * Corrects a client's details (BA v2, change 8 / FR-1.11).
 *
 * Only the fields actually sent are touched, so editing a phone number
 * from the Clients page cannot blank a company nobody typed into that
 * form. The name is the one field that may not be emptied — every
 * quotation and job header prints it.
 *
 * Quotations are unaffected by design: each one snapshots the client's
 * details at the moment it was raised, so a corrected number appears on
 * the next document rather than silently rewriting one already issued.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "Which client?" }, { status: 400 });
    }

    const updates: Record<string, string | null> = {};
    const sent = (...keys: string[]) =>
      keys.find((key) => body?.[key] !== undefined);

    const nameKey = sent("client_name", "name");
    if (nameKey) {
      const name = String(body[nameKey] ?? "").trim();
      if (name.length < 2) {
        return NextResponse.json(
          { error: "Client name is required" },
          { status: 400 },
        );
      }
      updates.name = name;
    }

    const emailKey = sent("client_email", "email");
    if (emailKey) updates.email = emptyToNull(body[emailKey]);
    const phoneKey = sent("client_phone", "phone");
    if (phoneKey) updates.phone = emptyToNull(body[phoneKey]);
    if (body?.company !== undefined)
      updates.company = emptyToNull(body.company);
    if (body?.notes !== undefined) updates.notes = emptyToNull(body.notes);

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("snagging_clients")
      .update(updates)
      .eq("id", id)
      .select("id, name, email, phone, company, notes, created_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    return NextResponse.json({ data: toOption(data) });
  } catch (error) {
    console.error("Snagging clients PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to save client" },
      { status: 500 },
    );
  }
}

function emptyToNull(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}
