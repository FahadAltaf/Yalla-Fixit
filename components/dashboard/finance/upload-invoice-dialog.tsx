"use client";

import { useMemo, useRef, useState } from "react";
import { FileText, FileUp, Loader2, Plus, ScanText, TriangleAlert, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CandidateLine, Confidence } from "@/lib/finance/invoice-match";
import { todayInZone } from "@/lib/scheduling/org-time";
import type { ScanProposal } from "@/lib/server/finance/invoice-scan";
import { cn } from "@/lib/utils";
import { financeService } from "@/modules/finance/finance-service";

import { aed } from "./shared";

/**
 * Upload a MAHER invoice and let the AI read it (decided with the user,
 * 22 Oct). Three steps in one dialog: choose the file; it is uploaded and
 * read; the review shows which work-order lines the invoice appears to
 * cover and how much of each, which the person corrects and confirms.
 * Nothing is recorded until they do (and confirm once more), and the file
 * and what the scan read are kept with the invoice. Only lines completed in
 * FSM are offered (the server reads no others); from the lines ticked on a
 * work order, only those.
 */

type Row = { key: string; candidate: CandidateLine; amount: string; included: boolean; confidence: Confidence | null; reasons: string[]; scanned: string | null };

const CONFIDENCE: Record<Confidence, { label: string; className: string }> = {
  high: { label: "Strong match", className: "bg-success/10 text-success" },
  medium: { label: "Likely", className: "bg-warning/10 text-warning" },
  low: { label: "Check", className: "bg-destructive/10 text-destructive" },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

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
  const [total, setTotal] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { confirm: ask, dialog } = useConfirm();
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
      setTotal(result.scanned.total !== null ? String(result.scanned.total) : "");
      const proposed: Row[] = result.proposals.map((p) => ({
        key: p.candidate.lineId,
        candidate: p.candidate,
        amount: String(p.amount),
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
  const sum = round2(included.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const bad = included.find((r) => !(Number(r.amount) > 0) || Number(r.amount) > r.candidate.remaining + 0.005);
  const totalNumber = total === "" ? sum : Number(total);
  const valid = step === "review" && included.length > 0 && !bad && number.trim() && date && totalNumber > 0;

  const confirm = async () => {
    if (!proposal || !path) return;
    const ok = await ask({
      title: `Record MAHER ${number.trim()}?`,
      description: `${aed(round2(totalNumber))} invoice, against ${included.length} ${included.length === 1 ? "line" : "lines"} for ${aed(sum)} before VAT. It cannot be undone here.`,
      confirmText: "Record invoice",
    });
    if (!ok) return;
    setBusy(true);
    setProblem(null);
    try {
      await financeService.recordLineInvoice({
        idempotencyKey: key,
        number: number.trim(),
        date,
        total: round2(totalNumber),
        allocations: included.map((r) => ({ line: r.candidate.lineId, workOrder: r.candidate.workOrderId, amount: round2(Number(r.amount)) })),
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
      <ActionDialogContent busy={busy || step === "reading"} className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Upload a MAHER invoice</DialogTitle>
          <DialogDescription>
            The invoice is read by AI and matched to work-order lines. Check every line and amount before confirming: nothing is recorded until you do.
          </DialogDescription>
        </DialogHeader>

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
                <span className="text-muted-foreground text-xs">The PDF from MAHER, or a clear photo of it · PDF, JPG, PNG or WEBP · up to 10 MB</span>
              </button>
            )}
            <ol className="text-muted-foreground grid gap-1 pt-1 text-xs sm:grid-cols-3">
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

            <div className="max-h-[42vh] overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-4" />
                    <TableHead>Work order line</TableHead>
                    <TableHead>Read from the invoice</TableHead>
                    <TableHead className="text-right">Left to invoice</TableHead>
                    <TableHead className="w-36 pr-4 text-right">This invoice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground py-6 text-center text-sm">
                        No line could be matched with confidence. Add the lines it covers below.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {rows.map((r) => {
                    const over = r.included && Number(r.amount) > r.candidate.remaining + 0.005;
                    return (
                      <TableRow key={r.key}>
                        <TableCell className="pl-4">
                          <Checkbox checked={r.included} onCheckedChange={(c) => update(r.candidate.lineId, { included: Boolean(c) })} aria-label="Include this line" />
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{r.candidate.name ?? "Line"}</p>
                          <p className="text-muted-foreground text-xs">
                            {r.candidate.workOrderNumber}
                            {r.candidate.quotationNumber ? ` · quotation ${r.candidate.quotationNumber}` : ""}
                          </p>
                        </TableCell>
                        <TableCell>
                          {r.scanned ? <p className="text-muted-foreground line-clamp-2 max-w-56 text-xs">{r.scanned}</p> : <span className="text-muted-foreground text-xs">Added by hand</span>}
                          {r.confidence ? (
                            <Badge variant="secondary" className={cn("mt-1 border-0", CONFIDENCE[r.confidence].className)} title={r.reasons.join("; ")}>
                              {CONFIDENCE[r.confidence].label}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{aed(r.candidate.remaining)}</TableCell>
                        <TableCell className="pr-4 text-right">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.01"
                            disabled={!r.included}
                            aria-invalid={over || undefined}
                            className={cn("h-8 w-32 text-right", over && "border-destructive")}
                            value={r.amount}
                            onChange={(e) => update(r.candidate.lineId, { amount: e.target.value })}
                            aria-label={`Amount for ${r.candidate.name ?? "line"}`}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {proposal.unmatched.length ? (
              <div className="grid gap-1.5">
                <p className="text-sm font-medium">Not matched ({proposal.unmatched.length})</p>
                <ul className="text-muted-foreground space-y-0.5 text-xs">
                  {proposal.unmatched.map((i) => {
                    const l = proposal.scanned.lines[i];
                    return (
                      <li key={i}>
                        {l.description}
                        {l.amount !== null ? ` · ${aed(l.amount)}` : ""}
                        {l.reference ? ` · ${l.reference}` : ""}
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
                        {c.workOrderNumber} · {c.name ?? "Line"} · {aed(c.remaining)} left
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <p className="text-muted-foreground text-right text-sm">
              Lines on this invoice: <span className="text-foreground font-medium tabular-nums">{aed(sum)}</span> before VAT
              {proposal.scanned.subtotal !== null ? ` · invoice subtotal ${aed(proposal.scanned.subtotal)}` : ""}
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="scan-number">MAHER invoice number</Label>
                <Input id="scan-number" value={number} maxLength={60} onChange={(e) => setNumber(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="scan-date">Invoice date</Label>
                <Input id="scan-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="scan-total">Invoice total (AED)</Label>
                <Input id="scan-total" type="number" inputMode="decimal" min={0} step="0.01" placeholder={String(sum)} value={total} onChange={(e) => setTotal(e.target.value)} />
              </div>
            </div>
            {bad ? (
              <p className="text-destructive text-sm">
                {bad.candidate.name ?? "A line"}: enter an amount above zero and no more than {aed(bad.candidate.remaining)}.
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
        {dialog}
      </ActionDialogContent>
    </Dialog>
  );
}
