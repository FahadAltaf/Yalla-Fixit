"use client";

import { PhoneInput as IntlPhoneInput } from "react-international-phone";
import "react-international-phone/style.css";

import { cn } from "@/lib/utils";

/**
 * International phone input (D1) built on react-international-phone.
 *
 * Keeps a simple {value, onChange} contract: the value is the full E.164
 * number (e.g. "+971501234567"). A dial code with no national number is
 * normalised to an empty string so an untouched field never stores a bare
 * "+971". Defaults to the UAE for this market.
 */
export function PhoneInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <IntlPhoneInput
      defaultCountry="ae"
      value={value}
      disabled={disabled}
      onChange={(phone, meta) => {
        const digits = phone.replace(/\D/g, "");
        const dial = meta.country.dialCode;
        const national = digits.startsWith(dial) ? digits.slice(dial.length) : digits;
        onChange(national ? phone : "");
      }}
      className="w-full"
      inputClassName={cn(
        "!h-9 !w-full !rounded-r-md !border-input !bg-transparent !text-sm",
        "!text-foreground placeholder:!text-muted-foreground",
        "focus-visible:!ring-ring focus-visible:!ring-[3px]",
      )}
      countrySelectorStyleProps={{
        buttonClassName: "!h-9 !rounded-l-md !border-input !bg-transparent px-2",
        dropdownStyleProps: { className: "!z-50" },
      }}
    />
  );
}
