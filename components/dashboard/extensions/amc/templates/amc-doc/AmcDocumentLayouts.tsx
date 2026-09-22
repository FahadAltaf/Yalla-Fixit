import type { AmcDocumentModel } from "../../amc-document-model";
import { AmcBrandFooter, AmcBrandHeader, AmcCoverPage } from "./AmcDocParts";
import { AmcDocumentBody, AmcPdfRenderContext } from "./AmcDocumentBody";
import { AMC_DOC_COLORS, AMC_DOC_FONT, AMC_PAGE } from "./amc-doc-theme";

const pageFrame = {
  width: `${AMC_PAGE.width}px`,
  boxSizing: "border-box" as const,
  backgroundColor: AMC_DOC_COLORS.white,
  fontFamily: AMC_DOC_FONT,
  padding: `${AMC_PAGE.padTop}px ${AMC_PAGE.padX}px ${AMC_PAGE.padBottom}px`,
};

/**
 * The whole document on one continuous sheet: cover, then header, body and
 * footer. Used by the Review & Submit preview and the client link, where
 * the reader scrolls rather than turns pages.
 */
export function AmcDocumentContinuous({
  model,
  cover = true,
}: {
  model: AmcDocumentModel;
  /* The AMC cover. Quotations have none. */
  cover?: boolean;
}) {
  return (
    <div style={{ width: `${AMC_PAGE.width}px`, backgroundColor: AMC_DOC_COLORS.white }}>
      {cover && (
        <>
          <AmcCoverPage />
          <div style={{ height: "1px", backgroundColor: AMC_DOC_COLORS.rule }} />
        </>
      )}
      <div style={pageFrame}>
        <AmcBrandHeader />
        <AmcDocumentBody model={model} />
        <div style={{ marginTop: "24px" }}>
          <AmcBrandFooter />
        </div>
      </div>
    </div>
  );
}

/**
 * One A4 page holding the whole body, rendered off screen so the PDF
 * paginator can measure the header, the footer, the body and where the
 * body may break.
 */
export function AmcDocumentMeasure({ model }: { model: AmcDocumentModel }) {
  return (
    <div
      data-amc-measure-page
      style={{
        ...pageFrame,
        height: `${AMC_PAGE.height}px`,
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        visibility: "hidden",
        pointerEvents: "none",
      }}
    >
      <AmcBrandHeader />
      <div style={{ flex: 1, minHeight: 0 }}>
        <AmcPdfRenderContext.Provider value>
          <AmcDocumentBody model={model} />
        </AmcPdfRenderContext.Provider>
      </div>
      <AmcBrandFooter page={1} totalPages={1} />
    </div>
  );
}

/**
 * The PDF pages: the cover, then one A4 page per slice of the body. Each
 * page shows the body through a window of its slice's height, shifted up
 * by the slice's offset — the same body markup on every page, so a page
 * starts exactly where the previous one ended.
 */
export function AmcDocumentPages({
  model,
  sliceOffsets,
  bodyHeight,
  cover = true,
}: {
  model: AmcDocumentModel;
  sliceOffsets: number[];
  bodyHeight: number;
  cover?: boolean;
}) {
  const total = sliceOffsets.length;
  return (
    <div>
      {cover && <AmcCoverPage />}
      {sliceOffsets.map((offset, index) => {
        const end = sliceOffsets[index + 1] ?? bodyHeight;
        return (
          <div
            key={offset}
            data-amc-page={index + 1}
            style={{
              ...pageFrame,
              height: `${AMC_PAGE.height}px`,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <AmcBrandHeader />
            <div style={{ height: `${Math.max(0, end - offset)}px`, overflow: "hidden", flexShrink: 0 }}>
              <div style={{ marginTop: `-${offset}px` }}>
                {/* The same PDF padding it was measured with, so breaks match. */}
                <AmcPdfRenderContext.Provider value>
                  <AmcDocumentBody model={model} />
                </AmcPdfRenderContext.Provider>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <AmcBrandFooter page={index + 1} totalPages={total} />
          </div>
        );
      })}
    </div>
  );
}
