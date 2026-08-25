import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Snagging pricing configuration (F7-F10).
 *
 * A single admin-editable row holds the rate per square foot, the
 * multiplier per property type, the external rate, tax, the de-snag and
 * additional-visit prices, and the scope + terms text. Editing is
 * restricted to master-data admins (F8/F13); every change is logged (F10).
 */
const CONFIG_COLUMNS =
  "currency, rate_per_sqft, external_rate_per_sqft, multipliers, tax_rate, desnag_price, additional_visit_price, scope_of_work, terms, updated_at";

export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("snagging_pricing_config")
      .select(CONFIG_COLUMNS)
      .eq("id", true)
      .maybeSingle();
    if (error) throw new Error(error.message);

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Snagging pricing GET error:", error);
    return NextResponse.json({ error: "Failed to load pricing" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Master-data admins only (F8).
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING_CATALOGUE, ActionType.EDIT)) {
      return NextResponse.json({ error: "Only an admin can change pricing" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const updates = {
      currency: typeof body.currency === "string" ? body.currency : "AED",
      rate_per_sqft: num(body.rate_per_sqft),
      external_rate_per_sqft: num(body.external_rate_per_sqft),
      multipliers:
        body.multipliers && typeof body.multipliers === "object"
          ? body.multipliers
          : { apartment: 1, villa: 1.25, townhouse: 1.15, commercial: 1.5 },
      tax_rate: num(body.tax_rate, 5),
      desnag_price: num(body.desnag_price),
      additional_visit_price: num(body.additional_visit_price),
      scope_of_work: typeof body.scope_of_work === "string" ? body.scope_of_work : null,
      terms: typeof body.terms === "string" ? body.terms : null,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    };

    const admin = await createAdminServerClient();

    // Capture the previous values so the audit trail records old -> new (F10/FR-2.08).
    const { data: before } = await admin
      .from("snagging_pricing_config")
      .select(CONFIG_COLUMNS)
      .eq("id", true)
      .maybeSingle();

    const { data, error } = await admin
      .from("snagging_pricing_config")
      .upsert({ id: true, ...updates }, { onConflict: "id" })
      .select(CONFIG_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    await admin.from("snagging_pricing_config_log").insert({ changed_by: profile.id, changes: updates });

    // One audit event per kind of change (pricing / scope / terms), with the
    // previous and new value where practical.
    const prev = (before ?? {}) as Record<string, unknown>;
    const changed = (keys: string[]) =>
      keys.some((k) => JSON.stringify(prev[k]) !== JSON.stringify((updates as Record<string, unknown>)[k]));
    const events: Array<{ eventType: string; keys: string[] }> = [
      { eventType: "pricing_updated", keys: ["rate_per_sqft", "external_rate_per_sqft", "multipliers", "tax_rate", "desnag_price", "additional_visit_price", "currency"] },
      { eventType: "scope_updated", keys: ["scope_of_work"] },
      { eventType: "terms_updated", keys: ["terms"] },
    ];
    for (const ev of events) {
      if (!changed(ev.keys)) continue;
      const old: Record<string, unknown> = {};
      const next: Record<string, unknown> = {};
      for (const k of ev.keys) {
        old[k] = prev[k];
        next[k] = (updates as Record<string, unknown>)[k];
      }
      await recordAudit(admin, {
        entityType: "catalogue",
        eventType: ev.eventType,
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email,
        payload: { old, new: next },
      });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Snagging pricing PUT error:", error);
    return NextResponse.json({ error: "Failed to save pricing" }, { status: 500 });
  }
}
