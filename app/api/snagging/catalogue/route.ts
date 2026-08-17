import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { catalogueEntrySchema, catalogueToggleSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Snag catalogue administration (BRD §9).
 *
 * Owned by the YFI Operations Lead and reviewed quarterly. Every
 * analytics objective in §2.2 depends on this staying controlled, so
 * the write paths are gated on the dedicated catalogue resource rather
 * than on general snagging access.
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

    const params = req.nextUrl.searchParams;
    const admin = await createAdminServerClient();

    let query = admin
      .from("snagging_catalogue_entries")
      .select("*", { count: "exact" })
      .order("sort_order", { ascending: true });

    if (params.get("activeOnly") === "true") query = query.eq("active", true);

    const element = params.get("element");
    if (element && element !== "all") query = query.eq("element_code", element);

    const search = params.get("search")?.trim();
    if (search) {
      const term = `%${search}%`;
      query = query.or(
        [`code.ilike.${term}`, `defect_label.ilike.${term}`, `element_label.ilike.${term}`].join(","),
      );
    }

    const [entries, areas, matrix] = await Promise.all([
      query,
      admin
        .from("snagging_catalogue_areas")
        .select("code, label, sort_order, active")
        .order("sort_order", { ascending: true }),
      admin.from("snagging_catalogue_area_elements").select("area_code, element_code, sort_order"),
    ]);

    if (entries.error) throw new Error(entries.error.message);
    if (areas.error) throw new Error(areas.error.message);
    if (matrix.error) throw new Error(matrix.error.message);

    // No totalCount here on purpose: the client's REST helper treats a
    // { data, totalCount } envelope as a paginated response and returns
    // it whole, which would hand the caller the envelope instead of the
    // catalogue. The catalogue is not paginated, so it returns a plain
    // { data } the helper unwraps to the object the screen expects.
    return NextResponse.json({
      data: {
        entries: entries.data ?? [],
        areas: areas.data ?? [],
        area_elements: matrix.data ?? [],
        total: entries.count ?? 0,
      },
    });
  } catch (error) {
    console.error("Snagging catalogue GET error:", error);
    return NextResponse.json({ error: "Failed to load catalogue" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING_CATALOGUE, ActionType.CREATE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = catalogueEntrySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;
    const code = `${input.element_code}-${input.defect_code}`;

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("snagging_catalogue_entries")
      .insert({
        code,
        element_code: input.element_code,
        element_label: input.element_label,
        defect_code: input.defect_code,
        defect_label: input.defect_label,
        default_severity: input.default_severity,
        guidance: input.guidance?.trim() || null,
        sort_order: input.sort_order,
        created_by: profile.id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `${code} already exists. Codes are never reused (BR-8).` },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }

    await recordAudit(admin, {
      entityType: "catalogue",
      entityId: data.id,
      eventType: "catalogue_entry_created",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: { code },
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error("Snagging catalogue POST error:", error);
    return NextResponse.json({ error: "Failed to add catalogue entry" }, { status: 500 });
  }
}

/**
 * BR-8: entries are deactivated, not deleted, so historical reports
 * keep resolving. There is deliberately no DELETE handler on this
 * route.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING_CATALOGUE, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const toggle = catalogueToggleSchema.safeParse(body);

    const admin = await createAdminServerClient();

    if (toggle.success) {
      const { error } = await admin
        .from("snagging_catalogue_entries")
        .update({ active: toggle.data.active })
        .eq("id", toggle.data.id);
      if (error) throw new Error(error.message);

      await recordAudit(admin, {
        entityType: "catalogue",
        entityId: toggle.data.id,
        eventType: toggle.data.active ? "catalogue_entry_reactivated" : "catalogue_entry_retired",
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email,
      });

      return NextResponse.json({ data: { id: toggle.data.id, active: toggle.data.active } });
    }

    const parsed = catalogueEntrySchema
      .partial()
      .extend(catalogueToggleSchema.pick({ id: true }).shape)
      .safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { id, ...fields } = parsed.data;
    // The code is the analytics key and is never rewritten in place
    // (BR-8); label, severity guidance, and ordering are all fair game.
    const updates = Object.fromEntries(
      Object.entries(fields).filter(
        ([key, value]) =>
          value !== undefined && key !== "element_code" && key !== "defect_code",
      ),
    );

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { data, error } = await admin
      .from("snagging_catalogue_entries")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await recordAudit(admin, {
      entityType: "catalogue",
      entityId: id,
      eventType: "catalogue_entry_updated",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: updates,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Snagging catalogue PATCH error:", error);
    return NextResponse.json({ error: "Failed to update catalogue entry" }, { status: 500 });
  }
}
