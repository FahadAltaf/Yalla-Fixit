import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { LOOKUP_KEYS } from "@/lib/server/attribute-list-route";
import { ActionType, LeaveType, ResourceType } from "@/types/types";

/*
  FR-21 (Portal FRD, 20 Oct 2026): the leave types offered in Add Leave are
  a managed list, like technician tags and roles, kept in lookup_options
  under list_key 'leave_type'. The business enters the first four (Annual,
  Sick, Public Holiday, Offset) through the screen; nothing is seeded.

  leave_records.leave_type stores the NAME as text, not a foreign key, so:
  - renaming an option also renames the records that carry the old name
    (case-insensitive), so the filter stays consistent;
  - deleting an option RETIRES it: the dropdown stops offering it, past
    records keep their text and still display and filter.
  Older free-text records (before this list existed) are left as they are.
*/
const LIST_KEY = LOOKUP_KEYS.leaveType;

// No `*`: PostgREST treats it as a wildcard in pattern filters, and a name
// that could never be matched exactly has no place on the list.
const nameSchema = z.string().trim().min(1).max(80).regex(/^[^*]+$/, "A leave type cannot contain *");
const createSchema = z.object({ name: nameSchema });
const updateSchema = z.object({ id: z.string().uuid(), name: nameSchema });

type OptionRow = { id: string; name: string; sort_order: number };

const normalise = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

// Every distinct spelling leave_records holds, paged so the API's row cap
// (1,000 on hosted Supabase unless raised) cannot silently cut the count.
async function loadLeaveTypeValues(admin: Awaited<ReturnType<typeof createAdminServerClient>>): Promise<string[]> {
  const PAGE = 1000;
  const values: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("leave_records")
      .select("leave_type")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    (data ?? []).forEach((row: { leave_type: string | null }) => values.push(row.leave_type ?? ""));
    if ((data ?? []).length < PAGE) break;
  }
  return values;
}

async function guard(action: ActionType) {
  const { profile, accessUser } = await getAuthenticatedUserAccess();
  if (!profile || !accessUser) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, action)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { profile };
}

const duplicate = () =>
  NextResponse.json({ error: "A leave type with this name already exists" }, { status: 409 });

