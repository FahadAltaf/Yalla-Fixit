import React from "react";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

import { sanitizeUnsupportedColors } from "@/lib/pdf/sanitize-colors";

import { QuotationData } from "./quotation-templates";
import { YallaClassicTemplate } from "./templates/YallaClassicTemplate";
import { ModernBoldTemplate } from "./templates/ModernBoldTemplate";
import { MinimalCleanTemplate } from "./templates/MinimalCleanTemplate";

export interface PDFGeneratorOptions {
  scale?: number;
  imageFormat?: "JPEG" | "PNG";
  imageQuality?: number;
}

function findSafePageBreakOffset(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  targetOffset: number,
  maxBacktrackPx: number,
  minOffset: number
): number {
  const target = Math.floor(targetOffset);
  const minCandidate = Math.max(minOffset, target - maxBacktrackPx);

  // Prefer cutting at a mostly-white row to avoid slicing through text.
  for (let y = target; y >= minCandidate; y--) {
    const row = ctx.getImageData(0, y, canvasWidth, 1).data;
    let darkPixels = 0;

    for (let i = 0; i < row.length; i += 4) {
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      const a = row[i + 3];

      if (a > 10 && (r < 245 || g < 245 || b < 245)) {
        darkPixels++;
      }
    }

    const darkRatio = darkPixels / canvasWidth;
    if (darkRatio < 0.008) {
      return y;
    }
  }

  return target;
}

/**
 * The last canvas row carrying any ink, or -1 if the canvas is blank.
 *
 * html2canvas renders the template's whole box, bottom padding included, so
 * the canvas overshoots the content by a band of white. Paginating against
 * the raw height opened a final, entirely blank page.
 *
 * Scans bottom-up in coarse chunks and refines inside the chunk that hits,
 * so the usual case costs a handful of getImageData calls rather than one
 * per row. Callers pad the result by more than COARSE_STEP, which covers the
 * one case the coarse pass can miss: a hairline sitting between two samples.
 */
const COARSE_STEP = 8;

function findLastInkedRow(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number
): number {
  const rowHasInk = (y: number) => {
    const row = ctx.getImageData(0, y, canvasWidth, 1).data;
    let darkPixels = 0;

    for (let i = 0; i < row.length; i += 4) {
      const a = row[i + 3];
      if (a > 10 && (row[i] < 245 || row[i + 1] < 245 || row[i + 2] < 245)) {
        darkPixels++;
        // A handful of stray pixels is anti-aliasing, not content.
        if (darkPixels / canvasWidth > 0.004) return true;
      }
    }

    return false;
  };

  for (let y = canvasHeight - 1; y >= 0; y -= COARSE_STEP) {
    if (!rowHasInk(y)) continue;

    // The true last row is inside the chunk the coarse pass stepped over.
    const upper = Math.min(canvasHeight - 1, y + COARSE_STEP - 1);
    for (let fine = upper; fine > y; fine--) {
      if (rowHasInk(fine)) return fine;
    }

    return y;
  }

  return -1;
}


