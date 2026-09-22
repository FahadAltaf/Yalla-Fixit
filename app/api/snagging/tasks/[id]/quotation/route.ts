import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { sendEmail } from "@/lib/server/send-email";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { recordAudit } from "@/lib/server/snagging/audit";
import {
  computeQuotation,
  type PricingConfig,
  type QuoteJob,
} from "@/lib/server/snagging/pricing";
import {
  approveQuotation,
  QUOTATION_DOCUMENT_COLUMNS,
  QuotationDecisionError,
  rejectQuotation,
  type QuoteRef,
} from "@/lib/server/snagging/quotation";
import { PRICING_CONFIG_COLUMNS } from "@/lib/server/snagging/quotation-build";
import { mintReportToken } from "@/lib/server/snagging/report-token";
import { ActionType, ResourceType } from "@/types/types";

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

/** The job's current quotation. */
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
    const quote = await latestQuote(admin, id);

    /*
      No quotation yet, and the caller asked what one would look like.

      The Quotation tab opens on the document rather than on a button, so
      a job that has never been quoted still needs something to show. This
      prices the job through the very same computeQuotation() the generate
      action uses, and persists nothing — so the preview cannot say one
      figure and the generated quotation another.
    */
    if (!quote && req.nextUrl.searchParams.get("preview") === "1") {
      return previewQuotation(admin, id);
    }

    return NextResponse.json({ data: quote });
  } catch (error) {
    console.error("Snagging quotation GET error:", error);
    return NextResponse.json(
      { error: "Failed to load the quotation" },
      { status: 500 },
    );
  }
}

/**
 * Generate / send / approve / reject the quotation for a job.
 * Approving unlocks inspector assignment (F6/BR-2): a draft job becomes
 * assigned only once its quotation is approved.
 */
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
    const action = String(body.action ?? "generate");
    const declaredFurnished =
      body.furnished === undefined ? null : Boolean(body.furnished);
    const admin = await createAdminServerClient();

    if (action === "generate")
      return generate(admin, id, profile.id, declaredFurnished);
    if (action === "send") return send(admin, id, profile.id, body);
    if (action === "share_link") return shareLink(admin, id, profile.id);
    if (action === "approve")
      return approve(admin, id, profile.id, {
        name: body.approved_by_name ?? null,
        internal: true,
      });
    if (action === "reject")
      return reject(admin, id, profile.id, {
        reason: body.reason ?? null,
        name: null,
        internal: true,
      });

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Snagging quotation POST error:", error);
    return NextResponse.json(
      { error: "Failed to update the quotation" },
      { status: 500 },
    );
  }
}

