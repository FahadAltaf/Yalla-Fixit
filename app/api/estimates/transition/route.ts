import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { ESTIMATE_ID, verifyQuotationReview } from "@/lib/server/quotation-review-token";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { zohoEdgeHeaders } from "@/lib/server/zoho/edge-auth";
import { ActionType, ResourceType } from "@/types/types";

const EDGE_URL = `${process.env.SUPABASE_URL}/functions/v1/zoho-fsm-estimate-transitions`;

/**
 * POST /api/estimates/transition
 * Body: { record_id, action: "approve" | "reject" | "mark_as_sent", notes?, sig? }
 *
 * Moves a Zoho FSM estimate. It used to do so for anyone on the internet:
 * no session, no signature, any estimate id. Now either
 *   - a signed-in, active user who can work with quotations (Extensions:
 *     View for marking as sent; Extensions: Edit to approve or reject on the
 *     customer's behalf), or
 *   - the customer, approving or rejecting through their review link, which
 *     carries the signature for that estimate (`sig`).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { record_id?: unknown; action?: unknown; notes?: unknown; sig?: unknown };
    const recordId = typeof body.record_id === "string" ? body.record_id : String(body.record_id ?? "");
    const action = String(body.action ?? "");

    if (!ESTIMATE_ID.test(recordId)) {
      return NextResponse.json({ success: false, error: "record_id is required." }, { status: 400 });
    }
    if (!["approve", "reject", "mark_as_sent"].includes(action)) {
      return NextResponse.json({ success: false, error: 'action must be "approve", "reject", or "mark_as_sent".' }, { status: 400 });
    }

    let allowed = false;
    if (action !== "mark_as_sent" && verifyQuotationReview(recordId, body.sig)) {
      allowed = true;
    } else {
      const { profile, accessUser } = await getAuthenticatedUserAccess().catch(() => ({ profile: null, accessUser: null }));
      if (profile && accessUser && profile.is_active !== false) {
        allowed =
          action === "mark_as_sent"
            ? hasResourceAction(accessUser, ResourceType.EXTENSIONS, ActionType.VIEW)
            : hasResourceAction(accessUser, ResourceType.EXTENSIONS, ActionType.EDIT);
      }
    }
    if (!allowed) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const payload: Record<string, unknown> = { record_id: recordId, action };
    if (typeof body.notes === "string" && body.notes.trim()) payload.notes = body.notes.trim().slice(0, 2000);

    const res = await fetch(EDGE_URL, {
      method: "POST",
      /* Signed: the function serves only this server. */
      headers: zohoEdgeHeaders("zoho-fsm-estimate-transitions"),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      return NextResponse.json({ success: false, error: data.error ?? "Failed to execute transition." }, { status: res.status || 502 });
    }
    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    console.error("estimate transition failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 });
  }
}
