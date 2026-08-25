"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Download, FileText, Loader2, Send } from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateQuotationPDFBlob } from "@/components/dashboard/extensions/quotation-templates/pdf-utils";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingQuoteToTemplateData, type SnaggingQuoteDoc } from "@/lib/snagging/quotation-template-data";
import { snaggingService, type SnaggingQuotation } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingTask } from "@/types/types";

import { SectionCard } from "./shared";

/** Builds the document snapshot the shared quotation template renders from. */
function toDocData(q: SnaggingQuotation): SnaggingQuoteDoc {
  const s = (q.property_snapshot ?? {}) as Record<string, unknown>;
  return {
    quote_number: q.quote_number,
    status: q.status,
    created_at: q.created_at,
    sent_at: q.sent_at,
    currency: q.currency,
    subtotal: q.subtotal,
    tax_rate: q.tax_rate,
    tax_amount: q.tax_amount,
    total: q.total,
    lines: q.lines,
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
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Quotation for a job (F1-F6, FR-2.06). A job stays a draft until its
 * quotation is approved — by the client through the emailed link, or by a
 * coordinator recording the client's decision here.
 */
export function QuotationPanel({ task, onChanged }: { task: SnaggingTask; onChanged: () => void }) {
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.EDIT);
  const [quote, setQuote] = useState<SnaggingQuotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const busy = working || downloading;

  const load = useCallback(async () => {
    try {
      setQuote(await snaggingService.getQuotation(task.id));
    } catch {
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: "generate" | "approve" | "reject", extra?: Record<string, unknown>) {
    if (working) return;
    setWorking(true);
    try {
      await snaggingService.quotationAction(task.id, action, extra);
      await load();
      if (action === "approve") {
        toast.success("Quotation approved — the job is now assigned");
        onChanged();
      } else toast.success(action === "generate" ? "Quotation generated" : "Quotation rejected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the quotation");
    } finally {
      setWorking(false);
    }
  }

  async function makePdfBase64(): Promise<string | null> {
    if (!quote) return null;
    const blob = await generateQuotationPDFBlob(
      "yalla-classic",
      snaggingQuoteToTemplateData(toDocData(quote)),
      { scale: 2 },
      "without",
    );
    return blobToBase64(blob);
  }

  async function download() {
    if (!quote) return;
    setDownloading(true);
    const t = toast.loading("Preparing the PDF…");
    try {
      const blob = await generateQuotationPDFBlob(
        "yalla-classic",
        snaggingQuoteToTemplateData(toDocData(quote)),
        { scale: 2 },
        "without",
      );
      saveAs(blob, `Quotation-${quote.quote_number}.pdf`);
      toast.success("PDF downloaded", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate the PDF", { id: t });
    } finally {
      setDownloading(false);
    }
  }

  async function sendToClient() {
    if (!quote || !recipient.trim()) return;
    setWorking(true);
    try {
      const pdf_base64 = await makePdfBase64();
      const res = (await snaggingService.quotationAction(task.id, "send", {
        sent_to: recipient.trim(),
        pdf_base64,
      })) as SnaggingQuotation;
      setApprovalUrl(res.approval_url ?? null);
      setSendOpen(false);
      toast.success("Quotation emailed to the client");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the quotation");
    } finally {
      setWorking(false);
    }
  }

  const money = (n: number) =>
    `${quote?.currency ?? "AED"} ${Number(n).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const isDecided = quote?.status === "approved" || quote?.status === "rejected";

  return (
    <SectionCard
      title="Quotation"
      description={
        quote
          ? `${quote.quote_number} · ${quote.status}`
          : task.status === "draft"
            ? "This job is a draft. Generate and send a quotation to the client to proceed."
            : "No quotation on this job."
      }
      bodyClassName="border-t"
    >
      <div className="space-y-4 p-5">
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : !quote ? (
          canEdit ? (
            <Button onClick={() => void run("generate")} disabled={working}>
              {working ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              Generate quotation
            </Button>
          ) : (
            <p className="text-muted-foreground text-sm">No quotation yet.</p>
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="py-2 pr-2 font-medium">Description</th>
                    <th className="py-2 px-2 text-right font-medium">Qty</th>
                    <th className="py-2 px-2 text-right font-medium">Rate</th>
                    <th className="py-2 pl-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.lines.map((line, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-2">{line.description}</td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {line.qty} {line.unit}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{money(line.unit_price)}</td>
                      <td className="py-2 pl-2 text-right font-medium tabular-nums">{money(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ml-auto max-w-xs space-y-1 text-sm">
              <Row label="Subtotal" value={money(quote.subtotal)} />
              <Row label={`VAT (${quote.tax_rate}%)`} value={money(quote.tax_amount)} muted />
              <div className="flex items-center justify-between border-t pt-1 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{money(quote.total)}</span>
              </div>
            </div>

            {/* Status */}
            {quote.status === "sent" ? (
              <p className="text-muted-foreground border-t pt-3 text-sm">
                Sent to <strong>{quote.sent_to}</strong>
                {quote.sent_at ? ` on ${new Date(quote.sent_at).toLocaleDateString()}` : ""} — awaiting the client's
                decision.
              </p>
            ) : null}
            {quote.status === "approved" ? (
              <p className="text-success border-t pt-3 text-sm">
                Approved{quote.approved_by_name ? ` by ${quote.approved_by_name}` : ""}
                {quote.decided_at ? ` on ${new Date(quote.decided_at).toLocaleDateString()}` : ""}. Inspector
                assignment is unlocked.
              </p>
            ) : null}
            {quote.status === "rejected" ? (
              <p className="text-destructive border-t pt-3 text-sm">
                Rejected{quote.approved_by_name ? ` by ${quote.approved_by_name}` : ""}: {quote.rejected_reason}
              </p>
            ) : null}

            {approvalUrl ? (
              <div className="bg-muted flex items-center gap-2 rounded-md p-2 text-xs">
                <span className="truncate">{approvalUrl}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(approvalUrl);
                    toast.success("Client link copied");
                  }}
                >
                  <Copy className="size-3.5" /> Copy
                </Button>
              </div>
            ) : null}

            {/* Actions */}
            {canEdit ? (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button variant="outline" size="sm" onClick={() => void download()} disabled={busy}>
                  {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  {downloading ? "Preparing…" : "Download PDF"}
                </Button>
                {!isDecided ? (
                  <>
                    {quote.status !== "draft" ? null : (
                      <Button variant="outline" size="sm" onClick={() => setRegenOpen(true)} disabled={busy}>
                        <FileText className="size-4" /> Regenerate
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => {
                        const s = (quote.property_snapshot ?? {}) as Record<string, unknown>;
                        setRecipient((s.client_email as string) ?? quote.sent_to ?? "");
                        setSendOpen(true);
                      }}
                      disabled={busy}
                    >
                      <Send className="size-4" /> {quote.status === "sent" ? "Resend to client" : "Send to client"}
                    </Button>
                  </>
                ) : (
                  <Badge variant="secondary" className="bg-muted border-0">
                    {quote.status === "approved" ? "Approved by client — locked" : "Rejected by client"}
                  </Badge>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>

      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate this quotation?</DialogTitle>
            <DialogDescription>
              This rebuilds the quotation from the current pricing, scope and terms, replacing the existing
              draft figures. Only draft quotations can be regenerated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegenOpen(false)} disabled={working}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setRegenOpen(false);
                await run("generate");
              }}
              disabled={working}
            >
              {working ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send quotation to the client</DialogTitle>
            <DialogDescription>
              Emails the PDF and a secure approve/reject link to the client via Resend. The job stays a draft
              until the client approves.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="quote-recipient">Client email</Label>
            <Input
              id="quote-recipient"
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="client@email.com"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={working}>
              Cancel
            </Button>
            <Button onClick={() => void sendToClient()} disabled={working || recipient.trim().length < 3}>
              {working ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send quotation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
