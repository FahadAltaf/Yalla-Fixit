import { jsPDF } from "jspdf";

/**
 * Slices one tall html2canvas raster into A4 pages.
 *
 * Both PDF paths -- the client quotation and the snagging inspection report
 * -- rasterise a DOM node and then have to cut it into pages. They each had
 * their own copy of that loop, and the copies drifted: a fix to one (the
 * trailing-whitespace blank page) never reached the other. This is the one
 * copy.
 *
 * Two things decide where a page ends:
 *
 *   - `blocks`, the pixel ranges of things that must not be split. The
 *     report is built from cards, and a cut through the middle of one is
 *     what made page two open on half a row of checklist with no heading.
 *     A break inside a block is moved up to the block's top.
 *   - failing that, a mostly-white row near the target, so the cut at
 *     least misses a line of text.
 *
 * A block taller than a page cannot be honoured, and falls back to the
 * white-row search rather than pushing an empty page.
 */

export type PdfBlock = { start: number; end: number };

export type PaginateOptions = {
  pageWidthMm?: number;
  pageHeightMm?: number;
  marginMm?: number;
  imageFormat?: "JPEG" | "PNG";
  imageQuality?: number;
  /** Canvas-pixel ranges that a page break must not land inside. */
  blocks?: PdfBlock[];
  /** Drawn bottom-left on every page, e.g. "BURTOWPR-KA09 · Page 1 of 2". */
  footer?: (page: number, pageCount: number) => string;
};

/** How much ink a row needs before it counts as content rather than a stray pixel. */
const INK_RATIO = 0.004;
/** Under this, a row is white enough to cut through. */
const BREAKABLE_RATIO = 0.008;
/** The coarse step of the bottom-up content scan. */
const COARSE_STEP = 8;

function rowInk(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  y: number,
  stopAt: number,
): number {
  const row = ctx.getImageData(0, y, canvasWidth, 1).data;
  let dark = 0;
  for (let i = 0; i < row.length; i += 4) {
    const a = row[i + 3];
    if (a > 10 && (row[i] < 245 || row[i + 1] < 245 || row[i + 2] < 245)) {
      dark++;
      if (dark / canvasWidth > stopAt) return dark;
    }
  }
  return dark;
}

/**
 * The last row carrying ink, or -1 for a blank canvas.
 *
 * html2canvas renders the node's whole box, bottom padding included, so the
 * canvas overshoots the content. Paginating against the raw height opened a
 * final, entirely blank page.
 */
function findLastInkedRow(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
): number {
  const inked = (y: number) => rowInk(ctx, canvasWidth, y, INK_RATIO) / canvasWidth > INK_RATIO;

  for (let y = canvasHeight - 1; y >= 0; y -= COARSE_STEP) {
    if (!inked(y)) continue;
    // The true last row is inside the chunk the coarse pass stepped over.
    const upper = Math.min(canvasHeight - 1, y + COARSE_STEP - 1);
    for (let fine = upper; fine > y; fine--) {
      if (inked(fine)) return fine;
    }
    return y;
  }
  return -1;
}

/** A mostly-white row at or above the target, so a cut misses the text. */
function whiteRowNear(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  target: number,
  minOffset: number,
  maxBacktrack: number,
): number {
  const from = Math.floor(target);
  const to = Math.max(minOffset, from - maxBacktrack);
  for (let y = from; y >= to; y--) {
    if (rowInk(ctx, canvasWidth, y, BREAKABLE_RATIO) / canvasWidth < BREAKABLE_RATIO) {
      return y;
    }
  }
  return from;
}

/**
 * Moves a break out of any block it lands inside, walking outwards so a
 * nested card breaks at the outer card's top rather than between the two.
 * Returns null when no viable block boundary exists above `minOffset`.
 */
function breakAboveBlocks(target: number, blocks: PdfBlock[], minOffset: number): number | null {
  let at = target;
  // Bounded rather than `while (true)`: each pass strictly decreases `at`,
  // but a malformed range should not be able to spin.
  for (let pass = 0; pass < 8; pass++) {
    const hit = blocks.find((block) => block.start < at && at < block.end);
    if (!hit) return at === target ? null : at;
    if (hit.start <= minOffset) return null;
    at = hit.start;
  }
  return at > minOffset ? at : null;
}

