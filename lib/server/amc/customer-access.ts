import { NextResponse } from "next/server";

import { canEditCustomer } from "@/lib/amc/access";
import type { ContractGate } from "@/lib/server/amc/contract-access";

/**
 * Interim rule for the shared customer and property records, until the
 * business decides who owns them (master report §7 A6):
 *
 *   read    every AMC user (proposals and assessments need to find them)
 *   create  every AMC user (starting an assessment or proposal)
 *   edit    the record's creator, an AMC approver, or AMC Operations (Edit)
 *   delete  nobody: there is no delete path (records are kept)
 *
 * Before 6 Oct 2026 any AMC user could edit any customer or property.
 */
export async function refuseCustomerEdit(
  gate: Extract<ContractGate, { ok: true }>,
  table: "customers" | "customer_properties",
  id: string,
): Promise<NextResponse | null> {
  const { data } = await gate.admin.from(table).select("id, created_by").eq("id", id).maybeSingle<{ id: string; created_by: string | null }>();
  if (!data) {
    return NextResponse.json({ error: table === "customers" ? "Customer not found." : "Property not found." }, { status: 404 });
  }
  if (!canEditCustomer(gate.actor, data.created_by)) {
    return NextResponse.json(
      { error: "Only the person who added this record, an AMC approver or AMC Operations can change it." },
      { status: 403 },
    );
  }
  return null;
}
