// Finds an FSM work order by its exact name, with its appointments and their
// attachment ids (bulk download). Portal-signed calls only (/api/work-orders,
// which checks Extensions access first). Source captured from production
// (v19) on 6 Oct 2026 and hardened: caller check, exact-match search only,
// no logging of work orders or contacts, no wildcard CORS.
import { createClient } from "jsr:@supabase/supabase-js@2";

import { failure, isPortalRequest, unauthorized } from "../_shared/internal-auth.ts";

const FSM = "https://fsm.zoho.com/fsm/v1";

async function accessToken(): Promise<string> {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase.from("settings").select("oauth_access_token").eq("id", 1).single();
  if (error || !data?.oauth_access_token) throw new Error("Failed to fetch access token");
  return data.oauth_access_token as string;
}

async function zFetch(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Zoho API ${res.status}`);
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (!(await isPortalRequest(req, "zoho-fsm-work-orders"))) return unauthorized();
  if (req.method !== "POST") return failure(405, "Method not allowed. Use POST.");
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    if (!name) return failure(400, "Missing field: name");

    const token = await accessToken();
    /* Exact match only: this is not a search interface. */
    const search = await zFetch(`${FSM}/Work_Orders/search?api_name=Name&value=${encodeURIComponent(name)}&comparator=equal`, token);
    const wo = search?.data?.[0];
    if (!wo) return failure(404, `No work order found for: "${name}"`);
    const detail = (await zFetch(`${FSM}/Work_Orders/${wo.id}`, token))?.data?.[0];
    if (!detail) return failure(500, "Could not read the work order");

    const unique = new Map<string, string>();
    for (const item of detail.Appointments_X_Services ?? []) {
      if (item?.Service_Appointment?.id) unique.set(item.Service_Appointment.id, item.Service_Appointment.name);
    }
    const appointments = await Promise.all(
      Array.from(unique.entries()).map(async ([id, apptName]) => {
        let attachments: Array<{ $file_id?: string; File_Name?: string }> = [];
        try {
          const att = await zFetch(`${FSM}/Service_Appointments/${id}/Attachments`, token);
          attachments = (att?.data ?? []).map((a: { $file_id?: string; File_Name?: string }) => ({ $file_id: a.$file_id, File_Name: a.File_Name }));
        } catch {
          attachments = [];
        }
        return { id, name: apptName, attachments };
      }),
    );
    const street = [detail.Service_Address?.Service_Street_1, detail.Service_Address?.Service_Street_2].filter(Boolean).join(" ");
    return new Response(
      JSON.stringify({
        id: detail.id,
        name: detail.Name ?? wo.Name ?? wo.id,
        status: detail.Status ?? wo.Status ?? "",
        summary: detail.Summary ?? "",
        contact_name: detail.Contact?.name ?? "",
        address: street,
        type: detail.Type,
        total_appointments: unique.size,
        total_attachments: appointments.reduce((s, a) => s + a.attachments.length, 0),
        appointments,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[zoho-fsm-work-orders]", error instanceof Error ? error.message : "unknown");
    return failure(500, "Something went wrong");
  }
});
