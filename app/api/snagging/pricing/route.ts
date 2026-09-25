import { after, NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Snagging pricing configuration (F7-F10, FR-2.03).
 *
 * A single admin-editable row holds the rate card Operations issued on
 * 21 August 2026 — rate per square foot by property type and furnished
 * state, minimum charge by type, the plot band, and the fixed de-snagging
 * and additional-visit prices — plus tax, the out-of-hours percentage, and
 * the scope + terms text. Editing is restricted to master-data admins
 * (F8/F13, FR-2.11); every change is logged (F10, FR-2.16).
 *
 * The pre-card columns are still selected and still written. They price
 * nothing now, but quotations raised before the card carry them in their
 * own snapshot, and dropping them while those quotations are still being
 * rendered would blank the figures on documents already issued.
 */
const CONFIG_COLUMNS =
  "currency, rate_card, out_of_hours_percent, tax_rate, scope_of_work, terms, rate_per_sqft, external_rate_per_sqft, multipliers, desnag_price, additional_visit_price, updated_at";

export async function GET(req: NextRequest) {
  try {
    // const { profile, accessUser } = await getRequestUserAccess(req);
    // if (!profile || !accessUser) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // }
    // if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
    //   return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // }

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
    return NextResponse.json(
      { error: "Failed to load pricing" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Master-data admins only (F8).
    if (
      !hasResourceAction(
        accessUser,
        ResourceType.SNAGGING_CATALOGUE,
        ActionType.EDIT,
      )
    ) {
      return NextResponse.json(
        { error: "Only an admin can change pricing" },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const num = (v: unknown, d = 0) =>
      Number.isFinite(Number(v)) ? Number(v) : d;

    const admin = await createAdminServerClient();

    // Capture the previous values so the audit trail records old -> new (F10/FR-2.08).
    const { data: before } = await admin
      .from("snagging_pricing_config")
      .select(CONFIG_COLUMNS)
      .eq("id", true)
      .maybeSingle();
    const prev = (before ?? {}) as Record<string, unknown>;

    /*
      The superseded columns are CARRIED, not rewritten.

      The pricing screen has priced against the rate card since it replaced
      the rate-times-multiplier model, so it never sends these — and this
      route used to read that silence as zero, writing `rate_per_sqft: 0`
      and a hardcoded multiplier set on every single save. Nothing prices
      against them any more, but they are the record of what the old model
      held, and a save that quietly destroys history is not a save.
    */
    const carry = <T>(sent: unknown, column: string, fallback: T): T =>
      sent !== undefined ? (sent as T) : ((prev[column] as T) ?? fallback);

    const updates = {
      currency: typeof body.currency === "string" ? body.currency : "AED",
      // The card is written whole or not at all: a partial merge would let
      // one type's band be saved against another type's stale minimum.
      ...(body.rate_card && typeof body.rate_card === "object"
        ? { rate_card: body.rate_card }
        : {}),
      out_of_hours_percent: num(body.out_of_hours_percent, 40),
      tax_rate: num(body.tax_rate, 5),
      rate_per_sqft: carry(body.rate_per_sqft, "rate_per_sqft", 0),
      external_rate_per_sqft: carry(
        body.external_rate_per_sqft,
        "external_rate_per_sqft",
        0,
      ),
      multipliers: carry(body.multipliers, "multipliers", {
        apartment: 1,
        villa: 1.25,
        townhouse: 1.15,
        commercial: 1.5,
      }),
      desnag_price: carry(body.desnag_price, "desnag_price", 0),
      additional_visit_price: carry(
        body.additional_visit_price,
        "additional_visit_price",
        0,
      ),
      scope_of_work:
        typeof body.scope_of_work === "string" ? body.scope_of_work : null,
      terms: typeof body.terms === "string" ? body.terms : null,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await admin
      .from("snagging_pricing_config")
      .upsert({ id: true, ...updates }, { onConflict: "id" })
      .select(CONFIG_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    /*
      The change log and audit entries are written after the admin has
      their answer (after()): the saved configuration is what the page
      needs, and these were several more round trips in front of it.
    */
    after(async () => {
      try {
        await admin
          .from("snagging_pricing_config_log")
          .insert({ changed_by: profile.id, changes: updates });

        // One audit event per kind of change (pricing / scope / terms), with the
        // previous and new value where practical.
        const changed = (keys: string[]) =>
          keys.some(
            (k) =>
              JSON.stringify(prev[k]) !==
              JSON.stringify((updates as Record<string, unknown>)[k]),
          );
        const events: Array<{ eventType: string; keys: string[] }> = [
          /*
            `rate_card` and `out_of_hours_percent` head this list because they
            are what an admin actually edits now, and they were both missing
            from it — so every change to a published rate, a minimum charge or
            the out-of-hours surcharge went unlogged, while the dead
            multiplier columns beside them were watched closely. FR-2.16 asks
            for every pricing change to be recorded; this is what records it.
          */
          {
            eventType: "pricing_updated",
            keys: [
              "rate_card",
              "out_of_hours_percent",
              "tax_rate",
              "currency",
              "rate_per_sqft",
              "external_rate_per_sqft",
              "multipliers",
              "desnag_price",
              "additional_visit_price",
            ],
          },
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
      } catch (logError) {
        console.error("Snagging pricing log/audit failed:", logError);
      }
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Snagging pricing PUT error:", error);
    return NextResponse.json(
      { error: "Failed to save pricing" },
      { status: 500 },
    );
  }
}
