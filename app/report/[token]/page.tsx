import type { Metadata } from "next";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import {
  recordReportOpen,
  validateReportToken,
  type ReportDenial,
} from "@/lib/server/snagging/report-link";
import { loadReportTask } from "@/lib/server/snagging/report-task";
import { ClientReportView } from "@/components/report/client-report-view";
import { AMC_BRAND_IMAGES } from "@/components/dashboard/extensions/amc/templates/amc-doc/amc-doc-theme";

/**
 * The client's report, at a secure link (FR-7.04, FR-7.05).
 *
 * The job's report page, read-only: the same React component the portal's
 * report page renders, on the same data, cut to what the client may see. So
 * the page, its Download PDF and Word, the PDF on the Zoho FSM work order and
 * the office's own copy are all one design.
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
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img
          src={AMC_BRAND_IMAGES.logoTrimmed}
          alt="Yalla Fix It Facility Management"
          style={{ height: 56, width: "auto", margin: "0 auto", display: "block" }}
        />
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

  const task = await loadReportTask(admin, link.job_id);
  if (!task) return <DenialPage reason="invalid" />;
  return <ClientReportView task={task} />;
}
