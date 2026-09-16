import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import {
  checklistItemSchema,
  checklistItemUpdateSchema,
  checklistToggleSchema,
} from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The checklist library (N1, FR-4.13).
 *
 * The master list of checks an inspector works through on site. A job takes a
 * copy of the applicable rows at creation, so editing an item here changes
 * what future inspections are given and leaves every job already raised
 * exactly as it was.
 *
 * Operations owns this the same way it owns the snag catalogue, and it is
 * reviewed on the same cadence, so it is gated on the same resource rather
 * than on general snagging access.
 */

const TABLE = "snagging_checklist_items";

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
      .from(TABLE)
      .select("*", { count: "exact" })
      .order("sort_order", { ascending: true });

    if (params.get("activeOnly") === "true") query = query.eq("active", true);

    /*
      One audience at a time (N1).

      The two lists are different documents for different readers, and
      showing them interleaved would let somebody retire a client-facing
      line believing they were changing what inspectors see. The screen
      always names which one it is showing; the default is the technician
      list, because that is the one in daily use.
    */
    const audience = params.get("audience") ?? "technician";
    if (audience !== "all") query = query.eq("audience", audience);

    const group = params.get("group");
    if (group && group !== "all") query = query.eq("group_name", group);

    // The four applicability columns are booleans rather than one enum, so
    // filtering by property type is a column choice, not a value match.
    const propertyType = params.get("propertyType");
    const appliesColumn: Record<string, string> = {
      apartment: "applies_apartment",
      villa: "applies_villa",
      townhouse: "applies_townhouse",
      commercial: "applies_commercial",
    };
    if (propertyType && appliesColumn[propertyType]) {
      query = query.eq(appliesColumn[propertyType], true);
    }

    const search = params.get("search")?.trim();
    if (search) {
      const term = `%${search}%`;
      query = query.or(
        [`code.ilike.${term}`, `label.ilike.${term}`, `group_name.ilike.${term}`].join(","),
      );
    }

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    const items = data ?? [];

    // Groups come from the whole library, not the filtered page, so the
    // group filter does not shrink its own list of options as it is used.
    const { data: allGroups } = await admin
      .from(TABLE)
      .select("group_name")
      .order("sort_order", { ascending: true });
    const groups = [
      ...new Set((allGroups ?? []).map((row) => row.group_name as string)),
    ];

    return NextResponse.json({
      data: {
        items,
        groups,
        totalCount: count ?? items.length,
        activeCount: items.filter((item) => item.active).length,
        mandatoryCount: items.filter((item) => item.active && item.mandatory).length,
      },
    });
  } catch (error) {
    console.error("Snagging checklist GET error:", error);
    return NextResponse.json(
      { error: "Failed to load the checklist library" },
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

    const parsed = checklistItemSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;

    // A check nobody is ever offered is a data-entry mistake, not a
    // configuration: it would sit in the library and never reach a job.
    if (
      !input.applies_apartment &&
      !input.applies_villa &&
      !input.applies_townhouse &&
      !input.applies_commercial
    ) {
      return NextResponse.json(
        { error: "Pick at least one property type, or the check never reaches a job." },
        { status: 400 },
      );
    }

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from(TABLE)
      .insert({ ...input, active: true })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error: `${input.code} already exists. Codes are never reused, because job checklists already point at them.`,
          },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }

    await recordAudit(admin, {
      entityType: "catalogue",
      entityId: data.id,
      eventType: "checklist_item_created",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: { code: input.code, label: input.label, group_name: input.group_name },
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error("Snagging checklist POST error:", error);
    return NextResponse.json({ error: "Failed to add the check" }, { status: 500 });
  }
}

/**
 * Edits an item, or deactivates it.
 *
 * There is deliberately no DELETE handler. Every job checklist row keeps a
 * `checklist_item_id` pointing here, and deleting a row would blank that
 * link on inspections already delivered; deactivating leaves history intact
 * and only stops the check reaching new jobs.
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

    const body = await req.json();
    const admin = await createAdminServerClient();

    const toggle = checklistToggleSchema.safeParse(body);
    if (toggle.success) {
      const { data, error } = await admin
        .from(TABLE)
        .update({ active: toggle.data.active, updated_at: new Date().toISOString() })
        .eq("id", toggle.data.id)
        .select("code, label")
        .single();
      if (error) throw new Error(error.message);

      await recordAudit(admin, {
        entityType: "catalogue",
        entityId: toggle.data.id,
        eventType: toggle.data.active
          ? "checklist_item_reactivated"
          : "checklist_item_deactivated",
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email,
        payload: { code: data.code, label: data.label },
      });

      return NextResponse.json({
        data: { id: toggle.data.id, active: toggle.data.active },
      });
    }

    const parsed = checklistItemUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { id, ...fields } = parsed.data;
    const updates = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    // Same rule as creation, checked against the row as it will end up
    // rather than only against what this request happened to send.
    const applicability = [
      "applies_apartment",
      "applies_villa",
      "applies_townhouse",
      "applies_commercial",
    ] as const;
    if (applicability.some((key) => key in updates)) {
      const { data: current } = await admin
        .from(TABLE)
        .select("applies_apartment, applies_villa, applies_townhouse, applies_commercial")
        .eq("id", id)
        .maybeSingle();
      const merged = { ...(current ?? {}), ...updates } as Record<string, boolean>;
      if (!applicability.some((key) => merged[key])) {
        return NextResponse.json(
          { error: "Pick at least one property type, or the check never reaches a job." },
          { status: 400 },
        );
      }
    }

    const { data, error } = await admin
      .from(TABLE)
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await recordAudit(admin, {
      entityType: "catalogue",
      entityId: id,
      eventType: "checklist_item_updated",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: { code: data.code, changed: Object.keys(updates) },
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Snagging checklist PATCH error:", error);
    return NextResponse.json({ error: "Failed to update the check" }, { status: 500 });
  }
}
