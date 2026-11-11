import { getActiveFormattingMask, guessCountryByPartialPhoneNumber } from "react-international-phone";

/**
 * Phone numbers as the international phone input (components/ui/phone-input)
 * shows them, for the pages that read a number back: "+971 50 000 0001",
 * "+1 (886) 377-7092". The country and its grouping come from the same
 * library and data as the input, so a number reads the same on the page as
 * it did in the box it was typed into.
 */

/**
 * A stored number in its full international form, "+971500000001".
 *
 * Numbers saved before the international input was used can be local
 * (050 000 0001) or carry their own spacing and brackets; a local one is
 * read as the UAE number it is, as the AMC phone input reads it.
 */
export function toE164Phone(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("971")) return `+${digits}`;
  if (digits.startsWith("0")) return `+971${digits.slice(1)}`;
  return `+971${digits}`;
}

/** The number grouped as its country writes it; empty in, empty out. */
export function formatPhone(value: string | null | undefined): string {
  const e164 = toE164Phone(value);
  if (!e164) return "";
  const { country } = guessCountryByPartialPhoneNumber({ phone: e164 });
  if (!country) return e164;
  const national = e164.slice(1 + country.dialCode.length);
  if (!national) return e164;
  /* UAE toll-free (800 7373328): the input's mask is for mobiles and landlines. */
  if (country.dialCode === "971" && /^800\d+$/.test(national)) return `+971 800 ${national.slice(3)}`;
  const mask = getActiveFormattingMask({ phone: e164, country });

  /* Each "." in the mask takes the next digit; the mask stops where the digits do. */
  let out = "";
  let next = 0;
  for (const char of mask) {
    if (next >= national.length) break;
    if (char === ".") {
      out += national[next];
      next += 1;
    } else {
      out += char;
    }
  }
  /* A number longer than its country's mask keeps the rest rather than losing it. */
  out += national.slice(next);
  return `+${country.dialCode} ${out.trim()}`;
}

/** The number for a tel: link, without the spacing. */
export function phoneHref(value: string | null | undefined): string {
  return `tel:${toE164Phone(value)}`;
}
