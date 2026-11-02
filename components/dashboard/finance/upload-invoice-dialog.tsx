"use client";

import { useMemo, useRef, useState } from "react";
import { FileText, FileUp, Loader2, Plus, ScanText, TriangleAlert, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CandidateLine, Confidence } from "@/lib/finance/invoice-match";
import { invoiceTotals } from "@/lib/finance/line-status";
import { todayInZone } from "@/lib/scheduling/org-time";
import type { ScanProposal } from "@/lib/server/finance/invoice-scan";
import { cn } from "@/lib/utils";
import { financeService } from "@/modules/finance/finance-service";

import { InvoiceTotals, LineName, aed } from "./shared";

/**
 * Upload a MAHER invoice and let the AI read it (decided with the user,
 * 22 Oct). Three steps in one dialog: choose the file; it is uploaded and
 * read; the review shows which work-order lines the invoice appears to
 * cover and how much of each, which the person corrects and confirms.
 * Nothing is recorded until they do, and the file
 * and what the scan read are kept with the invoice. Only lines completed in
 * FSM are offered (the server reads no others); from the lines ticked on a
 * work order, only those.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

type Row = {
  key: string;
  candidate: CandidateLine;
  /** This invoice's amount for the line, before VAT, as typed (2 Nov: VAT goes on the invoice total, not each line). */
  amount: string;
  /** The % as typed: of the line's whole value; unset when the amount was typed instead. */
  pct?: string;
  included: boolean;
  confidence: Confidence | null;
  reasons: string[];
  scanned: string | null;
};

/* A candidate line's VAT rate, for the invoice total. */
const vatLine = (c: CandidateLine) => ({ amount: c.amount, lineAmount: c.amountWithVat, taxPercent: null });
/* What is left of the line, before VAT. */
const leftOf = (r: Row) => r.candidate.remaining;
/* The amount typed, before VAT. */
const beforeVatOf = (r: Row) => Number(r.amount) || 0;
/* The % of a line's whole value an amount is, as shown in the % box. */
const percentOf = (r: Row) => {
  const n = Number(r.amount);
  const whole = r.candidate.amount;
  return r.amount.trim() !== "" && Number.isFinite(n) && whole > 0 ? String(round2((n / whole) * 100)) : "";
};

