/**
 * Phone numbers as they print on the AMC documents.
 *
 * The wizard stores full international numbers ("+971501234567", from the
 * international phone input). Printed raw they are hard to read, so UAE
 * mobile and landline numbers are grouped the way people write them:
 * "+971 50 123 4567", "+971 4 123 4567". Other countries print with a
 * space after the country code where it can be told apart safely, and
 * anything else prints exactly as entered.
 */
export function formatPhoneForDocument(value: string | undefined | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");

  /* UAE, stored internationally or in the old local form (050…, 04…). */
  const uae = raw.startsWith("+971") || digits.startsWith("971")
    ? digits.slice(3)
    : /^0[2-9]/.test(digits) && !raw.startsWith("+")
      ? digits.slice(1)
      : null;
  if (uae !== null) {
    if (/^5\d{8}$/.test(uae)) return `+971 ${uae.slice(0, 2)} ${uae.slice(2, 5)} ${uae.slice(5)}`;
    if (/^[2-9]\d{7}$/.test(uae)) return `+971 ${uae.slice(0, 1)} ${uae.slice(1, 4)} ${uae.slice(4)}`;
    if (/^800\d+$/.test(uae)) return `+971 ${uae}`;
  }

  return raw;
}
