"use client";

import { useRef, useState, type CSSProperties } from "react";
import { PhoneInput as IntlPhoneInput } from "react-international-phone";
import "react-international-phone/style.css";

import { cn } from "@/lib/utils";

/* The list's usual height, and the least it is allowed to shrink to. */
const LIST_MAX = 260;
const LIST_MIN = 120;
const GAP = 8;

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
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Ties the box to its label. */
  id?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({ maxHeight: LIST_MAX });

  /*
    The country list is drawn inside the field, so a card or dialog that
    clips its content (most do, for their rounded corners) cut it off at
    its edge -- only the top of the list showed. Just before it opens, this
    measures the room left inside the nearest clipping box and the window,
    opens the list upwards when there is more room above, and caps its
    height to what fits, so it never runs past the edge.
  */
  function fitDropdown() {
    const field = wrapRef.current;
    if (!field) return;
    const rect = field.getBoundingClientRect();
    let top = 0;
    let bottom = window.innerHeight;
    for (let node = field.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(hidden|auto|scroll|clip)/.test(`${style.overflow} ${style.overflowY}`)) {
        const box = node.getBoundingClientRect();
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
    }
    const below = bottom - rect.bottom - GAP;
    const above = rect.top - top - GAP;
    const up = below < LIST_MAX && above > below;
    const room = Math.max(LIST_MIN, Math.min(LIST_MAX, up ? above : below));
    setDropdownStyle(
      up
        ? { maxHeight: room, top: "auto", bottom: "calc(100% + 4px)" }
        : { maxHeight: room },
    );
  }

  return (
    <div ref={wrapRef} className="w-full" onPointerDownCapture={fitDropdown} onKeyDownCapture={fitDropdown}>
      <IntlPhoneInput
        defaultCountry="ae"
        value={value}
        disabled={disabled}
        inputProps={{ id }}
        onChange={(phone, meta) => {
          const digits = phone.replace(/\D/g, "");
          const dial = meta.country.dialCode;
          const national = digits.startsWith(dial) ? digits.slice(dial.length) : digits;
          onChange(national ? phone : "");
        }}
        className="w-full"
        inputClassName={cn(
          "!h-9 !w-full !rounded-r-[12px] !border-input !bg-transparent !text-sm",
          "!text-foreground placeholder:!text-muted-foreground",
          "focus-visible:!ring-ring focus-visible:!ring-[3px]",
        )}
        countrySelectorStyleProps={{
          buttonClassName: "!h-9 !rounded-l-[12px] !border-input !bg-transparent px-2",
          dropdownStyleProps: {
            className: "!z-50 !rounded-[12px] !border !border-border !py-1",
            style: dropdownStyle,
          },
        }}
      />
    </div>
  );
}
