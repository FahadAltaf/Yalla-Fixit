"use client";

import {
  ClientDocumentShell,
  ClientDownloadMenu,
  FitToWidth,
  formatClientDate,
  type ClientFileFormat,
} from "@/components/client-document/client-document-shell";
import { InspectionReport } from "@/components/dashboard/snagging/inspection-report";
import type { SnaggingTask } from "@/types/types";

/**
 * The client's report link: the job's report page, read-only, in the same
 * page the client gets for a quotation (logo and actions in a sticky bar,
 * the facts they check first, then the document fitted to the column).
 *
 * The report is the component the portal's report page renders, on the same
 * data, so what the client reads and downloads is the document the
 * office sees. Download builds the PDF or Word file exactly as the report
 * page does.
 */
export function ClientReportView({ task }: { task: SnaggingTask }) {
  async function download(format: ClientFileFormat) {
    const [builders, { saveAs }] = await Promise.all([
      import("@/components/dashboard/snagging/report-pdf-download"),
      import("file-saver"),
    ]);
    const { blob, filename } =
      format === "pdf"
        ? await builders.buildInspectionReportPdf(task, null)
        : await builders.buildInspectionReportDocx(task, null);
    saveAs(blob, filename);
  }

  const property = task.property;
  const place = [property?.unit_label, property?.building_name, property?.community].filter(Boolean).join(", ");
  const inspector = (task.assignees ?? [])
    .filter((assignee) => assignee.role === "technician")
    .map((assignee) => assignee.user_profile?.full_name ?? assignee.user_profile?.email)
    .filter(Boolean)
    .join(", ");
  const inspected = formatClientDate(task.submitted_at ?? task.scheduled_date ?? null);
  const snagCount = (task.snags ?? []).filter(
    (snag) => task.visit_type !== "desnag" || snag.status !== "verified_closed",
  ).length;

  return (
    <ClientDocumentShell
      actions={<ClientDownloadMenu onDownload={download} showLabel />}
      facts={[
        { label: "Prepared for", value: property?.client_name || "—", hint: place || undefined },
        { label: "Inspected", value: inspected ?? "—", hint: inspector || undefined },
        { label: "Snags found", value: String(snagCount), hint: "Snagging inspection report" },
      ]}
    >
      <FitToWidth>
        <InspectionReport task={task} />
      </FitToWidth>
    </ClientDocumentShell>
  );
}
