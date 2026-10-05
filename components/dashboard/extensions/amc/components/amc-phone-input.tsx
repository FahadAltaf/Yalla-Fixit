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
  const current = toInternationalPhone(value);
  return (
    <PhoneInput
      id={id}
      value={current}
      /*
        A change the user actually made, not the control settling in.

        react-international-phone normalises an empty box to the chosen
        country's dial code when it mounts, and reports that through
        onChange. React Hook Form counts it as the field being edited,
        validates on the spot and finds it empty -- so a brand-new
        proposal opened with "Customer phone is required" in red under two
        fields nobody had so much as clicked.

        Comparing against what we already hold drops exactly that: the
        mount call hands back the same value it was given, and every real
        keystroke differs from it.
      */
      onChange={(next) => {
        if (next === current) return;
        onChange(next);
      }}
      disabled={disabled}
    />
  );
}
