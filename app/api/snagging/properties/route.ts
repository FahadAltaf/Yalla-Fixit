import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { propertyColumns } from "@/lib/server/snagging/property";
import { propertyUpsertSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Property records (BR-1): a client's properties, reusable across jobs.
 *
 *   GET  ?client_id=…  -> that client's properties
 *   GET  ?id=…         -> one property
 *   POST               -> create a property for a client
 *   PATCH  { id, … }   -> edit a property
 */
const SELECT =
  "id, client_id, unit_label, building_name, community, developer_name, property_type, " +
  "bedrooms, built_up_area_sqft, plot_area_sqft, external_areas_in_scope, floors, " +
  "location_lat, location_lng, title_deed_path, noc_required, noc_path, created_at, updated_at";

export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const clientId = req.nextUrl.searchParams.get("client_id");
    const id = req.nextUrl.searchParams.get("id");
    const admin = await createAdminServerClient();

    if (id) {
      const { data, error } = await admin.from("snagging_properties").select(SELECT).eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return NextResponse.json({ data });
    }

    // Newest first by when the property was added. updated_at reshuffled
    // the list every time anyone touched a record, so the same property
    // was never twice in the same place.
    let query = admin
      .from("snagging_properties")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(200);
    if (clientId) query = query.eq("client_id", clientId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    console.error("Snagging properties GET error:", error);
    return NextResponse.json({ error: "Failed to load properties" }, { status: 500 });
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

    const parsed = propertyUpsertSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { client_id, ...fields } = parsed.data;

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("snagging_properties")
      .insert({ ...propertyColumns(fields), client_id, created_by: profile.id })
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error("Snagging properties POST error:", error);
    return NextResponse.json({ error: "Failed to create the property" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return NextResponse.json({ error: "Missing property id" }, { status: 400 });

    const parsed = propertyUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { client_id, ...fields } = parsed.data;

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("snagging_properties")
      .update({ ...propertyColumns(fields), client_id, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Snagging properties PATCH error:", error);
    return NextResponse.json({ error: "Failed to update the property" }, { status: 500 });
  }
}
