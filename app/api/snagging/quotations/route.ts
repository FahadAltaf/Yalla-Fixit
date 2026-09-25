import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { resolveClient } from "@/lib/server/snagging/client";
import { PROPERTY_COLUMNS, resolveProperty } from "@/lib/server/snagging/property";
import {
  loadPricingConfig,
  priceDesnag,
  priceQuotation,
  UNDECIDED,
  type QuotedProperty,
} from "@/lib/server/snagging/quotation-build";
import { desnagBand } from "@/lib/server/snagging/pricing";
import { LIST_COLUMNS, listQuotations, toWire } from "@/lib/server/snagging/quotation-list";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Quotations as their own thing, not a tab inside a job (BA v2, changes
 * 1-3; BRD §5.1, BR-2).
 *
 * The team quotes a client and only raises the job once that quotation
 * comes back approved. Until now the system insisted on the opposite
 * order, so every enquiry that went nowhere left a draft job behind and a
 * coordinator had to commit to work before anyone had agreed to pay for
 * it.
 *
 * A quotation raised here needs a client and a property and nothing else
 * — no floor plans, no areas, no inspector (change 2). Those are the job's
 * business, and the job is built from the wizard once the client says yes.
 */

/**
 * Quotations, newest first, a page at a time for the Quotations section.
 * ?search= matches the number, client, unit and building; the response
 * carries the total and a count per status for the pills.
 */
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
    return NextResponse.json(await listQuotations(admin, req.nextUrl.searchParams));
  } catch (error) {
    console.error("Snagging quotations GET error:", error);
    return NextResponse.json(
      { error: "Failed to load quotations" },
      { status: 500 },
    );
  }
}

