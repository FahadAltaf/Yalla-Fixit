/**
 * Shrinks an image in the browser before it is uploaded.
 *
 * Every upload path in the portal took whatever came off the file picker and
 * posted it. A photo straight off a phone is routinely 4 to 12MB, which is
 * slow to send on site, slow to sign and fetch back, and counts against the
 * bucket for the life of the job. None of that is needed: a floor plan or a
 * title deed is read on a screen, and 2400px is already more than a reader
 * can use.
 *
 * Runs on the client on purpose. Compressing after upload means paying for
 * the slow transfer anyway, and the inspector on a phone is the person the
 * saving is actually for.
 */

export type CompressOptions = {
  /** Longest edge, in pixels. Anything larger is scaled down to fit. */
  maxDimension?: number;
  /** Encoder quality, 0 to 1. */
  quality?: number;
  /** Below this, the file is left alone. */
  skipUnderBytes?: number;
};

const DEFAULTS = {
  // Comfortably past what a screen or an A4 print can resolve, and still a
  // large drop from a modern phone camera's 4000px.
  maxDimension: 2400,
  quality: 0.82,
  // A small file has nothing worth reclaiming, and re-encoding it can make
  // it bigger.
  skipUnderBytes: 300 * 1024,
};

export type CompressResult = {
  file: File;
  width: number | null;
  height: number | null;
  /** True when the returned file is the one that came in. */
  unchanged: boolean;
};

/** Only raster images are worth re-encoding; a PDF is left as it is. */
function isCompressible(file: File): boolean {
  return /^image\/(jpeg|jpg|png|webp)$/i.test(file.type);
}

function extensionFor(mime: string): string {
  return mime === "image/webp" ? ".webp" : ".jpg";
}

/**
 * Picks the best encoder this browser actually supports.
 *
 * WebP holds line art (a floor plan, a stamped deed) far better than JPEG at
 * the same size, but the check has to be real rather than assumed: a canvas
 * asked for an unsupported type silently hands back a PNG, which would make
 * "compression" double the file.
 */
let encoderPromise: Promise<string> | null = null;
function bestEncoder(): Promise<string> {
  if (!encoderPromise) {
    encoderPromise = (async () => {
      try {
        const probe = document.createElement("canvas");
        probe.width = 1;
        probe.height = 1;
        const url = probe.toDataURL("image/webp");
        return url.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
      } catch {
        return "image/jpeg";
      }
    })();
  }
  return encoderPromise;
}

/**
 * Compresses one image, or returns it untouched when that is the better
 * outcome.
 *
 * Never throws for an image reason: if anything about the decode or encode
 * fails, the original file is returned and the upload proceeds. A failed
 * optimisation must not become a failed upload.
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const { maxDimension, quality, skipUnderBytes } = { ...DEFAULTS, ...options };

  if (!isCompressible(file)) {
    return { file, width: null, height: null, unchanged: true };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    // `from-image` applies the EXIF orientation flag. Without it a photo the
    // phone recorded as rotated is drawn on its side, because the flag does
    // not survive the canvas.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

    const { width: sourceWidth, height: sourceHeight } = bitmap;
    const longest = Math.max(sourceWidth, sourceHeight);
    const scale = longest > maxDimension ? maxDimension / longest : 1;

    // Nothing to gain: already small enough and already modest in size.
    if (scale === 1 && file.size <= skipUnderBytes) {
      return {
        file,
        width: sourceWidth,
        height: sourceHeight,
        unchanged: true,
      };
    }

    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    // Matters when scaling down by a large factor; the default sampling
    // leaves thin lines on a floor plan looking broken.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    const mime = await bestEncoder();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime, quality),
    );
    if (!blob) throw new Error("encode returned nothing");

    /*
      Keep whichever is smaller.

      Re-encoding does not always win. A flat PNG screenshot, or a photo the
      phone already compressed hard, can come out larger, and shipping a
      bigger file than the user chose would be a straightforward regression.
    */
    if (blob.size >= file.size) {
      return {
        file,
        width: sourceWidth,
        height: sourceHeight,
        unchanged: true,
      };
    }

    const name = file.name.replace(/\.[^.]+$/, "") + extensionFor(mime);
    return {
      file: new File([blob], name, { type: mime, lastModified: Date.now() }),
      width,
      height,
      unchanged: false,
    };
  } catch (error) {
    console.warn("Image compression skipped:", error);
    return { file, width: null, height: null, unchanged: true };
  } finally {
    bitmap?.close();
  }
}

/** Reads an image's pixel dimensions without re-encoding it. */
export async function readImageSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (!isCompressible(file)) return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { width: bitmap.width, height: bitmap.height };
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
