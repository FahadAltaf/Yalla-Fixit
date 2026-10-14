import { compressImage } from "@/lib/media/compress-image";

/** What a floor plan picker accepts. A PDF is turned into an image on pick. */
export const FLOOR_PLAN_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

export type PinnablePlan = { file: File; width?: number; height?: number };

/**
 * Prepares a floor plan so it can be pinned and drawn on everywhere.
 *
 * An image is downscaled and re-encoded before it leaves the device. A PDF is
 * rendered (page 1) to a PNG first, so it is never stored as a plan nobody can
 * mark (FR-3.05 #7, UAT SNG-055). The returned dimensions are the ones actually
 * uploaded, so pin coordinates are relative to the image the report shows.
 *
 * Browser only: it needs a canvas.
 */
export async function toPinnablePlan(file: File): Promise<PinnablePlan> {
  if (file.type.startsWith("image/")) {
    const compressed = await compressImage(file);
    return {
      file: compressed.file,
      width: compressed.width ?? undefined,
      height: compressed.height ?? undefined,
    };
  }

  if (file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    // Point the worker at the bundled module worker.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not render the PDF");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/png"),
    );
    if (!blob) throw new Error("Could not convert the PDF to an image");
    // A page rasterised at scale 2 is a large PNG; run it through the same
    // compressor so a PDF plan does not cost several times an image one.
    const png = new File([blob], file.name.replace(/\.pdf$/i, ".png"), {
      type: "image/png",
    });
    const compressed = await compressImage(png);
    return {
      file: compressed.file,
      width: compressed.width ?? canvas.width,
      height: compressed.height ?? canvas.height,
    };
  }

  throw new Error("Floor plans must be an image (PNG/JPG) or a PDF");
}
