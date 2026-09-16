import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { resolveClient } from "@/lib/server/snagging/client";
import { resolveProperty } from "@/lib/server/snagging/property";
import {
  loadPricingConfig,
  priceDesnag,
  priceQuotation,
  UNDECIDED,
  type QuotedProperty,
} from "@/lib/server/snagging/quotation-build";
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
const LIST_COLUMNS =
  "id, quote_number, status, quote_kind, currency, subtotal, tax_rate, tax_amount, total, " +
  "sent_at, approved_at, decided_at, rejected_reason, created_at, updated_at, " +
  "job_id, source_job_id, client_id, property_id, property_snapshot";

/** Everything quoted, newest first, for the Quotations section. */
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
    const status = req.nextUrl.searchParams.get("status");
    const kind = req.nextUrl.searchParams.get("kind");

    let query = admin
      .from("snagging_quotations")
      .select(
        `${LIST_COLUMNS}, client:client_id(id, name, email, phone),
         job:job_id(id, code, status)`,
      )
      .order("created_at", { ascending: false })
      .limit(400);

    if (status && status !== "all") query = query.eq("status", status);
    if (kind && kind !== "all") query = query.eq("quote_kind", kind);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return NextResponse.json({ data: rows.map(toWire) });
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
      .select("*")
      .eq("id", property.id)
      .single();
    if (propertyError) throw new Error(propertyError.message);

    const { data: client } = await admin
      .from("snagging_clients")
      .select("id, name, email, phone")
      .eq("id", clientId)
      .maybeSingle();

    const priced = priceQuotation(full as QuotedProperty, client, config);

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
       property:property_id(*)`,
    )
    .eq("id", sourceJobId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) {
    return NextResponse.json({ error: "That job was not found" }, { status: 404 });
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

  const priced = priceDesnag(
    property as QuotedProperty,
    client as { name?: string | null } | null,
    config,
    {
      jobCode: job.code as string,
      round: ((job.round_number as number) ?? 1) + 1,
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

/** Flattens the joins into the shape the Quotations screen reads. */
function toWire(row: Record<string, unknown>) {
  type Joined = Record<string, unknown> | Record<string, unknown>[] | null;
  const first = (value: Joined): Record<string, unknown> | null =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

  const client = first(row.client as Joined);
  const job = first(row.job as Joined);
  const snapshot = (row.property_snapshot ?? {}) as Record<string, unknown>;

  return {
    ...row,
    client: undefined,
    job: undefined,
    client_name: (client?.name as string) ?? (snapshot.client_name as string) ?? null,
    client_email: (client?.email as string) ?? (snapshot.client_email as string) ?? null,
    client_phone: (client?.phone as string) ?? (snapshot.client_phone as string) ?? null,
    job_code: (job?.code as string) ?? null,
    job_status: (job?.status as string) ?? null,
    unit_label: (snapshot.unit_label as string) ?? null,
    building_name: (snapshot.building_name as string) ?? null,
  };
}

function emptyToNull(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}
