import { NextRequest, NextResponse } from "next/server";
import { refuseCustomerEdit } from "@/lib/server/amc/customer-access";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { getProperty, propertyOverview, updateProperty } from "@/lib/server/amc/business";
import { UUID, propertySchema } from "@/lib/server/amc/business-schemas";
import { assertValidParent, propertyUnits } from "@/lib/server/amc/client-profile";
import { canEditCustomer } from "@/lib/amc/access";
import { siteVisitMissing } from "@/lib/amc/site-visit-address";

/**
 * A property's AMC view: the current contract, previous contracts (kept
 * through renewals), services and usage, assessments and quotes. PATCH edits
 * the live property record; signed snapshots never change.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ propertyId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { propertyId } = await ctx.params;
  if (!UUID.test(propertyId)) return NextResponse.json({ error: "Property not found." }, { status: 404 });
  try {
    /* ?view=card: what a picker's card needs (the record, and what a site visit still needs), not the whole page. */
    if (req.nextUrl.searchParams.get("view") === "card") {
      const [property, snag] = await Promise.all([
        getProperty(gate.admin, propertyId),
        gate.admin
          .from("snagging_properties")
          .select("unit_label, building_name, property_type, bedrooms, built_up_area_sqft")
          .eq("id", propertyId)
          .maybeSingle<{ unit_label: string | null; building_name: string | null; property_type: string | null; bedrooms: number | null; built_up_area_sqft: number | null }>(),
      ]);
      return NextResponse.json({ property, siteVisitMissing: snag.data ? siteVisitMissing(snag.data) : [] });
    }
    /* The property is read once; its overview, units (they need its parent), owner and Snagging row then come at once. */
    const record = getProperty(gate.admin, propertyId);
    const [overview, units, owner, pin] = await Promise.all([
      propertyOverview(gate.admin, { userId: gate.userId, canApprove: gate.seesAll }, propertyId, record),
      /* Combined units (BRD 5.2): the parent and the units linked under this one. */
      record.then((p) => propertyUnits(gate.admin, propertyId, p.parentPropertyId)),
      gate.admin.from("amc_property_directory").select("created_by").eq("id", propertyId).maybeSingle<{ created_by: string | null }>(),
      /* The pin on the map, and what a site visit needs, from the Snagging address (the directory does not carry them). */
      gate.admin
        .from("snagging_properties")
        .select("location_lat, location_lng, developer_name, unit_label, building_name, property_type, bedrooms, built_up_area_sqft")
        .eq("id", propertyId)
        .maybeSingle<{
          location_lat: number | null;
          location_lng: number | null;
          developer_name: string | null;
          unit_label: string | null;
          building_name: string | null;
          property_type: string | null;
          bedrooms: number | null;
          built_up_area_sqft: number | null;
        }>(),
    ]);
    const lat = pin.data?.location_lat;
    const lng = pin.data?.location_lng;
    return NextResponse.json({
      overview,
      units,
      canEdit: canEditCustomer(gate.actor, owner.data?.created_by ?? null),
      location: typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null,
      developer: pin.data?.developer_name ?? null,
      /* What the address lacks for a site visit (as the client's address list says), so a picker needs no second read. */
      siteVisitMissing: pin.data ? siteVisitMissing(pin.data) : [],
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the property");
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ propertyId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { propertyId } = await ctx.params;
  if (!UUID.test(propertyId)) return NextResponse.json({ error: "Property not found." }, { status: 404 });
  const parsed = propertySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const refused = await refuseCustomerEdit(gate, "customer_properties", propertyId);
    if (refused) return refused;
    await assertValidParent(gate.admin, propertyId, parsed.data.parentPropertyId);
    return NextResponse.json({ property: await updateProperty(gate.admin, propertyId, parsed.data, { id: gate.userId, label: gate.label }) });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the property");
  }
}
