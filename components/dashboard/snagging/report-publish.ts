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
  stage("Building the PDF");
  // As the report page shows it: nothing from a visit not yet approved.
  const { blob, filename } = await buildInspectionReportPdf(approvedOnly(task), quotation);

  stage("Saving it and sending it to Zoho FSM");
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await snaggingService.uploadReportPdf(taskId, blob, filename, options.versionId);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 409 || attempt >= 14) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