async function latestQuote(admin: Admin, jobId: string) {
  /*
      The inspection's own quotation, not a visit's.

      An additional visit's quotation is raised from this job and carries
      its job_id (change 26), so "the newest quotation on the job" became
      the visit's the moment one existed — and the inspection's tab, its
      client report and its inspector gate all started reading a AED 500
      return trip as if it were the agreement for the inspection.
    */
  const { data, error } = await admin
    .from("snagging_quotations")
    .select(QUOTATION_DOCUMENT_COLUMNS)
    .eq("job_id", jobId)
    .neq("quote_kind", "visit")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function generate(
  admin: Admin,
  jobId: string,
  userId: string,
  /*
    What the client declared for this quotation (FR-2.15). Null when the
    caller does not offer the control, in which case the unit's own flag
    stands — which is what this priced against before.
  */
  declaredFurnished: boolean | null = null,
) {
  const [{ data: job, error: jobError }, { data: config, error: configError }] =
    await Promise.all([
      admin
        .from("snagging_jobs")
        .select(
          `id, code, client:client_id(id, name, email, phone),
         property:property_id(property_type, furnished, built_up_area_sqft, plot_area_sqft, external_areas_in_scope,
           bedrooms, unit_label, building_name, community, developer_name)`,
        )
        .eq("id", jobId)
        .maybeSingle(),
      admin
        .from("snagging_pricing_config")
        .select(PRICING_CONFIG_COLUMNS)
        .eq("id", true)
        .maybeSingle(),
    ]);
  if (jobError) throw new Error(jobError.message);
  if (!job)
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (configError) throw new Error(configError.message);
  if (!config)
    return NextResponse.json(
      { error: "Pricing is not configured yet" },
      { status: 400 },
    );

  // Pricing inputs live on the property record now (BR-1).
  const jobRow = job as {
    code: string;
    property: PropertyRow | PropertyRow[] | null;
    client: ClientRow | ClientRow[] | null;
  };
  const property = (
    Array.isArray(jobRow.property) ? jobRow.property[0] : jobRow.property
  ) as PropertyRow | null;
  const client = (
    Array.isArray(jobRow.client) ? jobRow.client[0] : jobRow.client
  ) as ClientRow | null;
  if (!property) {
    return NextResponse.json(
      { error: "This job has no property to price yet" },
      { status: 400 },
    );
  }
  const cfg = config as PricingConfig & { currency: string };
  const furnished =
    declaredFurnished != null
      ? declaredFurnished
      : (property.furnished ?? false);
  const priced = computeQuotation(
    { ...(property as QuoteJob), furnished },
    cfg,
  );

  // Snapshot the exact property + pricing used, so this quotation stays
  // reproducible and immune to later config changes (FR-2.03, §10).
  const propertySnapshot = {
    unit_label: property.unit_label ?? null,
    building_name: property.building_name ?? null,
    community: property.community ?? null,
    developer_name: property.developer_name ?? null,
    property_type: property.property_type ?? null,
    // The declaration this document was priced with, frozen onto it.
    furnished,
    bedrooms: property.bedrooms ?? null,
    built_up_area_sqft: property.built_up_area_sqft ?? null,
    client_name: client?.name ?? null,
    client_email: client?.email ?? null,
    client_phone: client?.phone ?? null,
    client_ref: client?.id ?? null,
  };
  /*
    The card as it stood when this quotation was priced (FR-2.03, §10).

    Snapshotted whole rather than as the few figures that happened to be
    used, so a quotation issued today still reprices identically after
    Operations moves a band tomorrow.
  */
  const pricingSnapshot = {
    rate_card: cfg.rate_card,
    out_of_hours_percent: cfg.out_of_hours_percent,
    tax_rate: cfg.tax_rate,
    currency: cfg.currency,
  };

  // One live quote per job: refresh a draft in place, otherwise open a new one.
  const existing = await latestQuote(admin, jobId);
  const reuseDraft = existing && existing.status === "draft";
  const quoteNumber = reuseDraft
    ? existing!.quote_number
    : `${(job as { code: string }).code}-Q${(await quoteCount(admin, jobId)) + 1}`;

  const row = {
    ...(reuseDraft ? { id: existing!.id } : {}),
    job_id: jobId,
    quote_number: quoteNumber,
    status: "draft" as const,
    currency: priced.currency,
    subtotal: priced.subtotal,
    tax_rate: priced.tax_rate,
    tax_amount: priced.tax_amount,
    total: priced.total,
    scope_of_work: (config as PricingConfig).scope_of_work,
    terms: (config as PricingConfig).terms,
    lines: priced.lines,
    // The client's declaration, on the document it priced (FR-2.15).
    furnished,
    property_snapshot: propertySnapshot,
    pricing_snapshot: pricingSnapshot,
    // Regenerating always returns to an unsent, undecided draft.
    sent_at: null,
    sent_to: null,
    approved_at: null,
    decided_at: null,
    approved_by_name: null,
    approved_by_contact: null,
    rejected_reason: null,
    approval_token_hash: null,
    approval_token_expires_at: null,
    email_message_id: null,
    created_by: userId,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("snagging_quotations")
    .upsert(row, { onConflict: "id" })
    .select(QUOTATION_DOCUMENT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  await recordAudit(admin, {
    entityType: "task",
    entityId: jobId,
    taskId: jobId,
    eventType: reuseDraft ? "quotation_regenerated" : "quotation_generated",
    actorId: userId,
    payload: {
      quote_number: quoteNumber,
      total: priced.total,
      currency: priced.currency,
    },
  });

  return NextResponse.json({ data });
}

type PropertyRow = QuoteJob & {
  unit_label?: string | null;
  building_name?: string | null;
  community?: string | null;
  developer_name?: string | null;
};
type ClientRow = {
  id?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

async function quoteCount(admin: Admin, jobId: string): Promise<number> {
  const { count } = await admin
    .from("snagging_quotations")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .neq("quote_kind", "visit");
  return count ?? 0;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * An approval link, without sending anything (BA v2, change 24).
 *
 * The team sends quotations on WhatsApp as well as by email, and WhatsApp
 * is sent by hand — they download the PDF and paste the approval link into
 * the chat themselves. There was no way to get that link: it was minted
 * inside `send`, so the only route to a WhatsApp quotation ran through
 * emailing the client first.
 *
 * This mints and stores one, and marks the quotation sent, because from
 * the client's side it is: they are about to receive it. `sent_to` is left
 * alone rather than filled with an address nothing was posted to.
 *
 * Each call issues a NEW token and the previous link stops working. That
 * is the honest behaviour — only the hash is stored, so an existing link
 * cannot be shown again — and the caller warns before replacing one.
 */
async function shareLink(admin: Admin, jobId: string, actorId: string) {
  const quote = await latestQuote(admin, jobId);
  if (!quote)
    return NextResponse.json(
      { error: "Generate a quotation first" },
      { status: 400 },
    );
  if (quote.status === "approved" || quote.status === "rejected") {
    return NextResponse.json(
      { error: "This quotation has already been decided" },
      { status: 409 },
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
      sent_at: quote.sent_at ?? now,
      approval_token_hash: token.hash,
      approval_token_expires_at: expiresAt,
      updated_at: now,
    })
    .eq("id", quote.id)
    .select(QUOTATION_DOCUMENT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  await recordAudit(admin, {
    entityType: "task",
    entityId: jobId,
    taskId: jobId,
    eventType: "quotation_link_shared",
    actorId,
    payload: { quote_number: quote.quote_number, channel: "manual" },
  });

  return NextResponse.json({ data: { ...data, approval_url: approvalUrl } });
}

/**
 * Emails the quotation to the client via Resend with the PDF attached and a
 * secure approve/reject link, then marks it sent (FR-2.06). The PDF is
 * generated in the coordinator's browser and posted here as base64.
 *
 * The database write happens BEFORE the email, and that ordering is the
 * whole point (BA v2, change 35).
 *
 * It used to run the other way round: mint a token, email the client a link
 * built from it, then store the token's hash. Two things went wrong with
 * that. The email call is a server-to-self HTTP request that measured 30
 * seconds in Sami's log, so by the time the update ran the request had been
 * open long enough for the connection underneath it to be gone — `fetch
 * failed`, a 500 at 46 seconds, and the coordinator told "Send request
 * failed" about an email the client had already received. Worse, the hash
 * never landed, so the approval link in that email could never validate.
 * The client held a dead link to a quotation the system still believed had
 * never been sent.
 *
 * Writing first fixes both. The token is valid the moment the link exists,
 * and the Supabase call is made at the top of the request rather than at
 * the end of a minute-long one. If the email is then refused, the status
 * goes back to where it was and the caller gets the real reason.
 */
async function send(
  admin: Admin,
  jobId: string,
  actorId: string,
  body: Record<string, unknown>,
) {
  const quote = await latestQuote(admin, jobId);
  if (!quote)
    return NextResponse.json(
      { error: "Generate a quotation first" },
      { status: 400 },
    );
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
  const pdfBase64 =
    typeof body.pdf_base64 === "string" ? body.pdf_base64 : null;

  const token = mintReportToken();
  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const approvalUrl = `${baseUrl}/quote/${token.raw}`;

  // 1. Make the link real, and record the send, while the request is still
  //    young. Nothing in the email is valid until this row says so.
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
    .eq("id", quote.id)
    .select(QUOTATION_DOCUMENT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  // 2. Send it. A refusal here is the one case that has to undo step 1 —
  //    the client has nothing, so the quotation must not claim otherwise.
  let messageId: string | null = null;
  try {
    const res = await sendEmail({
      to: recipient,
      subject: `Yalla Fix It Quotation #${quote.quote_number}`,
      html: quotationEmailHtml({
        clientName: (snap.client_name as string) ?? "there",
        quoteNumber: quote.quote_number,
        unit:
          [snap.unit_label, snap.building_name].filter(Boolean).join(", ") ||
          "your property",
        total: `${quote.currency} ${Number(quote.total).toLocaleString("en-AE", { minimumFractionDigits: 2 })}`,
        approvalUrl,
      }),
      attachment: pdfBase64
        ? {
            filename: `Quotation-${quote.quote_number}.pdf`,
            content: pdfBase64,
            contentType: "application/pdf",
          }
        : undefined,
    });
    messageId = (res as { data?: { id?: string } })?.data?.id ?? null;
  } catch (sendError) {
    await admin
      .from("snagging_quotations")
      .update({
        status: quote.status,
        sent_at: quote.sent_at ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", quote.id);

    const reason =
      sendError instanceof Error ? sendError.message : "Unknown error";
    console.error("Quotation email failed:", reason);
    return NextResponse.json(
      { error: `The quotation was not sent: ${reason}` },
      { status: 502 },
    );
  }

  /*
    3. The provider's id, for tracing a delivery later. Best-effort on
       purpose — the email is gone and the link works, so failing the whole
       request over a reference number would report a disaster that did not
       happen, which is exactly the bug this function is being fixed for.
  */
  if (messageId) {
    const { error: idError } = await admin
      .from("snagging_quotations")
      .update({ email_message_id: messageId })
      .eq("id", quote.id);
    if (idError) {
      console.error(
        "Quotation sent but message id not stored:",
        idError.message,
      );
    }
  }

  await recordAudit(admin, {
    entityType: "task",
    entityId: jobId,
    taskId: jobId,
    eventType: "quotation_sent",
    actorId,
    payload: {
      quote_number: quote.quote_number,
      recipient,
      message_id: messageId,
    },
  });

  return NextResponse.json({ data: { ...data, approval_url: approvalUrl } });
}

async function approve(
  admin: Admin,
  jobId: string,
  actorId: string,
  opts: { name: string | null; internal: boolean },
) {
  const quote = await latestQuote(admin, jobId);
  if (!quote)
    return NextResponse.json(
      { error: "Generate a quotation first" },
      { status: 400 },
    );
  try {
    const data = await approveQuotation(admin, quote as QuoteRef, {
      name: opts.name,
      actorId,
      origin: "portal",
    });
    return NextResponse.json({ data });
  } catch (e) {
    if (e instanceof QuotationDecisionError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

async function reject(
  admin: Admin,
  jobId: string,
  actorId: string,
  opts: { reason: string | null; name: string | null; internal: boolean },
) {
  const quote = await latestQuote(admin, jobId);
  if (!quote)
    return NextResponse.json(
      { error: "No quotation to reject" },
      { status: 400 },
    );
  const reason = (opts.reason ?? "").trim();
  if (!reason)
    return NextResponse.json(
      { error: "A rejection reason is required" },
      { status: 400 },
    );
  try {
    const data = await rejectQuotation(admin, quote as QuoteRef, {
      reason,
      name: opts.name,
      actorId,
      origin: "portal",
    });
    return NextResponse.json({ data });
  } catch (e) {
    if (e instanceof QuotationDecisionError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

function quotationEmailHtml(o: {
  clientName: string;
  quoteNumber: string;
  unit: string;
  total: string;
  approvalUrl: string;
}): string {
  /* The same note the quotation-by-id send writes, so both inboxes match. */
  return clientEmailHtml({
    eyebrow: "Snagging quotation",
    heading: "Your snagging quotation",
    greeting: `Dear ${o.clientName},`,
    paragraphs: [
      `Thank you for choosing Yalla Fix It. Please find attached your snagging inspection quotation <strong>#${escapeEmailHtml(o.quoteNumber)}</strong> for <strong>${escapeEmailHtml(o.unit)}</strong>.`,
      "Review the quotation and approve it, or tell us what you would like changed.",
    ],
    details: [
      { label: "Quotation", value: `#${o.quoteNumber}` },
      { label: "Property", value: o.unit },
      { label: "Total", value: o.total },
    ],
    cta: { label: "Review and approve", url: o.approvalUrl },
    footnote:
      "This private link is valid for 30 days. Please don't share it. The quotation is also attached as a PDF.",
  });
}

/**
 * What this job would be quoted, without writing anything.
 *
 * Shaped like a real quotation so the panel can render it through the
 * same template, but with no id and a `preview` flag so nothing
 * downstream mistakes it for a saved document.
 */
async function previewQuotation(admin: Admin, jobId: string) {
  const [{ data: job, error: jobError }, { data: config, error: configError }] =
    await Promise.all([
      admin
        .from("snagging_jobs")
        .select(
          `id, code, client:client_id(id, name, email, phone),
           property:property_id(property_type, furnished, built_up_area_sqft, plot_area_sqft, external_areas_in_scope,
             bedrooms, unit_label, building_name, community, developer_name)`,
        )
        .eq("id", jobId)
        .maybeSingle(),
      admin
        .from("snagging_pricing_config")
        .select(PRICING_CONFIG_COLUMNS)
        .eq("id", true)
        .maybeSingle(),
    ]);
  if (jobError) throw new Error(jobError.message);
  if (configError) throw new Error(configError.message);
  // A job with no property or no pricing simply has no preview; the panel
  // falls back to its empty state rather than showing invented figures.
  if (!job || !config) return NextResponse.json({ data: null });

  const jobRow = job as {
    code: string;
    property: PropertyRow | PropertyRow[] | null;
    client: ClientRow | ClientRow[] | null;
  };
  const property = (
    Array.isArray(jobRow.property) ? jobRow.property[0] : jobRow.property
  ) as PropertyRow | null;
  const client = (
    Array.isArray(jobRow.client) ? jobRow.client[0] : jobRow.client
  ) as ClientRow | null;
  if (!property) return NextResponse.json({ data: null });

  const cfg = config as PricingConfig & { currency: string };
  const priced = computeQuotation(property as QuoteJob, cfg);

  return NextResponse.json({
    data: {
      id: null,
      preview: true,
      job_id: jobId,
      quote_number: `${jobRow.code}-Q${(await quoteCount(admin, jobId)) + 1}`,
      status: "draft",
      currency: cfg.currency,
      lines: priced.lines,
      subtotal: priced.subtotal,
      tax_rate: cfg.tax_rate,
      tax_amount: priced.tax_amount,
      total: priced.total,
      property_snapshot: {
        unit_label: property.unit_label ?? null,
        building_name: property.building_name ?? null,
        community: property.community ?? null,
        developer_name: property.developer_name ?? null,
        property_type: property.property_type ?? null,
        furnished: property.furnished ?? false,
        bedrooms: property.bedrooms ?? null,
        built_up_area_sqft: property.built_up_area_sqft ?? null,
        client_name: client?.name ?? null,
        client_email: client?.email ?? null,
        client_phone: client?.phone ?? null,
      },
    },
  });
}
