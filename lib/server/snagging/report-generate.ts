import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAudit } from "./audit";
import { buildReportData, type ReportScope } from "./report-data";
import { renderReportHtml } from "./report-html";
import {
  BrowserUnavailableError,
  renderPdfFromHtml,
} from "./report-pdf-headless";

/**
 * Turns an approved inspection into a stored PDF (FR-7.01).
 *
 * Runs on the server with no browser session involved, so approval alone is
 * enough to produce the client's document. The lifecycle is explicit --
 * pending → generating → generated | failed -- because the one thing this
 * must never do is let an approval imply a PDF exists when rendering failed.
 */

type Admin = SupabaseClient;

const BUCKET = "snagging";

/**
 * Signed photo URLs expire within hours, so a snapshot that kept them
 * would preserve dead links and bloat the row for nothing.
 */
function stripSignedUrl<T extends { url: string | null }>(photo: T): Omit<T, "url"> {
  const { url, ...rest } = photo;
  // `url` is read so the destructure is not flagged as unused; the point is
  // that it does not reach `rest`.
  void url;
  return rest;
}

export type GenerateResult =
  | { ok: true; versionId: string; version: number; pdfPath: string; durationMs: number }
  | { ok: false; versionId: string | null; error: string };

/** Where a version's PDF lives. Deterministic, so a retry overwrites itself. */
function pdfPathFor(jobId: string, version: number, reportType: string): string {
  const suffix = reportType === "inspection" ? "" : `-${reportType}`;
  return `reports/${jobId}/v${version}${suffix}.pdf`;
}

/**
 * Generates (or regenerates) the PDF for one report version.
 *
 * Idempotent by claim: the row is moved to `generating` in a statement that
 * only matches while it is `pending` or `failed`, so a retry racing the
 * original does no work rather than producing a second document. A version
 * already `generated` is returned untouched -- reissuing is what new versions
 * are for, and overwriting an issued document is exactly what FR-7.08
 * forbids.
 */
export async function generateReportPdf(
  admin: Admin,
  versionId: string,
  options: { force?: boolean; actorId?: string | null; actorLabel?: string | null } = {},
): Promise<GenerateResult> {
  const { data: version, error: loadError } = await admin
    .from("snagging_report_versions")
    .select("id, job_id, version, report_type, source_round_id, generation_status")
    .eq("id", versionId)
    .maybeSingle();

  if (loadError) return { ok: false, versionId, error: loadError.message };
  if (!version) return { ok: false, versionId, error: "Report version not found" };

  if (version.generation_status === "generated" && !options.force) {
    const { data: existing } = await admin
      .from("snagging_report_versions")
      .select("pdf_path, generated_ms")
      .eq("id", versionId)
      .maybeSingle();
    return {
      ok: true,
      versionId,
      version: version.version,
      pdfPath: existing?.pdf_path ?? "",
      durationMs: existing?.generated_ms ?? 0,
    };
  }

  // Claim it. A concurrent sweep or retry finds nothing to update and stops.
  const claimFrom = options.force
    ? ["pending", "failed", "generated"]
    : ["pending", "failed"];
  const { data: claimed, error: claimError } = await admin
    .from("snagging_report_versions")
    .update({ generation_status: "generating", generation_error: null })
    .eq("id", versionId)
    .in("generation_status", claimFrom)
    .select("id");

  if (claimError) return { ok: false, versionId, error: claimError.message };
  if (!claimed || claimed.length === 0) {
    return { ok: false, versionId, error: "Generation is already in progress" };
  }

  const scope: ReportScope =
    version.report_type === "round"
      ? "round"
      : version.report_type === "cumulative"
        ? "cumulative"
        : "inspection";

  const started = Date.now();
  try {
    const data = await buildReportData(admin, version.job_id, scope);
    if (!data) throw new Error("The inspection behind this report no longer exists");

    const html = renderReportHtml(data, {
      mode: "print",
      version: version.version,
      reportType: version.report_type,
    });

    const { pdf, durationMs } = await renderPdfFromHtml(html);

    const path = pdfPathFor(version.job_id, version.version, version.report_type);
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw new Error(`Could not store the PDF: ${uploadError.message}`);

    /*
      The snapshot is what makes the version reproducible.

      Signed photo URLs are stripped: they expire within hours, so keeping
      them would preserve dead links and bloat the row. Everything that
      decides what the document *said* -- totals, wording, ordering, coverage
      -- is kept, so a later catalogue edit or snag change cannot rewrite an
      issued report.
    */
    const snapshot = {
      ...data,
      areas: data.areas.map((area) => ({
        ...area,
        snags: area.snags.map((snag) => ({
          ...snag,
          photos: snag.photos.map(stripSignedUrl),
        })),
      })),
      unassignedSnags: data.unassignedSnags.map((snag) => ({
        ...snag,
        photos: snag.photos.map(stripSignedUrl),
      })),
      signOff: { ...data.signOff, signatureUrl: null },
    };

    const totalMs = Date.now() - started;
    const { error: doneError } = await admin
      .from("snagging_report_versions")
      .update({
        generation_status: "generated",
        generation_error: null,
        generated_ms: totalMs,
        pdf_path: path,
        snag_count: data.cover.totalSnags,
        snapshot,
      })
      .eq("id", versionId);
    if (doneError) throw new Error(doneError.message);

    await recordAudit(admin, {
      entityType: "report",
      entityId: versionId,
      taskId: version.job_id,
      eventType: "report_generated",
      actorId: options.actorId ?? null,
      actorLabel: options.actorLabel ?? "System",
      origin: options.actorId ? "portal" : "system",
      payload: {
        version: version.version,
        report_type: version.report_type,
        snags: data.cover.totalSnags,
        duration_ms: totalMs,
        render_ms: durationMs,
      },
    });

    return {
      ok: true,
      versionId,
      version: version.version,
      pdfPath: path,
      durationMs: totalMs,
    };
  } catch (error) {
    /*
      Record the failure and stop. The version stays `failed` with the reason
      attached, so the UI can offer a retry and nothing downstream mistakes a
      failed render for a deliverable document.
    */
    const message =
      error instanceof BrowserUnavailableError
        ? error.message
        : error instanceof Error
          ? error.message
          : "PDF generation failed";

    await admin
      .from("snagging_report_versions")
      .update({
        generation_status: "failed",
        generation_error: message.slice(0, 1000),
        generated_ms: Date.now() - started,
      })
      .eq("id", versionId);

    await recordAudit(admin, {
      entityType: "report",
      entityId: versionId,
      taskId: version.job_id,
      eventType: "report_generation_failed",
      actorId: options.actorId ?? null,
      actorLabel: options.actorLabel ?? "System",
      origin: options.actorId ? "portal" : "system",
      payload: { version: version.version, error: message.slice(0, 500) },
    });

    console.error("Report generation failed:", version.job_id, message);
    return { ok: false, versionId, error: message };
  }
}

/**
 * A short-lived URL for a stored report PDF.
 *
 * The bucket is private, so nothing hands out a storage path: the public
 * report route signs one per request and the link dies with it.
 */
export async function signReportPdf(
  admin: Admin,
  path: string,
  ttlSeconds = 60 * 60,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error) {
    console.error("Could not sign report PDF:", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}
