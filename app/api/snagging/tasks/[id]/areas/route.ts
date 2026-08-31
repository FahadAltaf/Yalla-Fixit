import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { createAreaSchema, updateAreaSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Area management for a job (FR-3.05 / FR-3.07).
 *
 * Areas are the rooms of the inspection. They start from the property-type
 * template (seeded at job creation) and stay editable here: add, rename,
 * remove, and — the new part — pin an area onto a floor plan. A pin is
 * floor_plan_id + pin_x/pin_y (0..1), the Floor -> Plan -> Pin -> Area link.
 * Reuses snagging_areas; no new table.
 */
const AREA_COLUMNS =
  "id, job_id, name, catalogue_area_code, sort_order, status, floor_plan_id, pin_x, pin_y";

const pinFieldsFrom = (
  input: { floor_plan_id?: string | null; pin_x?: number | null; pin_y?: number | null },
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (input.floor_plan_id !== undefined) out.floor_plan_id = input.floor_plan_id;
  // A pin is all-or-nothing: keep the plan/x/y consistent so the DB check holds.
  if (input.pin_x !== undefined || input.pin_y !== undefined) {
    const x = input.pin_x ?? null;
    const y = input.pin_y ?? null;
    out.pin_x = x === null || y === null ? null : x;
    out.pin_y = x === null || y === null ? null : y;
  }
  return out;
};

/** GET — the job's areas, ordered, with their floor-plan pin (if any). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("snagging_areas")
      .select(AREA_COLUMNS)
      .eq("job_id", id)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    console.error("Snagging areas GET error:", error);
    return NextResponse.json({ error: "Failed to load areas" }, { status: 500 });
  }
}

/** POST — add an area (optionally already pinned to a plan). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const parsed = createAreaSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const input = parsed.data;

    const admin = await createAdminServerClient();
    // Append after the last area.
    const { count } = await admin
      .from("snagging_areas")
      .select("id", { count: "exact", head: true })
      .eq("job_id", id);

    const { data, error } = await admin
      .from("snagging_areas")
      .insert({
        job_id: id,
        name: input.name,
        catalogue_area_code: input.catalogue_area_code ?? null,
        sort_order: (count ?? 0) * 10,
        ...pinFieldsFrom(input),
      })
      .select(AREA_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "An area with that name already exists on this job" }, { status: 409 });
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error("Snagging areas POST error:", error);
    return NextResponse.json({ error: "Failed to add the area" }, { status: 500 });
  }
}

/** PATCH — rename an area, and/or place / move / clear its floor-plan pin. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const parsed = updateAreaSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const input = parsed.data;

    const updates: Record<string, unknown> = { ...pinFieldsFrom(input) };
    if (input.name !== undefined) updates.name = input.name;
    if (input.catalogue_area_code !== undefined) updates.catalogue_area_code = input.catalogue_area_code;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("snagging_areas")
      .update(updates)
      .eq("id", input.id)
      .eq("job_id", id)
      .select(AREA_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "An area with that name already exists on this job" }, { status: 409 });
      }
      throw new Error(error.message);
    }
    if (!data) return NextResponse.json({ error: "Area not found" }, { status: 404 });
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Snagging areas PATCH error:", error);
    return NextResponse.json({ error: "Failed to update the area" }, { status: 500 });
  }
}

/** DELETE /api/snagging/tasks/[id]/areas?areaId=… — remove an area. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const areaId = req.nextUrl.searchParams.get("areaId");
    if (!areaId) return NextResponse.json({ error: "Missing areaId" }, { status: 400 });

    const admin = await createAdminServerClient();
    // Guard: do not orphan snags. An area with snags on it cannot be removed.
    const { count: snagCount } = await admin
      .from("snagging_snags")
      .select("id", { count: "exact", head: true })
      .eq("area_id", areaId);
    if ((snagCount ?? 0) > 0) {
      return NextResponse.json(
        { error: "This area has snags recorded against it and cannot be removed." },
        { status: 409 },
      );
    }

    const { error } = await admin.from("snagging_areas").delete().eq("id", areaId).eq("job_id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: { id: areaId } });
  } catch (error) {
    console.error("Snagging areas DELETE error:", error);
    return NextResponse.json({ error: "Failed to remove the area" }, { status: 500 });
  }
}
