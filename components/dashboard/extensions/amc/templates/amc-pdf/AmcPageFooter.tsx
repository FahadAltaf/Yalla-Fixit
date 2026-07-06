import { FOOTER_TEXT } from "../../amc-contract-content";
import { AMC_PDF_STYLES } from "./amc-pdf-styles";

interface Props {
  page: number;
  totalPages: number;
}

export function AmcPageFooter({ page, totalPages }: Props) {
  return (
    <div style={{ flexShrink: 0, marginTop: "auto", paddingTop: "6px" }}>
      <div
        style={{
          borderTop: `1px solid ${AMC_PDF_STYLES.BORDER_COLOR}`,
          paddingTop: "5px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "8px",
          fontSize: "7.5px",
          color: "#444444",
          fontFamily: AMC_PDF_STYLES.BODY_FONT,
          lineHeight: 1.3,
        }}
      >
        <div style={{ flex: 1 }}>
          {FOOTER_TEXT.split("800-PERFECT")[0]}
          <span style={{ color: AMC_PDF_STYLES.BRAND_RED, fontWeight: 700 }}>
            800-PERFECT
          </span>
          .
        </div>
        <div style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
          {page} of {totalPages}
        </div>
      </div>
    </div>
  );
}
