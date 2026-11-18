/**
 * A PDF the portal built in the browser and sent along with an action
 * (18 Nov 2026): the service report as the viewer shows it, since live
 * servers have no Chrome to print with. At most ~12 MB, and it must be a
 * PDF; anything else is ignored and the server prints its own.
 */
export function browserPdfFrom(body: unknown): Uint8Array | null {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).pdfBase64 : null;
  if (typeof raw !== "string" || !raw || raw.length > 16_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const bytes = new Uint8Array(Buffer.from(raw, "base64"));
  /* "%PDF" */
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? bytes : null;
}