// Leave records per type name, case-insensitive, any status. Used by the
// manage dialog to say what a delete leaves behind.
async function countRecordsByName(admin: Awaited<ReturnType<typeof createAdminServerClient>>) {
  const counts = new Map<string, number>();
  (await loadLeaveTypeValues(admin)).forEach((value) => {
    const key = normalise(value);
    if (!key) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
}

export async function GET() {
  try {
    const g = await guard(ActionType.VIEW);
    if (g.error) return g.error;

    const admin = await createAdminServerClient();
    const { data: rows, error } = await admin
      .from("lookup_options")
      .select("id, name, sort_order")
      .eq("list_key", LIST_KEY)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);

    const counts = await countRecordsByName(admin);
    const list: LeaveType[] = ((rows ?? []) as OptionRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      sort_order: row.sort_order,
      record_count: counts.get(row.name.trim().toLowerCase()) ?? 0,
    }));
    return NextResponse.json({ data: list });
  } catch (error) {
    console.error("Scheduling leave-types GET error:", error);
    return NextResponse.json({ error: "Failed to load leave types" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await guard(ActionType.CREATE);
    if (g.error) return g.error;

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data: created, error } = await admin
      .from("lookup_options")
      .insert({
        list_key: LIST_KEY,
        name: parsed.data.name,
        created_by: g.profile.id,
        updated_by: g.profile.id,
      })
      .select("id, name, sort_order")
      .single();
    if (error) {
      // Unique index on (list_key, lower(name)).
      if (error.code === "23505") return duplicate();
      throw new Error(error.message);
    }

    await admin.from("schedule_audit_events").insert({
      event_type: "leave_type_created",
      actor_id: g.profile.id,
      origin: "portal",
      affected_entity_type: "leave_type",
      affected_entity_id: created.id,
      after_value: { name: created.name },
    });

    // A type that was in free-text use before it was listed starts with
    // those records counted against it.
    const counts = await countRecordsByName(admin);
    return NextResponse.json({
      data: { ...created, record_count: counts.get(created.name.trim().toLowerCase()) ?? 0 },
    });
  } catch (error) {
    console.error("Scheduling leave-types POST error:", error);
    return NextResponse.json({ error: "Failed to create leave type" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const g = await guard(ActionType.EDIT);
    if (g.error) return g.error;

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data: existing, error: existingError } = await admin
      .from("lookup_options")
      .select("id, name")
      .eq("id", parsed.data.id)
      .eq("list_key", LIST_KEY)
      .single();
    if (existingError || !existing) {
      return NextResponse.json({ error: "Leave type not found" }, { status: 404 });
    }

    const newName = parsed.data.name;
    const renaming = normalise(existing.name) !== normalise(newName);

    // The duplicate check comes BEFORE any write, so the record cascade
    // below can never run for a name the list refuses.
    if (renaming) {
      const { data: clash, error: clashError } = await admin
        .from("lookup_options")
        .select("id, name")
        .eq("list_key", LIST_KEY)
        .neq("id", existing.id);
      if (clashError) throw new Error(clashError.message);
      if ((clash ?? []).some((row: { name: string }) => normalise(row.name) === normalise(newName))) return duplicate();
    }

    /*
      Records store the name as text, so the rename follows them: every
      record that carried the old name (case-insensitive, trimmed) takes
      the new one. The exact spellings are collected first and matched with
      `in`, never with a like pattern, so the cascade can only touch exact
      matches. Records go first and the option second: if the second write
      fails, a retry still finds the old option name and completes.
    */
    let renamedRecords = 0;
    if (renaming) {
      const spellings = Array.from(
        new Set((await loadLeaveTypeValues(admin)).filter((value) => value && normalise(value) === normalise(existing.name))),
      );
      if (spellings.length > 0) {
        const { data: renamed, error: renameError } = await admin
          .from("leave_records")
          .update({ leave_type: newName })
          .in("leave_type", spellings)
          .select("id");
        if (renameError) throw new Error(renameError.message);
        renamedRecords = renamed?.length ?? 0;
      }
    }

    const { data: updated, error } = await admin
      .from("lookup_options")
      .update({ name: newName, updated_by: g.profile.id, updated_at: new Date().toISOString() })
      .eq("id", parsed.data.id)
      .eq("list_key", LIST_KEY)
      .select("id, name, sort_order")
      .single();
    if (error) {
      if (error.code === "23505") return duplicate();
      throw new Error(error.message);
    }

    await admin.from("schedule_audit_events").insert({
      event_type: "leave_type_renamed",
      actor_id: g.profile.id,
      origin: "portal",
      affected_entity_type: "leave_type",
      affected_entity_id: updated.id,
      before_value: { name: existing.name },
      after_value: { name: updated.name, renamed_records: renamedRecords },
    });

    const counts = await countRecordsByName(admin);
    return NextResponse.json({
      data: { ...updated, record_count: counts.get(updated.name.trim().toLowerCase()) ?? 0 },
    });
  } catch (error) {
    console.error("Scheduling leave-types PUT error:", error);
    return NextResponse.json({ error: "Failed to update leave type" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const g = await guard(ActionType.DELETE);
    if (g.error) return g.error;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    const admin = await createAdminServerClient();
    const { data: existing, error: existingError } = await admin
      .from("lookup_options")
      .select("id, name")
      .eq("id", id)
      .eq("list_key", LIST_KEY)
      .single();
    if (existingError || !existing) {
      return NextResponse.json({ error: "Leave type not found" }, { status: 404 });
    }

    const counts = await countRecordsByName(admin);
    const recordCount = counts.get(existing.name.trim().toLowerCase()) ?? 0;

    // Retire: the option goes, the records keep their text.
    const { error } = await admin.from("lookup_options").delete().eq("id", id).eq("list_key", LIST_KEY);
    if (error) throw new Error(error.message);

    await admin.from("schedule_audit_events").insert({
      event_type: "leave_type_deleted",
      actor_id: g.profile.id,
      origin: "portal",
      affected_entity_type: "leave_type",
      affected_entity_id: id,
      before_value: { name: existing.name, record_count: recordCount },
    });

    return NextResponse.json({ data: { success: true, recordCount } });
  } catch (error) {
    console.error("Scheduling leave-types DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete leave type" }, { status: 500 });
  }
}
