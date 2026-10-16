"use client";

import { useState } from "react";

/**
 * The Download PDF bar on the client's report link (SNG-140).
 *
 * Always offered. When the report version has a stored PDF it is that file;
 * otherwise the PDF is made in the browser from the same report, in its A4
 * layout, so a client can always save what they are reading. Styled inline:
 * the link page carries its own look, not the portal's theme.
 */
export function ReportDownloadBar({
  documentUrl,
  pdfUrl,
  fileName,
  place,
}: {
  /** The print-layout page of this report (app/report/[token]/document). */
  documentUrl: string;
  /** A stored PDF for this version, when one was generated. */
  pdfUrl: string | null;
  fileName: string;
  place: string | null;
}) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  async function download() {
    if (state === "working") return;
    if (pdfUrl) {
      const a = document.createElement("a");
      a.href = pdfUrl;
      a.download = fileName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    setState("working");
    try {
      const response = await fetch(documentUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("The report could not be loaded");
      const [{ reportHtmlToPdfBlob }, { saveAs }] = await Promise.all([
        import("@/lib/snagging/report-html-pdf"),
        import("file-saver"),
      ]);
      const blob = await reportHtmlToPdfBlob(await response.text(), {
        place,
        footerLabel: "Snagging inspection report",
      });
      saveAs(blob, fileName);
      setState("idle");
    } catch (error) {
      console.error("Report PDF download failed:", error);
      setState("failed");
    }
  }

  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        background: "#ffffff",
        borderTop: "1px solid #e3dedb",
        padding: "12px 16px",
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
        justifyContent: "center",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
      }}
    >
      <button
        type="button"
        onClick={() => void download()}
        disabled={state === "working"}
        style={{
          background: "#8c1d24",
          color: "#ffffff",
          border: 0,
          padding: "10px 20px",
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 14,
          cursor: state === "working" ? "progress" : "pointer",
          opacity: state === "working" ? 0.75 : 1,
        }}
      >
        {state === "working" ? "Preparing the PDF…" : "Download PDF"}
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        style={{
          background: "#ffffff",
          color: "#17191b",
          border: "1px solid #e3dedb",
          padding: "10px 20px",
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        Print
      </button>
      {state === "failed" ? (
        <span style={{ color: "#a81d1d", fontSize: 13, width: "100%", textAlign: "center" }}>
          The PDF could not be prepared. Please try again, or use Print and choose Save as PDF.
        </span>
      ) : null}
    </div>
  );
}
