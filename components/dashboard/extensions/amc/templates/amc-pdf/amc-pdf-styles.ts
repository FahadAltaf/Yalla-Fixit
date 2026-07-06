import type { CSSProperties } from "react";

export const AMC_PDF_STYLES = {
  BRAND_RED: "#c00000",
  HIGHLIGHT_YELLOW: "#FFFF00",
  TABLE_HEADER_RED: "#c00000",
  TABLE_HEADER_BEIGE: "#E8E4D9",
  BODY_FONT: "Arial, Helvetica, sans-serif",
  BODY_SIZE: "12px",
  SMALL_SIZE: "12px",
  TITLE_SIZE: "13px",
  PAGE_WIDTH: 794,
  PAGE_HEIGHT: 1180,
  TEXT_COLOR: "#1a1a2e",
  BORDER_COLOR: "#333333",
} as const;

export const PDF_EXTRA_PADDING_BOTTOM = "13px";
export const PDF_HIGHLIGHT_PADDING_BOTTOM = "12px";

export const CLAUSE_LAYOUT = {
  SUB_SECTION_INDENT: "28px",
  BODY_INDENT: "52px",
  SECTION_GAP: "10px",
  PARAGRAPH_GAP: "3px",
  BLOCK_TOP: "14px",
  TABLE_TOP: "8px",
  TABLE_BOTTOM: "12px",
  TERMS_TOP: "14px",
} as const;

export const clauseMainTitle: CSSProperties = {
  fontSize: AMC_PDF_STYLES.TITLE_SIZE,
  fontWeight: 700,
  lineHeight: 1.5,
  marginTop: CLAUSE_LAYOUT.BLOCK_TOP,
  marginBottom: "6px",
  color: AMC_PDF_STYLES.TEXT_COLOR,
};

export const clauseSubTitle: CSSProperties = {
  fontSize: AMC_PDF_STYLES.BODY_SIZE,
  fontWeight: 400,
  lineHeight: 1.5,
  marginBottom: "4px",
  paddingLeft: CLAUSE_LAYOUT.SUB_SECTION_INDENT,
  color: AMC_PDF_STYLES.TEXT_COLOR,
};

export const clauseParagraph: CSSProperties = {
  fontSize: AMC_PDF_STYLES.BODY_SIZE,
  lineHeight: 1.5,
  marginBottom: CLAUSE_LAYOUT.PARAGRAPH_GAP,
  paddingLeft: CLAUSE_LAYOUT.BODY_INDENT,
  color: AMC_PDF_STYLES.TEXT_COLOR,
};

export const clauseLetterItem: CSSProperties = {
  ...clauseParagraph,
  paddingLeft: CLAUSE_LAYOUT.SUB_SECTION_INDENT,
};

export const clauseBulletItem: CSSProperties = {
  fontSize: AMC_PDF_STYLES.BODY_SIZE,
  lineHeight: 1.5,
  marginBottom: CLAUSE_LAYOUT.PARAGRAPH_GAP,
  paddingLeft: CLAUSE_LAYOUT.BODY_INDENT,
  color: AMC_PDF_STYLES.TEXT_COLOR,
  position: "relative",
};

export function tableCell(isPdf = false): CSSProperties {
  return {
    border: `1px solid ${AMC_PDF_STYLES.BORDER_COLOR}`,
    padding: "3px 5px",
    fontSize: AMC_PDF_STYLES.SMALL_SIZE,
    verticalAlign: "top",
    lineHeight: 1.35,
    color: "#000000c2",
    ...(isPdf ? { paddingBottom: PDF_EXTRA_PADDING_BOTTOM } : {}),
  };
}

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

export function highlightStyle(isPdf = false): CSSProperties {
  return {
    backgroundColor: AMC_PDF_STYLES.HIGHLIGHT_YELLOW,
    ...(isPdf ? { paddingBottom: PDF_HIGHLIGHT_PADDING_BOTTOM } : {}),
  };
}

export const brandRedText: CSSProperties = {
  color: AMC_PDF_STYLES.BRAND_RED,
};
