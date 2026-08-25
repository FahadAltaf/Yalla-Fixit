import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { emailService } from "@/lib/email-service";
import { recordAudit } from "@/lib/server/snagging/audit";
import { computeQuotation, type PricingConfig, type QuoteJob } from "@/lib/server/snagging/pricing";
import {
  approveQuotation,
  QuotationDecisionError,
  rejectQuotation,
  type QuoteRef,
} from "@/lib/server/snagging/quotation";
import { mintReportToken } from "@/lib/server/snagging/report-token";
import { ActionType, ResourceType } from "@/types/types";

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

/** The job's current quotation. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const admin = await createAdminServerClient();
    const quote = await latestQuote(admin, id);
    return NextResponse.json({ data: quote });
  } catch (error) {
    console.error("Snagging quotation GET error:", error);
    return NextResponse.json({ error: "Failed to load the quotation" }, { status: 500 });
  }
}

/**
 * Generate / send / approve / reject the quotation for a job.
 * Approving unlocks inspector assignment (F6/BR-2): a draft job becomes
 * assigned only once its quotation is approved.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "generate");
    const admin = await createAdminServerClient();

    if (action === "generate") return generate(admin, id, profile.id);
    if (action === "send") return send(admin, id, profile.id, body);
    if (action === "approve") return approve(admin, id, profile.id, { name: body.approved_by_name ?? null, internal: true });
    if (action === "reject")
      return reject(admin, id, profile.id, { reason: body.reason ?? null, name: null, internal: true });

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Snagging quotation POST error:", error);
    return NextResponse.json({ error: "Failed to update the quotation" }, { status: 500 });
  }
}

async function latestQuote(admin: Admin, jobId: string) {
  const { data, error } = await admin
    .from("snagging_quotations")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function generate(admin: Admin, jobId: string, userId: string) {
  const [{ data: job, error: jobError }, { data: config, error: configError }] = await Promise.all([
    admin
      .from("snagging_jobs")
      .select(
        `id, code, client:client_id(id, name, email, phone),
         property:property_id(property_type, built_up_area_sqft, plot_area_sqft, external_areas_in_scope,
           bedrooms, unit_label, building_name, community, developer_name)`,
      )
      .eq("id", jobId)
      .maybeSingle(),
    admin.from("snagging_pricing_config").select("*").eq("id", true).maybeSingle(),
  ]);
  if (jobError) throw new Error(jobError.message);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (configError) throw new Error(configError.message);
  if (!config) return NextResponse.json({ error: "Pricing is not configured yet" }, { status: 400 });

  // Pricing inputs live on the property record now (BR-1).
  const jobRow = job as { code: string; property: PropertyRow | PropertyRow[] | null; client: ClientRow | ClientRow[] | null };
  const property = (Array.isArray(jobRow.property) ? jobRow.property[0] : jobRow.property) as PropertyRow | null;
  const client = (Array.isArray(jobRow.client) ? jobRow.client[0] : jobRow.client) as ClientRow | null;
  if (!property) {
    return NextResponse.json({ error: "This job has no property to price yet" }, { status: 400 });
  }
  const cfg = config as PricingConfig & { currency: string };
  const priced = computeQuotation(property as QuoteJob, cfg);

  // Snapshot the exact property + pricing used, so this quotation stays
  // reproducible and immune to later config changes (FR-2.03, §10).
  const propertySnapshot = {
    unit_label: property.unit_label ?? null,
    building_name: property.building_name ?? null,
    community: property.community ?? null,
    developer_name: property.developer_name ?? null,
    property_type: property.property_type ?? null,
    bedrooms: property.bedrooms ?? null,
    built_up_area_sqft: property.built_up_area_sqft ?? null,
    client_name: client?.name ?? null,
    client_email: client?.email ?? null,
    client_phone: client?.phone ?? null,
    client_ref: client?.id ?? null,
  };
  const pricingSnapshot = {
    rate_per_sqft: cfg.rate_per_sqft,
    external_rate_per_sqft: cfg.external_rate_per_sqft,
    multipliers: cfg.multipliers,
    tax_rate: cfg.tax_rate,
    currency: cfg.currency,
  };

  // One live quote per job: refresh a draft in place, otherwise open a new one.
  const existing = await latestQuote(admin, jobId);
  const reuseDraft = existing && existing.status === "draft";
  const quoteNumber = reuseDraft ? existing!.quote_number : `${(job as { code: string }).code}-Q${(await quoteCount(admin, jobId)) + 1}`;

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
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await recordAudit(admin, {
    entityType: "task",
    entityId: jobId,
    taskId: jobId,
    eventType: reuseDraft ? "quotation_regenerated" : "quotation_generated",
    actorId: userId,
    payload: { quote_number: quoteNumber, total: priced.total, currency: priced.currency },
  });

  return NextResponse.json({ data });
}

type PropertyRow = QuoteJob & {
  unit_label?: string | null;
  building_name?: string | null;
  community?: string | null;
  developer_name?: string | null;
};
type ClientRow = { id?: string; name?: string | null; email?: string | null; phone?: string | null };

async function quoteCount(admin: Admin, jobId: string): Promise<number> {
  const { count } = await admin
    .from("snagging_quotations")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  return count ?? 0;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Emails the quotation to the client via Resend with the PDF attached and a
 * secure approve/reject link, then marks it sent (FR-2.06). The PDF is
 * generated in the coordinator's browser and posted here as base64. If the
 * email fails, this throws and the quote is NOT marked sent.
 */
