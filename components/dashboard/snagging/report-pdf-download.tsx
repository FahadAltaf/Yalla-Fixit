"use client";

import { renderReactToPdfBlob } from "@/lib/snagging/report-pdf";
import type { SnaggingQuotation } from "@/modules/snagging";
import type { SnaggingTask } from "@/types/types";

import { InspectionReport } from "./inspection-report";

/**
 * The inspection report as a PDF: the document rendered fresh with
 * `forPDF`, rasterised, and paginated with a running head and footer on
 * every page after the cover.
 *
 * The running head matches the AMC documents: the Yalla Fix It logo on the
 * left, the report's name beside it, the ISO marks on the right, and a
 * brand-red rule underneath.
 */

type HeaderImage = { dataUrl: string; widthMm: number; heightMm: number };

/*
  An image as a flattened PNG data URI. jsPDF cannot take a URL, and a
  transparent PNG comes through with black where it was clear, so each is
  painted onto white first. A failure loses the image, never the PDF.
*/
async function loadFlattened(
  src: string,
  heightMm: number,
): Promise<HeaderImage | undefined> {
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = src;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width || !canvas.height) return undefined;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    return {
      dataUrl: canvas.toDataURL("image/png"),
      heightMm,
      widthMm: (heightMm * canvas.width) / canvas.height,
    };
  } catch {
    return undefined;
  }
}

export async function buildInspectionReportPdf(
  task: SnaggingTask,
  quotation: SnaggingQuotation | null | undefined,
): Promise<{ blob: Blob; filename: string }> {
  const [logo, ...badges] = await Promise.all([
    loadFlattened("/amc/brand/logo-trimmed.png", 9),
    loadFlattened("/amc/brand/iso-14001.png", 8),
    loadFlattened("/amc/brand/iso-9001.png", 8),
    loadFlattened("/amc/brand/iso-45001.png", 8),
  ]);

  const place = [task.property?.building_name, task.property?.unit_label]
    .filter(Boolean)
    .join(", ");

  const blob = await renderReactToPdfBlob(
    <InspectionReport task={task} quotation={quotation} forPDF />,
    /* About 150 dpi: sharp in print, and a third of the old file size. */
    1.6,
    {
      footerLabel: `${task.property?.unit_label ?? "Inspection"} · Snagging inspection report`,
      header: {
        text: `Property handover snagging report${place ? ` · ${place}` : ""}`,
        logo,
        badges: badges.filter((badge): badge is HeaderImage => Boolean(badge)),
        skipFirstPage: true,
        rgb: [131, 32, 30],
      },
    },
  );

  return {
    blob,
    filename: `${(task.property?.unit_label ?? "inspection").replace(/\s+/g, "-")}-snagging-report.pdf`,
  };
}
