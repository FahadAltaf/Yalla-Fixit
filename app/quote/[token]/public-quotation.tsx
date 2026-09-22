"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { saveAs } from "file-saver";

import {
  generateQuotationDocxBlob,
  generateQuotationPDFBlob,
} from "@/components/dashboard/extensions/quotation-templates/pdf-utils";
import { YallaClassicTemplate } from "@/components/dashboard/extensions/quotation-templates/templates/YallaClassicTemplate";
import { snaggingQuoteToTemplateData, type SnaggingQuoteDoc } from "@/lib/snagging/quotation-template-data";
import { StatusMessageCard } from "@/components/quotations/status-message-card";
import {
  ClientDocumentShell,
  ClientDownloadMenu,
  FitToWidth,
  type ClientFileFormat,
} from "@/components/client-document/client-document-shell";
import { formatCurrencyAED } from "@/utils/format-currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Loader from "@/components/ui/loader";

/**
 * Public, login-free client quotation page (FR-2.06, §5). Loads the quote by
 * its link token, renders the document, and lets the client approve or reject
 * once.
 *
 * Built to match app/quotations/review: the same page shell, the same
 * actions-above-document order, the same StatusMessageCard for terminal
 * states, and the same Loader / EmptyState. These are the only two pages a
 * client ever sees, so they must not look like different products -- this
 * one previously used hand-rolled inline styles and hex colours that matched
 * nothing else in the app.
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
  /**
   * Which decision the client is making, and how far through it they are.
   * Null means no dialog is open.
   *
   * Both decisions ask who is making them before anything else: the name is
   * what gets recorded against a binding choice, and asking for it inline on
   * the card left it looking optional beside two prominent buttons. Step one
   * collects it, step two states what the decision means and takes the
   * confirmation.
   */
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [step, setStep] = useState<"name" | "details">("name");
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

  function startDecision(next: "approve" | "reject") {
    setDecision(next);
    // A name already given this session carries over, so a client who backs
    // out of Approve and picks Reject is not asked for it twice.
    setStep(name.trim() ? "details" : "name");
  }

  function closeDecision() {
    if (busy) return;
    setDecision(null);
  }

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

  /* PDF or Word — the same document model, so the two always match. A
     failure is reported by the menu (ClientDownloadMenu). */
  async function download(format: ClientFileFormat) {
    if (!quote) return;
    const data = snaggingQuoteToTemplateData(quote);
    const blob =
      format === "pdf"
        ? await generateQuotationPDFBlob("yalla-classic", data, { scale: 2 }, "without")
        : await generateQuotationDocxBlob(data, "without");
    saveAs(blob, `Quotation-${quote.quote_number}.${format}`);
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh)] items-center justify-center py-8">
        <Loader />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-10">
        <EmptyState
          title="We could not load this quotation"
          description={
            error ??
            "The quotation may have expired, been updated, or the link is no longer valid. Please reach out to Yalla Fix It so we can resend it."
          }
          icon={<AlertCircle />}
        />
      </main>
    );
  }

  // A quote that has already been decided -- here or in a previous visit --
  // is terminal: show the outcome rather than buttons that would fail.
  const outcome =
    done ?? (quote.status === "approved" ? "approved" : quote.status === "rejected" ? "rejected" : null);

  if (outcome === "approved") {
    return (
      <StatusMessageCard
        title="Quotation approved"
        description="Thank you — your approval has been recorded and our team will be in touch to schedule your inspection."
        icon={<CheckCircle2 size={32} className="text-green-600" />}
        iconBg="bg-green-50"
      />
    );
  }

  if (outcome === "rejected") {
    return (
      <StatusMessageCard
        title="Quotation rejected"
        description={
          quote.rejected_reason
            ? `Your rejection has been recorded: “${quote.rejected_reason}”. Our team will follow up if anything can be revised.`
            : "Your rejection has been recorded. Our team will follow up if anything can be revised."
        }
        icon={<XCircle size={32} className="text-red-600" />}
        iconBg="bg-red-50"
      />
    );
  }

  const doc = snaggingQuoteToTemplateData(quote);
  const property = [quote.property?.unit_label, quote.property?.building_name, quote.property?.community]
    .filter(Boolean)
    .join(", ");

  return (
    <ClientDocumentShell
      actions={
        <>
          <ClientDownloadMenu onDownload={download} />
          <Button className="flex-1 sm:flex-none" variant="outline" disabled={busy} onClick={() => startDecision("reject")}>
            <XCircle className="size-4" /> Reject
          </Button>
          <Button className="flex-1 sm:flex-none" disabled={busy} onClick={() => startDecision("approve")}>
            <CheckCircle2 className="size-4" /> Approve quotation
          </Button>
        </>
      }
      facts={[
        { label: "Prepared for", value: doc.customerCompanyName || "—", hint: property || undefined },
        { label: "Total", value: formatCurrencyAED(quote.total), hint: "incl. VAT" },
        { label: "Quotation", value: quote.quote_number, hint: doc.quotationDate },
      ]}
    >
        <Dialog
          open={decision !== null}
          onOpenChange={(open) => {
            if (!open) closeDecision();
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {step === "name"
                  ? "Who is responding?"
                  : decision === "approve"
                    ? `Approve quotation ${quote.quote_number}?`
                    : `Reject quotation ${quote.quote_number}?`}
              </DialogTitle>
              <DialogDescription>
                {step === "name"
                  ? "We record this against your decision, so please tell us who you are."
                  : decision === "approve"
                    ? "This confirms you accept the quotation and its terms. It is final, and our team will proceed to schedule your inspection."
                    : "Tell us what is wrong and our team will follow up if anything can be revised."}
              </DialogDescription>
            </DialogHeader>

            {step === "name" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="approver-name">
                  Your name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="approver-name"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim()) setStep("details");
                  }}
                  placeholder="e.g. Sarah Ahmed"
                />
              </div>
            ) : decision === "approve" ? (
              <p className="text-sm text-slate-600">
                Approving as <strong className="text-slate-900">{name.trim()}</strong>.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reject-reason">
                  Reason <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="reject-reason"
                  value={reason}
                  autoFocus
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Please tell us why you are rejecting this quotation"
                  rows={3}
                />
              </div>
            )}

            <DialogFooter>
              {step === "name" ? (
                <>
                  <Button variant="outline" onClick={closeDecision}>
                    Cancel
                  </Button>
                  <Button disabled={!name.trim()} onClick={() => setStep("details")}>
                    Continue
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" disabled={busy} onClick={() => setStep("name")}>
                    Back
                  </Button>
                  {decision === "approve" ? (
                    <Button disabled={busy} onClick={() => void decide("approve")}>
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      {busy ? "Approving…" : "Confirm approval"}
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      disabled={busy || !reason.trim()}
                      onClick={() => void decide("reject")}
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                      {busy ? "Submitting…" : "Confirm rejection"}
                    </Button>
                  )}
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

      <FitToWidth>
        <YallaClassicTemplate data={doc} discountMode="without" hideDiscount />
      </FitToWidth>
    </ClientDocumentShell>
  );
}
