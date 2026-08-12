import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType, TechnicianTag } from "@/types/types";

const createTagSchema = z.object({
  name: z.string().trim().min(1),
});

const updateTagSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
});

type TagRow = {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
};

export async function GET() {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = await createAdminServerClient();
    const { data: tagRows, error } = await admin
      .from("technician_tags")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: assignmentRows, error: assignmentError } = await admin
      .from("technician_tag_assignments")
      .select("tag_id");
    if (assignmentError) throw new Error(assignmentError.message);

    const countByTag = new Map<string, number>();
    (assignmentRows ?? []).forEach((row: { tag_id: string }) => {
      countByTag.set(row.tag_id, (countByTag.get(row.tag_id) ?? 0) + 1);
    });

    const tags: TechnicianTag[] = (tagRows ?? []).map((row: TagRow) => ({
      id: row.id,
      name: row.name,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_by: row.updated_by,
      updated_at: row.updated_at,
      technician_count: countByTag.get(row.id) ?? 0,
    }));

    return NextResponse.json({ data: tags });
  } catch (error) {
    console.error("Scheduling tags GET error:", error);
    return NextResponse.json({ error: "Failed to load tags" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.CREATE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = createTagSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data: created, error } = await admin
      .from("technician_tags")
      .insert({
        name: parsed.data.name,
        created_by: profile.id,
        updated_by: profile.id,
      })
      .select("*")
      .single();

    if (error) {
      // TAG-002: unique tag name (case-insensitive unique index).
      if (error.code === "23505") {
        return NextResponse.json({ error: "A tag with this name already exists" }, { status: 409 });
      }
      throw new Error(error.message);
    }

    await admin.from("schedule_audit_events").insert({
      event_type: "tag_created",
      actor_id: profile.id,
      origin: "portal",
      affected_entity_type: "technician_tag",
      affected_entity_id: created.id,
      after_value: { name: created.name },
    });

    return NextResponse.json({ data: { ...created, technician_count: 0 } });
  } catch (error) {
    console.error("Scheduling tags POST error:", error);
    return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = updateTagSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data: existing, error: existingError } = await admin
      .from("technician_tags")
      .select("id, name")
      .eq("id", parsed.data.id)
      .single();
    if (existingError || !existing) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    const { data: updated, error } = await admin
      .from("technician_tags")
      .update({ name: parsed.data.name, updated_by: profile.id, updated_at: new Date().toISOString() })
      .eq("id", parsed.data.id)
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "A tag with this name already exists" }, { status: 409 });
      }
      throw new Error(error.message);
    }

    // TAG-003: renamed tag must be reflected everywhere it's referenced --
    // it is, because every consumer joins on tag_id and reads the current
    // name from this row rather than storing a denormalised copy.
    await admin.from("schedule_audit_events").insert({
      event_type: "tag_renamed",
      actor_id: profile.id,
      origin: "portal",
      affected_entity_type: "technician_tag",
      affected_entity_id: updated.id,
      before_value: { name: existing.name },
      after_value: { name: updated.name },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("Scheduling tags PUT error:", error);
    return NextResponse.json({ error: "Failed to update tag" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.DELETE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    const admin = await createAdminServerClient();
    const { data: existing, error: existingError } = await admin
      .from("technician_tags")
      .select("id, name")
      .eq("id", id)
      .single();
    if (existingError || !existing) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    const { count } = await admin
      .from("technician_tag_assignments")
      .select("*", { count: "exact", head: true })
      .eq("tag_id", id);

    // TAG-004: assignments cascade-delete with the tag (FK ON DELETE CASCADE);
    // the audit event preserves how many technicians were affected.
    const { error } = await admin.from("technician_tags").delete().eq("id", id);
    if (error) throw new Error(error.message);

    await admin.from("schedule_audit_events").insert({
      event_type: "tag_deleted",
      actor_id: profile.id,
      origin: "portal",
      affected_entity_type: "technician_tag",
      affected_entity_id: id,
      before_value: { name: existing.name, technician_count: count ?? 0 },
    });

    return NextResponse.json({ data: { success: true, affectedTechnicianCount: count ?? 0 } });
  } catch (error) {
    console.error("Scheduling tags DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete tag" }, { status: 500 });
  }
}