const CONFIDENCE: Record<Confidence, { label: string; className: string }> = {
  high: { label: "Strong match", className: "bg-success/10 text-success" },
  medium: { label: "Likely", className: "bg-warning/10 text-warning" },
  low: { label: "Check", className: "bg-destructive/10 text-destructive" },
};

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";
const MAX_BYTES = 10 * 1024 * 1024;
const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function UploadInvoiceDialog({
  workOrderId,
  onlyLines = null,
  onClose,
  onRecorded,
}: {
  workOrderId?: string;
  /** The lines ticked on the work order: the invoice is for these. */
  onlyLines?: string[] | null;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [step, setStep] = useState<"pick" | "reading" | "review">("pick");
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ScanProposal | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(() => todayInZone());
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  /* A PDF or an image, up to 10 MB; anything else says so here, before the upload. */
  const take = (picked: File | undefined | null) => {
    if (!picked) return;
    if (!/\.(pdf|jpe?g|png|webp)$/i.test(picked.name)) {
      setProblem(`${picked.name} is not a PDF or an image. Choose the MAHER PDF or a photo of the invoice.`);
      return;
    }
    if (picked.size > MAX_BYTES) {
      setProblem(`${picked.name} is ${fileSize(picked.size)}; the limit is 10 MB.`);
      return;
    }
    setProblem(null);
    setFile(picked);
  };
  const only = useMemo(() => (onlyLines ? new Set(onlyLines) : null), [onlyLines]);

  const read = async () => {
    if (!file) return;
    setStep("reading");
    setProblem(null);
    try {
      const signed = await financeService.signInvoiceUpload({ fileName: file.name, contentType: file.type, size: file.size });
      const put = await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": signed.contentType }, body: file });
      if (!put.ok) throw new Error(`${file.name} did not upload. Try again.`);
      setPath(signed.path);
      const result = await financeService.scanInvoice({ path: signed.path, workOrderId });
      setProposal(result);
      setNumber(result.scanned.invoiceNumber ?? "");
      if (result.scanned.invoiceDate) setDate(result.scanned.invoiceDate);
      const proposed: Row[] = result.proposals.map((p) => ({
        key: p.candidate.lineId,
        candidate: p.candidate,
        amount: String(round2(p.amount)),
        included: p.confidence !== "low",
        confidence: p.confidence,
        reasons: p.reasons,
        scanned: result.scanned.lines[p.scannedIndex]?.description ?? null,
      }));
      /* For the lines ticked: each of them, with what the scan matched to it or the amount left. */
      setRows(
        only
          ? result.candidates
              .filter((c) => only.has(c.lineId))
              .map(
                (c) =>
                  proposed.find((r) => r.candidate.lineId === c.lineId) ?? {
                    key: c.lineId,
                    candidate: c,
                    amount: String(c.remaining),
                    included: true,
                    confidence: null,
                    reasons: [],
                    scanned: null,
                  },
              )
              .map((r) => ({ ...r, included: true }))
          : proposed,
      );
      setStep("review");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The invoice could not be read");
      setStep("pick");
    }
  };

  const unusedCandidates = useMemo(
    () => (proposal?.candidates ?? []).filter((c) => (!only || only.has(c.lineId)) && !rows.some((r) => r.candidate.lineId === c.lineId)),
    [proposal, rows, only],
  );
  const included = rows.filter((r) => r.included);
  const bad = included.find((r) => !(Number(r.amount) > 0) || beforeVatOf(r) > r.candidate.remaining + 0.005);
  /* The invoice total is the lines with VAT, worked out as the server does; what the AI read is only compared. */
  /* 2 Nov: the lines' net total, plus VAT worked out once on it. */
  const totals = invoiceTotals(included.map((r) => ({ amount: beforeVatOf(r), line: vatLine(r.candidate) })));
  const sumWithVat = totals.total;
  const scannedTotal = proposal?.scanned.total ?? null;
  /* Whether the number and date shown are what was read from the file (27 Oct). */
  const numberRead = Boolean(proposal?.scanned.invoiceNumber) && number.trim() === proposal?.scanned.invoiceNumber;
  const dateRead = Boolean(proposal?.scanned.invoiceDate) && date === proposal?.scanned.invoiceDate;
  const differs = scannedTotal !== null && included.length > 0 && Math.abs(scannedTotal - sumWithVat) > 0.01;
  const valid = step === "review" && included.length > 0 && !bad && number.trim() && date && sumWithVat > 0;

  const confirm = async () => {
    if (!proposal || !path) return;
    setBusy(true);
    setProblem(null);
    try {
      await financeService.recordLineInvoice({
        idempotencyKey: key,
        number: number.trim(),
        date,
        total: sumWithVat,
        allocations: included.map((r) => ({ line: r.candidate.lineId, workOrder: r.candidate.workOrderId, amount: round2(beforeVatOf(r)) })),
        filePath: path,
        scan: proposal.scanned as unknown as Record<string, unknown>,
      });
      toast.success(`MAHER ${number.trim()} recorded against ${included.length} ${included.length === 1 ? "line" : "lines"}`);
      onRecorded();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Nothing was recorded");
    } finally {
      setBusy(false);
    }
  };

  const update = (lineId: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.candidate.lineId === lineId ? { ...r, ...patch } : r)));

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && step !== "reading" && onClose()}>
      {/* As high as its content, up to the screen; the middle scrolls, the title and buttons stay. */}
      <ActionDialogContent
        busy={busy || step === "reading"}
        className={cn("flex max-h-[calc(100dvh-2rem)] flex-col", step === "review" ? "sm:max-w-xl" : "sm:max-w-md")}
      >
        <DialogHeader>
          <DialogTitle>Upload a MAHER invoice</DialogTitle>
          <DialogDescription>
            The invoice is read by AI and matched to work-order lines. Check every line and amount before confirming: nothing is recorded until you do.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 overflow-x-hidden overflow-y-auto px-4 py-0.5">
        {step !== "review" ? (
          <div className="grid gap-2">
            <input
              ref={fileRef}
              id="invoice-file"
              type="file"
              accept={ACCEPT}
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                take(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {file ? (
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <span className="bg-brand-50 text-brand flex size-10 shrink-0 items-center justify-center rounded-md">
                  {step === "reading" ? <Loader2 className="size-5 animate-spin" /> : <FileText className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {step === "reading" ? "Uploading and reading the invoice. This takes up to a minute." : `${fileSize(file.size)} · ready to read`}
                  </p>
                </div>
                {step === "reading" ? null : (
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setFile(null)} aria-label="Remove the file">
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  take(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center transition-colors",
                  dragging ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                )}
              >
                <span className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-full">
                  <Upload className="size-5" />
                </span>
                <span className="text-sm font-medium">Click to choose the invoice, or drag it here</span>
                <span className="text-muted-foreground text-xs">The MAHER PDF or a clear photo of it, up to 10 MB</span>
              </button>
            )}
            <ol className="text-muted-foreground grid gap-1.5 pt-1 text-xs">
              {["The AI reads the invoice", "It matches each line to a work-order line", "You check the amounts and confirm"].map((text, i) => (
                <li key={text} className="flex items-center gap-2">
                  <span className="bg-muted text-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums">
                    {i + 1}
                  </span>
                  {text}
                </li>
              ))}
            </ol>
          </div>
        ) : proposal ? (
          <div className="grid gap-4">
            {proposal.notFound.length ? (
              <Alert>
                <TriangleAlert className="size-4" />
                <AlertTitle>Not found in the portal</AlertTitle>
                <AlertDescription>
                  {proposal.notFound.map((n) => n).join(", ")}: no such work order or quotation in the last four months of FSM data. Those lines cannot be matched here.
                </AlertDescription>
              </Alert>
            ) : null}
            {/* Named on the invoice, but nothing on them may be invoiced yet: say why their lines are not offered. */}
            {proposal.notReady?.length ? (
              <Alert>
                <TriangleAlert className="size-4" />
                <AlertTitle>Not ready to invoice yet</AlertTitle>
                <AlertDescription>
                  {proposal.notReady.join(", ")}: on this invoice, but nothing on {proposal.notReady.length === 1 ? "it" : "them"} is ready to invoice yet. Operations marks the work
                  ready, or it is Completed in FSM with its quotation flagged To Be Invoiced; until then its lines cannot be invoiced.
                </AlertDescription>
              </Alert>
            ) : null}

            {/* A card per line, as in Enter the MAHER details: tick it, then the % or the amount with VAT. */}
            {rows.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border px-3 py-6 text-center text-sm">No line could be matched with confidence. Add the lines it covers below.</p>
            ) : (
              <div className="grid gap-3">
                {rows.map((r) => {
                  const on = r.included;
                  const typed = Number(r.amount) || 0;
                  const left = leftOf(r);
                  const over = on && beforeVatOf(r) > r.candidate.remaining + 0.005;
                  return (
                    <div
                      key={r.key}
                      className={cn("min-w-0 rounded-lg border px-3 py-2 transition-colors", on ? "border-brand/40 bg-brand-50/40" : "bg-muted/30", over && "border-destructive")}
                    >
                      <div className="flex items-start gap-2.5">
                        <Checkbox
                          className="mt-0.5"
                          checked={on}
                          onCheckedChange={(c) => update(r.candidate.lineId, { included: Boolean(c) })}
                          aria-label={`Include ${r.candidate.name ?? "line"}`}
                        />
                        <div className="min-w-0 flex-1">
                          <LineName name={r.candidate.name} description={r.candidate.description} />
                          <p className="text-muted-foreground text-xs tabular-nums">
                            {r.candidate.workOrderNumber}
                            {r.candidate.quotationNumber ? ` · quotation ${r.candidate.quotationNumber}` : ""}
                            {" · "}
                            <span className="text-foreground font-medium">{aed(left)}</span> left, before VAT
                          </p>
                          <div className="mt-1 flex min-w-0 items-center gap-2">
                            {r.confidence ? (
                              <Badge variant="secondary" className={cn("shrink-0 border-0", CONFIDENCE[r.confidence].className)} title={r.reasons.join("; ")}>
                                {CONFIDENCE[r.confidence].label}
                              </Badge>
                            ) : null}
                            <p className="text-muted-foreground truncate text-xs" title={r.scanned ?? undefined}>
                              {r.scanned ? `Read: ${r.scanned}` : "Added by hand"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {on ? (
                        <div className="mt-2 grid gap-1 pl-6">
                          <div className="flex items-center gap-2">
                            {/* A % of the line's whole value fills the amount; an amount typed shows its %. */}
                            <div className="relative w-20 shrink-0">
                              <Input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={100}
                                step="0.01"
                                aria-invalid={over || undefined}
                                className={cn(
                                  "h-7 pr-6 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                                  over && "border-destructive",
                                )}
                                value={r.pct ?? percentOf(r)}
                                onChange={(e) => {
                                  const text = e.target.value;
                                  const p = Number(text);
                                  update(r.candidate.lineId, {
                                    pct: text,
                                    amount: text.trim() !== "" && Number.isFinite(p) ? String(round2((r.candidate.amount * p) / 100)) : "",
                                  });
                                }}
                                aria-label={`Percent of ${r.candidate.name ?? "the line"} on this invoice`}
                              />
                              <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs">%</span>
                            </div>
                            <div className="relative min-w-0 flex-1">
                              <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs">AED</span>
                              <Input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step="0.01"
                                aria-invalid={over || undefined}
                                className={cn(
                                  "h-7 pl-9 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                                  over && "border-destructive",
                                )}
                                value={r.amount}
                                onChange={(e) => update(r.candidate.lineId, { amount: e.target.value, pct: undefined })}
                                aria-label={`Amount of ${r.candidate.name ?? "the line"} on this invoice, before VAT`}
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className={cn("text-[11px]", over ? "text-destructive" : "text-muted-foreground")}>
                              {over ? `More than the ${aed(left)} left.` : typed > 0 ? `${aed(Math.max(0, round2(left - typed)))} left on the line after` : "Enter an amount or a %."}
                            </p>
                            {Math.abs(typed - left) >= 0.005 ? (
                              <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="h-auto shrink-0 p-0 text-[11px]"
                                onClick={() => update(r.candidate.lineId, { amount: String(left), pct: undefined })}
                              >
                                Full amount
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {proposal.unmatched.length ? (
              <div className="grid gap-2">
                <div>
                  <p className="text-sm font-medium">
                    Not matched on the invoice <span className="text-muted-foreground font-normal">({proposal.unmatched.length})</span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    These invoice lines match no line of this work order, so they are not recorded. If one belongs here, add its line with the box below.
                  </p>
                </div>
                <ul className="grid gap-2">
                  {proposal.unmatched.map((i) => {
                    const l = proposal.scanned.lines[i];
                    /* "MAINTENANCE Supply and Installation of … 24V IN -LIVING ROOM -rewiring …": the item, then its details. */
                    const cut = l.description.search(/\s-(?=\S)/);
                    const title = (cut > 0 ? l.description.slice(0, cut) : l.description).trim();
                    const details = cut > 0 ? l.description.slice(cut).replace(/\s-(?=\S)/g, " · ").replace(/^ · /, "").trim() : "";
                    return (
                      <li key={i} className="bg-muted/30 rounded-lg border px-3 py-2" title={l.description}>
                        <div className="flex items-start justify-between gap-3">
                          <p className="line-clamp-2 min-w-0 text-sm font-medium">{title}</p>
                          <span className="shrink-0 text-sm font-medium tabular-nums">{l.amount !== null ? aed(l.amount) : "—"}</span>
                        </div>
                        {details ? <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{details}</p> : null}
                        {l.quantity !== null || l.reference ? (
                          <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                            {[l.quantity !== null ? `Qty ${l.quantity}` : null, l.unitPrice !== null ? `at ${aed(l.unitPrice)}` : null, l.reference ? `Ref ${l.reference}` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {unusedCandidates.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <Plus className="text-muted-foreground size-4" />
                <Select
                  value=""
                  onValueChange={(lineId) => {
                    const c = unusedCandidates.find((x) => x.lineId === lineId);
                    if (c) setRows((prev) => [...prev, { key: c.lineId, candidate: c, amount: String(c.remaining), included: true, confidence: null, reasons: [], scanned: null }]);
                  }}
                >
                  <SelectTrigger className="w-full sm:w-96" aria-label="Add a line">
                    <SelectValue placeholder="Add another line from these work orders" />
                  </SelectTrigger>
                  <SelectContent>
                    {unusedCandidates.map((c) => (
                      <SelectItem key={c.lineId} value={c.lineId}>
                        {c.workOrderNumber} · {c.name ?? "Line"} · {aed(c.remaining)} left, before VAT
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <InvoiceTotals totals={totals} />
            {differs ? (
              <Alert>
                <TriangleAlert className="size-4" />
                <AlertTitle>The invoice says {aed(scannedTotal!)}</AlertTitle>
                <AlertDescription>
                  The lines ticked come to {aed(sumWithVat)} with VAT on their total. Check the lines and amounts: the total recorded is what the lines come to.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="scan-number">MAHER invoice number</Label>
                <Input id="scan-number" value={number} maxLength={60} onChange={(e) => setNumber(e.target.value)} />
                {/* Where the value came from: read from the file, or not on it. */}
                <p className="text-muted-foreground text-xs">
                  {numberRead ? "Read from the invoice." : proposal?.scanned.invoiceNumber ? "Changed from what was read." : "Not found on the file: enter it."}
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="scan-date">Invoice date</Label>
                <Input id="scan-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                <p className={cn("text-xs", proposal?.scanned.invoiceDate ? "text-muted-foreground" : "text-warning")}>
                  {dateRead
                    ? "Read from the invoice."
                    : proposal?.scanned.invoiceDate
                      ? "Changed from what was read."
                      : "No invoice date on the file: today's date is filled in. Check it."}
                </p>
              </div>
            </div>
            {bad ? (
              <p className="text-destructive text-sm">
                {bad.candidate.name ?? "A line"}: enter an amount above zero and no more than {aed(leftOf(bad))}, before VAT.
              </p>
            ) : null}
          </div>
        ) : null}

        {problem ? (
          <p className="text-destructive flex items-start gap-1.5 text-sm">
            <X className="mt-0.5 size-4 shrink-0" />
            {problem}
          </p>
        ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy || step === "reading"}>
            Cancel
          </Button>
          {step === "review" ? (
            <SubmitButton pending={busy} disabled={!valid} onClick={() => void confirm()} icon={<FileUp className="size-4" />}>
              Confirm and record
            </SubmitButton>
          ) : (
            <SubmitButton pending={step === "reading"} disabled={!file} onClick={() => void read()} icon={<ScanText className="size-4" />}>
              Read invoice
            </SubmitButton>
          )}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
