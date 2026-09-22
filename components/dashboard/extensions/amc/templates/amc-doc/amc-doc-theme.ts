import cover from "@/public/amc/brand/cover.png";
import iso14001 from "@/public/amc/brand/iso-14001.png";
import iso45001 from "@/public/amc/brand/iso-45001.png";
import iso9001 from "@/public/amc/brand/iso-9001.png";
import logo from "@/public/amc/brand/logo.png";
import logoTrimmed from "@/public/amc/brand/logo-trimmed.png";

/**
 * The AMC document design, taken from the "Le Majilis" Word file: its
 * colours, its header artwork and its type sizes (points, drawn here at
 * 96 dpi). Shared by the screen/PDF renderer and the Word export, so the
 * two cannot drift apart.
 */
export const AMC_DOC_COLORS = {
  brand: "#C1272D",
  text: "#222222",
  muted: "#595959",
  labelFill: "#EDEDED",
  zebraFill: "#F5F5F5",
  border: "#D0D0D0",
  rule: "#D9D9D9",
  white: "#FFFFFF",
} as const;

/* Sizes in points, as in the Word file. */
export const AMC_DOC_PT = {
  body: 10,
  table: 9.5,
  tableHeader: 9,
  small: 9,
  subheading: 10.5,
  heading: 12,
  banner: 13,
  footer: 7.5,
} as const;

export const pt = (points: number) => `${(points * 96) / 72}px`;

/* A4 at 96 dpi. The PDF is A4, so the screen page is too. */
export const AMC_PAGE = {
  width: 794,
  height: 1123,
  padX: 64,
  padTop: 32,
  padBottom: 24,
} as const;

export const AMC_BRAND_IMAGES = {
  cover: cover.src,
  logo: logo.src,
  /* The same logo with its white margins cut off, for places that size it
     by height, such as the client page navbar. */
  logoTrimmed: logoTrimmed.src,
  iso: [
    { src: iso14001.src, alt: "ISO 14001:2015 certified" },
    { src: iso9001.src, alt: "ISO 9001:2015 certified" },
    { src: iso45001.src, alt: "ISO 45001:2018 certified" },
  ],
} as const;

export const AMC_DOC_FONT = "Arial, Helvetica, sans-serif";
