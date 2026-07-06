import { ReactNode } from "react";

import { AMC_PDF_STYLES } from "./amc-pdf-styles";
import { AmcPageFooter } from "./AmcPageFooter";
import { AmcPageHeader } from "./AmcPageHeader";

interface Props {
  page: number;
  totalPages: number;
  sourceY: number;
  viewportHeight: number;
  bodyHeight: number;
  children: ReactNode;
}

export function AmcPdfPage({
  page,
  totalPages,
  sourceY,
  viewportHeight,
  bodyHeight,
  children,
}: Props) {
  const isLastPage = page === totalPages;
  const remainingContent = Math.max(0, bodyHeight - sourceY);
  const contentWindowHeight = isLastPage
    ? remainingContent
    : Math.min(viewportHeight, remainingContent);

  return (
    <div
      data-amc-page={page}
      style={{
        width: `${AMC_PDF_STYLES.PAGE_WIDTH}px`,
        height: `${AMC_PDF_STYLES.PAGE_HEIGHT}px`,
        backgroundColor: "#ffffff",
        boxSizing: "border-box",
        padding: "20px 28px 16px",
        display: "flex",
        flexDirection: "column",
        fontFamily: AMC_PDF_STYLES.BODY_FONT,
        overflow: "hidden",
      }}
    >
      <AmcPageHeader />
      <div
        style={{
          height: `${contentWindowHeight}px`,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div style={{ marginTop: `-${sourceY}px` }}>{children}</div>
      </div>
      {isLastPage && <div style={{ flex: 1 }} />}
      <AmcPageFooter page={page} totalPages={totalPages} />
    </div>
  );
}
