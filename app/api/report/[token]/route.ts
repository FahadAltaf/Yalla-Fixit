import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { signMediaPaths, signPaths } from "@/lib/server/snagging/media";
import { hashReportToken } from "@/lib/server/snagging/report-token";

/**
 * Public client report data, addressed by a link token (FR-5.04-06).
 *
 * No login: the bearer of the (unguessable, hashed-at-rest) token is the
 * client. The token is validated against its hash, checked for revocation
 * and expiry, and its open is recorded. The report is then assembled
 * fresh with short-lived signed photo URLs, so nothing sensitive is baked
 * into the link itself.
 */

// Long enough to read a full report in one sitting, short enough that a
// screenshot-shared URL cannot re-fetch the images later.
const PHOTO_TTL_SECONDS = 2 * 60 * 60;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!token || token.length < 16) {
      return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    }

    const admin = await createAdminServerClient();

    const { data: tokenRow, error: tokenError } = await admin
      .from("snagging_report_tokens")
      .select("id, job_id, expires_at, revoked_at, open_count, opened_at")
      .eq("token_hash", hashReportToken(token))
      .maybeSingle();

    if (tokenError) throw new Error(tokenError.message);
    if (!tokenRow || tokenRow.revoked_at) {
      return NextResponse.json({ error: "This link is no longer available" }, { status: 404 });
    }
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "This link has expired" }, { status: 410 });
    }

    const now = new Date().toISOString();
    await admin
      .from("snagging_report_tokens")
      .update({
        open_count: (tokenRow.open_count ?? 0) + 1,
        last_opened_at: now,
        opened_at: tokenRow.opened_at ?? now,
      })
      .eq("id", tokenRow.id);

    const data = await assembleReport(admin, tokenRow.job_id);
    if (!data) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    // The client link must not be indexed or cached by intermediaries.
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
    );
  } catch (error) {
    console.error("Public report GET error:", error);
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
}

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

async function assembleReport(admin: Admin, jobId: string) {
  const { data: job, error } = await admin
    .from("snagging_jobs")
    .select(
      `id, code, status, round_number, visit_type, scheduled_date,
       unit_label, building_name, community, property_type, developer_name,
       signed_at, signer_name, signature_path,
       client:client_id(name, email, phone),
       inspector:inspector_id(id, full_name, email),
       areas:snagging_areas(id, name, status, note, confirmed_at, sort_order,
         access_state, access_reason)`,
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!job) return null;

  const [{ data: checklist }, { data: snagRows }] = await Promise.all([
    admin
      .from("snagging_job_checklist")
      .select("id, code, group_name, label, mandatory, status, reason, sort_order")
      .eq("job_id", jobId)
      .order("sort_order", { ascending: true }),
    admin
      .from("snagging_snags")
      .select(
        `id, job_id, area_id, snag_code, catalogue_code, element_label, defect_label,
         severity, note, pin_x, pin_y, status, round_created,
         area:snagging_areas(id, name),
         photos:snagging_snag_photos(id, snag_id, storage_path, taken_at)`,
      )
      .eq("job_id", jobId)
      .neq("status", "withdrawn")
      .order("snag_code", { ascending: true }),
  ]);

  const signedSnags = await signMediaPaths(admin, snagRows ?? [], PHOTO_TTL_SECONDS);
  const snags = signedSnags.map((s) => {
    const snag = s as Record<string, unknown> & { area_id?: string };
    return { ...snag, origin_task_id: snag.job_id, area_id: firstAreaId(snag) };
  });

  const client = firstOf(job.client as ClientRow | ClientRow[] | null);
  const inspector = firstOf(job.inspector as ProfileRow | ProfileRow[] | null);

  const property = {
    id: jobId,
    client_name: client?.name ?? "",
    client_email: client?.email ?? null,
    client_phone: client?.phone ?? null,
    unit_label: job.unit_label,
    building_name: job.building_name,
    community: job.community,
    city: "Dubai",
    property_type: job.property_type,
    developer_name: job.developer_name,
  };

  const assignees = inspector
    ? [{ role: "technician" as const, user_profile: inspector }]
    : [];

  const signatureUrl = job.signature_path
    ? (await signPaths(admin, [job.signature_path], PHOTO_TTL_SECONDS)).get(job.signature_path) ?? null
    : null;
  const submissions = job.signed_at
    ? [{
        id: jobId,
        task_id: jobId,
        attempt: 1,
        signed_at: job.signed_at,
        signer_name: job.signer_name,
        signature_path: job.signature_path,
        signature_url: signatureUrl,
      }]
    : [];

  const { data: quotationRow } = await admin
    .from("snagging_quotations")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Only a settled quote belongs on a client-facing report.
  const quotation =
    quotationRow && ["sent", "approved"].includes(quotationRow.status) ? quotationRow : null;

  const areas = ((job.areas ?? []) as Array<{ sort_order: number }>)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  return {
    task: {
      id: job.id,
      code: job.code,
      status: job.status,
      task_type: "single_unit",
      round_number: job.round_number,
      visit_type: job.visit_type ?? "initial",
      scheduled_date: job.scheduled_date,
      property,
      areas,
      assignees,
      snags,
      checklist: checklist ?? [],
      submissions,
    },
    quotation,
  };
}

type ClientRow = { name?: string; email?: string; phone?: string };
type ProfileRow = { id?: string; full_name?: string; email?: string };

function firstOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function firstAreaId(snag: Record<string, unknown>): string | undefined {
  const area = snag.area as { id?: string } | { id?: string }[] | null | undefined;
  const one = Array.isArray(area) ? area[0] : area;
  return one?.id ?? (snag.area_id as string | undefined);
}
