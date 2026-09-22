/* eslint-disable @next/next/no-img-element -- these pages are captured by
   html2canvas for the PDF, which needs plain <img> elements. */
import { AMC_FOOTER } from "../../amc-document-model";
import { AMC_BRAND_IMAGES, AMC_DOC_COLORS, AMC_DOC_FONT, AMC_PAGE, pt } from "./amc-doc-theme";

/* Logo left, ISO certificates right, a hairline under both — the header
   on every page after the cover. */
export function AmcBrandHeader() {
  return (
    <div
      data-amc-header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBottom: "8px",
        marginBottom: "14px",
        borderBottom: `1px solid ${AMC_DOC_COLORS.rule}`,
        flexShrink: 0,
      }}
    >
      <img src={AMC_BRAND_IMAGES.logo} alt="Yalla Fix It Facility Management" style={{ height: "74px", width: "auto", display: "block" }} />
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        {AMC_BRAND_IMAGES.iso.map((badge) => (
          <img key={badge.src} src={badge.src} alt={badge.alt} style={{ height: "54px", width: "auto", display: "block" }} />
        ))}
      </div>
    </div>
  );
}

export function AmcBrandFooter({ page, totalPages }: { page?: number; totalPages?: number }) {
  const sep = <span style={{ color: AMC_DOC_COLORS.brand, padding: "0 6px" }}>|</span>;
  return (
    <div
      data-amc-footer
      style={{
        flexShrink: 0,
        borderTop: `1px solid ${AMC_DOC_COLORS.rule}`,
        paddingTop: "6px",
        textAlign: "center",
        fontFamily: AMC_DOC_FONT,
        fontSize: pt(7.5),
        lineHeight: 1.5,
        color: AMC_DOC_COLORS.muted,
      }}
    >
      <div>
        {AMC_FOOTER.address}
        {sep}
        {AMC_FOOTER.phone}
        {sep}
        <span style={{ color: AMC_DOC_COLORS.brand, fontWeight: 700 }}>{AMC_FOOTER.hotline}</span>
      </div>
      {page !== undefined && totalPages !== undefined && (
        <div>
          Page {page} of {totalPages}
        </div>
      )}
    </div>
  );
}

/* The cover: the artwork from the Word file, full bleed. */
export function AmcCoverPage() {
  return (
    <div
      data-amc-page="cover"
      style={{
        width: `${AMC_PAGE.width}px`,
        height: `${AMC_PAGE.height}px`,
        backgroundColor: AMC_DOC_COLORS.white,
        overflow: "hidden",
      }}
    >
      <img
        src={AMC_BRAND_IMAGES.cover}
        alt="Annual Maintenance Contract"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
  );
}
