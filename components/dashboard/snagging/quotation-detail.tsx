"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileText,
  MessageCircle,
  Plus,
  Send,
  X,
} from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { generateQuotationPDFBlob } from "@/components/dashboard/extensions/quotation-templates/pdf-utils";
import { YallaClassicTemplate } from "@/components/dashboard/extensions/quotation-templates/templates/YallaClassicTemplate";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import {
  snaggingQuoteToTemplateData,
  type SnaggingQuoteDoc,
} from "@/lib/snagging/quotation-template-data";
import { snaggingService, type SnaggingQuotation } from "@/modules/snagging";
import { ActionType, ResourceType } from "@/types/types";

import {
  DataState,
  PageHeading,
  QuotationStatusBadge,
  SubmitButton,
  formatGstDateTime,
} from "./shared";

/**
 * One quotation, on its own page rather than inside a job (BA v2, changes
 * 1-3).
 *
 * It carries the same verbs the job's quotation tab has — download, send,
 * share for WhatsApp, approve, reject — plus the one that only makes sense
 * here: turning an approved quotation into the job it paid for.
 */
export default function QuotationDetail({ id }: { id: string }) {
  const router = useRouter();
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.EDIT,
  );

  const [quote, setQuote] = useState<SnaggingQuotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [reason, setReason] = useState("");
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const busy = working || downloading;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setQuote(await snaggingService.getQuotationById(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the quotation");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const doc: SnaggingQuoteDoc | null = quote
    ? {
        quote_number: quote.quote_number,
        status: quote.status,
        created_at: quote.created_at,
        sent_at: quote.sent_at,
        currency: quote.currency,
        subtotal: quote.subtotal,
        tax_rate: quote.tax_rate,
        tax_amount: quote.tax_amount,
        total: quote.total,
        lines: quote.lines,
        scope_of_work: quote.scope_of_work,
        terms: quote.terms,
        property: (quote.property_snapshot ?? {}) as SnaggingQuoteDoc["property"],
      }
    : null;

  async function download() {
    if (!doc || !quote) return;
    setDownloading(true);
    const t = toast.loading("Preparing the PDF…");
    try {
      const blob = await generateQuotationPDFBlob(
        "yalla-classic",
        snaggingQuoteToTemplateData(doc),
        { scale: 2 },
        "without",
      );
      saveAs(blob, `Quotation-${quote.quote_number}.pdf`);
      toast.success("PDF downloaded", { id: t });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate the PDF", {
        id: t,
      });
    } finally {
      setDownloading(false);
    }
  }

  async function run(
    action: "send" | "share_link" | "regenerate" | "approve" | "reject",
    extra?: Record<string, unknown>,
    success?: string,
  ) {
    setWorking(true);
    try {
      const result = await snaggingService.quotationActionById(id, action, extra);
      if (result.approval_url) setApprovalUrl(result.approval_url);
      toast.success(success ?? "Done");
      await load();
      return result;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That did not work");
      return null;
    } finally {
      setWorking(false);
    }
  }

  /** The WhatsApp route: a link and a PDF, ready to paste (change 24). */
  async function shareByHand() {
    if (
      approvalUrl &&
      !window.confirm(
        "A link has already been issued for this quotation. Getting a new one stops the old link working. Continue?",
      )
    ) {
      return;
    }
    const result = await run("share_link", undefined, "Link copied and PDF downloaded");
    if (result?.approval_url) {
      await navigator.clipboard.writeText(result.approval_url).catch(() => {});
      await download();
    }
  }

  const isDecided = quote?.status === "approved" || quote?.status === "rejected";
  const isDesnag = quote?.quote_kind === "desnag";
  const needsJob = quote?.status === "approved" && !quote?.job_id;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeading
          eyebrow="Sales"
          title={quote ? `Quotation ${quote.quote_number}` : "Quotation"}
          description={
            quote
              ? `${isDesnag ? "De-snagging visit" : "Inspection"} · raised ${formatGstDateTime(quote.created_at)}.`
              : "Loading the document…"
          }
        />
        <Button variant="outline" onClick={() => router.push("/snagging/quotations")}>
          <ArrowLeft className="size-4" />
          All quotations
        </Button>
      </div>

      <DataState
        loading={loading}
        error={error}
        onRetry={() => void load()}
        retrying={loading}
        errorTitle="Could not load the quotation"
        skeleton={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-[28rem] w-full" />
          </div>
        }
      >
        {quote && doc ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <QuotationStatusBadge status={quote.status} />

              {canEdit ? (
                <div className="flex flex-wrap items-center gap-2">
                  <SubmitButton
                    variant="outline"
                    size="sm"
                    onClick={() => void download()}
                    pending={downloading}
                    pendingLabel="Preparing…"
                    disabled={busy}
                    icon={<Download className="size-4" />}
                  >
                    Download PDF
                  </SubmitButton>

                  {quote.status === "draft" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void run("regenerate", undefined, "Repriced")}
                    >
                      <FileText className="size-4" /> Regenerate
                    </Button>
                  ) : null}

                  {!isDecided ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void shareByHand()}
                      >
                        <MessageCircle className="size-4" /> Share on WhatsApp
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          const snap = (quote.property_snapshot ?? {}) as Record<
                            string,
                            unknown
                          >;
                          setRecipient(
                            (snap.client_email as string) ?? quote.sent_to ?? "",
                          );
                          setSendOpen(true);
                        }}
                      >
                        <Send className="size-4" />{" "}
                        {quote.status === "sent" ? "Resend by email" : "Send by email"}
                      </Button>
                      {/*
                        The coordinator recording a decision the client gave
                        them on the phone. The client's own route is the
                        emailed link; both write the identical record.
                      */}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run("approve", undefined, "Recorded as approved")
                        }
                      >
                        <Check className="size-4" /> Mark approved
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => setRejectOpen(true)}
                      >
                        <X className="size-4" /> Mark rejected
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/*
              Approved, and no job yet — the whole reason this section
              exists (change 3). The button opens the wizard with the client
              and property already agreed, so the team adds the floor plans,
              areas and contacts and nothing else.
            */}
            {needsJob ? (
              <Alert>
                <Plus />
                <AlertTitle>The client approved this quotation</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  {/*
                    A de-snag needs no wizard (BA v2, change 31). Its areas,
                    floor plans and outstanding defects all come from the
                    original job, so the round is opened from there — where
                    the coordinator also picks which defects to carry and
                    books the visit.
                  */}
                  <span>
                    {isDesnag
                      ? "Open the de-snag round on the original inspection. The outstanding defects, areas and plans carry across."
                      : "Raise the job for it. The client and property carry over; you add the floor plans, areas and site contacts."}
                  </span>
                  {canEdit ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        router.push(
                          isDesnag
                            ? `/snagging/${quote.source_job_id}/desnag?quotation=${quote.id}`
                            : `/snagging/jobs/new?quotation=${quote.id}`,
                        )
                      }
                      disabled={isDesnag && !quote.source_job_id}
                    >
                      <Plus className="size-4" />{" "}
                      {isDesnag ? "Open de-snag round" : "Create job"}
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            {quote.job_id ? (
              <Alert>
                <FileText />
                <AlertTitle>This quotation has its job</AlertTitle>
                <AlertDescription>
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => router.push(`/snagging/${quote.job_id}`)}
                  >
                    Open the job
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {quote.status === "rejected" ? (
              <Alert variant="destructive">
                <X />
                <AlertTitle>The client rejected this quotation</AlertTitle>
                <AlertDescription>
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

            {/* The document itself, from the template the PDF is built from. */}
            <Card className="overflow-x-auto p-0">
              <YallaClassicTemplate
                data={snaggingQuoteToTemplateData(doc)}
                hideDiscount
                type="review"
              />
            </Card>
          </div>
        ) : null}
      </DataState>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send quotation to the client</DialogTitle>
            <DialogDescription>
              They get the PDF and a link to approve or reject it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="quote-recipient">Email</Label>
            <Input
              id="quote-recipient"
              type="email"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="client@example.com"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={working}>
              Cancel
            </Button>
            <SubmitButton
              pending={working}
              pendingLabel="Sending…"
              disabled={!recipient.trim()}
              onClick={() => {
                void (async () => {
                  const ok = await run(
                    "send",
                    { sent_to: recipient.trim() },
                    "Quotation emailed to the client",
                  );
                  if (ok) setSendOpen(false);
                })();
              }}
            >
              Send
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record the client&apos;s rejection</DialogTitle>
            <DialogDescription>
              This closes the quotation. A new one can be raised for the same
              property afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="quote-reason">Why?</Label>
            <Textarea
              id="quote-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Too expensive, went elsewhere, postponed…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={working}>
              Cancel
            </Button>
            <SubmitButton
              pending={working}
              pendingLabel="Saving…"
              disabled={!reason.trim()}
              onClick={() => {
                void (async () => {
                  const ok = await run(
                    "reject",
                    { reason: reason.trim() },
                    "Recorded as rejected",
                  );
                  if (ok) {
                    setRejectOpen(false);
                    setReason("");
                  }
                })();
              }}
            >
              Record rejection
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
