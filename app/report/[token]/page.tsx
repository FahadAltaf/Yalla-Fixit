import type { Metadata } from "next";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hashReportToken } from "@/lib/server/snagging/report-token";
import { buildReportData, type ReportData } from "@/lib/server/snagging/report-data";
import { renderReportHtml } from "@/lib/server/snagging/report-html";
import { signReportPdf } from "@/lib/server/snagging/report-generate";
import { recordAudit } from "@/lib/server/snagging/audit";

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

type Denial = "invalid" | "expired" | "revoked";

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

type LinkRow = {
  id: string;
  job_id: string;
  version_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  opened_at: string | null;
  open_count: number;
};

/**
 * Validates a presented token and records the open.
 *
 * Outside the component on purpose: it reads the clock and writes to the
 * database, neither of which belongs in a render.
 */
async function openLink(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  token: string,
): Promise<{ link: LinkRow } | { denied: Denial }> {
  const { data, error } = await admin
    .from("snagging_report_tokens")
    .select("id, job_id, version_id, expires_at, revoked_at, opened_at, open_count")
    .eq("token_hash", hashReportToken(token))
    .maybeSingle();

  if (error) {
    console.error("Public report token lookup failed:", error.message);
    return { denied: "invalid" };
  }
  const link = data as LinkRow | null;
  if (!link) return { denied: "invalid" };
  if (link.revoked_at) return { denied: "revoked" };
  if (new Date(link.expires_at).getTime() < Date.now()) return { denied: "expired" };

  // FR-7.05 — recorded before rendering, so a client who abandons a slow
  // page still counts as having opened it.
  const now = new Date().toISOString();
  const nextCount = (link.open_count ?? 0) + 1;
  await admin
    .from("snagging_report_tokens")
    .update({
      open_count: nextCount,
      last_opened_at: now,
      opened_at: link.opened_at ?? now,
    })
    .eq("id", link.id);

  await recordAudit(admin, {
    entityType: "report",
    entityId: link.version_id ?? link.job_id,
    taskId: link.job_id,
    eventType: "report_opened",
    actorLabel: "Client",
    origin: "system",
    payload: { open_count: nextCount },
  });

  return { link };
}

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token || token.length < 16) return <DenialPage reason="invalid" />;

  const admin = await createAdminServerClient();
  const outcome = await openLink(admin, token);
  if ("denied" in outcome) return <DenialPage reason={outcome.denied} />;
  const { link } = outcome;

  /*
    Prefer the version's snapshot over live data.

    A version is what the client was actually sent. Re-deriving it from
    today's rows would quietly restate an issued document against a changed
    catalogue or a later visit's snags -- so the snapshot wins whenever one
    exists, and live data is only the path for links minted before
    snapshots existed.
  */
  let data: ReportData | null = null;
  let version: number | null = null;
  let reportType = "inspection";
  let pdfUrl: string | null = null;

  if (link.version_id) {
    const { data: row } = await admin
      .from("snagging_report_versions")
      .select("version, report_type, snapshot, pdf_path")
      .eq("id", link.version_id)
      .maybeSingle();
    if (row) {
      version = row.version as number;
      reportType = (row.report_type as string) ?? "inspection";
      if (row.snapshot) data = row.snapshot as unknown as ReportData;
      if (row.pdf_path) pdfUrl = await signReportPdf(admin, row.pdf_path as string);
    }
  }

  if (!data) {
    data = await buildReportData(admin, link.job_id, "inspection");
  }
  if (!data) return <DenialPage reason="invalid" />;

  // Fragment: this is embedded in the app shell, so it carries its own
  // styles but no second <html> document.
  const html = renderReportHtml(data, {
    mode: "web",
    version,
    reportType,
    fragment: true,
  });

  // The document is a complete page of its own; a wrapper would inherit the
  // app's own theme tokens, which is exactly what the client must not get.
  const download = pdfUrl
    ? `<div style="position:sticky;bottom:0;background:#fff;border-top:1px solid #e3dedb;padding:12px 16px;text-align:center">
         <a href="${pdfUrl}" download style="display:inline-block;background:#8c1d24;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">Download PDF</a>
       </div>`
    : "";

  return <div dangerouslySetInnerHTML={{ __html: html + download }} />;
}
