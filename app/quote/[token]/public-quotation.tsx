"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, XCircle } from "lucide-react";
import { saveAs } from "file-saver";

import { generateQuotationPDFBlob } from "@/components/dashboard/extensions/quotation-templates/pdf-utils";
import { YallaClassicTemplate } from "@/components/dashboard/extensions/quotation-templates/templates/YallaClassicTemplate";
import { snaggingQuoteToTemplateData, type SnaggingQuoteDoc } from "@/lib/snagging/quotation-template-data";

/**
 * Public, login-free client quotation page (FR-2.06, §5). Loads the quote by
 * its link token, renders the document, and lets the client approve or reject
 * once. Deliberately minimal chrome — this is what a client opens from email.
 */
type QuoteData = SnaggingQuoteDoc & {
  id: string;
  status: string;
  rejected_reason?: string | null;
  approved_by_name?: string | null;
  decided_at?: string | null;
};

export function PublicQuotation({ token }: { token: string }) {
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [mode, setMode] = useState<"view" | "confirm-approve" | "reject">("view");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/snagging/quotation/${token}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "This quotation link is not available.");
        return;
      }
      const q = body.data;
      const s = (q.property_snapshot ?? {}) as Record<string, unknown>;
      setQuote({
        id: q.id,
        status: q.status,
        rejected_reason: q.rejected_reason,
        approved_by_name: q.approved_by_name,
        decided_at: q.decided_at,
        quote_number: q.quote_number,
        created_at: q.created_at,
        sent_at: q.sent_at,
        currency: q.currency,
        subtotal: q.subtotal,
        tax_rate: q.tax_rate,
        tax_amount: q.tax_amount,
        total: q.total,
        lines: q.lines ?? [],
        scope_of_work: q.scope_of_work,
        terms: q.terms,
        property: {
          unit_label: s.unit_label as string,
          building_name: s.building_name as string,
          community: s.community as string,
          developer_name: s.developer_name as string,
          property_type: s.property_type as string,
          bedrooms: s.bedrooms as number,
          built_up_area_sqft: s.built_up_area_sqft as number,
          client_name: s.client_name as string,
          client_email: s.client_email as string,
          client_phone: s.client_phone as string,
          client_ref: s.client_ref as string,
        },
      });
    } catch {
      setError("Could not load the quotation. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(decision: "approve" | "reject") {
    if (busy) return;
    if (decision === "reject" && !reason.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/snagging/quotation/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, name: name.trim() || null, reason: reason.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Could not record your decision.");
        return;
      }
      setDone(decision === "approve" ? "approved" : "rejected");
    } catch {
      setError("Could not record your decision. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!quote || downloading) return;
    setDownloading(true);
    try {
      const blob = await generateQuotationPDFBlob(
        "yalla-classic",
        snaggingQuoteToTemplateData(quote),
        { scale: 2 },
        "without",
      );
      saveAs(blob, `Quotation-${quote.quote_number}.pdf`);
    } catch {
      /* on-screen view still works */
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <Centered><Loader2 className="size-7 animate-spin" style={{ color: "#9f2b23" }} /></Centered>;

  if (error || !quote) {
    return (
      <Centered>
        <div style={{ textAlign: "center", maxWidth: 380 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#9f2b23" }}>YALLA FIX IT</div>
          <p style={{ color: "#6b7280", marginTop: 12 }}>{error ?? "Quotation not found."}</p>
        </div>
      </Centered>
    );
  }

  const decided = quote.status === "approved" || quote.status === "rejected" || done !== null;
  const outcome = done ?? (quote.status === "approved" ? "approved" : quote.status === "rejected" ? "rejected" : null);

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", padding: "24px 16px" }}>
      <div style={{ maxWidth: 794, margin: "0 auto 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#9f2b23" }}></div>
        <button type="button" onClick={() => void download()} disabled={downloading} style={{ ...btn("#0f766e"), opacity: downloading ? 0.7 : 1, cursor: downloading ? "default" : "pointer" }}>
          {downloading ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <Download style={{ width: 16, height: 16 }} />}
          {downloading ? "Preparing…" : "Download PDF"}
        </button>
      </div>

      <div style={{ maxWidth: 794, margin: "0 auto", background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,.1)", overflow: "hidden" }}>
        <YallaClassicTemplate data={snaggingQuoteToTemplateData(quote)} discountMode="without" hideDiscount />
      </div>

      <div style={{ maxWidth: 794, margin: "16px auto 0" }}>
        {decided ? (
          <div style={panel(outcome === "approved" ? "#16a34a" : "#dc2626")}>
            {outcome === "approved" ? (
              <p style={{ margin: 0, fontWeight: 600 }}>✓ You approved this quotation. Thank you — our team will proceed.</p>
            ) : (
              <p style={{ margin: 0, fontWeight: 600 }}>This quotation was rejected{quote.rejected_reason ? `: ${quote.rejected_reason}` : "."}</p>
            )}
          </div>
        ) : mode === "view" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (for the record)"
              style={input}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={() => setMode("confirm-approve")} disabled={busy} style={{ ...btn("#16a34a"), flex: 1, justifyContent: "center", padding: "12px" }}>
                <CheckCircle2 style={{ width: 18, height: 18 }} /> Approve quotation
              </button>
              <button type="button" onClick={() => setMode("reject")} disabled={busy} style={{ ...btn("#fff", "#dc2626"), flex: 1, justifyContent: "center", padding: "12px", border: "1px solid #dc2626" }}>
                <XCircle style={{ width: 18, height: 18 }} /> Reject
              </button>
            </div>
          </div>
        ) : mode === "confirm-approve" ? (
          <div style={panel("#16a34a")}>
            <p style={{ margin: "0 0 12px", fontWeight: 600 }}>Approve quotation {quote.quote_number}?</p>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "#4b5563" }}>
              This confirms you accept the quotation and its terms. It is final and our team will proceed to schedule your inspection. {name.trim() ? <>Approving as <strong>{name.trim()}</strong>.</> : "You can go back to add your name for the record."}
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={() => setMode("view")} disabled={busy} style={{ ...btn("#fff", "#374151"), border: "1px solid #d1d5db", padding: "12px 16px" }}>Back</button>
              <button type="button" onClick={() => void decide("approve")} disabled={busy} style={{ ...btn("#16a34a"), flex: 1, justifyContent: "center", padding: "12px", opacity: busy ? 0.7 : 1 }}>
                {busy ? <Loader2 className="animate-spin" style={{ width: 18, height: 18 }} /> : <CheckCircle2 style={{ width: 18, height: 18 }} />}
                {busy ? "Approving…" : "Confirm approval"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Please tell us why you're rejecting this quotation"
              rows={3}
              style={{ ...input, resize: "vertical" as const }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={() => setMode("view")} disabled={busy} style={{ ...btn("#fff", "#374151"), border: "1px solid #d1d5db", padding: "12px 16px" }}>Back</button>
              <button type="button" onClick={() => void decide("reject")} disabled={busy || !reason.trim()} style={{ ...btn("#dc2626"), flex: 1, justifyContent: "center", padding: "12px", opacity: busy || !reason.trim() ? 0.7 : 1 }}>
                {busy ? <Loader2 className="animate-spin" style={{ width: 18, height: 18 }} /> : null}
                {busy ? "Submitting…" : "Confirm rejection"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6" }}>{children}</div>;
}
function btn(bg: string, color = "#fff"): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 8, background: bg, color, border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer" };
}
function panel(color: string): React.CSSProperties {
  return { background: "#fff", border: `1px solid ${color}55`, borderLeft: `4px solid ${color}`, borderRadius: 8, padding: "14px 16px", color: "#1f2937" };
}
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, fontFamily: "inherit" };
