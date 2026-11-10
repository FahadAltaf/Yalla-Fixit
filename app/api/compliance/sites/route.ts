import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ActionType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireComplianceAny } from "@/lib/server/compliance/access";
import { ensureSiteClient, ensureSiteProperty, listSiteProperties, searchSiteClients } from "@/lib/server/compliance/sites";
import { intParam, ok, parseBody, serverError } from "@/lib/server/compliance/http";

/*
  Site picker (FRD D4): clients from Zoho FSM (or the portal's own list
  when FSM is off) and the project locations under one of them.
  GET  ?q=&page=&pageSize=            clients
  GET  ?client=<id>                   project locations for a client
  POST { client: {id?, fsm_contact_id?}, property?: string }
       makes sure the portal rows exist and returns the ids to store.
*/
const PICK = [ActionType.CREATE, ActionType.EDIT];

const resolveSchema = z.object({
  client: z.object({ id: z.string().uuid().nullable().optional(), fsm_contact_id: z.string().min(1).nullable().optional() }),
  property: z.string().min(1).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const g = await requireComplianceAny(PICK);
  if (g.error) return g.error;
  try {
    const admin = await createAdminServerClient();
    const p = req.nextUrl.searchParams;
    const clientId = p.get("client");
    if (clientId) return ok(await listSiteProperties(admin, clientId));
    const result = await searchSiteClients(admin, p.get("q"), intParam(p.get("page"), 0, 0, 1000), intParam(p.get("pageSize"), 20, 1, 100));
    return ok(result);
  } catch (error) {
    return serverError("site picker", error);
  }
}

export async function POST(req: NextRequest) {
  const g = await requireComplianceAny(PICK);
  if (g.error) return g.error;
  const body = await parseBody(req, resolveSchema);
  if ("response" in body) return body.response;
  try {
    const admin = await createAdminServerClient();
    const client = await ensureSiteClient(admin, body.data.client, g.actor.id);
    const propertyId = body.data.property ? await ensureSiteProperty(admin, client.id, body.data.property, g.actor.id) : null;
    return ok({ site_client_id: client.id, client_name: client.name, site_property_id: propertyId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resolve the site";
    if (/choose a client|does not belong/i.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    return serverError("resolve site", error);
  }
}
