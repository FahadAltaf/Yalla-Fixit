import React from "react";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

import {
  computeBodySliceOffsets,
  measureAmcLayoutHeights,
} from "./amc-pdf-pagination";
import type { AmcComputedData } from "./amc-types";
import { AmcContractBody } from "./templates/AmcContractBody";
import { AmcPaginatedTemplate } from "./templates/AmcPaginatedTemplate";
import { AmcPageFooter } from "./templates/amc-pdf/AmcPageFooter";
import { AmcPageHeader } from "./templates/amc-pdf/AmcPageHeader";
import { AMC_PDF_STYLES } from "./templates/amc-pdf/amc-pdf-styles";

export interface PDFGeneratorOptions {
  scale?: number;
  imageFormat?: "JPEG" | "PNG";
  imageQuality?: number;
}

function AmcMeasurementTemplate({ data }: { data: AmcComputedData }) {
  return (
    <div
      data-amc-measure-page
      style={{
        width: `${AMC_PDF_STYLES.PAGE_WIDTH}px`,
        height: `${AMC_PDF_STYLES.PAGE_HEIGHT}px`,
        boxSizing: "border-box",
        padding: "20px 28px 16px",
        display: "flex",
        flexDirection: "column",
        fontFamily: AMC_PDF_STYLES.BODY_FONT,
        position: "absolute",
        visibility: "hidden",
        pointerEvents: "none",
      }}
    >
      <div data-amc-measure-header>
        <AmcPageHeader />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <AmcContractBody data={data} isPdf />
      </div>
      <div data-amc-measure-footer>
        <AmcPageFooter page={1} totalPages={1} />
      </div>
    </div>
  );
}

export async function generateAmcPDFBlob(
  data: AmcComputedData,
  options: PDFGeneratorOptions = {}
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
    await new Promise<void>((resolve) => {
      root.render(<AmcMeasurementTemplate data={data} />);
      setTimeout(resolve, 500);
    });

    const { bodyHeight, viewportHeight } = measureAmcLayoutHeights(tempDiv);
    const sliceOffsets = computeBodySliceOffsets(bodyHeight, viewportHeight);

    await new Promise<void>((resolve) => {
      root.render(
        <AmcPaginatedTemplate
          data={data}
          sliceOffsets={sliceOffsets}
          viewportHeight={viewportHeight}
          bodyHeight={bodyHeight}
        />
      );
      setTimeout(resolve, 500);
    });

    const pageElements = Array.from(
      tempDiv.querySelectorAll<HTMLElement>("[data-amc-page]")
    );

    const PAGE_W_MM = 210;
    const PAGE_H_MM = 297;

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [PAGE_W_MM, PAGE_H_MM],
    });

    for (let index = 0; index < pageElements.length; index++) {
      const pageEl = pageElements[index];

      const canvas = await html2canvas(pageEl, {
        useCORS: true,
        allowTaint: true,
        background: "#ffffff",
        logging: false,
        width: pageEl.offsetWidth,
        height: pageEl.offsetHeight,
        ...({ scale } as object),
      });

      const imgData = canvas.toDataURL(
        `image/${imageFormat.toLowerCase()}`,
        imageQuality
      );

      if (index > 0) {
        pdf.addPage([PAGE_W_MM, PAGE_H_MM], "portrait");
      }

      pdf.addImage(imgData, imageFormat, 0, 0, PAGE_W_MM, PAGE_H_MM);
    }

    return pdf.output("blob");
  } finally {
    root.unmount();
    if (document.body.contains(tempDiv)) {
      document.body.removeChild(tempDiv);
    }
  }
}
