import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * Turns an already-rendered DOM node into a multi-page A4 PDF blob.
 *
 * This mirrors the quotation PDF generator: rasterise the node with
 * html2canvas, then slice the canvas into A4 pages, preferring to cut on a
 * mostly-white row so a page break never lands through a line of text or a
 * photo. The node must use inline hex/rgb colours — html2canvas cannot read
 * Tailwind v4's oklch theme tokens.
 */

/** Find a mostly-white row near the target so a page break avoids cutting content. */
function findSafePageBreakOffset(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  targetOffset: number,
  maxBacktrackPx: number,
  minOffset: number,
): number {
  const target = Math.floor(targetOffset);
  const minCandidate = Math.max(minOffset, target - maxBacktrackPx);

  for (let y = target; y >= minCandidate; y--) {
    const row = ctx.getImageData(0, y, canvasWidth, 1).data;
    let darkPixels = 0;
    for (let i = 0; i < row.length; i += 4) {
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      const a = row[i + 3];
      if (a > 10 && (r < 245 || g < 245 || b < 245)) darkPixels++;
    }
    if (darkPixels / canvasWidth < 0.008) return y;
  }
  return target;
}

export async function elementToPdfBlob(node: HTMLElement, scale = 2): Promise<Blob> {
  const canvas = await html2canvas(node, {
    useCORS: true,
    allowTaint: true,
    background: "#ffffff",
    logging: false,
    ...({ scale } as object),
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
  if (!canvasCtx) throw new Error("Unable to read the rendered report canvas.");

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [PAGE_W_MM, PAGE_H_MM] });

  let sourceY = 0;
  let isFirstPage = true;

  while (sourceY < canvas.height - 2 * PX_PER_MM) {
    if (!isFirstPage) pdf.addPage([PAGE_W_MM, PAGE_H_MM], "portrait");

    const idealSliceH = Math.min(CONTENT_H_PX, canvas.height - sourceY);
    const remainingAfterIdeal = canvas.height - (sourceY + idealSliceH);

    let sliceH = idealSliceH;
    if (remainingAfterIdeal > MIN_SLICE_H_PX) {
      sliceH =
        findSafePageBreakOffset(
          canvasCtx,
          canvas.width,
          sourceY + idealSliceH,
          PAGE_BREAK_BACKTRACK_PX,
          sourceY + MIN_SLICE_H_PX,
        ) - sourceY;
    }

    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceH;
    const ctx = pageCanvas.getContext("2d")!;
    ctx.drawImage(canvas, 0, sourceY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

    const pageImgData = pageCanvas.toDataURL("image/jpeg", 0.92);
    const sliceHeightMm = (sliceH / canvas.width) * PAGE_W_MM;
    pdf.addImage(pageImgData, "JPEG", 0, MARGIN_MM, PAGE_W_MM, sliceHeightMm);

    sourceY += sliceH;
    isFirstPage = false;
  }

  return pdf.output("blob");
}
