"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  /* The country picked in the box, for a pasted local number. */
  const dialRef = useRef("971");
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({ maxHeight: LIST_MAX });

  /*
    The trunk 0 of a local number (050...) is not part of the international
    number. Kept, it took one of the mask's places, so the last digit was
    dropped (0555550101 came out as +971 05 555 5010). The control keeps
    its own text, so the 0 is refused as it goes in rather than taken off
    the value afterwards. On "beforeinput", which every way of typing fires
    (a phone's keyboard often sends no usable key code), not on keydown.
  */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const refuseTrunkZero = (event: InputEvent) => {
      const input = event.target as HTMLInputElement;
      if (input.tagName !== "INPUT" || !event.data || !/^0/.test(event.data)) return;
      const atEnd = input.selectionStart === input.value.length;
      if (!atEnd || input.value.replace(/\D/g, "") !== dialRef.current) return;
      event.preventDefault();
      /* "0501234567" put in as one piece: the rest of it still goes in. */
      const rest = event.data.replace(/\D/g, "").replace(/^0+/, "");
      if (rest) onChange(`+${dialRef.current}${rest}`);
    };
    wrap.addEventListener("beforeinput", refuseTrunkZero, true);
    return () => wrap.removeEventListener("beforeinput", refuseTrunkZero, true);
  }, [onChange]);

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
    <div
      ref={wrapRef}
      className="w-full"
      onPointerDownCapture={fitDropdown}
      onKeyDownCapture={fitDropdown}
      onPasteCapture={(e) => {
        /* A pasted local number (050 123 4567) or one starting 00: the control would cut it at the mask. */
        const text = e.clipboardData.getData("text").trim();
        const digits = text.replace(/\D/g, "");
        if (!digits || text.startsWith("+")) return;
        const international = digits.startsWith("00")
          ? digits.slice(2)
          : digits.startsWith("0")
            ? `${dialRef.current}${digits.replace(/^0+/, "")}`
            : null;
        if (!international) return;
        e.preventDefault();
        onChange(`+${international}`);
      }}
    >
      <IntlPhoneInput
        defaultCountry="ae"
        value={value}
        disabled={disabled}
        inputProps={{ id }}
        onChange={(phone, meta) => {
          const digits = phone.replace(/\D/g, "");
          const dial = meta.country.dialCode;
          dialRef.current = dial;
          /*
            A local number is often typed with its trunk 0 (050...). The 0 is
            not part of the international number, and kept, it filled one of
            the mask's places so the last digit was dropped (0555550101 came
            out as +971 05 555 5010). It is taken off as it is typed.
          */
          const national = (digits.startsWith(dial) ? digits.slice(dial.length) : digits).replace(/^0+/, "");
          onChange(national ? `+${dial}${national}` : "");
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
