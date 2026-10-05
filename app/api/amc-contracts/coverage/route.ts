import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AMC_SLA_DEFAULTS } from "@/lib/amc/sla";
import { coverageVerdict, todayInDubai } from "@/lib/amc/contracts";
import {
  contractErrorResponse,
  requireContractAccess,
  requireManagedContract,
} from "@/lib/server/amc/contract-access";
import {
  coverageCatalogue,
  coverageForContract,
  coverageForCustomer,
} from "@/lib/server/amc/contract-operations";

/**
 * Is this work covered by an AMC? Read-only: it never consumes anything
 * and never creates work orders.
 *
 *   ?catalogue=1                              the services that can be asked about
 *   ?contractId=<uuid>&serviceId=..&date=..   one contract
 *   ?customerRef=YFI1806&serviceId=..&date=.. every contract of a customer
 *
 * Only contracts the caller can see are considered: their own proposals'
 * contracts, or all of them for approvers.
 */
const querySchema = z
  .object({
    contractId: z.string().uuid().optional(),
    customerRef: z.string().trim().min(1).max(100).optional(),
    serviceId: z.string().trim().min(1).max(100),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((q) => !!q.contractId !== !!q.customerRef, "Give a contract or a customer ID");

export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const params = Object.fromEntries(req.nextUrl.searchParams);

  try {
    const catalogue = await coverageCatalogue(gate.admin);
    if (params.catalogue) return NextResponse.json({ catalogue });

    const parsed = querySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "A service and a contract or customer ID are required" },
        { status: 400 },
      );
    }
    const { contractId, customerRef, serviceId } = parsed.data;
    const date = parsed.data.date ?? todayInDubai();

    let coverage;
    if (contractId) {
      const contract = await requireManagedContract(gate, contractId);
      if (!contract.ok) return contract.response;
      coverage = (await coverageForContract(gate.admin, contractId, { serviceId, date })).coverage;
    } else {
      coverage = await coverageForCustomer(
        gate.admin,
        { userId: gate.userId, canApprove: gate.canApprove },
        { customerRef: customerRef!, serviceId, date },
      );
    }

    const service = catalogue.find((s) => s.id === serviceId);
    const callOutClass = coverage.callOutClass ?? service?.callOutClass ?? null;
    return NextResponse.json({
      coverage,
      verdict: coverageVerdict(coverage, service?.label ?? serviceId),
      date,
      /* The target for call-outs. Whether it was met is not known: the
         portal does not yet receive request and arrival times from FSM. */
      sla: callOutClass ? { ...AMC_SLA_DEFAULTS[callOutClass], state: "unknown" as const } : null,
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not check coverage");
  }
}
