import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAudit } from "./audit";
import { buildReportData, type ReportData } from "./report-data";
import { signReportPdf } from "./report-generate";
import { hashReportToken } from "./report-token";

/**
 * The client's report link: who may open it, and what it shows.
 *
 * Shared by the link's page and its downloadable document (SNG-140), so the
 * page a client reads and the PDF they download are checked the same way and
 * built from the same report.
 */

export type ReportDenial = "invalid" | "expired" | "revoked";

export type ReportLinkRow = {
  id: string;
  job_id: string;
  version_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  opened_at: string | null;
  open_count: number;
};

/**
 * Validates a presented token. Reads only: the open is recorded separately,
 * by the page, so downloading the PDF does not count as a second visit.
 *
 * An invalid token gets the same answer as an expired one would without its
 * row, so the URL cannot be used to probe which inspections exist.
 */
export async function validateReportToken(
  admin: SupabaseClient,
  token: string,
): Promise<{ link: ReportLinkRow } | { denied: ReportDenial }> {
  if (!token || token.length < 16) return { denied: "invalid" };
  const { data, error } = await admin
    .from("snagging_report_tokens")
    .select("id, job_id, version_id, expires_at, revoked_at, opened_at, open_count")
    .eq("token_hash", hashReportToken(token))
    .maybeSingle();

  if (error) {
    console.error("Public report token lookup failed:", error.message);
    return { denied: "invalid" };
  }
  const link = data as ReportLinkRow | null;
  if (!link) return { denied: "invalid" };
  if (link.revoked_at) return { denied: "revoked" };
  if (new Date(link.expires_at).getTime() < Date.now()) return { denied: "expired" };
  return { link };
}

/** FR-7.05 — the open, counted and audited. */
export async function recordReportOpen(
  admin: SupabaseClient,
  link: ReportLinkRow,
): Promise<void> {
  const now = new Date().toISOString();
  const nextCount = (link.open_count ?? 0) + 1;
  await admin
    .from("snagging_report_tokens")
    .update({
      open_count: nextCount,
      last_opened_at: now,
      opened_at: link.opened_at ?? now,
    })
    .eq("id", link.id);

  await recordAudit(admin, {
    entityType: "report",
    entityId: link.version_id ?? link.job_id,
    taskId: link.job_id,
    eventType: "report_opened",
    actorLabel: "Client",
    origin: "system",
    payload: { open_count: nextCount },
  });
}

/**
 * The report a link shows.
 *
 * A version's snapshot wins whenever one exists: it is what the client was
 * actually sent, and re-deriving it from today's rows would quietly restate
 * an issued document. Live data is the path for links minted before
 * snapshots existed, or whose version has none.
 */
export async function loadLinkedReport(
  admin: SupabaseClient,
  link: ReportLinkRow,
): Promise<{
  data: ReportData;
  version: number | null;
  reportType: string;
  pdfUrl: string | null;
} | null> {
  let data: ReportData | null = null;
  let version: number | null = null;
  let reportType = "inspection";
  let pdfUrl: string | null = null;

  if (link.version_id) {
    const { data: row } = await admin
      .from("snagging_report_versions")
      .select("version, report_type, snapshot, pdf_path")
      .eq("id", link.version_id)
      .maybeSingle();
    if (row) {
      version = row.version as number;
      reportType = (row.report_type as string) ?? "inspection";
      if (row.snapshot) data = row.snapshot as unknown as ReportData;
      if (row.pdf_path) pdfUrl = await signReportPdf(admin, row.pdf_path as string);
    }
  }

  if (!data) data = await buildReportData(admin, link.job_id, "inspection");
  if (!data) return null;
  return { data, version, reportType, pdfUrl };
}
