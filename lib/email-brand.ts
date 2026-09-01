/**
 * The masthead for client-facing emails.
 *
 * Carries the same logo as the PDF quotation (public/yalla-fixit.png), so
 * the email and the document attached to it read as one brand rather than
 * an image on one and a text wordmark on the other.
 *
 * The src must be an absolute, publicly reachable URL: the recipient's mail
 * client fetches it from its own network, so a Next static import (a hashed
 * /_next/static path) or a relative path resolves to nothing. This is the
 * same origin the approval and report links are built from, and public/ is
 * served at the root and is outside the middleware matcher, so the file
 * needs no session to fetch.
 *
 * The alt text carries the wordmark, so the header still reads as Yalla Fix
 * It in clients that block remote images -- which is what the header said
 * before, so nothing is lost when the image does not load.
 */
export function emailMasthead(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

  return `
    <img src="${base}/yalla-fixit.png" alt="Yalla Fix It" width="64" height="66"
         style="display:block;width:64px;height:66px;border:0;outline:none;text-decoration:none" />
    <div style="font-size:12px;color:#6b7280;margin:10px 0 18px">Property Care &middot; Snagging</div>`;
}
