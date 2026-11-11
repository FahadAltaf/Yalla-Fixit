/**
 * Assessment photo rules, shared by the API and the tests. No imports.
 *
 * Photos are evidence of a property's condition. They live in the private
 * `amc-documents` bucket (never the public uploads bucket), are added and
 * removed only while the assessment is a draft, and are kept unchanged
 * once it is completed.
 */

export const AMC_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const AMC_PHOTOS_PER_ASSESSMENT = 20;
export type AmcPhotoType = "image/jpeg" | "image/png" | "image/webp";

/**
 * The image type from the file's own first bytes, not from its name or
 * the browser's claim. Anything else (including SVG, which can carry
 * script) is refused.
 */
export function detectImageType(bytes: Uint8Array): AmcPhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export const PHOTO_EXTENSION: Record<AmcPhotoType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type PhotoCheck = { ok: true; type: AmcPhotoType } | { ok: false; status: 400 | 403 | 409; error: string };

/** Whether this file may be added to this assessment now. */
export function checkPhotoUpload(input: {
  assessmentStatus: string;
  canEdit: boolean;
  existingCount: number;
  bytes: Uint8Array;
}): PhotoCheck {
  if (input.assessmentStatus !== "draft") {
    return { ok: false, status: 409, error: "A completed assessment's photos are kept as they are." };
  }
  if (!input.canEdit) return { ok: false, status: 403, error: "Only its assessor or an AMC approver can add photos." };
  if (input.existingCount >= AMC_PHOTOS_PER_ASSESSMENT) {
    return { ok: false, status: 409, error: `An assessment holds at most ${AMC_PHOTOS_PER_ASSESSMENT} photos.` };
  }
  if (input.bytes.byteLength === 0) return { ok: false, status: 400, error: "The file is empty." };
  if (input.bytes.byteLength > AMC_PHOTO_MAX_BYTES) return { ok: false, status: 400, error: "A photo can be at most 10 MB." };
  const type = detectImageType(input.bytes);
  if (!type) return { ok: false, status: 400, error: "Only JPEG, PNG or WebP photos can be added." };
  return { ok: true, type };
}

/** Whether a photo may be removed: drafts only, by whoever may edit. */
export function checkPhotoRemoval(input: { assessmentStatus: string; canEdit: boolean }): { ok: true } | { ok: false; status: 403 | 409; error: string } {
  if (input.assessmentStatus !== "draft") {
    return { ok: false, status: 409, error: "A completed assessment's photos are kept as history." };
  }
  if (!input.canEdit) return { ok: false, status: 403, error: "Only its assessor or an AMC approver can remove photos." };
  return { ok: true };
}
