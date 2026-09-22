import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { sendEmail } from "@/lib/server/send-email";
import { recordAudit } from "@/lib/server/snagging/audit";
import { resolveClient } from "@/lib/server/snagging/client";
import {
  PROPERTY_COLUMNS,
  resolveProperty,
} from "@/lib/server/snagging/property";
import {
  loadPricingConfig,
  priceQuotation,
  UNDECIDED,
  type QuotedProperty,
} from "@/lib/server/snagging/quotation-build";
import {
  approveQuotation,
  QUOTATION_COLUMNS,
  QuotationDecisionError,
  rejectQuotation,
  type QuoteRef,
} from "@/lib/server/snagging/quotation";
import { mintReportToken } from "@/lib/server/snagging/report-token";
import { ActionType, ResourceType } from "@/types/types";

/**
 * One quotation raised from the Quotations section (BA v2, changes 1-3).
 *
 * The same verbs the job's own quotation tab offers — send, share a link,
 * approve, reject, regenerate — against a quotation that has no job yet.
 * Approve and reject go through the shared decision helpers, so a client
 * approving from their emailed link and a coordinator recording the
 * decision here still write the identical record.
 *
 * There is no "create job" verb. The job is built in the wizard, from the
 * client and property this quotation already carries (change 3), so that
 * the team adds the floor plans, areas and contacts as they go rather than
 * finding a half-made job waiting for them.
 */
type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who may sign off pricing that left the published band (FR-2.04).
 *
 * An admin, or the approval manager of the job this quotation belongs to
 * — Sharon's answer on 16 September. The manager is the person already
 * accountable for that job's money, and requiring a system admin for
 * every off-band villa would put a queue in front of work somebody
 * closer to it can judge.
 *
 * A quotation raised BEFORE its job exists (changes 1-3) has no manager
 * to ask, so an admin is the only route there. That is a real gap rather
 * than an oversight: until the job exists, nobody has been made
 * accountable for it.
 */
