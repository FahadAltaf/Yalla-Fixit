import html2canvas from "html2canvas";

import { canvasToPdfBlob, collectPdfBlocks } from "@/lib/pdf/paginate";
import { sanitizeUnsupportedColors } from "@/lib/pdf/sanitize-colors";

/**
 * Turns an already-rendered DOM node into a multi-page A4 PDF blob.
 *
 * Rasterise with html2canvas, then hand the canvas to the shared paginator
 * along with the pixel ranges of every card, so no page break lands inside
 * one. The node must use inline hex/rgb colours -- html2canvas cannot read
 * Tailwind v4's oklch theme tokens.
 *
 * The slicing itself used to live here as a second copy of the quotation
 * generator's loop, and the two drifted; both now share lib/pdf/paginate.
 */
export async function elementToPdfBlob(
  node: HTMLElement,
  scale = 2,
  options: { footerLabel?: string } = {},
): Promise<Blob> {
  const canvas = await html2canvas(node, {
    useCORS: true,
    allowTaint: true,
    background: "#ffffff",
    logging: false,
    ...({ scale, onclone: (doc: Document) => sanitizeUnsupportedColors(doc) } as object),
  });

  const { footerLabel } = options;

  return canvasToPdfBlob(canvas, {
    blocks: collectPdfBlocks(node, canvas),
    footer: (page, pageCount) =>
      [footerLabel, `Page ${page} of ${pageCount}`].filter(Boolean).join("  \u00b7  "),
  });
}

/**
 * Resolves once every image in the tree has loaded, or the timeout passes.
 *
 * A fixed delay is not enough here: the report carries a signed URL per
 * photo, and rasterising before they arrive puts empty grey boxes in the
 * PDF. Errors resolve too -- one broken photo must not cost the download.
 */
async function waitForImages(root: HTMLElement, timeoutMs = 10_000): Promise<void> {
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
 * Renders a React element into a detached, on-body container, rasterises it to
 * a PDF, then cleans up. This is the reliable path for a document that isn't
 * already visible on screen -- html2canvas cannot capture a node parked far
 * off-screen inside the app tree, and a detached container also avoids
 * inheriting the app's oklch theme colours (which html2canvas can't parse).
 */
export async function renderReactToPdfBlob(
  element: import("react").ReactElement,
  scale = 2,
  options: { footerLabel?: string } = {},
): Promise<Blob> {
  const { createRoot } = await import("react-dom/client");
  const holder = document.createElement("div");
  holder.style.cssText =
    "position:fixed;left:-9999px;top:0;width:794px;background:#ffffff;z-index:-1;pointer-events:none";
  document.body.appendChild(holder);
  const root = createRoot(holder);
  try {
    await new Promise<void>((resolve) => {
      root.render(element);
      // One frame for React to commit, then wait on the photos themselves.
      setTimeout(resolve, 100);
    });
    await waitForImages(holder);
    return await elementToPdfBlob(holder, scale, options);
  } finally {
    root.unmount();
    holder.remove();
  }
}