async function send(admin: Admin, jobId: string, actorId: string, body: Record<string, unknown>) {
  const quote = await latestQuote(admin, jobId);
  if (!quote) return NextResponse.json({ error: "Generate a quotation first" }, { status: 400 });
  if (quote.status === "approved" || quote.status === "rejected") {
    return NextResponse.json({ error: "This quotation has already been decided" }, { status: 409 });
  }

  const snap = (quote.property_snapshot ?? {}) as Record<string, unknown>;
  const recipient = String(body.sent_to ?? snap.client_email ?? "").trim();
  if (!EMAIL_RE.test(recipient)) {
    return NextResponse.json({ error: "A valid client email is required to send the quotation" }, { status: 400 });
  }
  const pdfBase64 = typeof body.pdf_base64 === "string" ? body.pdf_base64 : null;

  const token = mintReportToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const approvalUrl = `${baseUrl}/quote/${token.raw}`;

  // Send first; only persist "sent" if Resend accepted it.
  const res = await emailService.sendEmail({
    to: recipient,
    subject: `Yalla Fix It Quotation #${quote.quote_number}`,
    html: quotationEmailHtml({
      clientName: (snap.client_name as string) ?? "there",
      quoteNumber: quote.quote_number,
      unit: [snap.unit_label, snap.building_name].filter(Boolean).join(", ") || "your property",
      total: `${quote.currency} ${Number(quote.total).toLocaleString("en-AE", { minimumFractionDigits: 2 })}`,
      approvalUrl,
    }),
    attachment: pdfBase64
      ? { filename: `Quotation-${quote.quote_number}.pdf`, content: pdfBase64, contentType: "application/pdf" }
      : undefined,
  });
  const messageId = (res as { data?: { id?: string } })?.data?.id ?? null;

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("snagging_quotations")
    .update({
      status: "sent",
      sent_at: now,
      sent_to: recipient,
      approval_token_hash: token.hash,
      approval_token_expires_at: expiresAt,
      email_message_id: messageId,
      updated_at: now,
    })
    .eq("id", quote.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await recordAudit(admin, {
    entityType: "task",
    entityId: jobId,
    taskId: jobId,
    eventType: "quotation_sent",
    actorId,
    payload: { quote_number: quote.quote_number, recipient, message_id: messageId },
  });

  return NextResponse.json({ data: { ...data, approval_url: approvalUrl } });
}

async function approve(admin: Admin, jobId: string, actorId: string, opts: { name: string | null; internal: boolean }) {
  const quote = await latestQuote(admin, jobId);
  if (!quote) return NextResponse.json({ error: "Generate a quotation first" }, { status: 400 });
  try {
    const data = await approveQuotation(admin, quote as QuoteRef, {
      name: opts.name,
      actorId,
      origin: "portal",
    });
    return NextResponse.json({ data });
  } catch (e) {
    if (e instanceof QuotationDecisionError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

async function reject(admin: Admin, jobId: string, actorId: string, opts: { reason: string | null; name: string | null; internal: boolean }) {
  const quote = await latestQuote(admin, jobId);
  if (!quote) return NextResponse.json({ error: "No quotation to reject" }, { status: 400 });
  const reason = (opts.reason ?? "").trim();
  if (!reason) return NextResponse.json({ error: "A rejection reason is required" }, { status: 400 });
  try {
    const data = await rejectQuotation(admin, quote as QuoteRef, { reason, name: opts.name, actorId, origin: "portal" });
    return NextResponse.json({ data });
  } catch (e) {
    if (e instanceof QuotationDecisionError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function quotationEmailHtml(o: {
  clientName: string;
  quoteNumber: string;
  unit: string;
  total: string;
  approvalUrl: string;
}): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:0 auto">
    <div style="font-size:20px;font-weight:800;color:#9f2b23">YALLA FIX IT</div>
    <div style="font-size:12px;color:#6b7280;margin-bottom:18px">Property Care · Snagging</div>
    <p>Dear ${escapeHtml(o.clientName)},</p>
    <p>Please find attached your snagging inspection quotation <strong>#${escapeHtml(o.quoteNumber)}</strong>
       for <strong>${escapeHtml(o.unit)}</strong>. The total is <strong>${escapeHtml(o.total)}</strong>.</p>
    <p>Review the quotation and approve or reject it here:</p>
    <p>
      <a href="${escapeHtml(o.approvalUrl)}"
         style="display:inline-block;background:#9f2b23;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:700">
        Review &amp; respond to your quotation
      </a>
    </p>
    <p style="font-size:12px;color:#6b7280">This private link is valid for 30 days. Please do not share it.</p>
  </div>`;
}
