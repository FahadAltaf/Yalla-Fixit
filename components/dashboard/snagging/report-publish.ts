"use client";

import { snaggingService } from "@/modules/snagging";
import { approvedOnly } from "@/lib/snagging/report-approved";

export { approvedOnly };

/**
 * Makes a job's report PDF in the report page's design and stores it as the
 * report version's file, which also sends it to the job's Zoho FSM work order.
 *
 * The report's one design is the React report page, so its PDF can only be
 * made where that component runs: here, in the browser, exactly as Download
 * makes it. Called straight after a manager approves an inspection or an
 * additional visit, and by the report page and FSM card for a version that
 * was left without one.
 *
 * Approval issues the version a moment after it answers, so an upload that
 * finds no version yet waits and tries again, for up to about half a minute.
 */
export async function publishReportPdf(
  taskId: string,
  options: { versionId?: string | null; onStage?: (stage: string) => void } = {},
): Promise<{ versionId: string; version: number }> {
  const stage = options.onStage ?? (() => undefined);
  stage("Preparing the report");
  // The whole report, as the report page loads it.
  const [{ buildInspectionReportPdf }, task, quotation] = await Promise.all([
    import("./report-pdf-download"),
    snaggingService.getTask(taskId, {}, ["snags", "checklist", "floor_plans", "visit_status"]),
    snaggingService.getQuotation(taskId).catch(() => null),
  ]);
  /*
    The version this PDF is, worked out before it is drawn, because the
    number is printed on it. The one asked for, or else the newest -- the
    one the upload would have picked. Approval issues it a moment after it
    answers, so this waits for it the same way the upload used to.
  */
  let target: { id: string; version: number } | null = null;
  for (let attempt = 0; attempt < 15 && !target; attempt += 1) {
    const versions = await snaggingService.listReportVersions(taskId).catch(() => null);
    const list = versions ?? [];
    target =
      (options.versionId
        ? list.find((v) => v.id === options.versionId)
        : [...list].sort((a, b) => b.version - a.version)[0]) ?? null;
    if (!target && versions === null) break; // no versions on this environment
    if (!target) await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  stage("Building the PDF");
  // As the report page shows it: nothing from a visit not yet approved.
  const { blob, filename } = await buildInspectionReportPdf(
    approvedOnly(task),
    quotation,
    target?.version ?? null,
  );

  stage("Saving it and sending it to Zoho FSM");
  for (let attempt = 0; ; attempt += 1) {
    try {
      // Pinned to the version printed on it, so a newer one issued meanwhile cannot take this file.
      return await snaggingService.uploadReportPdf(taskId, blob, filename, target?.id ?? options.versionId);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 409 || attempt >= 14) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
