// Server-side masking of identity numbers (FRD FR-9, NFR-4).
//
// The full Emirates ID or passport number leaves the server only through the
// audited reveal route (phase 2). Everywhere else the wire carries this shape.

export type MaskedNumber = {
  /** Last four characters, or null when nothing is on file. */
  last4: string | null;
  /** Whether a number is on file at all (so the UI can say "not entered"). */
  present: boolean;
};

export function maskNumber(value: string | null | undefined): MaskedNumber {
  if (!value) return { last4: null, present: false };
  const trimmed = value.trim();
  if (!trimmed) return { last4: null, present: false };
  return { last4: trimmed.slice(-4), present: true };
}

/** Display form: "••••••••••• 5054" for a 15-digit ID, "••••• 008B" for a passport. */
export function maskedDisplay(masked: MaskedNumber, totalLength = 15): string {
  if (!masked.present || !masked.last4) return "Not entered";
  const hidden = Math.max(totalLength - 4, 4);
  return `${"•".repeat(hidden)} ${masked.last4}`;
}

/** Audit log form of a value change: never the full number. */
export function maskForAudit(value: string | null | undefined): string | null {
  const m = maskNumber(value);
  return m.present ? `****${m.last4}` : null;
}

/** Emirates ID as the UAE prints it: 784-NNNN-NNNNNNN-N. Input is 15 digits. */
export function formatEmiratesId(digits: string): string {
  if (!/^\d{15}$/.test(digits)) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14)}`;
}

/** Strip dashes and spaces from a typed Emirates ID. */
export function normaliseEmiratesId(input: string): string {
  return input.replace(/[\s-]/g, "");
}
