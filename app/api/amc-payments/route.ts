import { NextRequest, NextResponse } from "next/server";

import { CHEQUE_STATUSES, INSTALMENT_STATUSES, PAYMENT_MODES, PAYMENT_WHEN, type ChequeStatus, type PaymentMode, type PaymentWhen } from "@/lib/amc/payments";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { listCheques, listInstalments, type InstalmentFilter } from "@/lib/server/amc/payments";

/**
 * Finance's payments views (DEV-383, 384): every instalment with balance
 * and ageing, or the cheque register, across contracts -- or one client's
 * (`clientId`, for the client profile). AMC Payments (View) only.
 *
 *   ?view=instalments|cheques  &status=  &q=  &clientId=  &page=  &pageSize=
 *   &when=overdue_1_30|...|next_90|past_30 (due date; a cheque's date)  &mode= (instalments' expected mode)
 *   &dueFrom=YYYY-MM-DD &dueTo=YYYY-MM-DD (due date; a cheque's date)
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
  const whenParam = params.get("when");
  const when = whenParam && (PAYMENT_WHEN as readonly string[]).includes(whenParam) ? (whenParam as PaymentWhen) : null;
  const modeParam = params.get("mode");
  const mode = modeParam && (PAYMENT_MODES as readonly string[]).includes(modeParam) ? (modeParam as PaymentMode) : null;
  const isoDay = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const dueFrom = isoDay(params.get("dueFrom"));
  const dueTo = isoDay(params.get("dueTo"));
  try {
    if (params.get("view") === "cheques") {
      const chequeStatus = status && (CHEQUE_STATUSES as readonly string[]).includes(status) ? (status as ChequeStatus) : null;
      return NextResponse.json(await listCheques(gate.admin, { status: chequeStatus, q, clientId, from, to, when, dueFrom, dueTo }));
    }
    const filter = status && (INSTALMENT_FILTERS as readonly string[]).includes(status) ? (status as InstalmentFilter) : null;
    return NextResponse.json(await listInstalments(gate.admin, { status: filter, q, clientId, from, to, when, mode, dueFrom, dueTo }));
  } catch (error) {
    return contractErrorResponse(error, "Could not load the payments");
  }
}
