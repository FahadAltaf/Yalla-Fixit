import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { updatePropertyDetails } from "@/lib/server/amc/business";
import { UUID } from "@/lib/server/amc/business-schemas";
import { UNIT_TYPES, propertyExtraFields } from "@/lib/amc/client-profile";
import { assertValidParent } from "@/lib/server/amc/client-profile";

const text = (max: number) => z.string().trim().max(max).nullable().optional();

const detailsSchema = z
  .object({
    unitType: z.enum(UNIT_TYPES).nullable().optional(),
    propertyCategory: z.enum(["residential", "commercial"]).nullable().optional(),
    occupancy: z.enum(["owner", "tenant", "vacant"]).nullable().optional(),
    floor: text(30),
    street: text(200),
    city: text(80),
    zones: z.array(z.string().trim().max(80)).max(50).optional(),
    accessConstraints: text(2000),
    /* When the property is edited on the address form (its page, an enquiry, a site visit). */
    address: text(300),
    unitNo: propertyExtraFields.unitNo,
    notes: text(2000),
    parentPropertyId: propertyExtraFields.parentPropertyId,
    floorsCount: propertyExtraFields.floorsCount,
  })
  .strict();

/**
 * What only AMC keeps about an address, for one entered on Snagging's
 * address form (which saved the address itself, and sent it to Zoho FSM).
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ propertyId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { propertyId } = await ctx.params;
  if (!UUID.test(propertyId)) return NextResponse.json({ error: "Property not found." }, { status: 404 });
  const parsed = detailsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    /* The same check the property form makes: not its own parent, directly or through another unit. */
    await assertValidParent(gate.admin, propertyId, parsed.data.parentPropertyId);
    return NextResponse.json({ property: await updatePropertyDetails(gate.admin, propertyId, parsed.data, { id: gate.userId, label: gate.label }) });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the property details");
  }
}
