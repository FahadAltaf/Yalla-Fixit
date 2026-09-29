import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import {
  catalogueEntrySchema,
  catalogueToggleSchema,
} from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";
import { likeTerm, pageParams } from "@/lib/server/snagging/search";
import { readAllRows } from "@/lib/server/snagging/read-all";

/* Every column, named. The only reader of this v1 endpoint is
   catalogue-admin, which nothing mounts, so nothing is dropped. */
const COLUMNS = `id, code, element_code, element_label, defect_code, defect_label,
  default_severity, guidance, active, sort_order, catalogue_version, updated_at`;

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

    /*
      Server-side paging, like the jobs and quotations lists.

      This read every entry and the screen filtered and sliced the result
      in the browser, so the whole library crossed the wire to show ten
      rows. Filtering, sorting and paging now happen in the database and
      the response carries the total the pager needs.
    */
    const { from, to } = pageParams(params, { defaultSize: 10, maxSize: 100 });

    let entriesQuery = admin
      .from("snagging_catalogue_entries")
      .select(COLUMNS, { count: "exact" })
      .order("sort_order", { ascending: true })
      .range(from, to);

    if (params.get("activeOnly") === "true") {
      entriesQuery = entriesQuery.eq("active", true);
    }

    const element = params.get("element");
    if (element && element !== "all") {
      entriesQuery = entriesQuery.eq("element_code", element);
    }

    /*
      likeTerm already returns the wrapped `%term%` pattern and null when
      nothing usable is left, so it is used as-is. Wrapping it again gave
      `%%term%%`, and `%null%` for an empty box.
    */
    const term = likeTerm(params.get("search"));
    if (term) {
      entriesQuery = entriesQuery.or(
        [
          `code.ilike.${term}`,
          `defect_label.ilike.${term}`,
          `element_label.ilike.${term}`,
        ].join(","),
      );
    }

    const [entries, elementRows, areas] = await Promise.all([
      entriesQuery,
      // The area -> element applicability matrix now lives on the areas
      // row itself, as the element_codes text[] column. There is no
      // separate snagging_catalogue_area_elements table any more.
      // Not paged by the caller -- the screen needs every area to build
      // its element filter -- so it is read to exhaustion rather than
      // stopping at PostgREST's silent 1,000-row cap.
      /*
        The element filter's options, from the whole library rather than
        the page -- otherwise paging would shrink the dropdown as you used
        it. Two short columns, read to exhaustion; the distinct set is
        inherently small even when the table is not.
      */
      readAllRows<{ element_code: string; element_label: string }>(
        (rangeFrom, rangeTo) =>
          admin
            .from("snagging_catalogue_entries")
            .select("element_code, element_label")
            .order("element_label", { ascending: true })
            .range(rangeFrom, rangeTo),
        "catalogue elements",
      ),
      readAllRows<{
        code: string;
        label: string | null;
        sort_order: number | null;
        element_codes: string[] | null;
      }>(
        (from, to) =>
          admin
            .from("snagging_catalogue_areas")
            .select("code, label, sort_order, element_codes")
            .order("sort_order", { ascending: true })
            .range(from, to),
        "catalogue areas",
      ),
    ]);

    if (entries.error) throw new Error(entries.error.message);
    const entryRows = entries.data ?? [];

    // Rebuild the flat { area_code, element_code, sort_order } pairs the
    // response has always exposed by expanding each area's element_codes
    // array, so the client sees the same shape it did when the matrix was
    // its own table.
    const areaRows = areas as Array<{
      code: string;
      label: string | null;
      sort_order: number | null;
      element_codes: string[] | null;
    }>;

    const area_elements = areaRows.flatMap((area) =>
      (area.element_codes ?? []).map((element_code, index) => ({
        area_code: area.code,
        element_code,
        sort_order: index,
      })),
    );

    /*
      The total stays INSIDE data, not beside it.

      The client's REST helper treats a top-level { data, totalCount } as
      its own pagination envelope and hands the caller that envelope
      instead of the catalogue. The screen reads data.total.
    */
    return NextResponse.json({
      data: {
        entries: entryRows,
        areas: areaRows.map(({ code, label, sort_order }) => ({
          code,
          label,
          sort_order,
        })),
        area_elements,
        // Distinct, sorted by label, for the element filter.
        elements: [
          ...new Map(
            elementRows.map((row) => [row.element_code, row.element_label]),
          ).entries(),
        ].map(([code, label]) => ({ code, label })),
        total: entries.count ?? entryRows.length,
      },
    });
  } catch (error) {
    console.error("Snagging catalogue GET error:", error);
    return NextResponse.json(
      { error: "Failed to load catalogue" },
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
      !hasResourceAction(
        accessUser,
        ResourceType.SNAGGING_CATALOGUE,
        ActionType.CREATE,
      )
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = catalogueEntrySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
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
      .select(COLUMNS)
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
    return NextResponse.json(
      { error: "Failed to add catalogue entry" },
      { status: 500 },
    );
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
    if (
      !hasResourceAction(
        accessUser,
        ResourceType.SNAGGING_CATALOGUE,
        ActionType.EDIT,
      )
    ) {
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
        eventType: toggle.data.active
          ? "catalogue_entry_reactivated"
          : "catalogue_entry_retired",
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email,
      });

      return NextResponse.json({
        data: { id: toggle.data.id, active: toggle.data.active },
      });
    }

    const parsed = catalogueEntrySchema
      .partial()
      .extend(catalogueToggleSchema.pick({ id: true }).shape)
      .safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { id, ...fields } = parsed.data;
    // The code is the analytics key and is never rewritten in place
    // (BR-8); label, severity guidance, and ordering are all fair game.
    const updates = Object.fromEntries(
      Object.entries(fields).filter(
        ([key, value]) =>
          value !== undefined &&
          key !== "element_code" &&
          key !== "defect_code",
      ),
    );

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { data, error } = await admin
      .from("snagging_catalogue_entries")
      .update(updates)
      .eq("id", id)
      .select(COLUMNS)
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
    return NextResponse.json(
      { error: "Failed to update catalogue entry" },
      { status: 500 },
    );
  }
}
