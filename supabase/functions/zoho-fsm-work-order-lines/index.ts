// Supabase Edge Function: zoho-fsm-work-order-lines
//
// Returns the service line items (and any service task line items) of a work
// order so the scheduler can choose which line(s) a NEW Service Appointment
// will cover (Zoho FSM Create Service Appointment requires the
// $Service_Line_Items ids). Lines already attached to an appointment are
// flagged so they can't be double-scheduled.
//
// Reads the shared OAuth token from public.settings, like the other
// zoho-fsm-* functions.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FSM_BASE_URL = "https://fsm.zoho.com/fsm/v1";

type ServiceLineItem = {
  id: string;
  Name?: string;
  Description?: string | null;
  Status?: string;
  Service?: { name?: string } | null;
};

type ServiceTaskLineItem = {
  id: string;
  Name?: string;
  Status?: string;
};

type AxsItem = {
  Service_Line_Item?: { id: string } | null;
  Service_Appointment?: { id: string; name?: string } | null;
};

type WorkOrderDetail = {
  id: string;
  Name?: string;
  Type?: string;
  Service_Line_Items?: ServiceLineItem[];
  Service_Tasks_Line_Items?: ServiceTaskLineItem[];
  Appointments_X_Services?: AxsItem[];
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: { workOrderId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.workOrderId) return jsonResponse({ error: "Missing field: workOrderId" }, 400);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase environment is not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: settings, error: settingsError } = await supabase
      .from("settings")
      .select("oauth_access_token")
      .eq("id", 1)
      .single();
    if (settingsError || !settings?.oauth_access_token) {
      return jsonResponse({ error: "Zoho FSM OAuth token is not configured" }, 500);
    }
    const authHeaders = { Authorization: `Zoho-oauthtoken ${settings.oauth_access_token as string}` };

    const woRes = await fetch(`${FSM_BASE_URL}/Work_Orders/${body.workOrderId}`, { headers: authHeaders });
    if (!woRes.ok) {
      console.error("[zoho-fsm-work-order-lines] WO fetch failed:", await woRes.text());
      return jsonResponse({ error: "Failed to read work order from Zoho FSM" }, 502);
    }
    const wo: WorkOrderDetail | undefined = (await woRes.json())?.data?.[0];
    if (!wo) return jsonResponse({ error: "Work order not found in Zoho FSM" }, 404);

    // Which service lines already sit on an appointment.
    const scheduledLineIds = new Set<string>();
    for (const axs of wo.Appointments_X_Services ?? []) {
      if (axs.Service_Line_Item?.id && axs.Service_Appointment?.id) {
        scheduledLineIds.add(axs.Service_Line_Item.id);
      }
    }

    const serviceLineItems = (wo.Service_Line_Items ?? []).map((line) => ({
      id: line.id,
      name: line.Name ?? line.id,
      serviceName: line.Service?.name ?? null,
      description: line.Description ?? null,
      status: line.Status ?? null,
      scheduled: scheduledLineIds.has(line.id),
    }));

    const serviceTaskLineItems = (wo.Service_Tasks_Line_Items ?? []).map((t) => ({
      id: t.id,
      name: t.Name ?? t.id,
      status: t.Status ?? null,
    }));

    return jsonResponse(
      {
        workOrderId: wo.id,
        workOrderName: wo.Name ?? null,
        workOrderType: wo.Type ?? null,
        serviceLineItems,
        serviceTaskLineItems,
      },
      200,
    );
  } catch (error: unknown) {
    console.error("[zoho-fsm-work-order-lines]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: message }, 500);
  }
});
