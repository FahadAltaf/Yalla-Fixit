import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import {
  catalogueCategorySchema,
  catalogueDefectSchema,
  catalogueLevelSchema,
  catalogueSubcategorySchema,
  catalogueToggleSchema,
} from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The snag catalogue, on its new three-level structure (Action Points P1).
 *
 * CATEGORY > SUB-CATEGORY > DEFECT, replacing area > element > defect. The
 * area no longer narrows anything (P2) and no longer appears in the code
 * (P3) — it is recorded against the snag instead.
 *
 * One route serves all three levels rather than three near-identical ones.
 * They differ only in which table a write lands on and which parent it
 * hangs from, and splitting that into three files meant the permission
 * gate, the audit call and the duplicate-code handling were written three
 * times and drifted.
 *
 * Writes are gated on the dedicated catalogue resource rather than general
 * snagging access: every analytics objective depends on this taxonomy
 * staying controlled, even though P6 requires it be editable without a
 * release.
 */

/** Where each level lives, and what it hangs from. */
const LEVELS = {
  category: {
    table: "snagging_catalogue_categories",
    parent: null,
    schema: catalogueCategorySchema,
  },
  subcategory: {
    table: "snagging_catalogue_subcategories",
    parent: "category_id",
    schema: catalogueSubcategorySchema,
  },
  defect: {
    table: "snagging_catalogue_defects",
    parent: "subcategory_id",
    schema: catalogueDefectSchema,
  },
} as const;

/**
 * The whole tree, in one response.
 *
 * The pickers need all three levels to narrow a defect, and fetching them
 * level by level meant three round trips before an inspector could choose
 * anything — on a site connection that is the difference between the sheet
 * opening and the inspector giving up. The catalogue is small enough
 * (~1,000 defects) that one payload is cheaper than the round trips.
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

    const activeOnly = req.nextUrl.searchParams.get("activeOnly") === "true";
    const admin = await createAdminServerClient();

    /*
      Paged, because the catalogue is bigger than one PostgREST response.

      It caps a request at 1,000 rows, and the seeded library holds 1,061
      defects — so a single select quietly returned the first thousand and
      the last sixty-one simply did not exist as far as the pickers were
      concerned. Nothing errored; the catalogue was just short.
    */
    async function readAll<T>(
      table: string,
      columns: string,
    ): Promise<T[]> {
      const size = 1000;
      const rows: T[] = [];
      for (let from = 0; ; from += size) {
        const { data, error } = await admin
          .from(table)
          .select(columns)
          .order("sort_order", { ascending: true })
          .range(from, from + size - 1);
        if (error) throw new Error(error.message);
        const page = (data ?? []) as T[];
        rows.push(...page);
        if (page.length < size) return rows;
      }
    }

    const [categories, subcategories, defects] = await Promise.all([
      readAll<{ active: boolean }>(
        "snagging_catalogue_categories",
        "id, code, label, sort_order, active",
      ),
      readAll<{ active: boolean }>(
        "snagging_catalogue_subcategories",
        "id, category_id, code, label, sort_order, active",
      ),
      readAll<{ active: boolean }>(
        "snagging_catalogue_defects",
        "id, subcategory_id, code, label, default_severity, guidance, source_code, sort_order, active",
      ),
    ]);

    const keep = <T extends { active: boolean }>(rows: T[]) =>
      rows.filter((row) => !activeOnly || row.active);

    return NextResponse.json({
      data: {
        categories: keep(categories),
        subcategories: keep(subcategories),
        defects: keep(defects),
      },
    });
  } catch (error) {
    console.error("Catalogue read error:", error);
    return NextResponse.json(
      { error: "Failed to load the catalogue" },
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
      !hasResourceAction(accessUser, ResourceType.SNAGGING_CATALOGUE, ActionType.CREATE)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const level = catalogueLevelSchema.safeParse(body.level);
    if (!level.success) {
      return NextResponse.json(
        { error: "level must be category, subcategory or defect" },
        { status: 400 },
      );
    }

    const config = LEVELS[level.data];
    const parsed = config.schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from(config.table)
      .insert(parsed.data)
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error:
              `${(parsed.data as { code: string }).code} already exists at this level. ` +
              "Codes are never reused (BR-8).",
          },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }

    await recordAudit(admin, {
      entityType: "catalogue",
      entityId: data.id,
      eventType: `catalogue_${level.data}_created`,
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: { code: data.code, label: data.label },
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error("Catalogue create error:", error);
    return NextResponse.json(
      { error: "Failed to save the catalogue entry" },
      { status: 500 },
    );
  }
}

/**
 * Edits one row, or retires it.
 *
 * BR-8: nothing is deleted. A defect that stops being offered is
 * deactivated, because snags already recorded against it must keep
 * resolving — a report issued last month cannot start showing a blank
 * where its classification was.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING_CATALOGUE, ActionType.EDIT)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const level = catalogueLevelSchema.safeParse(body.level);
    if (!level.success) {
      return NextResponse.json(
        { error: "level must be category, subcategory or defect" },
        { status: 400 },
      );
    }
    const config = LEVELS[level.data];
    const admin = await createAdminServerClient();

    // A toggle carries only id + active; anything else is a full edit.
    const toggle = catalogueToggleSchema.safeParse(body);
    if (toggle.success && Object.keys(body).length <= 3) {
      const { data, error } = await admin
        .from(config.table)
        .update({ active: toggle.data.active, updated_at: new Date().toISOString() })
        .eq("id", toggle.data.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);

      await recordAudit(admin, {
        entityType: "catalogue",
        entityId: data.id,
        eventType: toggle.data.active
          ? `catalogue_${level.data}_reinstated`
          : `catalogue_${level.data}_retired`,
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email,
        payload: { code: data.code, label: data.label },
      });

      return NextResponse.json({ data });
    }

    const id = typeof body.id === "string" ? body.id : null;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const parsed = config.schema.partial().safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { data, error } = await admin
      .from(config.table)
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "That code is already used at this level." },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }

    await recordAudit(admin, {
      entityType: "catalogue",
      entityId: data.id,
      eventType: `catalogue_${level.data}_updated`,
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: { code: data.code, label: data.label },
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Catalogue update error:", error);
    return NextResponse.json(
      { error: "Failed to update the catalogue entry" },
      { status: 500 },
    );
  }
}
