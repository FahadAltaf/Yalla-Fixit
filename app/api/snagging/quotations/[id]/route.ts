import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { emailMasthead } from "@/lib/email-brand";
import { sendEmail } from "@/lib/server/send-email";
import { recordAudit } from "@/lib/server/snagging/audit";
import {
  loadPricingConfig,
  priceQuotation,
  UNDECIDED,
  type QuotedProperty,
} from "@/lib/server/snagging/quotation-build";
import {
  approveQuotation,
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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();
    const quote = await load(admin, id);
    if (!quote)
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 });

    return NextResponse.json({ data: quote });
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
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const admin = await createAdminServerClient();

    const quote = await load(admin, id);
    if (!quote)
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 });

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
      if (!isAdminUser(accessUser)) {
        return NextResponse.json(
          { error: "Only an admin can approve a rate outside the published band." },
          { status: 403 },
        );
      }
      if (quote.rate_outside_band !== true) {
        return NextResponse.json(
          { error: "This quotation is priced inside the band, so it needs no approval." },
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
        .select("*")
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
      if (action === "share_link") return await shareLink(admin, quote, profile.id);
      if (action === "regenerate") return await regenerate(admin, quote, profile.id);
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

async function load(admin: Admin, id: string) {
  const { data, error } = await admin
    .from("snagging_quotations")
    .select("*")
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
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
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
    .select("*")
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

    const reason = sendError instanceof Error ? sendError.message : "Unknown error";
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
    .select("*")
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

  const config = await loadPricingConfig(admin);
  if (!config) {
    return NextResponse.json(
      { error: "Pricing is not configured yet" },
      { status: 400 },
    );
  }

  const { data: property, error: propertyError } = await admin
    .from("snagging_properties")
    .select("*")
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

  const priced = priceQuotation(property as QuotedProperty, client, config);

  const { data, error } = await admin
    .from("snagging_quotations")
    .update({ ...UNDECIDED, ...priced, updated_at: new Date().toISOString() })
    .eq("id", quote.id as string)
    .select("*")
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
  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #1f2937;">
      ${emailMasthead()}
      <h2 style="margin: 0 0 12px; font-size: 18px;">Your snagging quotation</h2>
      <p style="margin: 0 0 16px;">Dear ${opts.clientName},</p>
      <p style="margin: 0 0 16px;">
        Please find attached quotation <strong>#${opts.quoteNumber}</strong> for
        <strong>${opts.unit}</strong>, totalling <strong>${opts.total}</strong>.
      </p>
      <a href="${opts.approvalUrl}" style="display: inline-block; background: #83201e; color: #ffffff; padding: 12px 18px; border-radius: 6px; text-decoration: none;">Review and approve</a>
      <p style="margin: 16px 0 0; font-size: 12px; color: #6b7280;">
        This link is valid for 30 days.
      </p>
    </div>
  `;
}