/**
 * Quotes a client's property, with no job behind it.
 *
 * Resolves (or creates) the client and the property first — the same two
 * helpers the job wizard uses, so a quotation and a job raised for the
 * same unit land on one property record rather than two — then prices it
 * against the current rate card.
 */
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.CREATE)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const p = (body?.property ?? {}) as Record<string, unknown>;
    const kind = String(body?.quote_kind ?? "inspection");

    const admin = await createAdminServerClient();

    const config = await loadPricingConfig(admin);
    if (!config) {
      return NextResponse.json(
        { error: "Pricing is not configured yet" },
        { status: 400 },
      );
    }

    /*
      A de-snag is quoted against a job, not a bare property (BA v2, change
      31). Everything it needs — the client, the unit, the property type
      that sets the price — is already on the original, so it takes none of
      the property form the inspection path does.
    */
    if (kind === "desnag") {
      return desnagQuotation(admin, body, config, profile.id);
    }

    const gate = validate(body, p);
    if (gate) return NextResponse.json({ error: gate }, { status: 400 });

    // 1. The client. Required, and required to be reachable — a quotation
    //    nobody can be sent is not a quotation (change 2, D1).
    const clientId = await resolveClient(admin, {
      clientId: (body.client_id as string) ?? null,
      name: String(p.client_name ?? "").trim(),
      email: emptyToNull(p.client_email),
      phone: emptyToNull(p.client_phone),
      createdBy: profile.id,
    });

    // 2. The property (BR-1). Reuses the client's record for this unit
    //    rather than creating a second one for the same address.
    const property = await resolveProperty(admin, {
      propertyId: (body.property_id as string) ?? null,
      clientId,
      fields: p as never,
      createdBy: profile.id,
    });

    const { data: full, error: propertyError } = await admin
      .from("snagging_properties")
      .select(PROPERTY_COLUMNS)
      .eq("id", property.id)
      .single();
    if (propertyError) throw new Error(propertyError.message);

    const { data: client } = await admin
      .from("snagging_clients")
      .select("id, name, email, phone")
      .eq("id", clientId)
      .maybeSingle();

    /*
      The coordinator's rate (FR-2.04), when they made a choice.

      Absent on anything that does not offer the control yet — the API is
      unchanged for those callers and the size rule still applies, which
      is what it did before the choice existed.
    */
    const chosenRate =
      body?.rate_per_sqft === undefined || body?.rate_per_sqft === null
        ? null
        : Number(body.rate_per_sqft);
    if (
      chosenRate !== null &&
      (!Number.isFinite(chosenRate) || chosenRate < 0)
    ) {
      return NextResponse.json(
        { error: "The rate must be a number, and cannot be negative." },
        { status: 400 },
      );
    }
    const externalRate =
      body?.external_rate_per_sqft === undefined ||
      body?.external_rate_per_sqft === null
        ? null
        : Number(body.external_rate_per_sqft);
    if (
      externalRate !== null &&
      (!Number.isFinite(externalRate) || externalRate < 0)
    ) {
      return NextResponse.json(
        {
          error:
            "The external areas rate must be a number, and cannot be negative.",
        },
        { status: 400 },
      );
    }

    const overrideReason = String(body?.rate_override_reason ?? "").trim();

    /*
      What the client declared (FR-2.15). Absent — an older caller — the
      unit's own flag stands, which is what this priced against before.
    */
    const declaredFurnished =
      body?.furnished === undefined ? null : Boolean(body.furnished);

    const priced = priceQuotation(full as QuotedProperty, client, config, {
      ratePerSqft: chosenRate,
      externalRatePerSqft: externalRate,
      furnished: declaredFurnished,
      // Booked outside working hours: the surcharge goes on as its own line.
      outOfHours: body?.out_of_hours === true,
    });

    /*
      Leaving the band is allowed, but not silently. The reason is
      required here as well as by the database, so the coordinator is told
      while the form is still open rather than by a 500.
    */
    if (priced.rate_outside_band && !overrideReason) {
      return NextResponse.json(
        {
          error:
            "That rate is outside the published band for this property type. Give a reason — an admin has to approve it before the quotation can be sent.",
        },
        { status: 400 },
      );
    }

    /*
      `quote_number` is deliberately absent: the column's default assigns
      one from a sequence inside the INSERT, so two coordinators quoting at
      the same moment cannot be handed the same number. Naming it here
      would reintroduce the race the default exists to remove.
    */
    const { data, error } = await admin
      .from("snagging_quotations")
      .insert({
        job_id: null,
        client_id: clientId,
        property_id: property.id,
        quote_kind: "inspection",
        ...UNDECIDED,
        ...priced,
        // Who chose the rate, which is the whole point of FR-2.04.
        rate_chosen_by:
          chosenRate !== null || externalRate !== null ? profile.id : null,
        rate_chosen_at:
          chosenRate !== null || externalRate !== null
            ? new Date().toISOString()
            : null,
        rate_override_reason: priced.rate_outside_band ? overrideReason : null,
        created_by: profile.id,
        updated_at: new Date().toISOString(),
      })
      .select(LIST_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    const row = data as unknown as Record<string, unknown> & {
      id: string;
      quote_number: string;
    };

    await recordAudit(admin, {
      entityType: "quotation",
      entityId: row.id,
      eventType: "quotation_generated",
      actorId: profile.id,
      payload: {
        quote_number: row.quote_number,
        total: priced.total,
        currency: priced.currency,
        kind: "inspection",
        rate_per_sqft: priced.rate_per_sqft,
        rate_suggested: priced.rate_suggested,
        external_rate_per_sqft: priced.external_rate_per_sqft,
        external_rate_suggested: priced.external_rate_suggested,
        rate_outside_band: priced.rate_outside_band,
      },
    });

    return NextResponse.json({ data: toWire(row) }, { status: 201 });
  } catch (error) {
    console.error("Snagging quotations POST error:", error);
    return NextResponse.json(
      { error: "Failed to create the quotation" },
      { status: 500 },
    );
  }
}

/**
 * Quotes a return visit to verify fixes on a job already carried out.
 *
 * Refuses on three counts, each of which would otherwise produce a
 * document nobody should act on: a job that does not exist, a property
 * type the card prices as "to be confirmed" (commercial), and a de-snag
 * already quoted and waiting on the client — because two live quotations
 * for one return visit is how a client gets billed twice.
 */
