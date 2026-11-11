// Forces a Zoho FSM token refresh. Nothing in the portal or the cron job
// calls it (token-refresher does the scheduled refresh); it was public and
// let anyone burn Zoho's refresh-rate limit. Kept, portal-signed only, until
// it is deleted (recommended: `supabase functions delete refresh-token`).
// Source captured from production (v11) on 6 Oct 2026 and hardened.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { failure, isPortalRequest, unauthorized } from "../_shared/internal-auth.ts";

Deno.serve(async (req: Request) => {
  if (!(await isPortalRequest(req, "refresh-token"))) return unauthorized();
  try {
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
    if (!zohoRes.ok || zohoData.error || !zohoData.access_token) return failure(502, "Failed to refresh Zoho token");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await supabase
      .from("settings")
      .update({ oauth_access_token: zohoData.access_token, oauth_token_refreshed_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) return failure(500, "Failed to store the token");
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch {
    return failure(500, "Unexpected error");
  }
});
