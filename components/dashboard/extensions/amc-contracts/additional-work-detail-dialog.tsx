"use client";

import { useEffect, useId, useState } from "react";
import {
  Ban,
  Banknote,
  CalendarCheck,
  CheckCheck,
  CheckCircle2,
  FileText,
  Plus,
  ReceiptText,
  Save,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, ErrorState, FieldsSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  WORK_PARTIES,
  WORK_PARTY_LABELS,
  WORK_RISK_LABELS,
  WORK_RISKS,
  canMoveWork,
  quotationTotals,
  type AdditionalWorkStatus,
  type QuotationLine,
  type WorkRisk,
} from "@/lib/amc/call-outs";
import { TRADE_LABELS, TRADES } from "@/lib/amc/client-profile";
import type { Trade } from "@/lib/amc/visits";
import { cn } from "@/lib/utils";
import {
  additionalWorksService,
  type AdditionalWorkRecord,
  type AdditionalWorkResponse,
  type WorkPhotoKind,
} from "@/modules/amc-contracts/additional-works-service";

import {
  Fact,
  Field,
  Muted,
  Panel,
  PhotosPanel,
  PreparedMessage,
  ReadText,
  RiskBadge,
  WorkStatusBadge,
  errorText,
  shortDateTime,
  useActionForm,
} from "./call-out-shared";
import { formatContractDate, formatDateTime } from "./contract-status";
import { TechnicianSelect, useTechnicianName } from "./people-pickers";
import { PartiesEditor, partiesInput, partiesProblem, partyDrafts, type PartyDrafts } from "./raise-additional-work-dialog";

const NONE = "__none";
const PHOTO_KINDS = ["finding", "before", "after", "other"] as const satisfies readonly WorkPhotoKind[];
const PHOTO_LABELS: Record<WorkPhotoKind, string> = { finding: "Finding", before: "Before", after: "After", other: "Other" };

type Working = "finding" | "parties" | "quote" | "share" | "complete" | null;

export const workSourceLabel = (w: Pick<AdditionalWorkRecord, "source" | "visitNo" | "callOutNo">) =>
  w.source === "visit" ? `Visit ${w.visitNo ?? ""}`.trim() : w.source === "call_out" ? `Call out ${w.callOutNo ?? ""}`.trim() : "Raised by hand";

/**
 * One additional work (Phase 11: DEV-407): the finding, the five parties,
 * the quotation with its live totals, and the commercial steps (share,
 * approve with evidence, schedule, complete, invoice, paid), each offered
 * only when the status allows it. `canEdit` from the route decides what
 * is offered; the route checks again.
 */