export async function generateQuotationPDFBlob(
  templateId: string,
  data: QuotationData,
  options: PDFGeneratorOptions = {},
  discountMode: "with" | "without" | "with-total" | "with-total-no-list" = "with",
  includeServiceItemImages = false,
  rootQuotationNumber = "",
): Promise<Blob> {
  const { scale = 2, imageFormat = "JPEG", imageQuality = 0.92 } = options;

  const tempDiv = document.createElement("div");
  tempDiv.style.cssText = `
    position: absolute;
    left: -9999px;
    top: 0;
    width: 794px;
    background: #ffffff;
  `;
  document.body.appendChild(tempDiv);

  const root = createRoot(tempDiv);

  try {
    let TemplateEl: React.ReactElement;
    switch (templateId) {
      case "modern-bold":
        TemplateEl = <ModernBoldTemplate data={data} />;
        break;
      case "minimal-clean":
        TemplateEl = <MinimalCleanTemplate data={data} />;
        break;
      default:
        TemplateEl = (
          <YallaClassicTemplate
            data={data}
            forPDF
            hideDiscount={discountMode === "without"}
            discountMode={discountMode}
            includeServiceItemImages={includeServiceItemImages}
            rootQuotationNumber={rootQuotationNumber}
          />
        );
    }

    await new Promise<void>((resolve) => {
      root.render(TemplateEl);
      setTimeout(resolve, 300);
    });

    const fullHeight = tempDiv.scrollHeight;

    const canvas = await html2canvas(tempDiv, {
      useCORS: true,
      allowTaint: true,
      background: "#ffffff",
      logging: false,
      width: 794,
      height: fullHeight,
      ...({ scale, onclone: (doc: Document) => sanitizeUnsupportedColors(doc) } as object),
    });

    const PAGE_W_MM = 210;
    const PAGE_H_MM = 297;
    const MARGIN_MM = 8;
    const CONTENT_H_MM = PAGE_H_MM - MARGIN_MM * 2;

    const PX_PER_MM = canvas.width / PAGE_W_MM;
    const CONTENT_H_PX = CONTENT_H_MM * PX_PER_MM;
    const MIN_SLICE_H_PX = 28 * PX_PER_MM;
    const PAGE_BREAK_BACKTRACK_PX = 14 * PX_PER_MM;
    const canvasCtx = canvas.getContext("2d");

    if (!canvasCtx) {
      throw new Error("Unable to read rendered quotation canvas.");
    }

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [PAGE_W_MM, PAGE_H_MM],
    });

    /*
      Paginate against where the content actually ends, not where the canvas
      does. The old guard stopped only once under 2mm remained, so the
      template's bottom padding was enough to open a final blank page.

      The pad keeps a little white under the last line rather than cutting
      flush to it, and is comfortably wider than COARSE_STEP.
    */
    const lastInkedRow = findLastInkedRow(canvasCtx, canvas.width, canvas.height);
    const contentHeight =
      lastInkedRow < 0
        ? 0
        : Math.min(canvas.height, lastInkedRow + 1 + Math.round(3 * PX_PER_MM));

    let sourceY = 0;
    let isFirstPage = true;

    while (sourceY < contentHeight) {
      if (!isFirstPage) {
        pdf.addPage([PAGE_W_MM, PAGE_H_MM], "portrait");
      }

      const idealSliceH = Math.min(CONTENT_H_PX, contentHeight - sourceY);
      const remainingAfterIdeal = contentHeight - (sourceY + idealSliceH);

      let sliceH = idealSliceH;
      if (remainingAfterIdeal > MIN_SLICE_H_PX) {
        sliceH = findSafePageBreakOffset(
          canvasCtx,
          canvas.width,
          sourceY + idealSliceH,
          PAGE_BREAK_BACKTRACK_PX,
          sourceY + MIN_SLICE_H_PX
        ) - sourceY;
      }

      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceH;

      const ctx = pageCanvas.getContext("2d")!;
      ctx.drawImage(
        canvas,
        0,
        sourceY,
        canvas.width,
        sliceH,
        0,
        0,
        canvas.width,
        sliceH
      );

      const pageImgData = pageCanvas.toDataURL(
        `image/${imageFormat.toLowerCase()}`,
        imageQuality
      );

      const sliceHeightMm = (sliceH / canvas.width) * PAGE_W_MM;

      pdf.addImage(
        pageImgData,
        imageFormat,
        0,
        MARGIN_MM,
        PAGE_W_MM,
        sliceHeightMm
      );

      sourceY += sliceH;
      isFirstPage = false;
    }

    return pdf.output("blob");
  } finally {
    root.unmount();
    if (document.body.contains(tempDiv)) {
      document.body.removeChild(tempDiv);
    }
  }
}

