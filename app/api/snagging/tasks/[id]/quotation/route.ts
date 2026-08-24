import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { computeQuotation, type PricingConfig, type QuoteJob } from "@/lib/server/snagging/pricing";
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
    if (action === "send") return act(admin, id, { status: "sent", sent_at: new Date().toISOString(), sent_to: body.sent_to ?? null });
    if (action === "approve") return approve(admin, id);
    if (action === "reject") return act(admin, id, { status: "rejected", rejected_reason: body.reason ?? null });

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
        "id, code, property:property_id(property_type, built_up_area_sqft, plot_area_sqft, external_areas_in_scope, bedrooms)",
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
  const jobRow = job as { code: string; property: QuoteJob | QuoteJob[] | null };
  const property = Array.isArray(jobRow.property) ? jobRow.property[0] : jobRow.property;
  if (!property) {
    return NextResponse.json({ error: "This job has no property to price yet" }, { status: 400 });
  }
  const priced = computeQuotation(property as QuoteJob, config as PricingConfig);

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
    sent_at: null,
    approved_at: null,
    rejected_reason: null,
    created_by: userId,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("snagging_quotations")
    .upsert(row, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return NextResponse.json({ data });
}

async function quoteCount(admin: Admin, jobId: string): Promise<number> {
  const { count } = await admin
    .from("snagging_quotations")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  return count ?? 0;
}

async function act(admin: Admin, jobId: string, patch: Record<string, unknown>) {
  const quote = await latestQuote(admin, jobId);
  if (!quote) return NextResponse.json({ error: "No quotation to update" }, { status: 400 });
  const { data, error } = await admin
    .from("snagging_quotations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", quote.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return NextResponse.json({ data });
}

async function approve(admin: Admin, jobId: string) {
  const quote = await latestQuote(admin, jobId);
  if (!quote) return NextResponse.json({ error: "Generate a quotation first" }, { status: 400 });

  const { data, error } = await admin
    .from("snagging_quotations")
    .update({ status: "approved", approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", quote.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  // BR-2 / F6: an approved quote unlocks the job for the inspector.
  const { error: jobError } = await admin
    .from("snagging_jobs")
    .update({ status: "assigned" })
    .eq("id", jobId)
    .eq("status", "draft");
  if (jobError) throw new Error(jobError.message);

  return NextResponse.json({ data });
}
