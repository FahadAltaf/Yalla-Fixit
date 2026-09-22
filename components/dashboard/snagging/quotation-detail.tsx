"use client";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FileType2,
  FileText,
  Mail,
  MessageCircle,
  Plus,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  generateQuotationDocxBlob,
  generateQuotationPDFBlob,
} from "@/components/dashboard/extensions/quotation-templates/pdf-utils";
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
  StatCard,
  StatCardGrid,
  SubmitButton,
  formatLocalDateTime,
  useConfirm,
} from "./shared";

/**
 * One quotation, on its own page rather than inside a job (BA v2, changes
 * 1-3).
 *
 * It carries the verbs that belong to the document — download it, send it,
 * share it for WhatsApp — plus the one that only makes sense here: turning
 * an approved quotation into the job it paid for.
 *
 * Approving and rejecting are deliberately NOT here. The client decides,
 * through the link they were emailed, and the page reports that decision
 * rather than offering a coordinator a button to make it for them.
 */
export default function QuotationDetail({ id }: { id: string }) {
  const router = useRouter();
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.EDIT,
  );

  const { confirm, dialog } = useConfirm();

  const [quote, setQuote] = useState<SnaggingQuotation | null>(null);
  const [loading, setLoading] = useState(true);
  // The breadcrumb names the page by its number, not its id.
  useBreadcrumbLabel(quote?.id ?? undefined, quote?.quote_number ?? undefined);
  const [error, setError] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);

  /*
    WHICH action is running, not merely that one is.

    A single `working` flag disabled every button and spun none of them, so
    "Share on WhatsApp" — which issues a link, copies it and renders a PDF,
    several seconds of work — looked like a button that did nothing at all.
  */
  const [pending, setPending] = useState<
    null | "download" | "download_word" | "share_link" | "regenerate" | "send" | "approve_rate"
  >(null);
  const busy = pending !== null;

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

  /** The PDF bytes, from the same template the page renders below. */
  async function buildPdf() {
    if (!doc) throw new Error("The quotation has not loaded yet");
    return generateQuotationPDFBlob(
      "yalla-classic",
      snaggingQuoteToTemplateData(doc),
      { scale: 2 },
      "without",
    );
  }

  async function download() {
    if (!doc || !quote) return;
    setPending("download");
    try {
      saveAs(await buildPdf(), `Quotation-${quote.quote_number}.pdf`);
      toast.success("PDF downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate the PDF");
    } finally {
      setPending(null);
    }
  }

  /* The same quotation as an editable Word file. */
  async function downloadWord() {
    if (!doc || !quote) return;
    setPending("download_word");
    try {
      saveAs(
        await generateQuotationDocxBlob(snaggingQuoteToTemplateData(doc), "without"),
        `Quotation-${quote.quote_number}.docx`,
      );
      toast.success("Word file downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate the Word file");
    } finally {
      setPending(null);
    }
  }

  async function run(
    action: "send" | "regenerate",
    extra?: Record<string, unknown>,
    success?: string,
  ) {
    setPending(action);
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
      setPending(null);
    }
  }

  /**
   * The WhatsApp route: a link and a PDF, ready to paste (change 24).
   *
   * Written out rather than composed from run() + download() so the whole
   * errand reports once. Composed, it announced "link copied" and then
   * "PDF downloaded" for what the coordinator experiences as one action.
   */
  async function shareByHand() {
    if (!doc || !quote) return;
    if (approvalUrl) {
      const ok = await confirm({
        title: "Issue a new client link?",
        description:
          "A link has already been issued for this quotation. Getting a new one stops the old link working.",
        confirmText: "Issue a new link",
      });
      if (!ok) return;
    }

    setPending("share_link");
    try {
      const result = await snaggingService.quotationActionById(id, "share_link");
      if (result.approval_url) {
        setApprovalUrl(result.approval_url);
        await navigator.clipboard.writeText(result.approval_url).catch(() => {});
      }
      saveAs(await buildPdf(), `Quotation-${quote.quote_number}.pdf`);
      toast.success("Ready for WhatsApp", {
        description: "The approval link is on your clipboard and the PDF has downloaded.",
      });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That did not work");
    } finally {
      setPending(null);
    }
  }

  /*
    A rate outside the published band, still waiting on an admin
    (FR-2.04). Until it is approved the document cannot reach the client,
    and the server refuses both send and share — so the page has to say
    so, and offer the way out to whoever can take it.
  */
  const rateWaiting = quote?.rate_outside_band === true && !quote?.rate_approved_at;
  // Admin or this job's approval manager — decided by the server, which
  // is the only side that can see who manages the job.
  const canApproveRate = quote?.can_approve_rate === true;

  async function approveRate() {
    setPending("approve_rate");
    try {
      setQuote(await snaggingService.approveQuotationRate(id));
      toast.success("Rate approved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not approve the rate");
    } finally {
      setPending(null);
    }
  }

  const isDecided = quote?.status === "approved" || quote?.status === "rejected";
  const isDesnag = quote?.quote_kind === "desnag";
  const needsJob = quote?.status === "approved" && !quote?.job_id;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Sales"
        title={quote ? `Quotation ${quote.quote_number}` : "Quotation"}
        description={
          quote
            ? `${isDesnag ? "De-snagging visit" : "Inspection"} · raised ${formatLocalDateTime(quote.created_at)}.`
            : "Loading the document…"
        }
        actions={
          quote && doc ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* Once the job exists, its card below carries the status. */}
              {quote.job_id ? null : <QuotationStatusBadge status={quote.status} />}

              {canEdit ? (
                <div className="flex flex-wrap items-center gap-2">
                  {/* One Download button with the two formats, as on AMC proposals. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SubmitButton
                        variant="outline"
                        size="sm"
                        pending={pending === "download" || pending === "download_word"}
                        pendingLabel="Preparing…"
                        disabled={busy}
                        icon={<Download className="size-4" />}
                      >
                        Download
                        <ChevronDown className="size-3.5" />
                      </SubmitButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => void download()}>
                        <FileText className="size-4" />
                        PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void downloadWord()}>
                        <FileType2 className="size-4" />
                        Word (.docx)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* A de-snag is priced at the amount chosen for it, not
                      from the property, so it is never regenerated. */}
                  {quote.status === "draft" && !isDesnag ? (
                    <SubmitButton
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      pending={pending === "regenerate"}
                      pendingLabel="Repricing…"
                      icon={<FileText className="size-4" />}
                      onClick={() => void run("regenerate", undefined, "Repriced")}
                    >
                      Regenerate
                    </SubmitButton>
                  ) : null}

                  {!isDecided ? (
                    /*
                      One "Share" button with the two ways to send it, not
                      two buttons side by side.
                    */
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SubmitButton
                          size="sm"
                          disabled={busy}
                          pending={pending === "share_link"}
                          pendingLabel="Preparing…"
                          icon={<Send className="size-4" />}
                        >
                          {quote.status === "sent" ? "Share again" : "Share"}
                          <ChevronDown className="size-3.5" />
                        </SubmitButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => void shareByHand()}>
                          <MessageCircle className="size-4" />
                          Share on WhatsApp
                        </DropdownMenuItem>
                        <DropdownMenuItem
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
                          <Mail className="size-4" />
                          {quote.status === "sent" ? "Resend by email" : "Send by email"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null
        }
      />

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
            {/*
              What the de-snag is charged, above the document. The amount
              was chosen inside the rate card's range when it was raised,
              and it is the one figure the coordinator and the client talk
              about -- it should not have to be found in the line table.
            */}
            {isDesnag ? (
              <StatCardGrid columns={3}>
                <StatCard
                  label="De-snagging amount"
                  value={`${quote.currency} ${Number(quote.subtotal ?? 0).toLocaleString()}`}
                  headline="Before VAT"
                  caption="Chosen within the rate card range"
                />
                <StatCard
                  label="VAT"
                  value={`${quote.currency} ${Number(quote.tax_amount ?? 0).toLocaleString()}`}
                  // Stored as a fraction (0.05) on some rows and a percentage (5) on
                  // older ones; either reads as a percentage here.
                  caption={`At ${(() => {
                    const rate = Number(quote.tax_rate ?? 0);
                    return Math.round((rate <= 1 ? rate * 100 : rate) * 100) / 100;
                  })()}%`}
                />
                <StatCard
                  label="Total"
                  value={`${quote.currency} ${Number(quote.total ?? 0).toLocaleString()}`}
                  headline="What the client pays"
                  tone="good"
                />
              </StatCardGrid>
            ) : null}

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
                <AlertTitle className="flex flex-wrap items-center gap-2">
                  This quotation has its job
                  <QuotationStatusBadge status={quote.status} />
                </AlertTitle>
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

            {rateWaiting ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>This pricing is waiting on an admin</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  <span>
                    {/*
                      Both rates are shown, not just the one that broke
                      its band: an admin approving a price should see the
                      whole price, and the suggestion beside each says how
                      far the coordinator moved.
                    */}
                    Inspection {quote.rate_per_sqft} per sq ft
                    {quote.rate_suggested != null
                      ? ` (suggested ${quote.rate_suggested})`
                      : ""}
                    {quote.external_rate_per_sqft != null
                      ? `, external areas ${quote.external_rate_per_sqft}${
                          quote.external_rate_suggested != null
                            ? ` (suggested ${quote.external_rate_suggested})`
                            : ""
                        }`
                      : ""}
                    .
                    {quote.rate_override_reason
                      ? ` Reason given: ${quote.rate_override_reason}`
                      : ""}{" "}
                    It cannot be sent to the client until the pricing is
                    approved.
                  </span>
                  {canApproveRate ? (
                    <SubmitButton
                      size="sm"
                      pending={pending === "approve_rate"}
                      pendingLabel="Approving…"
                      icon={<Check className="size-4" />}
                      onClick={() => void approveRate()}
                    >
                      Approve this pricing
                    </SubmitButton>
                  ) : null}
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

            {/*
              The document itself, from the template the PDF is built from.
              Centred and sized to the page it represents (794px = A4 at
              96dpi) rather than stretched against the left edge of a
              full-width card.
            */}
            <Card className="mx-auto w-fit max-w-full overflow-x-auto p-0">
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
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <SubmitButton
              pending={pending === "send"}
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

      {dialog}
    </div>
  );
}
