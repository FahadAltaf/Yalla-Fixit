/**
 * Template engine for the AMC emails (BRD 6.1) and the WhatsApp / SMS
 * messages (BRD 6.3). Pure: used by routes, the configuration screen's
 * preview and the tests.
 *
 * Placeholders are written as in the BRD, e.g. "{Proposal no}". A
 * placeholder with no value renders empty and is reported as missing, so a
 * caller can refuse to send a half-filled message.
 */

export type TemplateVars = Record<string, string | number | null | undefined>;

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9 ]{0,40})\}/g;

export function templatePlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

export interface RenderedTemplate {
  text: string;
  missing: string[];
}

export function renderTemplate(
  template: string,
  vars: TemplateVars,
  options: { escapeHtml?: boolean } = {},
): RenderedTemplate {
  const missing: string[] = [];
  const text = template.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = vars[name];
    if (value === null || value === undefined || String(value).trim() === "") {
      if (!missing.includes(name)) missing.push(name);
      return "";
    }
    const s = String(value);
    return options.escapeHtml ? escapeHtml(s) : s;
  });
  return { text, missing };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Plain text with blank-line paragraphs → simple HTML paragraphs (values already escaped). */
export function paragraphsToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * A UAE phone number in international digits for wa.me and SMS, or null.
 * Accepts 05x…, 5x…, 9715x…, +971 5x…, 00971…, with spaces or dashes.
 */
export function normalizeUaePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^0\d{8,9}$/.test(digits)) digits = `971${digits.slice(1)}`;
  else if (/^5\d{8}$/.test(digits)) digits = `971${digits}`;
  if (!/^\d{9,15}$/.test(digits)) return null;
  return digits;
}

/**
 * A wa.me link that opens WhatsApp with the text ready to send. BRD 5.6:
 * the portal prepares the message and the coordinator sends it.
 */
export function whatsAppLink(phone: string | null | undefined, text: string): string | null {
  const number = normalizeUaePhone(phone);
  const encoded = encodeURIComponent(text);
  return number ? `https://wa.me/${number}?text=${encoded}` : null;
}

/** An sms: link with the same text (the SMS fallback, BRD 6.3). */
export function smsLink(phone: string | null | undefined, text: string): string | null {
  const number = normalizeUaePhone(phone);
  return number ? `sms:+${number}?body=${encodeURIComponent(text)}` : null;
}
