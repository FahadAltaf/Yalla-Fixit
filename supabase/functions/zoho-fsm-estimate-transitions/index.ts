// Lists or executes a Zoho FSM estimate blueprint transition (approve,
// reject, send, ...). Portal-signed calls only (/api/estimates/transition,
// which checks a signed-in user or a signed customer review link first).
// Source captured from production (v22) on 6 Oct 2026 and hardened:
//   - caller check (it was public: anyone could approve or cancel any estimate)
//   - the Zoho access token was written to the function log
//     (console.log(settings)); no logging of tokens or Zoho payloads now
//   - only named actions; a raw transition_id or extra blueprint data from
//     the caller is no longer accepted
//   - no wildcard CORS: browsers never call it
import { createClient } from "jsr:@supabase/supabase-js@2";

import { failure, isPortalRequest, unauthorized } from "../_shared/internal-auth.ts";

const FSM = "https://fsm.zoho.com/fsm/v1";

const ACTION_CANDIDATES: Record<string, string[]> = {
  approve: ["Approve", "Mark as Approved"],
  reject: ["Reject", "Cancel Approval", "Cancel"],
  cancel: ["Cancel"],
  cancel_approval: ["Cancel Approval"],
  send: ["Send Estimate", "Mark as Sent"],
  mark_as_sent: ["Mark as Sent"],
  mark_as_approved: ["Mark as Approved"],
  expire: ["Mark as Expired"],
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

async function zohoAuthHeader(): Promise<string | null> {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase.from("settings").select("oauth_access_token").eq("id", 1).single();
  if (error || !data?.oauth_access_token) return null;
  return `Zoho-oauthtoken ${data.oauth_access_token}`;
}

async function liveTransitions(recordId: string, authHeader: string) {
  const res = await fetch(`${FSM}/Estimates/${recordId}/actions/blueprint/transitions`, {
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok && data?.status === "success", status: res.status, data };
}

Deno.serve(async (req: Request) => {
  if (!(await isPortalRequest(req, "zoho-fsm-estimate-transitions"))) return unauthorized();
  try {
    const authHeader = await zohoAuthHeader();
    if (!authHeader) return failure(500, "Failed to fetch access token");

    if (req.method === "GET") {
      const recordId = new URL(req.url).searchParams.get("record_id") ?? "";
      if (!/^\d{1,25}$/.test(recordId)) return failure(400, "Query param 'record_id' is required.");
      const live = await liveTransitions(recordId, authHeader);
      if (!live.ok) return failure(live.status || 502, "Failed to fetch transitions from Zoho FSM.");
      return json({ success: true, data: live.data });
    }
    if (req.method !== "POST") return failure(405, "Method not allowed. Use GET or POST.");

    const body = await req.json().catch(() => ({}));
    const recordId = String(body?.record_id ?? "");
    const action = String(body?.action ?? "").toLowerCase();
    const notes = typeof body?.notes === "string" ? body.notes.slice(0, 2000) : undefined;
    if (!/^\d{1,25}$/.test(recordId)) return failure(400, "record_id is required.");
    const candidates = ACTION_CANDIDATES[action];
    if (!candidates) return failure(400, `Unknown action. Valid actions: ${Object.keys(ACTION_CANDIDATES).join(", ")}.`);

    const live = await liveTransitions(recordId, authHeader);
    if (!live.ok) return failure(live.status || 502, "Failed to fetch transitions. Cannot execute action.");
    const available: Array<{ id: string; name: string; enabled: boolean; fields?: Array<{ display_label: string; mandatory: boolean }> }> =
      live.data.transitions ?? [];
    let found: (typeof available)[number] | undefined;
    for (const name of candidates) {
      found = available.find((t) => t.name === name && t.enabled);
      if (found) break;
    }
    if (!found) {
      return failure(400, `Action "${action}" is not available for this estimate's current status.`);
    }
    const requiresNotes = found.fields?.some((f) => f.display_label === "Notes" && f.mandatory);
    if (requiresNotes && !notes) return failure(400, `The "${found.name}" action requires a "notes" field.`);

    const entry: Record<string, unknown> = { transition_id: found.id };
    if (notes) entry.data = { Notes: notes };
    const execRes = await fetch(`${FSM}/Estimates/${recordId}/actions/blueprint`, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ blueprint: [entry] }),
    });
    const execData = await execRes.json().catch(() => null);
    if (!execRes.ok || execData?.status !== "success") {
      return failure(execRes.status || 502, execData?.message ?? "Failed to execute transition.");
    }
    return json({ success: true, record_id: recordId, action: found.name, transition_id: found.id, message: execData.message ?? "Transition executed successfully." });
  } catch (err) {
    console.error("zoho-fsm-estimate-transitions error:", err instanceof Error ? err.message : "unknown");
    return failure(500, "Internal server error.");
  }
});
