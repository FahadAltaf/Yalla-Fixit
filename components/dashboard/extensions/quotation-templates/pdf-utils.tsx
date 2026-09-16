import React from "react";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";

import { canvasToPdfBlob, collectPdfBlocks } from "@/lib/pdf/paginate";
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

export async function generateQuotationPDFBlob(
  templateId: string,
  data: QuotationData,
  options: PDFGeneratorOptions = {},
  discountMode:
    "with" | "without" | "with-total" | "with-total-no-list" = "with",
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
      ...({
        scale,
        onclone: (doc: Document) => sanitizeUnsupportedColors(doc),
      } as object),
    });

    // The slicing lives in lib/pdf/paginate, shared with the snagging
    // report. Both used to carry their own copy of this loop and the copies
    // drifted -- the trailing-whitespace blank page was fixed in one of them
    // and not the other.
    return canvasToPdfBlob(canvas, {
      blocks: collectPdfBlocks(tempDiv, canvas),
      imageFormat,
      imageQuality,
    });
  } finally {
    root.unmount();
    if (document.body.contains(tempDiv)) {
      document.body.removeChild(tempDiv);
    }
  }
}
