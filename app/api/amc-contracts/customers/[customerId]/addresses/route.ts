import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  contractErrorResponse,
  requireContractAccess,
} from "@/lib/server/amc/contract-access";
import {
  getCustomer,
  getProperty,
  listProperties,
} from "@/lib/server/amc/business";
import { UUID } from "@/lib/server/amc/business-schemas";
import {
  fsmClientsReady,
  fsmErrorMessage,
  fsmOnlyAddresses,
  linkFsmAddress,
} from "@/lib/server/snagging/fsm-clients";
import { FsmConfigError } from "@/lib/server/zoho/fsm-client";
import { FsmApiError } from "@/lib/server/zoho/fsm-contacts";
import { requiredPropertyErrors, type RequiredPropertyKey } from "@/lib/snagging/quotation-required";

/** What a quotation (and a site visit) needs of an address that this one lacks, by label. */
const REQUIRED_LABELS: Record<RequiredPropertyKey, string> = {
  unit_label: "Unit reference",
  building_name: "Project / tower",
  property_type: "Property type",
  bedrooms: "Bedrooms",
  built_up_area: "Built-up area",
};

/**
 * A client's addresses for a picker, as Snagging's new quotation lists
 * them: the portal's properties, then the client's addresses in Zoho FSM
 * the portal has no row for yet (ids "fsm:…"). POST makes the portal row
 * for one of those when it is picked; FSM is only read.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ customerId: string }> },
) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId))
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  try {
    const properties = await listProperties(gate.admin, customerId);
    /* The fields the quotation rule reads, from the Snagging address behind each property. */
    const { data: snagRows } = await gate.admin
      .from("snagging_properties")
      .select("id, unit_label, building_name, property_type, bedrooms, built_up_area_sqft")
      .eq("client_id", customerId);
    const missingById = new Map(
      ((snagRows ?? []) as Array<Record<string, unknown>>).map((r) => [
        String(r.id),
        (Object.keys(
          requiredPropertyErrors({
            unit_label: r.unit_label,
            building_name: r.building_name,
            property_type: r.property_type,
            bedrooms: r.bedrooms,
            built_up_area: r.built_up_area_sqft,
          }),
        ) as RequiredPropertyKey[]).map((k) => REQUIRED_LABELS[k]),
      ]),
    );
    let fsm: { rows: Record<string, unknown>[]; error: string | null } = {
      rows: [],
      error: null,
    };
    if (await fsmClientsReady(gate.admin)) {
      const { data: linked } = await gate.admin
        .from("snagging_properties")
        .select("fsm_address_id")
        .eq("client_id", customerId)
        .not("fsm_address_id", "is", null);
      const linkedIds = new Set(
        ((linked ?? []) as { fsm_address_id: string }[]).map(
          (r) => r.fsm_address_id,
        ),
      );
      fsm = await fsmOnlyAddresses(gate.admin, customerId, linkedIds);
    }
    return NextResponse.json({
      addresses: [
        ...properties.map((p) => ({
          id: p.id,
          missing: missingById.get(p.id) ?? [],
          source: "portal" as const,
          label:
            [p.label, p.building, p.community].filter(Boolean).join(", ") ||
            p.label,
          unitType: p.unitType,
          propertyCategory: p.propertyCategory,
          community: p.community,
        })),
        ...fsm.rows.map((r) => ({
          id: String(r.id),
          source: "fsm" as const,
          label: String(
            r.fsm_address_label ?? r.unit_label ?? "Address in Zoho FSM",
          ),
          unitType: null,
          propertyCategory: null,
          community: (r.community as string | null) ?? null,
          fsmAddressId: String(r.fsm_address_id),
        })),
      ],
      fsmError: fsm.error,
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the addresses");
  }
}

const linkSchema = z.object({ fsmAddressId: z.string().trim().min(1).max(40) });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ customerId: string }> },
) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId))
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  const parsed = linkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Choose an address from the list." },
      { status: 400 },
    );
  try {
    await getCustomer(gate.admin, customerId);
    if (!(await fsmClientsReady(gate.admin)))
      return NextResponse.json(
        { error: "Zoho FSM is not available." },
        { status: 503 },
      );
    const row = await linkFsmAddress(
      gate.admin,
      customerId,
      parsed.data.fsmAddressId,
      gate.userId,
    );
    // An address from FSM carries little more than its line: say what it still needs.
    const missing = (Object.keys(
      requiredPropertyErrors({
        unit_label: row.unit_label,
        building_name: row.building_name,
        property_type: row.property_type,
        bedrooms: row.bedrooms,
        built_up_area: row.built_up_area_sqft,
      }),
    ) as RequiredPropertyKey[]).map((k) => REQUIRED_LABELS[k]);
    return NextResponse.json({
      property: await getProperty(gate.admin, String(row.id)),
      missing,
    });
  } catch (error) {
    if (error instanceof FsmApiError || error instanceof FsmConfigError) {
      return NextResponse.json(
        { error: fsmErrorMessage(error) },
        { status: 502 },
      );
    }
    return contractErrorResponse(error, "Could not use that address");
  }
}
