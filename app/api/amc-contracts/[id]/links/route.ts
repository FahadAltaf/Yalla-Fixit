import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";
import { contractLiveLinks, linkContractCustomer, linkContractProperty } from "@/lib/server/amc/business";
import { contractLinkSchema } from "@/lib/server/amc/business-schemas";

/**
 * The contract's live customer and property (who they are today). The
 * signed snapshots stay as signed. PUT links an existing record, makes one
 * from the snapshot, or unlinks (id null).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const contract = await requireManagedContract(gate, id, "read");
    if (!contract.ok) return contract.response;
    return NextResponse.json({ links: await contractLiveLinks(gate.admin, id) });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the links");
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const parsed = contractLinkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const contract = await requireManagedContract(gate, id);
    if (!contract.ok) return contract.response;
    const actor = { id: gate.userId, label: gate.label };
    const input = { createFromSnapshot: parsed.data.createFromSnapshot };
    const links =
      parsed.data.kind === "customer"
        ? await linkContractCustomer(gate.admin, id, { ...input, customerId: parsed.data.id ?? null }, actor)
        : await linkContractProperty(gate.admin, id, { ...input, propertyId: parsed.data.id ?? null }, actor);
    return NextResponse.json({ links });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the link");
  }
}
