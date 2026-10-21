/**
 * Evidence files attached to an exclusion request (BRD §5.1 Step 5).
 * Shared by the upload route, the exclusion route and the item screen so
 * the limits are stated once.
 */

export const EVIDENCE_BUCKET = "finance-evidence";
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_MAX_FILES = 10;

/** File types the bucket accepts (20261022110000), with the extension shown in the picker. */
export const EVIDENCE_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg,.jpeg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "message/rfc822": ".eml",
  "application/vnd.ms-outlook": ".msg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/msword": ".doc",
  "application/vnd.ms-excel": ".xls",
  "text/plain": ".txt",
};

export const EVIDENCE_ACCEPT = Object.values(EVIDENCE_TYPES).join(",");

/** Browsers leave the type empty for .msg and some .eml files; fall back on the extension. */
export function evidenceContentType(fileName: string, browserType: string): string | null {
  if (browserType && browserType in EVIDENCE_TYPES) return browserType;
  const ext = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  if (!ext) return null;
  for (const [type, exts] of Object.entries(EVIDENCE_TYPES)) {
    if (exts.split(",").includes(ext)) return type;
  }
  return null;
}

/** Every evidence object of a queue item lives under this prefix. */
export function evidencePrefix(itemId: string) {
  return `queue/${itemId}/`;
}

/** The file name as uploaded: the path is `queue/<item>/<uuid>-<name>`. */
export function evidenceFileName(path: string) {
  const last = path.slice(path.lastIndexOf("/") + 1);
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

/** Storage keys keep to a safe alphabet; the original name is only for display. */
export function safeEvidenceName(fileName: string) {
  const cleaned = fileName
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\.{2,}/g, ".")
    .trim()
    .replace(/\s+/g, "_");
  return (cleaned || "file").slice(-100);
}