export function AdditionalWorkDetailDialog({
  workId,
  open,
  onOpenChange,
  onChanged,
}: {
  workId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => unknown;
}) {
  const [state, setState] = useState<{ id: string | null; data: AdditionalWorkResponse | null; error: string | null }>({ id: null, data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [working, setWorking] = useState<Working>(null);

  useEffect(() => {
    if (!open || !workId) return;
    let stale = false;
    additionalWorksService.work(workId).then(
      (data) => !stale && setState({ id: workId, data, error: null }),
      (e) => !stale && setState((s) => ({ id: workId, data: s.id === workId ? s.data : null, error: errorText(e, "Could not load the additional work.") })),
    );
    return () => {
      stale = true;
    };
  }, [open, workId, attempt]);

  const current = state.id === workId ? state : { data: null, error: null };

  const changed = async () => {
    if (!workId) return;
    try {
      const data = await additionalWorksService.work(workId);
      setState({ id: workId, data, error: null });
    } catch {
      /* The change itself went through; the next open fetches again. */
    }
    await onChanged?.();
  };

  const w = current.data?.work ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => !working && onOpenChange(next)}>
      <ActionDialogContent busy={working !== null} className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {w ? `Additional work ${w.workNo}` : "Additional work"}
            {w ? <WorkStatusBadge status={w.status} /> : null}
            {w ? <RiskBadge risk={w.risk} /> : null}
          </DialogTitle>
          <DialogDescription>
            {w
              ? [w.contractNumber ? `Contract ${w.contractNumber}` : null, w.customerName, w.propertyLabel, workSourceLabel(w)].filter(Boolean).join(" · ")
              : "The finding, the parties, the quotation and where it stands with the client."}
          </DialogDescription>
        </DialogHeader>

        {w && current.data ? (
          <WorkBody key={w.id} data={current.data} working={working} setWorking={setWorking} changed={changed} />
        ) : current.error ? (
          <ErrorState title="Could not load the additional work" message={current.error} onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <FieldsSkeleton />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working !== null}>
            Close
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Body                                                                */
/* ------------------------------------------------------------------ */

type LineDraft = { key: string; description: string; kind: QuotationLine["kind"]; quantity: string; unitPrice: string };

let lineSeq = 0;
const lineKey = () => `l${(lineSeq += 1)}`;
const toDrafts = (lines: QuotationLine[]): LineDraft[] =>
  lines.map((l) => ({ key: lineKey(), description: l.description, kind: l.kind, quantity: String(l.quantity), unitPrice: String(l.unitPrice) }));
const fromDrafts = (drafts: LineDraft[]): { lines: QuotationLine[]; invalid: boolean } => {
  const filled = drafts.filter((d) => d.description.trim() || d.quantity.trim() || d.unitPrice.trim());
  const lines = filled.map((d) => ({ description: d.description.trim(), kind: d.kind, quantity: Number(d.quantity), unitPrice: Number(d.unitPrice) }));
  const invalid = lines.some((l) => !l.description || !(l.quantity > 0) || !(l.unitPrice >= 0) || !Number.isFinite(l.unitPrice));
  return { lines, invalid };
};
const sameLines = (a: QuotationLine[], b: QuotationLine[]) =>
  a.length === b.length && a.every((l, i) => l.description === b[i].description && l.kind === b[i].kind && l.quantity === b[i].quantity && l.unitPrice === b[i].unitPrice);

const STEPS: Array<{ status: AdditionalWorkStatus; label: string; at: (w: AdditionalWorkRecord) => string | null; date?: boolean }> = [
  { status: "identified", label: "Identified", at: (w) => w.createdAt },
  { status: "quotation_prepared", label: "Quoted", at: (w) => w.quotedAt },
  { status: "shared", label: "Shared", at: (w) => w.sharedAt },
  { status: "approved", label: "Approved", at: (w) => w.approvedAt },
  { status: "scheduled", label: "Scheduled", at: (w) => w.scheduledFor, date: true },
  { status: "completed", label: "Completed", at: (w) => w.completedAt },
  { status: "invoiced", label: "Invoiced", at: (w) => w.invoicedAt },
  { status: "paid", label: "Paid", at: (w) => w.paidAt },
];

function WorkBody({
  data,
  working,
  setWorking,
  changed,
}: {
  data: AdditionalWorkResponse;
  working: Working;
  setWorking: (w: Working) => void;
  changed: () => Promise<void>;
}) {
  const { work: w, canEdit, photos } = data;
  const busy = working !== null;
  const locked = w.status === "paid" || w.status === "rejected";
  const { confirm, dialog: confirmDialog } = useConfirm();
  const actionForm = useActionForm();
  const [prepared, setPrepared] = useState<{ message: string; whatsapp: string | null } | null>(null);

  const [finding, setFinding] = useState(w.finding);
  const [risk, setRisk] = useState<WorkRisk>(w.risk);
  const [trade, setTrade] = useState<Trade | null>((w.trade as Trade | null) ?? null);
  const [technicianId, setTechnicianId] = useState<string | null>(w.technicianId ?? null);
  const technicianName = useTechnicianName();
  const [parties, setParties] = useState<PartyDrafts>(() => partyDrafts(w.parties));
  const [drafts, setDrafts] = useState<LineDraft[]>(() => (w.quotationLines.length ? toDrafts(w.quotationLines) : [{ key: lineKey(), description: "", kind: "labour", quantity: "1", unitPrice: "" }]));
  const ids = { finding: useId(), risk: useId(), trade: useId(), technician: useId() };

  const quoting = canEdit && canMoveWork(w.status, "quotation_prepared");
  const built = fromDrafts(drafts);
  const totals = quotationTotals(built.invalid ? built.lines.filter((l) => l.description && l.quantity > 0 && l.unitPrice >= 0) : built.lines, w.materialFeePercent);
  const quoteDirty = quoting && !sameLines(built.lines, w.quotationLines);
  const approver = w.parties.approver;

  const run = async (kind: Exclude<Working, null>, fn: () => Promise<void>, fallback: string) => {
    setWorking(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(errorText(e, fallback));
    } finally {
      setWorking(null);
    }
  };

  const post = async (action: Parameters<typeof additionalWorksService.action>[1], success: string) => {
    const result = await additionalWorksService.action(w.id, action);
    toast.success(success);
    await changed();
    return result;
  };

  const saveFinding = () =>
    void run(
      "finding",
      async () => {
        await post({ action: "update", finding: finding.trim(), risk, trade, technicianId: technicianId?.trim() || null }, "Finding saved");
      },
      "Could not save the finding.",
    );

  const saveParties = () => {
    const problem = partiesProblem(parties);
    if (problem) return void toast.error(problem);
    void run(
      "parties",
      async () => {
        await post({ action: "update", parties: partiesInput(parties, true) }, "Parties saved");
      },
      "Could not save the parties.",
    );
  };

  const saveQuote = () => {
    if (built.invalid) return void toast.error("Each line needs a description, a quantity above 0 and a price.");
    if (!built.lines.length) return void toast.error("Add at least one line.");
    void run(
      "quote",
      async () => {
        await post({ action: "quote", lines: built.lines }, "Quotation saved");
      },
      "Could not save the quotation.",
    );
  };

  const share = () =>
    void confirm({
      title: `Share quotation ${w.workNo}?`,
      description: `This emails the quotation PDF (AED ${w.totals.total.toLocaleString("en-AE", { minimumFractionDigits: 2 })}) to ${
        approver?.email ? `${approver.name} at ${approver.email}` : approver ? `${approver.name}, who has no email on file, so the client's address is used if any` : "the client's email address on file"
      }, and prepares a WhatsApp message.`,
      confirmText: "Share quotation",
      action: async () => {
        const result = await additionalWorksService.action(w.id, { action: "share" });
        if (result.outcome === "sent") toast.success("Quotation emailed");
        else if (result.outcome === "no_recipient") toast.warning("No email address on file: send the quotation by WhatsApp.");
        else toast.error("The quotation email could not be sent. Send it by WhatsApp, or share again.");
        if (result.message) setPrepared({ message: result.message, whatsapp: result.whatsapp ?? null });
        await changed();
      },
    });

  const complete = () =>
    void confirm({
      title: `Mark ${w.workNo} as completed?`,
      description: "The work was done. It can then be invoiced; the call out it came from may close.",
      confirmText: "Mark completed",
      action: async () => {
        await post({ action: "complete" }, "Marked completed");
      },
    });

  const can = (to: AdditionalWorkStatus) => canEdit && canMoveWork(w.status, to);
  const rejectedStep = w.status === "rejected";
  const reachedIndex = STEPS.findIndex((s) => s.status === w.status);

  return (
    <div className="grid gap-4">
      {/* Where it stands */}
      <ol className="grid grid-cols-4 gap-2 rounded-lg border px-4 py-3 sm:grid-cols-8">
        {STEPS.map((s, i) => {
          const at = s.at(w);
          const reached = Boolean(at) || (!rejectedStep && i <= reachedIndex);
          return (
            <li key={s.status} className="min-w-0">
              <span className={cn("mb-1 block h-1 rounded-full", reached ? "bg-brand" : "bg-mist")} aria-hidden />
              <span className={cn("block truncate text-xs font-medium", reached ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
              <span className="text-muted-foreground block truncate text-[11px]">{at ? (s.date ? formatContractDate(at) : shortDateTime(at)) : "—"}</span>
            </li>
          );
        })}
      </ol>

      {rejectedStep ? (
        <Alert variant="destructive" className="border-destructive/30 items-start p-4">
          <XCircle />
          <AlertTitle>Rejected{w.rejectedAt ? ` ${formatDateTime(w.rejectedAt)}` : ""}</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap">{w.rejectionReason ?? "No reason given."}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {canEdit && !locked ? (
        <div className="flex flex-wrap gap-2">
          {can("shared") ? (
            <Button
              disabled={busy || !w.quotationLines.length || quoteDirty}
              title={quoteDirty ? "Save the quotation first" : !w.quotationLines.length ? "Prepare the quotation first" : undefined}
              onClick={share}
            >
              <Send className="size-4" />
              {w.status === "shared" ? "Share again" : "Share quotation"}
            </Button>
          ) : null}
          {can("approved") ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                actionForm.ask({
                  title: `Approve ${w.workNo}`,
                  description: "Record how the client approved the quotation.",
                  fields: [
                    { key: "evidence", label: "Evidence", type: "textarea", minLength: 3, placeholder: "Email of 12 Oct, signed quotation, WhatsApp reply…" },
                    { key: "approvedBy", label: "Approved by", maxLength: 160, initial: approver?.name ?? "" },
                  ],
                  confirmText: "Approve",
                  icon: <CheckCircle2 className="size-4" />,
                  submit: (v) => post({ action: "approve", evidence: v.evidence, approvedBy: v.approvedBy || null }, "Approved"),
                })
              }
            >
              <CheckCircle2 className="size-4" />
              Approve
            </Button>
          ) : null}
          {can("scheduled") ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                actionForm.ask({
                  title: w.status === "scheduled" ? `Reschedule ${w.workNo}` : `Schedule ${w.workNo}`,
                  description: "The day the work is planned.",
                  fields: [{ key: "date", label: "Date", type: "date", minLength: 10, initial: w.scheduledFor ?? "" }],
                  confirmText: "Schedule",
                  icon: <CalendarCheck className="size-4" />,
                  submit: (v) => post({ action: "schedule", date: v.date }, "Scheduled"),
                })
              }
            >
              <CalendarCheck className="size-4" />
              {w.status === "scheduled" ? "Reschedule" : "Schedule"}
            </Button>
          ) : null}
          {can("completed") ? (
            <Button variant="outline" disabled={busy} onClick={complete}>
              <CheckCheck className="size-4" />
              Complete
            </Button>
          ) : null}
          {can("invoiced") ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                actionForm.ask({
                  title: `Invoice ${w.workNo}`,
                  description: "The invoice number from the accounting system.",
                  fields: [{ key: "invoiceNumber", label: "Invoice number", minLength: 1, maxLength: 60 }],
                  confirmText: "Record invoice",
                  icon: <ReceiptText className="size-4" />,
                  submit: (v) => post({ action: "invoice", invoiceNumber: v.invoiceNumber }, "Invoice recorded"),
                })
              }
            >
              <ReceiptText className="size-4" />
              Invoice
            </Button>
          ) : null}
          {can("paid") ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                actionForm.ask({
                  title: `Mark ${w.workNo} as paid`,
                  description: "The client paid the invoice.",
                  fields: [{ key: "reference", label: "Payment reference", maxLength: 120 }],
                  confirmText: "Mark paid",
                  icon: <Banknote className="size-4" />,
                  submit: (v) => post({ action: "pay", reference: v.reference || null }, "Marked paid"),
                })
              }
            >
              <Banknote className="size-4" />
              Paid
            </Button>
          ) : null}
          {can("rejected") ? (
            <Button
              variant="outline"
              className="text-danger hover:text-danger"
              disabled={busy}
              onClick={() =>
                actionForm.ask({
                  title: `Reject ${w.workNo}`,
                  description: "The client declined, or the work is not going ahead. The call out it came from may then close.",
                  fields: [{ key: "reason", label: "Reason", type: "textarea", minLength: 3, maxLength: 500 }],
                  confirmText: "Reject",
                  variant: "destructive",
                  icon: <Ban className="size-4" />,
                  submit: (v) => post({ action: "reject", reason: v.reason }, "Rejected"),
                })
              }
            >
              <Ban className="size-4" />
              Reject
            </Button>
          ) : null}
        </div>
      ) : null}

      {prepared ? <PreparedMessage title="The quotation, for WhatsApp" message={prepared.message} whatsapp={prepared.whatsapp} onDismiss={() => setPrepared(null)} /> : null}

      {w.approvalEvidence || w.invoiceNumber || w.paymentReference || w.scheduledFor ? (
        <dl className="grid gap-x-8 gap-y-2 rounded-lg border px-4 py-3 text-sm sm:grid-cols-2">
          {w.approvalEvidence ? (
            <div className="sm:col-span-2">
              <Fact label="Approval">{w.approvalEvidence}</Fact>
            </div>
          ) : null}
          {w.scheduledFor ? <Fact label="Scheduled for">{formatContractDate(w.scheduledFor)}</Fact> : null}
          {w.invoiceNumber ? <Fact label="Invoice">{w.invoiceNumber}</Fact> : null}
          {w.paymentReference ? <Fact label="Payment reference">{w.paymentReference}</Fact> : null}
        </dl>
      ) : null}

      <Panel title="Finding" description="The technical finding, kept apart from the quotation.">
        {canEdit && !locked ? (
          <>
            <Field id={ids.finding} label="Finding">
              <Textarea id={ids.finding} rows={4} maxLength={4000} value={finding} onChange={(e) => setFinding(e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id={ids.risk} label="Risk">
                <Select value={risk} onValueChange={(v) => setRisk(v as WorkRisk)}>
                  <SelectTrigger id={ids.risk} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_RISKS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {WORK_RISK_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id={ids.trade} label="Trade">
                <Select value={trade ?? NONE} onValueChange={(v) => setTrade(v === NONE ? null : (v as Trade))}>
                  <SelectTrigger id={ids.trade} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
                    {TRADES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TRADE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id={ids.technician} label="Technician">
                <TechnicianSelect id={ids.technician} value={technicianId} onChange={setTechnicianId} disabled={busy} />
              </Field>
            </div>
            <div className="flex justify-end">
              <SubmitButton
                variant="outline"
                pending={working === "finding"}
                pendingLabel="Saving…"
                disabled={busy || finding.trim().length < 3}
                icon={<Save className="size-4" />}
                onClick={saveFinding}
              >
                Save finding
              </SubmitButton>
            </div>
          </>
        ) : (
          <>
            <ReadText value={w.finding} />
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <Fact label="Trade">{w.trade ? (TRADE_LABELS[w.trade as Trade] ?? w.trade) : <Muted>Not set</Muted>}</Fact>
              <Fact label="Technician">{technicianName(w.technicianId) ?? <Muted>—</Muted>}</Fact>
            </dl>
          </>
        )}
      </Panel>

      <Panel title="Parties" description="Who requests, approves, pays and receives the invoice and report. Empty means the client.">
        {canEdit && !locked ? (
          <>
            <PartiesEditor value={parties} onChange={setParties} disabled={busy} />
            <div className="flex justify-end">
              <SubmitButton variant="outline" pending={working === "parties"} pendingLabel="Saving…" disabled={busy} icon={<Save className="size-4" />} onClick={saveParties}>
                Save parties
              </SubmitButton>
            </div>
          </>
        ) : (
          <dl className="grid gap-2 text-sm">
            {WORK_PARTIES.map((p) => {
              const v = w.parties[p];
              return (
                <Fact key={p} label={WORK_PARTY_LABELS[p]}>
                  {v ? [v.name, v.email, v.phone].filter(Boolean).join(" · ") : <Muted>The client</Muted>}
                </Fact>
              );
            })}
          </dl>
        )}
      </Panel>

      <Panel
        title="Quotation"
        description={`Labour and materials. Materials carry a ${w.materialFeePercent}% handling fee; VAT on top.`}
        action={
          w.quotedAt ? (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <FileText className="size-3.5" />
              Saved {shortDateTime(w.quotedAt)}
            </span>
          ) : null
        }
      >
        {quoting ? (
          <QuoteEditor drafts={drafts} setDrafts={setDrafts} disabled={busy} />
        ) : w.quotationLines.length === 0 ? (
          <p className="text-muted-foreground text-sm">No quotation was prepared.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Description</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="pr-4 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {w.quotationLines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-[260px] pl-4 whitespace-normal">{l.description}</TableCell>
                    <TableCell>{l.kind === "labour" ? "Labour" : "Material"}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                    <TableCell className="text-right">
                      <Money value={l.unitPrice} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Money value={l.quantity * l.unitPrice} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <Totals totals={quoting ? totals : w.totals} feePercent={w.materialFeePercent} />
        {quoting ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              {built.invalid ? "Each line needs a description, a quantity above 0 and a price." : quoteDirty ? "Unsaved changes." : null}
            </p>
            <SubmitButton
              pending={working === "quote"}
              pendingLabel="Saving…"
              disabled={busy || built.invalid || !built.lines.length || !quoteDirty}
              icon={<Save className="size-4" />}
              onClick={saveQuote}
            >
              Save quotation
            </SubmitButton>
          </div>
        ) : null}
      </Panel>

      <PhotosPanel
        description="The finding, before and after."
        photos={photos}
        kinds={PHOTO_KINDS}
        labels={PHOTO_LABELS}
        editable={canEdit && !locked}
        disabled={busy}
        upload={(file, kind) => additionalWorksService.addPhoto(w.id, { file, kind })}
        onUploaded={changed}
        remove={async (photoId) => {
          await additionalWorksService.removePhoto(w.id, photoId);
          await changed();
        }}
      />

      {confirmDialog}
      {actionForm.dialog}
    </div>
  );
}

function QuoteEditor({ drafts, setDrafts, disabled }: { drafts: LineDraft[]; setDrafts: (next: LineDraft[]) => void; disabled: boolean }) {
  const base = useId();
  const update = (key: string, next: Partial<LineDraft>) => setDrafts(drafts.map((d) => (d.key === key ? { ...d, ...next } : d)));
  return (
    <div className="grid gap-2">
      {drafts.map((d, i) => {
        const amount = Number(d.quantity) * Number(d.unitPrice);
        return (
          <div key={d.key} className="grid gap-2 rounded-lg border px-3 py-2 sm:grid-cols-[1fr_8rem_5rem_7rem_6.5rem_auto] sm:items-center sm:border-0 sm:px-0 sm:py-0">
            <Input
              id={`${base}-${d.key}-desc`}
              aria-label={`Line ${i + 1} description`}
              placeholder="Description"
              maxLength={300}
              disabled={disabled}
              value={d.description}
              onChange={(e) => update(d.key, { description: e.target.value })}
            />
            <Select value={d.kind} disabled={disabled} onValueChange={(k) => update(d.key, { kind: k as LineDraft["kind"] })}>
              <SelectTrigger aria-label={`Line ${i + 1} kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="labour">Labour</SelectItem>
                <SelectItem value="material">Material</SelectItem>
              </SelectContent>
            </Select>
            <Input
              aria-label={`Line ${i + 1} quantity`}
              type="number"
              min={0}
              step="any"
              placeholder="Qty"
              disabled={disabled}
              value={d.quantity}
              onChange={(e) => update(d.key, { quantity: e.target.value })}
            />
            <Input
              aria-label={`Line ${i + 1} unit price, AED`}
              type="number"
              min={0}
              step="any"
              placeholder="Unit price"
              disabled={disabled}
              value={d.unitPrice}
              onChange={(e) => update(d.key, { unitPrice: e.target.value })}
            />
            <span className="text-right text-sm">{Number.isFinite(amount) ? <Money value={amount} /> : <Muted>—</Muted>}</span>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground hover:text-danger size-8 justify-self-end"
              aria-label={`Remove line ${i + 1}`}
              disabled={disabled}
              onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        );
      })}
      <div>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || drafts.length >= 60}
          onClick={() => setDrafts([...drafts, { key: lineKey(), description: "", kind: "material", quantity: "1", unitPrice: "" }])}
        >
          <Plus className="size-3.5" />
          Add line
        </Button>
      </div>
    </div>
  );
}

function Totals({ totals, feePercent }: { totals: ReturnType<typeof quotationTotals>; feePercent: number }) {
  const rows: Array<[string, number, boolean?]> = [
    ["Labour", totals.labourTotal],
    ["Materials", totals.materialTotal],
    [`Handling fee (${feePercent}%)`, totals.materialFee],
    ["Subtotal", totals.subtotal],
    ["VAT", totals.vatAmount],
    ["Total", totals.total, true],
  ];
  return (
    <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
      {rows.map(([label, value, strong]) => (
        <div key={label} className={cn("flex justify-between gap-4", strong && "border-t pt-1.5 font-semibold")}>
          <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
          <dd>
            <Money value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
