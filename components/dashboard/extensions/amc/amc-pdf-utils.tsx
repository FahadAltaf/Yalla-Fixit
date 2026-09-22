import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import { sanitizeUnsupportedColors } from "@/lib/pdf/sanitize-colors";
import { jsPDF } from "jspdf";

import {
  buildAmcDocumentModel,
  type AmcDocumentModel,
} from "./amc-document-model";
import {
  computeBodySliceOffsets,
  measureAmcLayoutHeights,
} from "./amc-pdf-pagination";
import type { AmcComputedData } from "./amc-types";
import {
  AmcDocumentMeasure,
  AmcDocumentPages,
} from "./templates/amc-doc/AmcDocumentLayouts";
import { AMC_PAGE } from "./templates/amc-doc/amc-doc-theme";

/*
  Where a PDF build has got to, so the caller can say so. A contract is
  eight or nine pages, each captured separately, and the whole build takes
  long enough that a bare spinner reads as a hang.
*/
export type AmcBuildProgress =
  | { stage: "layout" }
  | { stage: "page"; page: number; total: number }
  | { stage: "saving" };

export interface PDFGeneratorOptions {
  onProgress?: (progress: AmcBuildProgress) => void;
  scale?: number;
  imageFormat?: "JPEG" | "PNG";
  imageQuality?: number;
}

/* Waits for React to commit, fonts to load and every image in the
   container to decode — each changes heights, and a page measured or
   captured before them comes out wrong. */
async function settle(container: HTMLElement) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await document.fonts?.ready;
  await Promise.all(
    Array.from(container.querySelectorAll("img")).map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          }),
    ),
  );
  /* A timer, not requestAnimationFrame: browsers pause animation frames in
     a background tab, which would stall the PDF until the user came back. */
  await new Promise((resolve) => setTimeout(resolve, 30));
}

/* A timer, not an animation frame: a background tab pauses frames. */
const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 16));

export async function generateAmcPDFBlob(
  data: AmcComputedData,
  options: PDFGeneratorOptions = {},
): Promise<Blob> {
  return generateBrandedPdfBlob(buildAmcDocumentModel(data), {
    ...options,
    cover: true,
  });
}

/**
 * Any branded document model as an A4 PDF: optional cover, then pages with
 * the logo-and-ISO header and the address footer. Used by AMC proposals and
 * contracts, and by quotations (quotation-templates/pdf-utils.tsx).
 */
export async function generateBrandedPdfBlob(
  model: AmcDocumentModel,
  options: PDFGeneratorOptions & { cover?: boolean } = {},
): Promise<Blob> {
  /*
    Scale 1.6 and JPEG 0.82: sharp on screen and in print (about 150 dpi),
    and roughly a third of the size of the old scale 2 / 0.92, so a
    contract is small enough to email and quicker to build.
  */
  const {
    scale = 1.6,
    imageFormat = "JPEG",
    imageQuality = 0.82,
    cover = false,
    onProgress,
  } = options;
  onProgress?.({ stage: "layout" });
  await yieldToBrowser();

  const tempDiv = document.createElement("div");
  tempDiv.style.cssText = `
    position: absolute;
    left: -9999px;
    top: 0;
    width: ${AMC_PAGE.width}px;
    background: #ffffff;
  `;
  document.body.appendChild(tempDiv);

  const root = createRoot(tempDiv);

  try {
    /* flushSync: measure only after React has actually committed. */
    flushSync(() => root.render(<AmcDocumentMeasure model={model} />));
    await settle(tempDiv);

    const { bodyHeight, viewportHeight, breakPoints } =
      measureAmcLayoutHeights(tempDiv);
    const sliceOffsets = computeBodySliceOffsets(
      bodyHeight,
      viewportHeight,
      breakPoints,
    );

    flushSync(() =>
      root.render(
        <AmcDocumentPages
          model={model}
          sliceOffsets={sliceOffsets}
          bodyHeight={bodyHeight}
          cover={cover}
        />,
      ),
    );
    await settle(tempDiv);

    const pageElements = Array.from(
      tempDiv.querySelectorAll<HTMLElement>("[data-amc-page]"),
    );

    const PAGE_W_MM = 210;
    const PAGE_H_MM = 297;

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [PAGE_W_MM, PAGE_H_MM],
    });

    for (let index = 0; index < pageElements.length; index++) {
      /* Report, then give the browser a moment to paint it: each page
         capture holds the main thread, and a progress message sent right
         before one would otherwise not appear until after it. */
      onProgress?.({
        stage: "page",
        page: index + 1,
        total: pageElements.length,
      });
      await yieldToBrowser();
      const pageEl = pageElements[index];

      const canvas = await html2canvas(pageEl, {
        useCORS: true,
        allowTaint: true,
        background: "#ffffff",
        logging: false,
        width: pageEl.offsetWidth,
        height: pageEl.offsetHeight,
        /*
          html2canvas 1.x cannot parse modern colour functions, and the
          global stylesheet uses color-mix() -- including on the `*` rule,
          so every element inherits one (browsers report the result as
          `color(srgb ...)`). The shared sanitizer rewrites only those
          values, on html2canvas's clone.
        */
        /* Options the 1.x typings leave out. */
        ...({
          /*
            html2canvas clones the whole document for every page, and the
            dashboard behind the dialog is a large DOM. Skipping everything
            outside the document being captured (but keeping <head> and any
            style or link tags, for the styles) makes each page several times faster to capture.
          */
          ignoreElements: (element: Element) =>
            element !== tempDiv &&
            !element.contains(tempDiv) &&
            !tempDiv.contains(element) &&
            !document.head.contains(element) &&
            element.tagName !== "STYLE" &&
            element.tagName !== "LINK" &&
            element.parentElement !== null,
          scale,
          onclone: (doc: Document) => sanitizeUnsupportedColors(doc),
        } as object),
      });

      const imgData = canvas.toDataURL(
        `image/${imageFormat.toLowerCase()}`,
        imageQuality,
      );

      if (index > 0) {
        pdf.addPage([PAGE_W_MM, PAGE_H_MM], "portrait");
      }

      pdf.addImage(imgData, imageFormat, 0, 0, PAGE_W_MM, PAGE_H_MM);
    }

    onProgress?.({ stage: "saving" });
    await yieldToBrowser();
    return pdf.output("blob");
  } finally {
    root.unmount();
    if (document.body.contains(tempDiv)) {
      document.body.removeChild(tempDiv);
    }
  }
}
