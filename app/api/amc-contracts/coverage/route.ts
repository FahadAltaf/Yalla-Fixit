import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireContractAccess } from "@/lib/server/amc/contract-access";
import { ContractError, coverageFor } from "@/lib/server/amc/contracts";

/**
 * Is this work covered by an AMC? For a customer (the proposal's Customer
 * ID), a service and a date: whether an AMC is in force, whether the
 * service is on it, what is left, and whether the request would be covered
 * or chargeable. Read-only: it never consumes anything.
 *
 * GET /api/amc-contracts/coverage?customerRef=YFI1806&serviceId=ac-ppm&date=2026-10-06
 */
const querySchema = z.object({
  customerRef: z.string().trim().min(1).max(100),
  serviceId: z.string().trim().min(1).max(100),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "customerRef and serviceId are required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ coverage: await coverageFor(gate.admin, parsed.data) });
  } catch (error) {
    if (error instanceof ContractError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("AMC coverage failed:", error);
    return NextResponse.json({ error: "Could not check coverage" }, { status: 500 });
  }
}
