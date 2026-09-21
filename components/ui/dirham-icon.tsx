import type { SVGProps } from "react";

/**
 * The UAE dirham sign (the "D" with two bars), drawn to match the lucide
 * icon set: 24×24, 2px stroke, currentColor. Used in place of the "AED"
 * code wherever an amount is shown.
 */
export function DirhamIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M7 4h4a8 8 0 0 1 0 16H7z" />
      <path d="M3 10h16" />
      <path d="M3 14h16" />
    </svg>
  );
}
