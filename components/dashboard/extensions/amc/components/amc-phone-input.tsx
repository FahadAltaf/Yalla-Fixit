"use client";

import { PhoneInput } from "@/components/ui/phone-input";

/**
 * The international phone input snagging uses (components/ui/phone-input),
 * for the AMC wizard's phone fields. It stores the full international
 * number, e.g. "+971501234567", and defaults to the UAE.
 *
 * Submissions saved before this used a plain text box, so they hold local
 * numbers such as "050 588 5903". Those are shown as the UAE numbers they
 * are (+971 50 588 5903) rather than misread; the next edit saves the
 * international form.
 */
export function toInternationalPhone(value: string | undefined | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("971")) return `+${digits}`;
  if (digits.startsWith("0")) return `+971${digits.slice(1)}`;
  return `+971${digits}`;
}

export function AmcPhoneInput({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <PhoneInput
      id={id}
      value={toInternationalPhone(value)}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
