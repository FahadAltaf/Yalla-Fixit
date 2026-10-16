import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { listClients } from "@/lib/server/snagging/client-list";
import { fsmClientsReady, fsmErrorMessage, listFsmClients } from "@/lib/server/snagging/fsm-clients";
import { ActionType, ResourceType } from "@/types/types";

/**
 * GET /api/snagging/fsm/contacts?search=&page=&pageSize= -- clients for the
 * Clients page and the client picker, read from Zoho FSM, newest first.
 *
 * FSM gives no total, so the answer says whether there are more pages
 * ({ data, hasMore, source }). Each row carries its portal id when the
 * client has been used in the portal. With the FSM integration off, the
 * portal's own clients answer in the same shape (source "portal").
 */
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING_CLIENTS, ActionType.VIEW) &&
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.CREATE)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const params = req.nextUrl.searchParams;
    const page = Math.max(0, Number(params.get("page")) || 0);
    const pageSize = Math.min(Math.max(Number(params.get("pageSize")) || 10, 1), 50);
    const search = params.get("search");
    const admin = await createAdminServerClient();

    if (!(await fsmClientsReady(admin))) {
      const local = await listClients(
        admin,
        new URLSearchParams({
          ...(search ? { search } : {}),
          with_counts: "true",
          page: String(page),
          pageSize: String(pageSize),
        }),
      );
      return NextResponse.json({
        data: local.data,
        totalCount: local.totalCount ?? 0,
        hasMore: (page + 1) * pageSize < (local.totalCount ?? 0),
        source: "portal",
      });
    }

    try {
      const result = await listFsmClients(admin, { search, page, perPage: pageSize });
      // FSM gives no total (null); totalCount is still sent so the REST helper keeps hasMore.
      return NextResponse.json({ ...result, totalCount: null, source: "fsm" });
    } catch (err) {
      return NextResponse.json({ error: fsmErrorMessage(err) }, { status: 502 });
    }
  } catch (error) {
    console.error("FSM contacts GET error:", error);
    return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
  }
}
