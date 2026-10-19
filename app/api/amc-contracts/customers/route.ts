import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { createCustomer, searchCustomers } from "@/lib/server/amc/business";
import { customerSchema } from "@/lib/server/amc/business-schemas";
import { listClientsPage } from "@/lib/server/amc/client-list";
import { fsmErrorMessage } from "@/lib/server/snagging/fsm-clients";
import { FsmConfigError } from "@/lib/server/zoho/fsm-client";
import { FsmApiError } from "@/lib/server/zoho/fsm-contacts";

/**
 * Shared customers (one record per real customer, used by AMC today and
 * meant to be shared by other modules). GET searches by name, Customer ID,
 * phone, email or company; POST creates one.
 *
 * With `page`, one page of the Clients list as Snagging lists clients:
 * from Zoho FSM (read only), with AMC's portal-only prospects on page 0.
 */
export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    const params = req.nextUrl.searchParams;
    const lifecycle = params.get("lifecycle");
    const status = lifecycle === "prospect" || lifecycle === "client" || lifecycle === "former" ? lifecycle : null;
    if (params.has("page")) {
      try {
        return NextResponse.json(
          await listClientsPage(gate.admin, {
            search: params.get("q"),
            page: Math.max(0, Number(params.get("page")) || 0),
            perPage: Math.min(Math.max(Number(params.get("pageSize")) || 10, 1), 50),
            lifecycle: status,
          }),
        );
      } catch (error) {
        if (error instanceof FsmApiError || error instanceof FsmConfigError) {
          return NextResponse.json({ error: fsmErrorMessage(error) }, { status: 502 });
        }
        throw error;
      }
    }
    return NextResponse.json({
      customers: await searchCustomers(
        gate.admin,
        req.nextUrl.searchParams.get("q") ?? "",
        Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 25, 1), 200),
        status,
      ),
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load customers");
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = customerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const customer = await createCustomer(gate.admin, { ...parsed.data, email: parsed.data.email || null }, { id: gate.userId, label: gate.label });
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not create the customer");
  }
}
