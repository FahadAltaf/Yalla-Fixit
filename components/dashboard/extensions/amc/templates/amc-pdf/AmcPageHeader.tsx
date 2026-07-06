import pdfHeader from "@/public/amc/pdf-header.png";

export function AmcPageHeader() {
  return (
    <div style={{ marginBottom: "6px", flexShrink: 0, width: "100%" }}>
      <img
        src={pdfHeader.src}
        alt="Annual Maintenance Contract"
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          objectFit: "contain",
        }}
      />
    </div>
  );
}