async function mayApproveRate(
  admin: Admin,
  user: Parameters<typeof isAdminUser>[0],
  userId: string,
  quote: Record<string, unknown>,
): Promise<boolean> {
  if (isAdminUser(user)) return true;

  const jobId = quote.job_id as string | null;
  if (!jobId) return false;

  const { data, error } = await admin
    .from("snagging_jobs")
    .select("approval_manager_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.approval_manager_id === userId;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();
    const quote = await load(admin, id);
    if (!quote)
      return NextResponse.json(
        { error: "Quotation not found" },
        { status: 404 },
      );

    /*
      Computed here rather than left to the client to work out: the
      approval manager lives on the JOB, so a page holding only the
      quotation cannot answer it, and a second round trip to find out
      whether to draw a button is a poor trade.
    */
    const sent = { ...quote };
    delete sent.rate_chosen_by;
    delete sent.rate_chosen_at;
    return NextResponse.json({
      data: {
        ...sent,
        can_approve_rate: await mayApproveRate(
          admin,
          accessUser,
          profile.id,
          quote,
        ),
        /*
          The LIVE client and property, beside the snapshot the document
          was built from.

          The snapshot is frozen on purpose (FR-2.03) and is what the PDF
          renders, but it is the wrong thing to edit from: it holds five
          of the property's fields, not the plot area or the pin, and it
          reports the unit as it was rather than as it is. An edit form
          filled from it would quietly revert whatever it could not see.
        */
        ...(await records(admin, quote)),
      },
    });
  } catch (error) {
    console.error("Snagging quotation GET error:", error);
    return NextResponse.json(
      { error: "Failed to load the quotation" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const admin = await createAdminServerClient();

    const quote = await load(admin, id);
    if (!quote)
      return NextResponse.json(
        { error: "Quotation not found" },
        { status: 404 },
      );

    const ref: QuoteRef = {
      id: quote.id as string,
      job_id: (quote.job_id as string | null) ?? null,
      quote_number: quote.quote_number as string,
      status: quote.status as string,
    };

    /*
      FR-2.04 — an off-band rate cannot reach a client until an admin says
      so.

      Checked on the two actions that put the document in front of one:
      sending it, and issuing the share link. Saving a draft at an
      unusual rate is a proposal somebody is still thinking about;
      sending it is the promise, and that is the moment worth gating.
    */
    if (
      (action === "send" || action === "share_link") &&
      quote.rate_outside_band === true &&
      !quote.rate_approved_at
    ) {
      return NextResponse.json(
        {
          error:
            "This quotation is priced outside the published band and is waiting on an admin. Ask for approval before sending it to the client.",
        },
        { status: 409 },
      );
    }

    /*
      The approval itself. Separate from approving the QUOTATION, which is
      the client's decision — this one is internal, and it is about the
      price being allowed rather than the work being agreed.
    */
    if (action === "approve_rate") {
      if (!(await mayApproveRate(admin, accessUser, profile.id, quote))) {
        return NextResponse.json(
          {
            error:
              "Only an admin or this job's approval manager can approve pricing outside the published band.",
          },
          { status: 403 },
        );
      }
      if (quote.rate_outside_band !== true) {
        return NextResponse.json(
          {
            error:
              "This quotation is priced inside the band, so it needs no approval.",
          },
          { status: 409 },
        );
      }
      const { data: approved, error: approveError } = await admin
        .from("snagging_quotations")
        .update({
          rate_approved_by: profile.id,
          rate_approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select(QUOTATION_COLUMNS)
        .single();
      if (approveError) throw new Error(approveError.message);

      await recordAudit(admin, {
        entityType: "quotation",
        entityId: id,
        eventType: "quotation_rate_approved",
        actorId: profile.id,
        payload: {
          quote_number: quote.quote_number,
          rate_per_sqft: quote.rate_per_sqft,
          rate_suggested: quote.rate_suggested,
          reason: quote.rate_override_reason,
        },
      });

      return NextResponse.json({ data: approved });
    }

    try {
      if (action === "send") return await send(admin, quote, profile.id, body);
      if (action === "share_link")
        return await shareLink(admin, quote, profile.id);
      if (action === "regenerate")
        return await regenerate(admin, quote, profile.id);
      if (action === "approve") {
        const data = await approveQuotation(admin, ref, {
          name: body.approved_by_name ?? null,
          actorId: profile.id,
          origin: "portal",
        });
        return NextResponse.json({ data });
      }
      if (action === "reject") {
        const data = await rejectQuotation(admin, ref, {
          reason: String(body.reason ?? "").trim() || "No reason given",
          actorId: profile.id,
          origin: "portal",
        });
        return NextResponse.json({ data });
      }
    } catch (error) {
      if (error instanceof QuotationDecisionError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status },
        );
      }
      throw error;
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Snagging quotation POST error:", error);
    return NextResponse.json(
      { error: "Failed to update the quotation" },
      { status: 500 },
    );
  }
}

/**
 * Corrects a quotation that has not gone out yet.
 *
 * A draft is a document the team is still writing, so a mistyped area or
 * the wrong tower should be fixable in place rather than by raising a
 * second quotation and leaving the first one lying around with a number
 * against it. The moment it is SENT that stops being true: somebody
 * outside the company has read it, and editing it underneath them would
 * leave the client holding figures the system no longer agrees with.
 *
 * Writes through to the client and property records, not just the
 * quotation, because those are what the document is priced from — a
 * correction that lived only on the quotation would be undone by the
 * next Regenerate.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();
    const quote = await load(admin, id);
    if (!quote)
      return NextResponse.json(
        { error: "Quotation not found" },
        { status: 404 },
      );

    if (quote.status !== "draft") {
      return NextResponse.json(
        {
          error:
            quote.status === "sent"
              ? "This quotation has already been sent to the client, so it can no longer be edited. Raise a new one instead."
              : "This quotation has been decided, so it can no longer be edited.",
        },
        { status: 409 },
      );
    }

    /*
      A de-snag is priced from its original job, not from a property form
      (change 31), so there is nothing here to edit. Refusing says that
      plainly rather than silently repricing it as an inspection.
    */
    if (quote.quote_kind === "desnag") {
      return NextResponse.json(
        {
          error:
            "A de-snagging quotation is priced from its original job. Regenerate it there rather than editing it here.",
        },
        { status: 409 },
      );
    }

    /*
      Nor is a visit's. It is a fixed charge per visit (change 30), so
      there is no property figure on it to correct — and repricing it
      through the property form would turn a flat AED 500 into an
      inspection priced by the square foot.
    */
    if (quote.quote_kind === "visit") {
      return NextResponse.json(
        {
          error:
            "An additional visit is a fixed charge, so its quotation has nothing to edit. Cancel it on the job and raise a new one if the visit changed.",
        },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const p = (body?.property ?? {}) as Record<string, unknown>;

    const gate = validateQuoted(body, p);
    if (gate) return NextResponse.json({ error: gate }, { status: 400 });

    const config = await loadPricingConfig(admin);
    if (!config) {
      return NextResponse.json(
        { error: "Pricing is not configured yet" },
        { status: 400 },
      );
    }

    /*
      The client. An id from the picker repoints the quotation at somebody
      else; without one the typed details are the correction, and they are
      written to the record this quotation already belongs to rather than
      creating a second copy of the same person.
    */
    const picked = (body.client_id as string) ?? null;
    const previous = (quote.client_id as string) ?? null;
    let clientId: string;
    if (picked && picked !== previous) {
      clientId = picked;
    } else if (previous) {
      clientId = previous;
      const { error: clientError } = await admin
        .from("snagging_clients")
        .update({
          name: String(p.client_name ?? "").trim() || null,
          email: text(p.client_email),
          phone: text(p.client_phone),
          updated_at: new Date().toISOString(),
        })
        .eq("id", previous);
      if (clientError) throw new Error(clientError.message);
    } else {
      clientId = await resolveClient(admin, {
        clientId: null,
        name: String(p.client_name ?? "").trim(),
        email: text(p.client_email),
        phone: text(p.client_phone),
        createdBy: profile.id,
      });
    }

    // The property record this was quoted for, updated in place.
    const property = await resolveProperty(admin, {
      propertyId: (quote.property_id as string) ?? null,
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

    const chosenRate = optionalRate(body?.rate_per_sqft);
    if (chosenRate === false) {
      return NextResponse.json(
        { error: "The rate must be a number, and cannot be negative." },
        { status: 400 },
      );
    }
    const externalRate = optionalRate(body?.external_rate_per_sqft);
    if (externalRate === false) {
      return NextResponse.json(
        {
          error:
            "The external areas rate must be a number, and cannot be negative.",
        },
        { status: 400 },
      );
    }

    const priced = priceQuotation(full as QuotedProperty, client, config, {
      ratePerSqft: chosenRate,
      externalRatePerSqft: externalRate,
      furnished: body?.furnished === undefined ? null : Boolean(body.furnished),
      // Absent from an older caller: keep what the quotation already had.
      outOfHours:
        body?.out_of_hours === undefined
          ? quote.out_of_hours === true
          : Boolean(body.out_of_hours),
    });

    /*
      A reason already on the row still counts: the rate it was given for
      is the one being saved unless the coordinator moved it.
    */
    const reason =
      String(body?.rate_override_reason ?? "").trim() ||
      String(quote.rate_override_reason ?? "").trim();
    if (priced.rate_outside_band && !reason) {
      return NextResponse.json(
        {
          error:
            "That rate is outside the published band for this property type. Give a reason — an admin has to approve it before the quotation can be sent.",
        },
        { status: 400 },
      );
    }

    /*
      An approval covers the price it was given for, not the next one. If
      the figure moved, the sign-off goes with it and an admin looks
      again — otherwise editing a rate after approval would be a way of
      sending whatever you liked.
    */
    const rateMoved =
      Number(quote.rate_per_sqft ?? NaN) !==
        Number(priced.rate_per_sqft ?? NaN) ||
      Number(quote.external_rate_per_sqft ?? NaN) !==
        Number(priced.external_rate_per_sqft ?? NaN);

    const { data, error } = await admin
      .from("snagging_quotations")
      .update({
        client_id: clientId,
        property_id: property.id,
        ...UNDECIDED,
        ...priced,
        rate_chosen_by:
          chosenRate !== null || externalRate !== null
            ? profile.id
            : (quote.rate_chosen_by as string | null),
        rate_chosen_at:
          chosenRate !== null || externalRate !== null
            ? new Date().toISOString()
            : (quote.rate_chosen_at as string | null),
        rate_override_reason: priced.rate_outside_band ? reason : null,
        ...(rateMoved || !priced.rate_outside_band
          ? { rate_approved_by: null, rate_approved_at: null }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(QUOTATION_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    await recordAudit(admin, {
      entityType: "quotation",
      entityId: id,
      eventType: "quotation_edited",
      actorId: profile.id,
      payload: {
        quote_number: quote.quote_number,
        total_before: quote.total,
        total_after: priced.total,
        rate_before: quote.rate_per_sqft,
        rate_after: priced.rate_per_sqft,
        client_changed: clientId !== previous,
      },
    });

    return NextResponse.json({
      data: {
        ...data,
        can_approve_rate: await mayApproveRate(
          admin,
          accessUser,
          profile.id,
          data,
        ),
        ...(await records(admin, data)),
      },
    });
  } catch (error) {
    console.error("Snagging quotation PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to save the quotation" },
      { status: 500 },
    );
  }
}

/** The live client and property behind a quotation, for the edit form. */
async function records(admin: Admin, quote: Record<string, unknown>) {
  const propertyId = quote.property_id as string | null;
  const clientId = quote.client_id as string | null;

  const [property, client] = await Promise.all([
    propertyId
      ? admin
          .from("snagging_properties")
          .select(PROPERTY_COLUMNS)
          .eq("id", propertyId)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
    clientId
      ? admin
          .from("snagging_clients")
          .select("id, name, email, phone")
          .eq("id", clientId)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);

  return { property, client };
}

/**
 * The three a quotation cannot be built without.
 *
 * Deliberately the same three the create route demands, written out here
 * rather than imported across route files: somebody to send it to, a unit
 * to name on it, and an area to price it from.
 */
function validateQuoted(
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

/** A rate the caller may have left out. `false` means "sent, but wrong". */
function optionalRate(value: unknown): number | null | false {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : false;
}

function text(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

/* The page's columns, plus who chose the rate: the edit keeps that when
   the rate is unchanged, and GET leaves it out. */
const LOAD_COLUMNS = `${QUOTATION_COLUMNS}, rate_chosen_by, rate_chosen_at`;

async function load(admin: Admin, id: string) {
  const { data, error } = await admin
    .from("snagging_quotations")
    .select<string, Record<string, unknown>>(LOAD_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

/**
 * Emails the quotation, writing before sending.
 *
 * The ordering is the one change 35 established on the job-scoped route
 * and it matters just as much here: the approval link in the email is only
 * real once its hash is stored, so storing it second means a failed write
 * sends the client a link that can never validate.
 */
async function send(
  admin: Admin,
  quote: Record<string, unknown>,
  actorId: string,
  body: Record<string, unknown>,
) {
  if (quote.status === "approved" || quote.status === "rejected") {
    return NextResponse.json(
      { error: "This quotation has already been decided" },
      { status: 409 },
    );
  }

  const snap = (quote.property_snapshot ?? {}) as Record<string, unknown>;
  const recipient = String(body.sent_to ?? snap.client_email ?? "").trim();
  if (!EMAIL_RE.test(recipient)) {
    return NextResponse.json(
      { error: "A valid client email is required to send the quotation" },
      { status: 400 },
    );
  }

  const token = mintReportToken();
  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const approvalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/quote/${token.raw}`;
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("snagging_quotations")
    .update({
      status: "sent",
      sent_at: now,
      sent_to: recipient,
      approval_token_hash: token.hash,
      approval_token_expires_at: expiresAt,
      updated_at: now,
    })
    .eq("id", quote.id as string)
    .select(QUOTATION_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  try {
    await sendEmail({
      to: recipient,
      subject: `Yalla Fix It Quotation #${quote.quote_number}`,
      html: quotationEmailHtml({
        clientName: (snap.client_name as string) ?? "there",
        quoteNumber: quote.quote_number as string,
        unit:
          [snap.unit_label, snap.building_name].filter(Boolean).join(", ") ||
          "your property",
        total: `${quote.currency} ${Number(quote.total).toLocaleString("en-AE", { minimumFractionDigits: 2 })}`,
        approvalUrl,
      }),
      attachment:
        typeof body.pdf_base64 === "string"
          ? {
              filename: `Quotation-${quote.quote_number}.pdf`,
              content: body.pdf_base64,
              contentType: "application/pdf",
            }
          : undefined,
    });
  } catch (sendError) {
    await admin
      .from("snagging_quotations")
      .update({
        status: quote.status as string,
        sent_at: (quote.sent_at as string) ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quote.id as string);

    const reason =
      sendError instanceof Error ? sendError.message : "Unknown error";
    console.error("Quotation email failed:", reason);
    return NextResponse.json(
      { error: `The quotation was not sent: ${reason}` },
      { status: 502 },
    );
  }

  await recordAudit(admin, {
    entityType: "quotation",
    entityId: quote.id as string,
    eventType: "quotation_sent",
    actorId,
    payload: { quote_number: quote.quote_number, recipient },
  });

  return NextResponse.json({ data: { ...data, approval_url: approvalUrl } });
}

/** An approval link with no email, for the WhatsApp route (change 24). */
async function shareLink(
  admin: Admin,
  quote: Record<string, unknown>,
  actorId: string,
) {
  if (quote.status === "approved" || quote.status === "rejected") {
    return NextResponse.json(
      { error: "This quotation has already been decided" },
      { status: 409 },
    );
  }

  const token = mintReportToken();
  const now = new Date().toISOString();
  const approvalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/quote/${token.raw}`;

  const { data, error } = await admin
    .from("snagging_quotations")
    .update({
      status: "sent",
      sent_at: (quote.sent_at as string) ?? now,
      approval_token_hash: token.hash,
      approval_token_expires_at: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      updated_at: now,
    })
    .eq("id", quote.id as string)
    .select(QUOTATION_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  await recordAudit(admin, {
    entityType: "quotation",
    entityId: quote.id as string,
    eventType: "quotation_link_shared",
    actorId,
    payload: { quote_number: quote.quote_number, channel: "manual" },
  });

  return NextResponse.json({ data: { ...data, approval_url: approvalUrl } });
}

/**
 * Reprices a draft against the current rate card.
 *
 * Drafts only. A sent quotation has been read by somebody and an approved
 * one is an agreement; silently restating either at a new price is how a
 * client ends up holding a document the system no longer agrees with.
 */
async function regenerate(
  admin: Admin,
  quote: Record<string, unknown>,
  actorId: string,
) {
  if (quote.status !== "draft") {
    return NextResponse.json(
      { error: "Only a draft quotation can be regenerated" },
      { status: 409 },
    );
  }
  /*
    A visit's quotation is a fixed charge per visit (change 30). Repricing
    it from the property would turn a flat AED 500 into an inspection
    priced by the square foot.
  */
  if (quote.quote_kind === "visit") {
    return NextResponse.json(
      {
        error:
          "An additional visit is a fixed charge, so its quotation is not regenerated. Cancel it on the job and raise a new one if the visit changed.",
      },
      { status: 409 },
    );
  }

  /*
    Nor a de-snag. It is priced at the amount chosen inside the card's
    de-snagging range, and regenerating ran it through the INSPECTION
    pricer -- turning a return visit into a per-square-foot inspection of
    the whole unit. Raise a new one at a different amount instead.
  */
  if (quote.quote_kind === "desnag") {
    return NextResponse.json(
      {
        error:
          "A de-snag quotation is priced at the amount chosen for it, so it is not regenerated. Raise a new de-snag quotation for a different amount.",
      },
      { status: 409 },
    );
  }

  const config = await loadPricingConfig(admin);
  if (!config) {
    return NextResponse.json(
      { error: "Pricing is not configured yet" },
      { status: 400 },
    );
  }

  const { data: property, error: propertyError } = await admin
    .from("snagging_properties")
    .select(PROPERTY_COLUMNS)
    .eq("id", quote.property_id as string)
    .maybeSingle();
  if (propertyError) throw new Error(propertyError.message);
  if (!property) {
    return NextResponse.json(
      { error: "The property this was quoted for no longer exists" },
      { status: 400 },
    );
  }

  const { data: client } = await admin
    .from("snagging_clients")
    .select("id, name, email, phone")
    .eq("id", quote.client_id as string)
    .maybeSingle();

  /*
    Repriced against today's card, but with this quotation's own
    declarations: whether the client said furnished, and whether the visit
    is out of hours. Leaving them out repriced a furnished quotation at the
    unit's flag and dropped an out-of-hours surcharge nobody had removed.
  */
  const priced = priceQuotation(property as QuotedProperty, client, config, {
    furnished: typeof quote.furnished === "boolean" ? quote.furnished : null,
    outOfHours: quote.out_of_hours === true,
  });

  const { data, error } = await admin
    .from("snagging_quotations")
    .update({ ...UNDECIDED, ...priced, updated_at: new Date().toISOString() })
    .eq("id", quote.id as string)
    .select(QUOTATION_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  await recordAudit(admin, {
    entityType: "quotation",
    entityId: quote.id as string,
    eventType: "quotation_regenerated",
    actorId,
    payload: { quote_number: quote.quote_number, total: priced.total },
  });

  return NextResponse.json({ data });
}

/** The same note the job-scoped send writes, so both inboxes match. */
function quotationEmailHtml(opts: {
  clientName: string;
  quoteNumber: string;
  unit: string;
  total: string;
  approvalUrl: string;
}): string {
  return clientEmailHtml({
    eyebrow: "Snagging quotation",
    heading: "Your snagging quotation",
    greeting: `Dear ${opts.clientName},`,
    paragraphs: [
      `Thank you for choosing Yalla Fix It. Please find attached your snagging inspection quotation <strong>#${escapeEmailHtml(opts.quoteNumber)}</strong> for <strong>${escapeEmailHtml(opts.unit)}</strong>.`,
      "Review the quotation and approve it, or tell us what you would like changed.",
    ],
    details: [
      { label: "Quotation", value: `#${opts.quoteNumber}` },
      { label: "Property", value: opts.unit },
      { label: "Total", value: opts.total },
    ],
    cta: { label: "Review and approve", url: opts.approvalUrl },
    footnote:
      "This private link is valid for 30 days. Please don't share it. The quotation is also attached as a PDF.",
  });
}