async function desnagQuotation(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  body: Record<string, unknown>,
  config: Awaited<ReturnType<typeof loadPricingConfig>> & object,
  userId: string,
) {
  const sourceJobId = String(body.source_job_id ?? "").trim();
  if (!sourceJobId) {
    return NextResponse.json(
      { error: "Which job is being de-snagged?" },
      { status: 400 },
    );
  }

  const { data: job, error: jobError } = await admin
    .from("snagging_jobs")
    .select(
      `id, code, round_number, client_id, property_id,
       client:client_id(id, name, email, phone),
       property:property_id(${PROPERTY_COLUMNS})`,
    )
    .eq("id", sourceJobId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) {
    return NextResponse.json(
      { error: "That job was not found" },
      { status: 404 },
    );
  }

  // Supabase types an embedded row as an array or an object depending on
  // the relationship it infers; both shapes arrive here in practice.
  const first = (v: unknown): Record<string, unknown> | null =>
    Array.isArray(v)
      ? ((v[0] as Record<string, unknown>) ?? null)
      : ((v as Record<string, unknown>) ?? null);
  const property = first(job.property);
  const client = first(job.client);
  if (!property) {
    return NextResponse.json(
      { error: "That job has no property record to price a de-snag against" },
      { status: 400 },
    );
  }

  // One live de-snag quotation per job. A decided one is history and does
  // not block the next round.
  const { data: existing, error: existingError } = await admin
    .from("snagging_quotations")
    .select("id, quote_number, status")
    .eq("source_job_id", sourceJobId)
    .in("status", ["draft", "sent"]);
  if (existingError) throw new Error(existingError.message);
  if ((existing ?? []).length > 0) {
    const live = existing![0];
    return NextResponse.json(
      {
        error: `De-snag quotation ${live.quote_number} for this job is already ${live.status}. Decide it before raising another.`,
      },
      { status: 409 },
    );
  }

  /*
    The amount, inside the card's de-snagging range for this property
    type -- the same rule the job wizard applies to its rate. A range asks
    for a figure and refuses one outside it; a single published figure is
    simply used. Enforced here as well as in the dialog, because the
    dialog is not the only thing that can reach this route.
  */
  const band = config.rate_card
    ? desnagBand(
        config.rate_card,
        (property.property_type as string) ?? "apartment",
      )
    : null;
  let chosenPrice: number | null = null;
  if (band && band.min !== band.max) {
    const entered = Number(body.price);
    if (
      body.price === undefined ||
      body.price === null ||
      !Number.isFinite(entered)
    ) {
      return NextResponse.json(
        {
          error: `Enter the de-snagging amount, between ${config.currency} ${band.min} and ${band.max}.`,
        },
        { status: 400 },
      );
    }
    if (entered < band.min || entered > band.max) {
      return NextResponse.json(
        {
          error: `The de-snagging amount must be between ${config.currency} ${band.min} and ${band.max} for this property type.`,
        },
        { status: 400 },
      );
    }
    chosenPrice = entered;
  }

  const priced = priceDesnag(
    property as QuotedProperty,
    client as { name?: string | null } | null,
    config,
    {
      round: ((job.round_number as number) ?? 1) + 1,
      price: chosenPrice,
    },
  );
  if (!priced) {
    return NextResponse.json(
      {
        error:
          "The rate card has no de-snagging price for this property type — it reads “to be confirmed”. Set one on the Pricing page first.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await admin
    .from("snagging_quotations")
    .insert({
      job_id: null,
      source_job_id: sourceJobId,
      client_id: job.client_id,
      property_id: job.property_id,
      quote_kind: "desnag",
      ...UNDECIDED,
      ...priced,
      created_by: userId,
      updated_at: new Date().toISOString(),
    })
    .select(LIST_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  const row = data as unknown as Record<string, unknown> & {
    id: string;
    quote_number: string;
  };

  await recordAudit(admin, {
    entityType: "quotation",
    entityId: row.id,
    taskId: sourceJobId,
    eventType: "quotation_generated",
    actorId: userId,
    payload: {
      quote_number: row.quote_number,
      total: priced.total,
      kind: "desnag",
      source_job: job.code,
    },
  });

  return NextResponse.json({ data: toWire(row) }, { status: 201 });
}

/**
 * What a quotation cannot be raised without.
 *
 * The same three the job wizard's property step demands, because they are
 * the same three the document is built from: somebody to send it to, a
 * unit to name on it, and an area to price it from.
 */
function validate(
  body: Record<string, unknown>,
  p: Record<string, unknown>,
): string | null {
  const name = String(p.client_name ?? "").trim();
  const phone = String(p.client_phone ?? "").trim();
  if (!body.client_id && name.length < 2) {
    return "Choose a client on file, or give a name for a new one.";
  }
  if (!body.client_id && phone.length < 5) {
    return "The client needs a phone number the team can reach them on.";
  }
  if (String(p.unit_label ?? "").trim().length === 0) {
    return "The unit reference is required — it is what names the property on the quotation.";
  }
  if (!(Number(p.built_up_area_sqft) > 0)) {
    return "Built-up area is required: the quotation is priced from it.";
  }
  return null;
}

function emptyToNull(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}
