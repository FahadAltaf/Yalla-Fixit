/*
  FR-16: what a task attachment may be, checked on the server from the
  file's own bytes, not from the browser's label.

  The allowlist is deliberately short: PDF, Word (.docx), Excel (.xlsx),
  CSV, PNG, JPG and the HEIC photos iPhones take. Macro-enabled Office files
  (.docm, .xlsm), the legacy .doc/.xls binaries, SVG and HTML (both can carry
  script), archives and executables are refused. A file is accepted only
  when its extension and its content signature agree, so a renamed .exe is
  refused as a PDF and a .docm renamed to .docx is caught by the
  vbaProject.bin entry its zip directory still lists.

  No dependency: signatures are a few bytes at the start, and the Office
  checks look for entry names that a zip's central directory stores in
  plain text.
*/

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export type AttachmentKind = "pdf" | "docx" | "xlsx" | "csv" | "png" | "jpg" | "heic";

const KIND_BY_EXTENSION: Record<string, AttachmentKind> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  csv: "csv",
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  heic: "heic",
  heif: "heic",
};

export const ATTACHMENT_ACCEPT = ".pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg,.heic,.heif";

export const ALLOWED_TYPES_LABEL = "PDF, Word (.docx), Excel (.xlsx), CSV, PNG, JPG or HEIC";

// The stored content type comes from the detected kind, never from the
// browser, so a signed download carries the right header.
const CONTENT_TYPE: Record<AttachmentKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  heic: "image/heic",
};

export type SignatureResult =
  | { ok: true; kind: AttachmentKind; contentType: string; extension: string }
  | { ok: false; reason: string };

export function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  // Latin-1 decoding keeps every byte as one char, so indexOf on the whole
  // buffer finds the zip directory's entry names wherever they sit.
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(needle, 0, "latin1");
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"]);

function isZip(bytes: Uint8Array) {
  return startsWith(bytes, ZIP_MAGIC);
}

function looksBinary(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x25, 0x50, 0x44, 0x46]) || // %PDF
    startsWith(bytes, ZIP_MAGIC) ||
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || // PNG
    startsWith(bytes, [0xff, 0xd8, 0xff]) || // JPEG
    startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) || // legacy Office (OLE)
    startsWith(bytes, [0x4d, 0x5a]) || // MZ executable
    startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) // ELF
  );
}

/**
 * Decides whether `bytes` are an allowed attachment named `fileName`.
 * The whole file is passed (uploads are capped at 25 MiB), because the
 * Office checks need the zip's central directory, which sits at the end.
 */
export function checkAttachmentSignature(fileName: string, bytes: Uint8Array): SignatureResult {
  const extension = extensionOf(fileName);
  const kind = KIND_BY_EXTENSION[extension];
  if (!kind) {
    return { ok: false, reason: `Files of type .${extension || "?"} are not allowed. Allowed: ${ALLOWED_TYPES_LABEL}.` };
  }
  if (bytes.length === 0) return { ok: false, reason: "The file is empty." };

  const mismatch = (): SignatureResult => ({
    ok: false,
    reason: `The file's content does not match its .${extension} name, so it was refused.`,
  });

  switch (kind) {
    case "pdf":
      if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return mismatch(); // %PDF-
      break;
    case "png":
      if (!startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return mismatch();
      break;
    case "jpg":
      if (!startsWith(bytes, [0xff, 0xd8, 0xff])) return mismatch();
      break;
    case "heic": {
      if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return mismatch();
      if (!HEIC_BRANDS.has(ascii(bytes, 8, 4).toLowerCase().trim())) return mismatch();
      break;
    }
    case "docx":
    case "xlsx": {
      // Entry names are looked for as plain text, which proves the parts
      // are listed, not that the package is well formed. A zip padded with
      // these names would pass; a real parse is more than this needs.
      if (!isZip(bytes)) return mismatch();
      if (containsAscii(bytes, "vbaProject.bin")) {
        return { ok: false, reason: "Macro-enabled Office files are not allowed." };
      }
      const marker = kind === "docx" ? "word/document.xml" : "xl/workbook.xml";
      if (!containsAscii(bytes, "[Content_Types].xml") || !containsAscii(bytes, marker)) return mismatch();
      break;
    }
    case "csv": {
      if (looksBinary(bytes)) return mismatch();
      if (bytes.includes(0)) return mismatch();
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return { ok: false, reason: "A CSV must be UTF-8 text." };
      }
      break;
    }
  }

  return { ok: true, kind, contentType: CONTENT_TYPE[kind], extension: kind === "jpg" ? "jpg" : extension };
}
