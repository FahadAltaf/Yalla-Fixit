import { NextRequest, NextResponse } from "next/server";

import { actorOf } from "@/lib/server/finance/route-helpers";
import { requireResourceAccess, type RequireAccessResult } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

import { logReportAccess, reportAccess, REPORTS, type ReportKey } from "./access";

/**
 * The part every report route shares: who may open it, who may export it,
 * and the access log. A report answers `?export=csv|xlsx` with every
 * matching row (for the browser to write the file) only when the caller
 * holds Export on that report, and logs it; `?log=view` logs an opening.
 */

export type ReportRequest = {
  gate: Extract<RequireAccessResult, { ok: true }>;
  admin: Awaited<ReturnType<typeof createAdminServerClient>>;
  params: Record<string, string>;
  exportFormat: "csv" | "xlsx" | null;
  logView: boolean;
  can: { view: boolean; export: boolean };
};

export async function openReport(req: NextRequest, report: ReportKey): Promise<ReportRequest | NextResponse> {
  const gate = await requireResourceAccess(REPORTS[report].resource, null);
  if (!gate.ok) return gate.response;
  const can = reportAccess(gate.access.accessUser, report);
  if (!can.view) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = Object.fromEntries(req.nextUrl.searchParams);
  const rawExport = params.export;
  const exportFormat = rawExport === "csv" || rawExport === "xlsx" ? rawExport : null;
  if (rawExport !== undefined && !exportFormat) return NextResponse.json({ error: "Invalid export format" }, { status: 400 });
  if (exportFormat && !can.export) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const logView = params.log === "view";
  for (const key of ["export", "log", "page", "pageSize"]) delete params[key];

  return { gate, admin: await createAdminServerClient(), params, exportFormat, logView, can };
}

/** Logs the view or export this request was, after the report was built. */
export async function logAccess(request: ReportRequest, report: ReportKey, filters: Record<string, unknown>, rowCount: number) {
  if (!request.exportFormat && !request.logView) return;
  await logReportAccess(request.admin, {
    report,
    action: request.exportFormat ? "export" : "view",
    user: actorOf(request.gate.access.profile),
    filters,
    rowCount,
    format: request.exportFormat ?? undefined,
  });
}

/** CRON_SECRET, as a header or a bearer token (the house pattern). */
export function cronAuthorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const headerSecret = req.headers.get("x-cron-secret");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return headerSecret === secret || bearer === secret;
}
