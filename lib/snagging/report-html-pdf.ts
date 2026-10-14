import html2canvas from "html2canvas";

import { canvasToPdfBlob, collectPdfBlocks } from "@/lib/pdf/paginate";

/**
 * The inspection report as a PDF, made in the browser from the report's own
 * HTML (SNG-140).
 *
 * The portal and the client link both show `renderReportHtml`'s page; this
 * prints its A4 `print` layout to a file, so the PDF looks like the page the
 * reader was looking at. It runs in the browser because the server's
 * headless Chrome is not available everywhere the portal is deployed, and a
 * download must not depend on it.
 *
 * The report is loaded into an off-screen iframe so its stylesheet (which
 * styles `html`, `body` and bare headings) cannot touch the page around it,
 * and the page's theme cannot touch the report.
 */

type HeaderImage = { dataUrl: string; widthMm: number; heightMm: number };

/* A4 at 96dpi: the width the print layout is set to. */
const A4_PX = 794;

/*
  An image as a flattened PNG data URI. jsPDF cannot take a URL, and a
  transparent PNG comes through with black where it was clear, so each is
  painted onto white first. A failure loses the image, never the PDF.
*/
async function loadFlattened(src: string, heightMm: number): Promise<HeaderImage | undefined> {
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

/**
 * Resolves once every image has loaded or failed, or the timeout passes.
 * Rasterising before the signed photo URLs arrive puts grey boxes in the
 * PDF; one broken photo must not cost the download.
 */
async function waitForImages(root: ParentNode, timeoutMs = 15_000): Promise<void> {
  const pending = Array.from(root.querySelectorAll("img")).filter(
    (img) => !img.complete || img.naturalWidth === 0,
  );
  if (pending.length === 0) return;
  await Promise.race([
    Promise.all(
      pending.map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
      ),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Prints a full report HTML document (the `print` layout) to a PDF blob.
 *
 * `place` names the unit in the running head on every page after the cover,
 * as the AMC documents and the earlier report did.
 */
export async function reportHtmlToPdfBlob(
  html: string,
  options: { place?: string | null; footerLabel?: string } = {},
): Promise<Blob> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${A4_PX}px;height:1123px;border:0;visibility:visible;pointer-events:none`;
  document.body.appendChild(frame);

  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error("Could not open the report"));
      frame.srcdoc = html;
    });
    const doc = frame.contentDocument;
    if (!doc) throw new Error("Could not open the report");
    const root = (doc.querySelector(".page") as HTMLElement | null) ?? doc.body;

    // Photos are cross-origin signed URLs: ask for them with CORS so the
    // canvas is not tainted, then wait for every one.
    for (const img of Array.from(doc.querySelectorAll("img"))) {
      if (!img.src.startsWith("data:") && !img.crossOrigin) {
        img.crossOrigin = "anonymous";
        const src = img.src;
        img.src = "";
        img.src = src;
      }
    }
    await waitForImages(doc);

    // The frame grows to the document, so nothing is cut at its viewport.
    const fullHeight = Math.max(doc.documentElement.scrollHeight, root.scrollHeight);
    frame.style.height = `${fullHeight}px`;

    const [canvas, logo, ...badges] = await Promise.all([
      html2canvas(root, {
        useCORS: true,
        allowTaint: false,
        background: "#ffffff",
        logging: false,
        // Typed by an older definition than the library itself ships.
        ...({
          // About 150dpi: sharp in print, and a third of the size of 2x.
          scale: 1.6,
          windowWidth: A4_PX,
          windowHeight: fullHeight,
        } as object),
      }),
      loadFlattened("/amc/brand/logo-trimmed.png", 9),
      loadFlattened("/amc/brand/iso-14001.png", 8),
      loadFlattened("/amc/brand/iso-9001.png", 8),
      loadFlattened("/amc/brand/iso-45001.png", 8),
    ]);

    const place = options.place?.trim();
    return canvasToPdfBlob(canvas, {
      blocks: collectPdfBlocks(root, canvas),
      imageQuality: 0.82,
      header: {
        text: `Property handover snagging report${place ? ` · ${place}` : ""}`,
        logo,
        badges: badges.filter((badge): badge is HeaderImage => Boolean(badge)),
        skipFirstPage: true,
        rgb: [140, 29, 36],
      },
      footer: (page, pageCount) =>
        [options.footerLabel, `Page ${page} of ${pageCount}`].filter(Boolean).join("  ·  "),
    });
  } finally {
    frame.remove();
  }
}