export function canvasToPdfBlob(
  canvas: HTMLCanvasElement,
  options: PaginateOptions = {},
): Blob {
  const {
    pageWidthMm = 210,
    pageHeightMm = 297,
    marginMm = 8,
    imageFormat = "JPEG",
    imageQuality = 0.92,
    blocks = [],
    footer,
  } = options;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to read the rendered canvas.");

  const pxPerMm = canvas.width / pageWidthMm;
  const footerMm = footer ? 6 : 0;
  const contentHpx = (pageHeightMm - marginMm * 2 - footerMm) * pxPerMm;
  const minSlicePx = 28 * pxPerMm;
  const backtrackPx = 45 * pxPerMm;

  // Paginate against where the content ends, not where the canvas does.
  const lastInked = findLastInkedRow(ctx, canvas.width, canvas.height);
  const contentHeight =
    lastInked < 0
      ? 0
      : Math.min(canvas.height, lastInked + 1 + Math.round(3 * pxPerMm));

  // Every cut is decided before a single page is drawn, so the footer can
  // say "of N" -- a page count is not knowable half way through the loop.
  const slices: Array<{ from: number; height: number }> = [];
  let sourceY = 0;
  while (sourceY < contentHeight) {
    const ideal = Math.min(contentHpx, contentHeight - sourceY);
    const remaining = contentHeight - (sourceY + ideal);
    let end = sourceY + ideal;

    if (remaining > minSlicePx) {
      const minEnd = sourceY + minSlicePx;
      end =
        breakAboveBlocks(end, blocks, minEnd) ??
        whiteRowNear(ctx, canvas.width, end, minEnd, backtrackPx);
    }

    slices.push({ from: sourceY, height: end - sourceY });
    sourceY = end;
  }

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: [pageWidthMm, pageHeightMm],
  });

  slices.forEach((slice, index) => {
    if (index > 0) pdf.addPage([pageWidthMm, pageHeightMm], "portrait");

    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = slice.height;
    const pageCtx = pageCanvas.getContext("2d");
    if (!pageCtx) throw new Error("Unable to build the page canvas.");
    // White behind the slice: a JPEG has no alpha, and an unpainted canvas
    // encodes as black.
    pageCtx.fillStyle = "#ffffff";
    pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageCtx.drawImage(
      canvas,
      0,
      slice.from,
      canvas.width,
      slice.height,
      0,
      0,
      canvas.width,
      slice.height,
    );

    pdf.addImage(
      pageCanvas.toDataURL(`image/${imageFormat.toLowerCase()}`, imageQuality),
      imageFormat,
      0,
      marginMm,
      pageWidthMm,
      slice.height / pxPerMm,
    );

    if (footer) {
      pdf.setFontSize(7.5);
      pdf.setTextColor(150, 150, 155);
      pdf.text(
        footer(index + 1, slices.length),
        pageWidthMm / 2,
        pageHeightMm - marginMm / 2,
        { align: "center" },
      );
    }
  });

  return pdf.output("blob");
}

/**
 * Pixel ranges, in canvas space, of the elements a page break must miss.
 *
 * Measured off the live DOM before rasterising, which is exact -- the
 * alternative is guessing from pixels where one card ends and the next
 * begins, and a bordered card on a tinted ground gives no white row to find.
 */
export function collectPdfBlocks(
  node: HTMLElement,
  canvas: HTMLCanvasElement,
  selector = "[data-pdf-block]",
): PdfBlock[] {
  const scale = canvas.width / node.offsetWidth;
  const top = node.getBoundingClientRect().top;

  return Array.from(node.querySelectorAll<HTMLElement>(selector))
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        start: Math.floor((rect.top - top) * scale),
        end: Math.ceil((rect.bottom - top) * scale),
      };
    })
    .filter((block) => block.end > block.start)
    // Outermost first, so the break walk climbs out of nesting in one pass.
    .sort((a, b) => a.start - b.start || b.end - a.end);
}
