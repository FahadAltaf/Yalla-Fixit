import { NextRequest, NextResponse } from "next/server";

import { contactProblem, readContactInput } from "@/lib/clients/client-input";
import { listClientsPage } from "@/lib/server/amc/client-list";
import { clientsErrorResponse, requireClientsAccess } from "@/lib/server/clients/gate";
import { clientsWriteToFsm, createSharedClient } from "@/lib/server/clients/record";

/**
 * The Clients module (26 Nov 2026): one list for AMC and Snagging.
 *
 * GET  one page of clients from Zoho FSM, newest first or matching `q`, with
 *      AMC's prospects that FSM does not have yet on the first page; with
 *      `lifecycle`, the portal's clients in that AMC status.
 * POST a new client, in Zoho FSM and the portal.
 */
export async function GET(req: NextRequest) {
  const gate = await requireClientsAccess(req);
  if (!gate.ok) return gate.response;
  try {
    const params = req.nextUrl.searchParams;
    const lifecycle = params.get("lifecycle");
    const [page, writesToFsm] = await Promise.all([
      listClientsPage(gate.admin, {
        search: params.get("q"),
        page: Math.max(0, Number(params.get("page")) || 0),
        perPage: Math.min(Math.max(Number(params.get("pageSize")) || 10, 1), 50),
        lifecycle: lifecycle === "prospect" || lifecycle === "client" || lifecycle === "former" ? lifecycle : null,
      }),
      clientsWriteToFsm(gate.admin),
    ]);
    /* The list carries no AMC profile records: the row's own fields are enough. */
    return NextResponse.json({ ...page, clients: page.clients.map((row) => ({ ...row, customer: null })), writesToFsm });
  } catch (error) {
    return clientsErrorResponse(error, "Could not load clients");
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireClientsAccess(req);
  if (!gate.ok) return gate.response;
  if (!gate.access.create) return NextResponse.json({ error: "You cannot add clients." }, { status: 403 });
  const input = readContactInput(await req.json().catch(() => null));
  try {
    const savedInFsm = await clientsWriteToFsm(gate.admin);
    const problem = contactProblem(input, { savedInFsm });
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const client = await createSharedClient(gate.admin, input, gate.userId);
    return NextResponse.json({ client: { id: client.id, name: client.name }, existed: client.existed }, { status: client.existed ? 200 : 201 });
  } catch (error) {
    return clientsErrorResponse(error, "Could not add the client");
  }
}
