import type { AmcComputedData } from "../amc-types";
import { AmcProposalBody } from "./AmcProposalBody";
import { AmcProposalPdfPage } from "./amc-pdf/AmcProposalPdfPage";

interface Props {
  data: AmcComputedData;
  sliceOffsets: number[];
  viewportHeight: number;
  bodyHeight: number;
}

export function AmcProposalPaginatedTemplate({
  data,
  sliceOffsets,
  viewportHeight,
  bodyHeight,
}: Props) {
  const totalPages = sliceOffsets.length;

  return (
    <div id="amc-pdf-root">
      {sliceOffsets.map((sourceY, index) => (
        <AmcProposalPdfPage
          key={sourceY}
          page={index + 1}
          totalPages={totalPages}
          sourceY={sourceY}
          viewportHeight={viewportHeight}
          bodyHeight={bodyHeight}
        >
          <AmcProposalBody data={data} isPdf />
        </AmcProposalPdfPage>
      ))}
    </div>
  );
}
