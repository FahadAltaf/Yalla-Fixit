import React from "react";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

import { QuotationData } from "./quotation-templates";
import { YallaClassicTemplate } from "./templates/YallaClassicTemplate";
import { ModernBoldTemplate } from "./templates/ModernBoldTemplate";
import { MinimalCleanTemplate } from "./templates/MinimalCleanTemplate";

export interface PDFGeneratorOptions {
  scale?: number;
  imageFormat?: "JPEG" | "PNG";
  imageQuality?: number;
}

export async function generateQuotationPDFBlob(
  templateId: string,
  data: QuotationData,
  options: PDFGeneratorOptions = {},
  discountMode: "with" | "without" = "with"
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
      ...({ scale } as object),
    });

    const PAGE_W_MM = 210;
    const PAGE_H_MM = 297;
    const MARGIN_MM = 8;
    const CONTENT_H_MM = PAGE_H_MM - MARGIN_MM * 2;

    const PX_PER_MM = canvas.width / PAGE_W_MM;
    const CONTENT_H_PX = CONTENT_H_MM * PX_PER_MM;

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [PAGE_W_MM, PAGE_H_MM],
    });

    let sourceY = 0;
    let isFirstPage = true;

    while (sourceY < canvas.height - 2 * PX_PER_MM) {
      if (!isFirstPage) {
        pdf.addPage([PAGE_W_MM, PAGE_H_MM], "portrait");
      }

      const sliceH = Math.min(CONTENT_H_PX, canvas.height - sourceY);

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

