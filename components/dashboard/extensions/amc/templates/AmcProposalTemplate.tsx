import type { AmcComputedData } from "../amc-types";
import { AmcProposalBody } from "./AmcProposalBody";
import { AmcPageHeader } from "./amc-pdf/AmcPageHeader";
import { AMC_PDF_STYLES } from "./amc-pdf/amc-pdf-styles";

interface Props {
  data: AmcComputedData;
}

export function AmcProposalTemplate({ data }: Props) {
  return (
    <div
      id="amc-proposal-preview-root"
      style={{
        width: `${AMC_PDF_STYLES.PAGE_WIDTH}px`,
        backgroundColor: "#ffffff",
        fontFamily: AMC_PDF_STYLES.BODY_FONT,
        color: AMC_PDF_STYLES.TEXT_COLOR,
        boxSizing: "border-box",
        padding: "20px 28px 16px",
      }}
    >
      <AmcPageHeader />
      <AmcProposalBody data={data} />
    </div>
  );
}
