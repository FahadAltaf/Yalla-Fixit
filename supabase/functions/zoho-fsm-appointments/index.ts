// Finds an FSM service appointment by its exact name, with its attachment
// ids (bulk download). Portal-signed calls only (/api/appointments, which
// checks Extensions access first). The bulk-download screen used to call
// this function straight from the browser with the anon key. Source
// captured from production (v16) on 6 Oct 2026 and hardened: caller check,
// no logging of appointments, no wildcard CORS.
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
  if (!(await isPortalRequest(req, "zoho-fsm-appointments"))) return unauthorized();
  if (req.method !== "POST") return failure(405, "Method not allowed. Use POST.");
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    if (!name) return failure(400, "Missing field: name");

    const token = await accessToken();
    const search = await zFetch(`${FSM}/Service_Appointments/search?api_name=Name&value=${encodeURIComponent(name)}&comparator=equal`, token);
    const appt = search?.data?.[0];
    if (!appt) return failure(404, `No appointment found for: "${name}"`);

    let attachments: Array<{ $file_id: string; File_Name: string }> = [];
    try {
      const att = await zFetch(`${FSM}/Service_Appointments/${appt.id}/Attachments`, token);
      attachments = (att?.data ?? [])
        .filter((a: Record<string, unknown>) => a["$file_id"])
        .map((a: Record<string, unknown>) => ({
          $file_id: a["$file_id"] as string,
          File_Name: (a.File_Name ?? a.file_name ?? a.Name ?? `file_${a.id}`) as string,
        }));
    } catch {
      attachments = [];
    }
    const addr = appt.Service_Address ?? {};
    return new Response(
      JSON.stringify({
        id: appt.id,
        name: appt.Name ?? name,
        address: [addr.Service_Street_1, addr.Service_Street_2, addr.Service_City, addr.Service_State, addr.Service_Country].filter(Boolean).join(", "),
        contact_id: appt.Contact?.id ?? "",
        contact_name: appt.Contact?.name ?? "",
        summary: appt.Summary ?? "",
        type: appt.Type ?? "",
        status: appt.Status ?? "",
        attachments,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[zoho-fsm-appointments]", error instanceof Error ? error.message : "unknown");
    return failure(500, "Something went wrong");
  }
});
