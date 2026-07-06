import type { AmcComputedData } from "../amc-types";
import { AmcContractBody } from "./AmcContractBody";
import { AmcPdfPage } from "./amc-pdf";

interface Props {
  data: AmcComputedData;
  sliceOffsets: number[];
  viewportHeight: number;
  bodyHeight: number;
}

export function AmcPaginatedTemplate({
  data,
  sliceOffsets,
  viewportHeight,
  bodyHeight,
}: Props) {
  const totalPages = sliceOffsets.length;

  return (
    <div id="amc-pdf-root">
      {sliceOffsets.map((sourceY, index) => (
        <AmcPdfPage
          key={sourceY}
          page={index + 1}
          totalPages={totalPages}
          sourceY={sourceY}
          viewportHeight={viewportHeight}
          bodyHeight={bodyHeight}
        >
          <AmcContractBody data={data} />
        </AmcPdfPage>
      ))}
    </div>
  );
}
