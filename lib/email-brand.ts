/**
 * Branding for the emails the portal sends.
 *
 * The logo is embedded in the message (an inline "cid:" attachment) rather
 * than linked from the app's public URL. A linked image only shows when the
 * mail client can fetch it, and from a local or staging server that URL is
 * localhost, which is why the snagging emails showed a broken image.
 * `withInlineLogo` (lib/server/email-logo-attachment.ts) adds the attachment to any message whose HTML refers to
 * it; both senders (lib/server/send-email.ts and /api/send-email) call it,
 * so every email that uses the masthead gets the logo.
 *
 * The alt text carries the wordmark, so the header still reads as Yalla Fix
 * It in clients that block images.
 */

const BRAND = "#83201e";
const INK = "#1f1a17";
const MUTED = "#6b625c";
const LINE = "#ece6e1";
const TINT = "#faf7f5";

/* The logo image itself is attached by lib/server/email-logo-attachment.ts. */
export const EMAIL_LOGO_CID = "yalla-fix-it-logo";
const LOGO_SRC = `cid:${EMAIL_LOGO_CID}`;

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The logo and a small label, for the internal notification emails that
 * keep their own simple layout.
 */
export function emailMasthead(
  label = "Property Care &middot; Snagging",
): string {
  return `
    <img src="${LOGO_SRC}" alt="Yalla Fix It" width="150" height="63"
         style="display:block;width:150px;height:63px;border:0;outline:none;text-decoration:none" />
    <div style="font-size:12px;color:${MUTED};margin:10px 0 18px">${label}</div>`;
}

export type ClientEmailOptions = {
  /** Small label at the top right of the header, e.g. "AMC proposal". */
  eyebrow: string;
  heading: string;
  /** Plain text; escaped here. */
  greeting?: string;
  /** Trusted HTML paragraphs (escape any values put into them). */
  paragraphs: string[];
  /** Label/value rows in a tinted box. Plain text; escaped here. */
  details?: { label: string; value: string }[];
  cta?: { label: string; url: string };
  /** Small print under the button. Plain text; escaped here. */
  footnote?: string;
};

/**
 * The layout for emails that go to clients: snagging quotations and
 * reports, AMC proposals and contracts. Table-based and inline-styled, so
 * it holds together in Gmail, Outlook and phone mail apps.
 */
export function clientEmailHtml(o: ClientEmailOptions): string {
  const details =
    o.details && o.details.length > 0
      ? `
        <tr><td style="padding:4px 32px 8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border-collapse:separate;background:${TINT};border:1px solid ${LINE};border-radius:10px">
            ${o.details
              .map(
                (row, index) => `
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:${MUTED};${index > 0 ? `border-top:1px solid ${LINE};` : ""}white-space:nowrap">${escapeEmailHtml(row.label)}</td>
                <td align="right" style="padding:10px 16px;font-size:14px;color:${INK};font-weight:600;${index > 0 ? `border-top:1px solid ${LINE};` : ""}">${escapeEmailHtml(row.value)}</td>
              </tr>`,
              )
              .join("")}
          </table>
        </td></tr>`
      : "";

  const cta = o.cta
    ? `
        <tr><td style="padding:20px 32px 4px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:8px;background:${BRAND}">
              <a href="${escapeEmailHtml(o.cta.url)}"
                 style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">
                ${escapeEmailHtml(o.cta.label)}
              </a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:12px 32px 0;font-size:12px;line-height:18px;color:${MUTED}">
          If the button doesn't work, copy this link into your browser:<br />
          <a href="${escapeEmailHtml(o.cta.url)}" style="color:${BRAND};word-break:break-all">${escapeEmailHtml(o.cta.url)}</a>
        </td></tr>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f1ee">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ee">
      <tr><td align="center" style="padding:32px 12px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:${INK}">
          <tr><td style="height:5px;background:${BRAND};font-size:0;line-height:0">&nbsp;</td></tr>
          <tr><td style="padding:24px 32px 20px;border-bottom:1px solid ${LINE}">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td valign="middle">
                <img src="${LOGO_SRC}" alt="Yalla Fix It" width="150" height="63"
                     style="display:block;width:150px;height:63px;border:0;outline:none;text-decoration:none" />
              </td>
              <td valign="middle" align="right"
                  style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${BRAND};font-weight:700">
                ${escapeEmailHtml(o.eyebrow)}
              </td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:28px 32px 8px">
            <h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:${INK}">${escapeEmailHtml(o.heading)}</h1>
          </td></tr>
          ${o.greeting ? `<tr><td style="padding:12px 32px 0;font-size:15px;line-height:24px">${escapeEmailHtml(o.greeting)}</td></tr>` : ""}
          ${o.paragraphs
            .map(
              (html) =>
                `<tr><td style="padding:12px 32px 0;font-size:15px;line-height:24px;color:${INK}">${html}</td></tr>`,
            )
            .join("")}
          ${details ? `<tr><td style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr>${details}` : ""}
          ${cta}
          ${o.footnote ? `<tr><td style="padding:16px 32px 0;font-size:12px;line-height:18px;color:${MUTED}">${escapeEmailHtml(o.footnote)}</td></tr>` : ""}
          <tr><td style="padding:28px 32px 0">&nbsp;</td></tr>
          <tr><td style="padding:18px 32px 22px;background:${TINT};border-top:1px solid ${LINE};font-size:12px;line-height:18px;color:${MUTED}">
            <strong style="color:${INK}">Yalla Fix It</strong> &middot; Facility Management, Dubai<br />
            This email was sent automatically, so replies to it aren't read. To talk to us, contact your account manager.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
