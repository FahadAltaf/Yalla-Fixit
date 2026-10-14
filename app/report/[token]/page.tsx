import type { Metadata } from "next";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { renderReportHtml } from "@/lib/server/snagging/report-html";
import {
  loadLinkedReport,
  recordReportOpen,
  validateReportToken,
  type ReportDenial,
} from "@/lib/server/snagging/report-link";
import { LocalDates } from "@/components/report/local-dates";
import { ReportDownloadBar } from "@/components/report/report-download-bar";
import { reportFileName } from "@/lib/snagging/report-file-name";

/**
 * The client's report, at a secure link (FR-7.04, FR-7.05).
 *
 * Rendered on the server from the same `buildReportData()` the PDF is built
 * from, through the same template in `web` mode -- so the two cannot report
 * different totals, and the page is responsive rather than a fixed A4 sheet
 * scaled down on a phone.
 *
 * The token is the only credential. It is validated, checked for revocation
 * and expiry, and its open recorded before anything is rendered; an invalid
 * token gets the same page as an expired one, so the URL cannot be used to
 * probe which inspections exist.
 */

// A private client link: never index it, never cache it.
export const metadata: Metadata = {
  title: "Inspection report",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Denial = ReportDenial;

function DenialPage({ reason }: { reason: Denial }) {
  const copy: Record<Denial, { title: string; body: string }> = {
    invalid: {
      title: "This link is not available",
      body: "The link may be incomplete or may have been replaced. Please ask Yalla Fix It to send it again.",
    },
    expired: {
      title: "This link has expired",
      body: "Report links are valid for 30 days. Please ask Yalla Fix It for a fresh link to your report.",
    },
    revoked: {
      title: "This link has been withdrawn",
      body: "This report link is no longer active. Please contact Yalla Fix It if you still need a copy.",
    },
  };
  const { title, body } = copy[reason];

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#f6f4f3",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          background: "#ffffff",
          border: "1px solid #e3dedb",
          borderRadius: 12,
          padding: "32px 28px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 800, color: "#8c1d24" }}>
          Yalla Fix It
        </div>
        <h1 style={{ fontSize: 20, margin: "16px 0 8px", color: "#17191b" }}>{title}</h1>
        <p style={{ margin: 0, color: "#5b5f63", lineHeight: 1.6, fontSize: 15 }}>
          {body}
        </p>
      </div>
    </main>
  );
}

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token || token.length < 16) return <DenialPage reason="invalid" />;

  const admin = await createAdminServerClient();
  const outcome = await validateReportToken(admin, token);
  if ("denied" in outcome) return <DenialPage reason={outcome.denied} />;
  const { link } = outcome;
  // FR-7.05 — recorded before rendering, so a client who abandons a slow
  // page still counts as having opened it.
  await recordReportOpen(admin, link);

  const report = await loadLinkedReport(admin, link);
  if (!report) return <DenialPage reason="invalid" />;

  // Fragment: this is embedded in the app shell, so it carries its own
  // styles but no second <html> document.
  const html = renderReportHtml(report.data, {
    mode: "web",
    version: report.version,
    reportType: report.reportType,
    fragment: true,
  });

  /*
    Always a Download PDF, and a Print (SNG-140). The stored PDF when this
    version has one; otherwise the browser prints this same report's A4
    layout to a file, so the client can always save what they are reading.
  */
  const place = [report.data.cover.project, report.data.cover.unit]
    .filter(Boolean)
    .join(", ");
  return (
    <>
      <style>{"@media print { .report-download-bar { display: none !important; } }"}</style>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <div className="report-download-bar">
        <ReportDownloadBar
          documentUrl={`/report/${encodeURIComponent(token)}/document`}
          pdfUrl={report.pdfUrl}
          fileName={reportFileName(report.data.cover.unit, "pdf")}
          place={place || null}
        />
      </div>
      <LocalDates />
    </>
  );
}
