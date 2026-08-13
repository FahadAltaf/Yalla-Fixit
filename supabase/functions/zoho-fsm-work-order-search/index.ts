// Supabase Edge Function: zoho-fsm-work-order-search
//
// Multi-result work order search for the scheduler (FRD PLAN-003/004, O-4).
// FSM's /Work_Orders/search endpoint only reliably filters by Name and Type
// on this org -- Contact/Company/Address/date searches return nothing there.
// So:
//   - a work order NUMBER (WO2361) uses the fast native Name search;
//   - client / company / address / date filter a batch of recent work orders
//     in-memory. This means those searches look within the most recent
//     work orders (bounded below), which suits day-to-day scheduling.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FSM_BASE_URL = "https://fsm.zoho.com/fsm/v1";
const RECENT_PAGES = 4; // up to 4 * 200 = 800 most-recent work orders
const PER_PAGE = 200;

type SearchBody = {
  workOrderName?: string;
  contact?: string;
  company?: string;
  address?: string;
  dateFrom?: string; // YYYY-MM-DD (Due_Date on/after)
  dateTo?: string; // YYYY-MM-DD (Due_Date on/before)
};

type WorkOrder = {
  id: string;
  Name?: string;
  Summary?: string;
  Status?: string;
  Type?: string;
  Due_Date?: string | null;
  Created_Time?: string | null;
  Contact?: { name?: string } | null;
  Company?: { name?: string } | null;
  Service_Address?: Record<string, string | null> | null;
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function addressText(addr?: Record<string, string | null> | null): string {
  if (!addr) return "";
  return Object.entries(addr)
    .filter(([k]) => /street|city|state|country|zip|address/i.test(k))
    .map(([, v]) => v ?? "")
    .filter(Boolean)
    .join(" ");
}

function shape(w: WorkOrder) {
  return {
    id: w.id,
    name: w.Name ?? null,
    summary: w.Summary ?? null,
    status: w.Status ?? null,
    type: w.Type ?? null,
    dueDate: w.Due_Date ?? null,
    contactName: w.Contact?.name ?? null,
    companyName: w.Company?.name ?? null,
    address: addressText(w.Service_Address) || null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: SearchBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const hasFilter =
    body.workOrderName || body.contact || body.company || body.address || body.dateFrom || body.dateTo;
  if (!hasFilter) return jsonResponse({ error: "Provide at least one search filter" }, 400);

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

    // Fast path: a work order number uses FSM's native Name search.
    if (body.workOrderName) {
      const url = `${FSM_BASE_URL}/Work_Orders/search?api_name=Name&value=${encodeURIComponent(
        body.workOrderName.trim(),
      )}&comparator=contains&per_page=25`;
      const r = await fetch(url, { headers: authHeaders });
      const results = r.status === 204 ? [] : ((await r.json())?.data ?? []);
      return jsonResponse({ results: (results as WorkOrder[]).map(shape), scope: "by-number" }, 200);
    }

    // Otherwise filter a batch of recent work orders in-memory.
    const contact = body.contact?.trim().toLowerCase();
    const company = body.company?.trim().toLowerCase();
    const address = body.address?.trim().toLowerCase();
    const fromMs = body.dateFrom ? new Date(`${body.dateFrom}T00:00:00`).getTime() : null;
    const toMs = body.dateTo ? new Date(`${body.dateTo}T23:59:59`).getTime() : null;

    const matches: WorkOrder[] = [];
    for (let page = 1; page <= RECENT_PAGES; page += 1) {
      const r = await fetch(`${FSM_BASE_URL}/Work_Orders?per_page=${PER_PAGE}&page=${page}`, {
        headers: authHeaders,
      });
      if (!r.ok) break;
      const payload = await r.json();
      const rows: WorkOrder[] = payload?.data ?? [];

      for (const w of rows) {
        if (contact && !(w.Contact?.name ?? "").toLowerCase().includes(contact)) continue;
        if (company && !(w.Company?.name ?? "").toLowerCase().includes(company)) continue;
        if (address && !addressText(w.Service_Address).toLowerCase().includes(address)) continue;
        if (fromMs || toMs) {
          const due = w.Due_Date ? new Date(w.Due_Date).getTime() : null;
          if (due === null) continue;
          if (fromMs && due < fromMs) continue;
          if (toMs && due > toMs) continue;
        }
        matches.push(w);
        if (matches.length >= 50) break;
      }
      if (matches.length >= 50) break;
      if (!payload?.info?.more_records) break;
    }

    return jsonResponse({ results: matches.map(shape), scope: "recent" }, 200);
  } catch (error: unknown) {
    console.error("[zoho-fsm-work-order-search]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: message }, 500);
  }
});
