import type { CSSProperties } from "react";

import { AMC_PDF_STYLES, PDF_EXTRA_PADDING_BOTTOM } from "./amc-pdf-styles";

/** Proposal layout tokens mapped to the existing AMC contract PDF styles. */
export const AMC_PROPOSAL_STYLES = {
  ACCENT: AMC_PDF_STYLES.BRAND_RED,
  ACCENT_SOFT: "#F8E8E8",
  PANEL: AMC_PDF_STYLES.TABLE_HEADER_BEIGE,
  ROW_ALT: "#F5F3EE",
  BORDER: AMC_PDF_STYLES.BORDER_COLOR,
  TEXT: AMC_PDF_STYLES.TEXT_COLOR,
  MUTED: "#555555",
  WHITE: "#FFFFFF",
  BODY_FONT: AMC_PDF_STYLES.BODY_FONT,
  BODY_SIZE: AMC_PDF_STYLES.BODY_SIZE,
  SMALL_SIZE: AMC_PDF_STYLES.SMALL_SIZE,
  TITLE_SIZE: AMC_PDF_STYLES.TITLE_SIZE,
  PAGE_WIDTH: AMC_PDF_STYLES.PAGE_WIDTH,
  PAGE_HEIGHT: AMC_PDF_STYLES.PAGE_HEIGHT,
} as const;

export const proposalSectionTitle: CSSProperties = {
  fontSize: AMC_PDF_STYLES.TITLE_SIZE,
  fontWeight: 700,
  textTransform: "uppercase",
  color: AMC_PDF_STYLES.TEXT_COLOR,
  margin: "0 0 8px",
  fontFamily: AMC_PDF_STYLES.BODY_FONT,
};

export const proposalLabel: CSSProperties = {
  fontSize: AMC_PDF_STYLES.SMALL_SIZE,
  color: AMC_PROPOSAL_STYLES.MUTED,
  fontWeight: 400,
  fontFamily: AMC_PDF_STYLES.BODY_FONT,
};

export const proposalValue: CSSProperties = {
  fontSize: AMC_PDF_STYLES.BODY_SIZE,
  color: AMC_PDF_STYLES.TEXT_COLOR,
  fontWeight: 600,
  fontFamily: AMC_PDF_STYLES.BODY_FONT,
};

export function proposalTableCell(
  isHeader = false,
  isPdf = false,
): CSSProperties {
  return {
    border: `1px solid ${AMC_PDF_STYLES.BORDER_COLOR}`,
    padding: "5px 6px",
    fontSize: AMC_PDF_STYLES.SMALL_SIZE,
    lineHeight: 1.35,
    verticalAlign: "top",
    textAlign: "left",
    fontFamily: AMC_PDF_STYLES.BODY_FONT,
    ...(isHeader
      ? {
          backgroundColor: AMC_PDF_STYLES.TABLE_HEADER_RED,
          color: AMC_PROPOSAL_STYLES.WHITE,
          fontWeight: 700,
          textTransform: "uppercase",
        }
      : {
          color: "#000000c2",
          backgroundColor: AMC_PROPOSAL_STYLES.WHITE,
        }),
    ...(isPdf
      ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM }
      : { paddingBottom: "6px" }),
  };
}

export function proposalPanelPadding(isPdf = false): CSSProperties {
  return {
    padding: "10px 12px",
    paddingBottom: PDF_EXTRA_PADDING_BOTTOM,
  };
}
