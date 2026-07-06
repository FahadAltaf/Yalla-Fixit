import type { AmcComputedData } from "../amc-types";
import { AmcContractBody } from "./AmcContractBody";
import { AmcPageHeader } from "./amc-pdf/AmcPageHeader";
import { AMC_PDF_STYLES } from "./amc-pdf/amc-pdf-styles";

interface Props {
  data: AmcComputedData;
  forPDF?: boolean;
}

export function AmcContractTemplate({ data }: Props) {
  return (
    <div
      id="amc-pdf-root"
      style={{
        width: `${AMC_PDF_STYLES.PAGE_WIDTH}px`,
        backgroundColor: "#ffffff",
        fontFamily: AMC_PDF_STYLES.BODY_FONT,
        padding: "20px 28px",
      }}
    >
      <AmcPageHeader />
      <AmcContractBody data={data} />
    </div>
  );
}
