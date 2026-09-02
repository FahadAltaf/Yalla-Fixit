"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { saveAs } from "file-saver";

import { InspectionReport } from "@/components/dashboard/snagging/inspection-report";
import { renderReactToPdfBlob } from "@/lib/snagging/report-pdf";
import type { SnaggingQuotation } from "@/modules/snagging";
import type { SnaggingTask } from "@/types/types";

type ReportPayload = {
  task: SnaggingTask;
  quotation: SnaggingQuotation | null;
};

/**
 * The public, login-free client report page (FR-5.04-06).
 *
 * Loads the report by its link token and renders the same document the
 * coordinator sees, with a download button. Deliberately minimal chrome:
 * this is what a client opens from an email.
 */
export function PublicReport({ token }: { token: string }) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/report/${token}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "This report link is not available.");
        return;
      }
      setPayload(body.data as ReportPayload);
    } catch {
      setError(
        "Could not load the report. Please check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function downloadPdf() {
    if (!payload) return;
    setBusy(true);
    try {
      // Rendered fresh with forPDF rather than rasterising the node on
      // screen: the two need different vertical padding (html2canvas puts a
      // box's background where the browser does not), which is the same
      // split the quotation template makes.
      const blob = await renderReactToPdfBlob(
        <InspectionReport
          task={payload.task}
          quotation={payload.quotation}
          forPDF
        />,
        2,
        { footerLabel: `${payload.task.code} — Snagging inspection report` },
      );
      saveAs(blob, `${payload.task.code}-snagging-report.pdf`);
    } catch {
      // Swallow: the client can still read the report on screen.
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div style={centered}>
        <Loader2
          style={{ width: 28, height: 28, color: "#0f766e" }}
          className="animate-spin"
        />
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div style={centered}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0f766e" }}>
            YALLA FIXIT
          </div>
          <p style={{ color: "#6b7280", marginTop: 12 }}>
            {error ?? "Report not found."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        padding: "24px 16px",
      }}
    >
      <style>{`@media print {
        .pr-bar { display: none !important; }
        .pr-sheet { box-shadow: none !important; }
      }`}</style>

      <div
        className="pr-bar"
        style={{
          maxWidth: 794,
          margin: "0 auto 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 800, color: "#0f766e" }}>
          YALLA FIXIT
        </div>
        <button
          type="button"
          onClick={() => void downloadPdf()}
          disabled={busy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#0f766e",
            color: "#ffffff",
            border: "none",
            borderRadius: 8,
            padding: "9px 16px",
            fontWeight: 700,
            fontSize: 14,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? (
            <Loader2
              style={{ width: 16, height: 16 }}
              className="animate-spin"
            />
          ) : (
            <Download style={{ width: 16, height: 16 }} />
          )}
          Download PDF
        </button>
      </div>

      <div
        className="pr-sheet"
        style={{
          maxWidth: 794,
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: 10,
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          overflow: "hidden",
        }}
      >
        <InspectionReport
          ref={reportRef}
          task={payload.task}
          quotation={payload.quotation}
        />
      </div>
    </div>
  );
}

const centered: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#f3f4f6",
};
