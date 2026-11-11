// Refreshes the Zoho FSM access token when it is older than 45 minutes.
// Called every 15 minutes by the pg_cron job "zoho-token-refresh", which must
// send the x-cron-secret header (see docs/amc-security-hardening-report.md).
// Source captured from production (v13) on 6 Oct 2026 and hardened: callers
// are checked, and Zoho's error bodies are not echoed back.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { failure, isCronRequest, isPortalRequest, unauthorized } from "../_shared/internal-auth.ts";

Deno.serve(async (req: Request) => {
  if (!isCronRequest(req) && !(await isPortalRequest(req, "token-refresher"))) return unauthorized();
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: settings, error: fetchError } = await supabase
      .from("settings")
      .select("id, oauth_token_refreshed_at")
      .eq("id", 1)
      .single();
    if (fetchError || !settings) return failure(500, "Failed to read token state");

    const refreshedAt = settings.oauth_token_refreshed_at ? new Date(settings.oauth_token_refreshed_at) : null;
    const now = new Date();
    const minutesSinceRefresh = refreshedAt ? (now.getTime() - refreshedAt.getTime()) / 60000 : Infinity;
    if (minutesSinceRefresh < 45) {
      return new Response(JSON.stringify({ success: true, refreshed: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const clientId = Deno.env.get("zoho_oauth_client_id");
    const clientSecret = Deno.env.get("zoho_oauth_client_secret");
    const refreshToken = Deno.env.get("zoho_oauth_refresh_token");
    if (!clientId || !clientSecret || !refreshToken) return failure(500, "Missing OAuth credentials in secrets");

    const form = new FormData();
    form.append("client_id", clientId);
    form.append("client_secret", clientSecret);
    form.append("refresh_token", refreshToken);
    form.append("grant_type", "refresh_token");
    const zohoRes = await fetch("https://accounts.zoho.com/oauth/v2/token", { method: "POST", body: form });
    const zohoData = await zohoRes.json().catch(() => ({}));
    if (!zohoRes.ok || zohoData.error || !zohoData.access_token) {
      console.error("token-refresher: Zoho refused the refresh:", zohoData?.error ?? zohoRes.status);
      return failure(502, "Failed to refresh Zoho token");
    }

    const { error: updateError } = await supabase
      .from("settings")
      .update({ oauth_access_token: zohoData.access_token, oauth_token_refreshed_at: now.toISOString() })
      .eq("id", 1);
    if (updateError) return failure(500, "Failed to store the token");

    return new Response(JSON.stringify({ success: true, refreshed: true, refreshed_at: now.toISOString() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("token-refresher error:", err instanceof Error ? err.message : "unknown");
    return failure(500, "Unexpected error");
  }
});
