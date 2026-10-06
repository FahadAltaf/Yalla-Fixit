// Reads a Zoho FSM estimate (and, when asked, its contact, blueprint
// transitions and the portal's revision rows). Portal-signed calls only
// (/api/estimates, /api/estimates/revision), which do their own access
// checks first. Source captured from production (v29) on 6 Oct 2026 and
// hardened: caller check, input validation, no upstream error details.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { failure, isPortalRequest, unauthorized } from "../_shared/internal-auth.ts";

const FSM = "https://fsm.zoho.com/fsm/v1";
const KNOWN_INCLUDES = new Set(["estimate", "contact", "transitions", "revisions"]);

Deno.serve(async (req: Request) => {
  if (!(await isPortalRequest(req, "get-estimate"))) return unauthorized();
  try {
    const body = await req.json().catch(() => ({}));
    const estimateName = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
    const estimateIdDirect = typeof body?.id === "string" || typeof body?.id === "number" ? String(body.id) : "";
    if (estimateIdDirect && !/^\d{1,25}$/.test(estimateIdDirect)) return failure(400, "Invalid id");
    const type = body?.type || "full";

    let includes: string[] = Array.isArray(body?.includes) ? body.includes.filter((i: unknown) => KNOWN_INCLUDES.has(String(i))) : [];
    if (!includes.length) {
      switch (type) {
        case "estimate_only":
          includes = ["estimate"];
          break;
        case "contact_only":
          includes = ["contact"];
          break;
        case "estimate_contact":
          includes = ["estimate", "contact"];
          break;
        case "estimate_status":
          includes = ["estimate", "transitions"];
          break;
        default:
          includes = ["estimate", "contact", "transitions", "revisions"];
      }
    }
    if (!estimateName && !estimateIdDirect && includes.includes("estimate")) return failure(400, "Missing 'name' or 'id'");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: settings, error: settingsError } = await supabase.from("settings").select("oauth_access_token").eq("id", 1).single();
    if (settingsError || !settings?.oauth_access_token) return failure(500, "Token fetch failed");
    const authHeader = `Zoho-oauthtoken ${settings.oauth_access_token}`;

    let estimateId: string | null = estimateIdDirect || null;
    if (!estimateId && includes.includes("estimate")) {
      const searchRes = await fetch(
        `${FSM}/Estimates/search?api_name=Name&value=${encodeURIComponent(estimateName)}&comparator=equal`,
        { headers: { Authorization: authHeader } },
      );
      const searchData = await searchRes.json().catch(() => null);
      if (!searchRes.ok || !searchData?.data?.[0]) return failure(404, "Estimate not found");
      estimateId = searchData.data[0].id;
    }

    const [estimateData, transitionsData] = await Promise.all([
      includes.includes("estimate") && estimateId
        ? fetch(`${FSM}/Estimates/${estimateId}`, { headers: { Authorization: authHeader } }).then((r) => r.json())
        : Promise.resolve(null),
      includes.includes("transitions") && estimateId
        ? fetch(`${FSM}/Estimates/${estimateId}/actions/blueprint/transitions`, { headers: { Authorization: authHeader } }).then((r) => r.json())
        : Promise.resolve(null),
    ]);

    let contactData: unknown = null;
    if (includes.includes("contact") && estimateData?.data?.[0]?.Contact?.id) {
      const contactRes = await fetch(`${FSM}/Contacts/${estimateData.data[0].Contact.id}`, { headers: { Authorization: authHeader } });
      contactData = await contactRes.json();
    }

    let revisions: unknown[] = [];
    if (includes.includes("revisions") && estimateData?.data?.[0]) {
      const root = estimateData.data[0]?.Root_Quotation_Number__C || `${estimateData.data[0]?.id}_${estimateData.data[0]?.Name}`;
      const { data } = await supabase
        .from("estimate_revisions")
        .select("*")
        .eq("root_quotation_number", root)
        .order("revision_number", { ascending: true });
      revisions = data || [];
    }

    const currentStatus = transitionsData?.process_info?.field_value ?? null;
    const availableTransitions =
      transitionsData?.transitions?.map((t: { id: string; name: string; next_field_value?: string; enabled: boolean }) => ({
        id: t.id,
        name: t.name,
        next_status: t.next_field_value ?? null,
        enabled: t.enabled,
      })) || [];

    return new Response(
      JSON.stringify({
        success: true,
        estimate: includes.includes("estimate") ? estimateData : null,
        contact: includes.includes("contact") ? contactData : null,
        current_status: includes.includes("transitions") ? currentStatus : null,
        available_transitions: includes.includes("transitions") ? availableTransitions : [],
        revisions: includes.includes("revisions") ? revisions : [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("get-estimate error:", err instanceof Error ? err.message : "unknown");
    return failure(500, "Unexpected error");
  }
});
