/**
 * Demo safety switch for outgoing email.
 *
 * The AMC demo runs the new code against the production database, where
 * proposals, contracts and contacts carry real addresses. When
 * EMAIL_REDIRECT_TO is set (only in the demo app's environment), every
 * email this app instance sends goes to that one inbox instead, with the
 * intended recipients shown at the top. Live `main` never sets it, so live
 * email is unaffected. Unset or blank: nothing changes.
 */
export type Envelope = {
  to?: string | string[];
  cc?: string[];
  subject: string;
  html: string;
};

const list = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function applyEmailRedirect(envelope: Envelope, redirectTo: string | undefined = process.env.EMAIL_REDIRECT_TO): Envelope {
  const target = redirectTo?.trim();
  if (!target) return envelope;
  const intendedTo = list(envelope.to);
  const intendedCc = list(envelope.cc);
  const banner =
    `<div style="border:1px solid #f59e0b;background:#fffbeb;padding:8px 12px;margin-bottom:12px;font:13px sans-serif">` +
    `<strong>Demo copy.</strong> This email was redirected and was not sent to its recipients.<br>` +
    `To: ${escapeHtml(intendedTo.join(", ") || "(none)")}` +
    (intendedCc.length ? `<br>Cc: ${escapeHtml(intendedCc.join(", "))}` : "") +
    `</div>`;
  return {
    to: target,
    cc: undefined,
    subject: `[DEMO] ${envelope.subject}`,
    html: banner + envelope.html,
  };
}
