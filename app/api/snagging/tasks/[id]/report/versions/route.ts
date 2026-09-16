import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { loadJobFamily } from "@/lib/server/snagging/job-family";
import {
  generateReportPdf,
  signReportPdf,
} from "@/lib/server/snagging/report-generate";
import { issueReportVersion } from "@/lib/server/snagging/report-versions";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The report versions issued against one inspection (FR-7.07, FR-7.08).
 *
 * GET lists them newest first with their generation state and a short-lived
 * link to each stored PDF; POST issues a new one -- a de-snag round report, a
 * cumulative report, or a retry of a version whose render failed.
 *
 * Versions are never overwritten. A retry re-renders the same version's PDF
 * to the same path; a reissue mints the next number. Which of the two happens
 * is decided by the body, not inferred.
 */

type VersionRow = {
  id: string;
  version: number;
  report_type: string;
  source_visit_id: string | null;
  source_round_id: string | null;
  snag_count: number;
  generation_status: string;
  generation_error: string | null;
  generated_ms: number | null;
  pdf_path: string | null;
  generated_at: string;
  reason: string | null;
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();

    // Versions belong to the original inspection, never to a visit or round,
    // so a coordinator opening a visit still sees the document history.
    const family = await loadJobFamily(admin, id);

    const { data, error } = await admin
      .from("snagging_report_versions")
      .select(
        "id, version, report_type, source_visit_id, source_round_id, snag_count, generation_status, generation_error, generated_ms, pdf_path, generated_at, reason",
      )
      .eq("job_id", family.rootId)
      .order("version", { ascending: false });

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as VersionRow[];
    const withUrls = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        version: row.version,
        report_type: row.report_type,
        source_visit_id: row.source_visit_id,
        source_round_id: row.source_round_id,
        snag_count: row.snag_count,
        generation_status: row.generation_status,
        // The recorded reason, which is written for a person to read.
        generation_error: row.generation_error,
        generated_ms: row.generated_ms,
        generated_at: row.generated_at,
        reason: row.reason,
        // Signed per request: the bucket is private and no storage path is
        // ever handed out.
        pdf_url: row.pdf_path ? await signReportPdf(admin, row.pdf_path) : null,
        is_current: false,
      })),
    );

    // The newest successfully generated version is the one in force.
    const current = withUrls.find((row) => row.generation_status === "generated");
    if (current) current.is_current = true;

    return NextResponse.json({ data: withUrls });
  } catch (error) {
    console.error("Report versions GET error:", error);
    return NextResponse.json({ error: "Failed to load report versions" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Issuing or reissuing a client document is a manager act, matching the
    // gate on approval and delivery.
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.APPROVE) &&
      !isAdminUser(accessUser)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      action?: "retry" | "round" | "cumulative";
      versionId?: string;
    };
    const action = body.action ?? "retry";

    const admin = await createAdminServerClient();

    if (action === "retry") {
      if (!body.versionId) {
        return NextResponse.json(
          { error: "A version is required to retry" },
          { status: 400 },
        );
      }
      const result = await generateReportPdf(admin, body.versionId, {
        force: true,
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email,
      });
      return NextResponse.json(
        result.ok
          ? { data: { status: "generated", version: result.version, duration_ms: result.durationMs } }
          : { error: result.error },
        { status: result.ok ? 200 : 422 },
      );
    }

    // FR-7.07 — a round or cumulative report for this job.
    const { data: job } = await admin
      .from("snagging_jobs")
      .select("id, code, status, visit_type, round_number")
      .eq("id", id)
      .maybeSingle();
    if (!job) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    // The client's document only ever describes approved work.
    if (!["approved", "delivered"].includes(job.status)) {
      return NextResponse.json(
        { error: "Only an approved inspection can be reported on." },
        { status: 409 },
      );
    }

    const issued = await issueReportVersion(admin, {
      jobId: id,
      reportType: action,
      sourceRoundId: action === "round" ? id : null,
      generatedBy: profile.id,
      reason:
        action === "round"
          ? `De-snag round ${job.round_number} report`
          : "Cumulative report",
    });
    if (!issued) {
      return NextResponse.json(
        { error: "Report versioning is not available on this environment" },
        { status: 503 },
      );
    }

    const result = await generateReportPdf(admin, issued.id, {
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
    });

    return NextResponse.json(
      result.ok
        ? {
            data: {
              status: "generated",
              version: issued.version,
              report_type: action,
              duration_ms: result.durationMs,
            },
          }
        : { error: result.error },
      { status: result.ok ? 200 : 422 },
    );
  } catch (error) {
    console.error("Report version POST error:", error);
    return NextResponse.json({ error: "Failed to issue the report" }, { status: 500 });
  }
}
