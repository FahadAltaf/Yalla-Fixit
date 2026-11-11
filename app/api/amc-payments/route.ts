import { NextRequest, NextResponse } from "next/server";

import { CHEQUE_STATUSES, INSTALMENT_STATUSES, type ChequeStatus } from "@/lib/amc/payments";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { listCheques, listInstalments, type InstalmentFilter } from "@/lib/server/amc/payments";

/**
 * Finance's payments views (DEV-383, 384): every instalment with balance
 * and ageing, or the cheque register, across contracts -- or one client's
 * (`clientId`, for the client profile). AMC Payments (View) only.
 *
 *   ?view=instalments|cheques  &status=  &q=  &clientId=  &page=  &pageSize=
 */
const INSTALMENT_FILTERS = ["open", "overdue", "settled", ...INSTALMENT_STATUSES] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.payments.view) return NextResponse.json({ error: "Payments need AMC Payments (View)." }, { status: 403 });
  const params = req.nextUrl.searchParams;
  const pageSize = Math.min(Math.max(Number(params.get("pageSize")) || 25, 1), 100);
  const page = Math.max(Number(params.get("page")) || 1, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const q = params.get("q")?.trim() || null;
  const clientId = params.get("clientId");
  if (clientId && !UUID.test(clientId)) return NextResponse.json({ error: "Unknown client." }, { status: 400 });
  const status = params.get("status") || null;
  try {
    if (params.get("view") === "cheques") {
      const chequeStatus = status && (CHEQUE_STATUSES as readonly string[]).includes(status) ? (status as ChequeStatus) : null;
      return NextResponse.json(await listCheques(gate.admin, { status: chequeStatus, q, clientId, from, to }));
    }
    const filter = status && (INSTALMENT_FILTERS as readonly string[]).includes(status) ? (status as InstalmentFilter) : null;
    return NextResponse.json(await listInstalments(gate.admin, { status: filter, q, clientId, from, to }));
  } catch (error) {
    return contractErrorResponse(error, "Could not load the payments");
  }
}
