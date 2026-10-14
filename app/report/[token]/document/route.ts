import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { renderReportHtml } from "@/lib/server/snagging/report-html";
import { loadLinkedReport, validateReportToken } from "@/lib/server/snagging/report-link";

/**
 * The client's report as a print-ready page, for the Download PDF button on
 * the report link (SNG-140).
 *
 * The same report the link shows, in the A4 `print` layout, so the PDF the
 * client saves is the page they were reading. The token is checked exactly
 * as the page checks it; the download is not counted as another open.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const admin = await createAdminServerClient();
    const outcome = await validateReportToken(admin, token);
    if ("denied" in outcome) {
      return NextResponse.json({ error: "This link is not available" }, { status: 404 });
    }
    const report = await loadLinkedReport(admin, outcome.link);
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    const html = renderReportHtml(report.data, {
      mode: "print",
      version: report.version,
      reportType: report.reportType,
    });
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    console.error("Public report document GET error:", error);
    return NextResponse.json({ error: "Failed to load the report" }, { status: 500 });
  }
}
