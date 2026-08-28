"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileText,
  Send,
  XCircle,
} from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { generateQuotationPDFBlob } from "@/components/dashboard/extensions/quotation-templates/pdf-utils";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import {
  snaggingQuoteToTemplateData,
  type SnaggingQuoteDoc,
} from "@/lib/snagging/quotation-template-data";
import { snaggingService, type SnaggingQuotation } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingTask } from "@/types/types";

import { EmptyState } from "@/components/ui/empty-state";

import { QuotationLinesTable } from "./quotation-lines-table";

import {
  DataState,
  QuotationStatusBadge,
  SectionCard,
  SubmitButton,
  formatGstDateTime,
  useConfirm,
} from "./shared";

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
export function QuotationPanel({
  task,
}: {
  task: SnaggingTask;
  /**
   * Part of the panel's contract with the job screen, but nothing here
   * moves the job any more: the client approves or rejects through the
   * emailed link, and the job screen reloads on its own.
   */
  onChanged: () => void;
}) {
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.EDIT,
  );
  const { confirm, dialog } = useConfirm();
  const [quote, setQuote] = useState<SnaggingQuotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const busy = working || downloading;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The API answers an absent quotation with null, so only a thrown
      // error is a failure. Swallowing it used to make "the server is
      // down" look identical to "no quotation yet" — and the panel then
      // offered Generate, which numbers a second financial document
      // against a job that already has one.
      setQuote(await snaggingService.getQuotation(task.id));
    } catch (err) {
      setQuote(null);
      setError(
        err instanceof Error ? err.message : "Could not load the quotation",
      );
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Generate (or regenerate) the quotation. Approve and reject are the
   * client's decisions, recorded through the emailed link — this panel
   * never drives them, so it only knows this one action.
   */
  async function run() {
    if (working) return;
    setWorking(true);
    try {
      await snaggingService.quotationAction(task.id, "generate");
      await load();
      toast.success("Quotation generated");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update the quotation",
      );
    } finally {
      setWorking(false);
    }
  }

  /** First generation numbers a document against the job, so it asks. */
  async function generate() {
    const ok = await confirm({
      title: "Generate a quotation?",
      description: `This creates a numbered quotation for ${task.code} from the current rates, scope and terms, and records it against the job.`,
      confirmText: "Generate quotation",
    });
    if (!ok) return;
    await run();
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
      toast.error(
        e instanceof Error ? e.message : "Could not generate the PDF",
        { id: t },
      );
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
      toast.error(
        error instanceof Error ? error.message : "Could not send the quotation",
      );
    } finally {
      setWorking(false);
    }
  }

  const isDecided =
    quote?.status === "approved" || quote?.status === "rejected";

  return (
    <SectionCard
      title="Quotation"
      icon={<FileText />}
      description={
        error
          ? "The quotation could not be loaded."
          : quote
            ? `Quotation ${quote.quote_number}`
            : task.status === "draft"
              ? "This job is a draft. Generate and send a quotation to the client to proceed."
              : "No quotation on this job."
      }
      // The status belongs in the header as a badge, not as a raw
      // lowercase word appended to the subtitle.
      action={quote ? <QuotationStatusBadge status={quote.status} /> : null}
      bodyClassName="border-t"
    >
      <div className="space-y-4 p-5">
        <DataState
          loading={loading}
          error={error}
          onRetry={() => void load()}
          retrying={loading}
          errorTitle="Could not load the quotation"
          isEmpty={!quote}
          skeleton={
            // The same single block the quote renders as: a header band,
            // a couple of lines, then the totals footer.
            <div className="overflow-hidden rounded-lg border">
              <div className="bg-muted/50 flex items-center gap-4 border-b px-4 py-2.5">
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-20" />
              </div>
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 border-b px-4 py-3.5"
                >
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
              <div className="bg-muted/50 space-y-2.5 px-4 py-3">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="flex justify-end gap-4">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton
                      className={cn("h-4", index === 2 ? "w-24" : "w-20")}
                    />
                  </div>
                ))}
              </div>
            </div>
          }
          empty={
            <EmptyState
              icon={<FileText className="size-6" />}
              title="No quotation yet"
              description={
                task.status === "draft"
                  ? "This job stays a draft until a quotation is generated, sent, and approved by the client."
                  : "Nothing has been quoted against this job."
              }
              // EmptyState takes a plain label rather than a SubmitButton, so the
              // pending state is carried by the label itself.
              action={
                canEdit
                  ? {
                      label: working ? "Generating…" : "Generate quotation",
                      onClick: () => void generate(),
                    }
                  : undefined
              }
            />
          }
        >
          {quote ? (
            <div className="space-y-5">
              <QuotationLinesTable
                lines={quote.lines}
                currency={quote.currency ?? "AED"}
                subtotal={quote.subtotal}
                taxRate={quote.tax_rate}
                taxAmount={quote.tax_amount}
                total={quote.total}
              />

              {/* Where it stands with the client. */}
              {quote.status === "sent" ? (
                <Alert>
                  <Clock />
                  <AlertTitle>Awaiting the client&apos;s decision</AlertTitle>
                  <AlertDescription>
                    Sent to {quote.sent_to}
                    {quote.sent_at
                      ? ` on ${formatGstDateTime(quote.sent_at)}`
                      : ""}
                    .
                  </AlertDescription>
                </Alert>
              ) : null}
              {quote.status === "approved" ? (
                <Alert className="border-success/30 [&>svg]:text-success">
                  <CheckCircle2 />
                  <AlertTitle>Approved by the client</AlertTitle>
                  <AlertDescription>
                    {quote.approved_by_name
                      ? `${quote.approved_by_name} approved this`
                      : "Approved"}
                    {quote.decided_at
                      ? ` on ${formatGstDateTime(quote.decided_at)}`
                      : ""}
                    . Inspector assignment is unlocked.
                  </AlertDescription>
                </Alert>
              ) : null}
              {quote.status === "rejected" ? (
                <Alert variant="destructive" className="border-destructive/30">
                  <XCircle />
                  <AlertTitle>Rejected by the client</AlertTitle>
                  <AlertDescription>
                    {quote.approved_by_name
                      ? `${quote.approved_by_name}: `
                      : ""}
                    {quote.rejected_reason || "No reason was given."}
                  </AlertDescription>
                </Alert>
              ) : null}

              {approvalUrl ? (
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs font-medium">
                    Client approval link
                  </p>
                  <div className="flex items-center gap-2 rounded-md border p-2">
                    <code className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
                      {approvalUrl}
                    </code>
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
                </div>
              ) : null}

              {/* Actions sit on their own line under a rule, so the
                  destructive-adjacent "Send to client" is never mistaken
                  for part of the figures above it. */}
              {canEdit ? (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
                  <SubmitButton
                    variant="outline"
                    size="sm"
                    onClick={() => void download()}
                    disabled={busy}
                    pending={downloading}
                    pendingLabel="Preparing…"
                    icon={<Download className="size-4" />}
                  >
                    Download PDF
                  </SubmitButton>
                  {!isDecided ? (
                    <>
                      {quote.status !== "draft" ? null : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRegenOpen(true)}
                          disabled={busy}
                        >
                          <FileText className="size-4" /> Regenerate
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => {
                          const s = (quote.property_snapshot ?? {}) as Record<
                            string,
                            unknown
                          >;
                          setRecipient(
                            (s.client_email as string) ?? quote.sent_to ?? "",
                          );
                          setSendOpen(true);
                        }}
                        disabled={busy}
                      >
                        <Send className="size-4" />{" "}
                        {quote.status === "sent"
                          ? "Resend to client"
                          : "Send to client"}
                      </Button>
                    </>
                  ) : (
                    <Badge variant="secondary" className="bg-muted border-0">
                      {quote.status === "approved"
                        ? "Approved by client — locked"
                        : "Rejected by client"}
                    </Badge>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </DataState>
      </div>

      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate this quotation?</DialogTitle>
            <DialogDescription>
              This rebuilds the quotation from the current pricing, scope and
              terms, replacing the existing draft figures. Only draft quotations
              can be regenerated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRegenOpen(false)}
              disabled={working}
            >
              Cancel
            </Button>
            <SubmitButton
              onClick={async () => {
                setRegenOpen(false);
                await run();
              }}
              pending={working}
              pendingLabel="Regenerating…"
              icon={<FileText className="size-4" />}
            >
              Regenerate
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send quotation to the client</DialogTitle>
            <DialogDescription>
              Emails the PDF and a secure approve/reject link to the client via
              Resend. The job stays a draft until the client approves.
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
            <Button
              variant="outline"
              onClick={() => setSendOpen(false)}
              disabled={working}
            >
              Cancel
            </Button>
            <SubmitButton
              onClick={() => void sendToClient()}
              disabled={recipient.trim().length < 3}
              pending={working}
              pendingLabel="Sending…"
              icon={<Send className="size-4" />}
            >
              Send quotation
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialog}
    </SectionCard>
  );
}
