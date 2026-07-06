import type { CSSProperties } from "react";

export const AMC_PDF_STYLES = {
  BRAND_RED: "#A6192E",
  HIGHLIGHT_YELLOW: "#FFFF00",
  TABLE_HEADER_RED: "#A6192E",
  TABLE_HEADER_BEIGE: "#E8E4D9",
  BODY_FONT: "Arial, Helvetica, sans-serif",
  BODY_SIZE: "12px",
  SMALL_SIZE: "12px",
  TITLE_SIZE: "13px",
  PAGE_WIDTH: 794,
  PAGE_HEIGHT: 1123,
  TEXT_COLOR: "#1a1a2e",
  BORDER_COLOR: "#333333",
} as const;

export const tableCell: CSSProperties = {
  border: `1px solid ${AMC_PDF_STYLES.BORDER_COLOR}`,
  padding: "3px 5px",
  fontSize: AMC_PDF_STYLES.SMALL_SIZE,
  verticalAlign: "top",
  lineHeight: 1.35,
};

export const bodyText: CSSProperties = {
  fontSize: AMC_PDF_STYLES.BODY_SIZE,
  lineHeight: 1.4,
  color: AMC_PDF_STYLES.TEXT_COLOR,
  marginBottom: "4px",
};

export const sectionTitle: CSSProperties = {
  fontSize: AMC_PDF_STYLES.TITLE_SIZE,
  fontWeight: 700,
  marginBottom: "6px",
  marginTop: "8px",
};
