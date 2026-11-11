"use client";

import { useId, useState, type ReactNode } from "react";
import { Ban, Banknote, CalendarCheck, Hammer, Users, CheckCheck, CheckCircle2, FileText, Plus, ReceiptText, Save, Search, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import DateSelect from "@/components/ui/date-select";
import TimeSelect from "@/components/ui/time-select";
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
import { todayInDubai } from "@/lib/amc/contracts";
import type { Trade } from "@/lib/amc/visits";
import { formatPhone } from "@/lib/phone/format-phone";
import { cn } from "@/lib/utils";
import {
  additionalWorksService,
  type AdditionalWorkRecord,
  type AdditionalWorkResponse,
  type WorkCrewSuggestion,
  type WorkPhotoKind,
} from "@/modules/amc-contracts/additional-works-service";

import { Fact, Field, Muted, Panel, PanelEmpty, PhotosPanel, SectionDialog, PreparedMessage, ReadText, errorText, shortDateTime, useActionForm } from "./call-out-shared";
import { formatContractDate } from "./contract-status";
import { CrewPicker, crewOptions, crewSummary } from "./crew-picker";
import { TechnicianSelect, useTechnicianName } from "./people-pickers";
import { PartiesEditor, partiesInput, partiesProblem, partyDrafts, type PartyDrafts } from "./raise-additional-work-dialog";
import { slotDate, slotLabel, slotTime } from "./visit-status";

/*
  One additional work (Phase 11: DEV-407), as sections of its page
  (AMC -> Additional work -> the work): the finding, the five parties, the
  quotation with its live totals, the slot and crew once approved (11 Nov
  2026), photos; the commercial steps (share, approve with evidence,
  complete, invoice, paid, reject) are the page's header actions, each
  offered only when the status allows it. They were the dialog's body.
  `canEdit` from the route decides what is offered; the route checks again.
*/

const NONE = "__none";
const PHOTO_KINDS = ["finding", "before", "after", "other"] as const satisfies readonly WorkPhotoKind[];
const PHOTO_LABELS: Record<WorkPhotoKind, string> = { finding: "Finding", before: "Before", after: "After", other: "Other" };

export type WorkWorking = "finding" | "parties" | "quote" | "suggest" | "schedule" | null;

export type WorkSectionProps = {
  data: AdditionalWorkResponse;
  working: WorkWorking;
  setWorking: (w: WorkWorking) => void;
  /** After a change: the page reads the work again. */
  changed: () => Promise<void>;
};

export const workSourceLabel = (w: Pick<AdditionalWorkRecord, "source" | "visitNo" | "callOutNo">) =>
  w.source === "visit" ? `Visit ${w.visitNo ?? ""}`.trim() : w.source === "call_out" ? `Call out ${w.callOutNo ?? ""}`.trim() : "Raised by hand";

/** Paid or rejected work is kept as it is. */
export const workLocked = (w: Pick<AdditionalWorkRecord, "status">) => w.status === "paid" || w.status === "rejected";

/** One action at a time: a failure is a toast, the form stays as it was. */
function useRun(setWorking: (w: WorkWorking) => void) {
  return async (kind: Exclude<WorkWorking, null>, fn: () => Promise<void>, fallback: string) => {
    setWorking(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(errorText(e, fallback));
    } finally {
      setWorking(null);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Where it stands                                                     */
/* ------------------------------------------------------------------ */

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

/** The eight steps from finding to payment, with when each was reached. */
export function WorkSteps({ work: w }: { work: AdditionalWorkRecord }) {
  const rejected = w.status === "rejected";
  const reachedIndex = STEPS.findIndex((s) => s.status === w.status);
  return (
    <ol className="grid grid-cols-4 gap-2 sm:grid-cols-8">
      {STEPS.map((s, i) => {
        const at = s.at(w);
        const reached = Boolean(at) || (!rejected && i <= reachedIndex);
        return (
          <li key={s.status} className="min-w-0">
            <span className={cn("mb-1 block h-1 rounded-full", reached ? "bg-brand" : "bg-mist")} aria-hidden />
            <span className={cn("block truncate text-xs font-medium", reached ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
            <span className="text-muted-foreground block truncate text-[11px]">{at ? (s.date ? formatContractDate(at) : shortDateTime(at)) : "—"}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* The commercial steps (header actions)                               */
/* ------------------------------------------------------------------ */

/**
 * Share, approve, complete, invoice, paid and reject: the buttons for the
 * page's header, the dialogs they open, and the WhatsApp message prepared
 * when the quotation is shared. Scheduling has its own tab (Crew & time):
 * `onSchedule` opens it.
 */
export function useWorkActions(data: AdditionalWorkResponse | null, changed: () => Promise<void>, busy: boolean, onSchedule: () => void) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const actionForm = useActionForm();
  const [prepared, setPrepared] = useState<{ message: string; whatsapp: string | null } | null>(null);
  const w = data?.work ?? null;

  if (!w || !data) return { buttons: null, dialogs: <>{confirmDialog}{actionForm.dialog}</>, notice: null };

  const approver = w.parties.approver;
  const can = (to: AdditionalWorkStatus) => data.canEdit && canMoveWork(w.status, to);
  const post = async (action: Parameters<typeof additionalWorksService.action>[1], success: string) => {
    await additionalWorksService.action(w.id, action);
    toast.success(success);
    await changed();
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
      action: () => post({ action: "complete" }, "Marked completed"),
    });

  const buttons =
    data.canEdit && !workLocked(w) ? (
      <>
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
        {can("shared") ? (
          <Button disabled={busy || !w.quotationLines.length} title={!w.quotationLines.length ? "Prepare the quotation first" : undefined} onClick={share}>
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
          <Button variant="outline" disabled={busy} onClick={onSchedule}>
            <CalendarCheck className="size-4" />
            {w.status === "scheduled" ? "Reschedule" : "Schedule"}
          </Button>
        ) : null}
        {can("completed") ? (
          <Button disabled={busy} onClick={complete}>
            <CheckCheck className="size-4" />
            Complete
          </Button>
        ) : null}
        {can("invoiced") ? (
          <Button
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
      </>
    ) : null;

  const notice = prepared ? (
    <PreparedMessage title="The quotation, for WhatsApp" message={prepared.message} whatsapp={prepared.whatsapp} onDismiss={() => setPrepared(null)} />
  ) : null;

  return {
    buttons,
    dialogs: (
      <>
        {confirmDialog}
        {actionForm.dialog}
      </>
    ),
    notice,
  };
}

/* ------------------------------------------------------------------ */
/* Finding                                                             */
/* ------------------------------------------------------------------ */

export function WorkFindingSection({ data, working, setWorking, changed }: WorkSectionProps) {
  const { work: w, canEdit } = data;
  const run = useRun(setWorking);
  const busy = working !== null;
  const [finding, setFinding] = useState(w.finding);
  const [risk, setRisk] = useState<WorkRisk>(w.risk);
  const [trade, setTrade] = useState<Trade | null>((w.trade as Trade | null) ?? null);
  const [technicianId, setTechnicianId] = useState<string | null>(w.technicianId ?? null);
  const technicianName = useTechnicianName();
  const ids = { finding: useId(), risk: useId(), trade: useId(), technician: useId() };

  const save = () =>
    void run(
      "finding",
      async () => {
        await additionalWorksService.action(w.id, { action: "update", finding: finding.trim(), risk, trade, technicianId: technicianId?.trim() || null });
        toast.success("Finding saved");
        await changed();
      },
      "Could not save the finding.",
    );

  return (
    <Panel title="Finding" icon={<Hammer />} description="The technical finding, kept apart from the quotation, and who found it.">
      {canEdit && !workLocked(w) ? (
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
            <Field id={ids.technician} label="Found by">
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
              onClick={save}
            >
              Save finding
            </SubmitButton>
          </div>
        </>
      ) : (
        <>
          <ReadText value={w.finding} />
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Fact label="Risk">{WORK_RISK_LABELS[w.risk]}</Fact>
            <Fact label="Trade">{w.trade ? (TRADE_LABELS[w.trade as Trade] ?? w.trade) : <Muted>Not set</Muted>}</Fact>
            <Fact label="Found by">{technicianName(w.technicianId) ?? <Muted>—</Muted>}</Fact>
          </dl>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Parties                                                             */
/* ------------------------------------------------------------------ */

export function WorkPartiesSection({ data, working, setWorking, changed }: WorkSectionProps) {
  const { work: w, canEdit } = data;
  const run = useRun(setWorking);
  const [parties, setParties] = useState<PartyDrafts>(() => partyDrafts(w.parties));

  const save = () => {
    const problem = partiesProblem(parties);
    if (problem) return void toast.error(problem);
    void run(
      "parties",
      async () => {
        await additionalWorksService.action(w.id, { action: "update", parties: partiesInput(parties, true) });
        toast.success("Parties saved");
        await changed();
      },
      "Could not save the parties.",
    );
  };

  return (
    <Panel title="Parties" icon={<Users />} description="Who requests, approves, pays and receives the invoice and report. Empty means the client.">
      {canEdit && !workLocked(w) ? (
        <>
          <PartiesEditor value={parties} onChange={setParties} disabled={working !== null} />
          <div className="flex justify-end">
            <SubmitButton variant="outline" pending={working === "parties"} pendingLabel="Saving…" disabled={working !== null} icon={<Save className="size-4" />} onClick={save}>
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
                {v ? [v.name, v.email, formatPhone(v.phone)].filter(Boolean).join(" · ") : <Muted>The client</Muted>}
              </Fact>
            );
          })}
        </dl>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Quotation                                                           */
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

export function WorkQuotationSection({ data, working, setWorking, changed }: WorkSectionProps) {
  const { work: w, canEdit } = data;
  const run = useRun(setWorking);
  const busy = working !== null;
  const [drafts, setDrafts] = useState<LineDraft[]>(() => (w.quotationLines.length ? toDrafts(w.quotationLines) : [{ key: lineKey(), description: "", kind: "labour", quantity: "1", unitPrice: "" }]));
  const quoting = canEdit && canMoveWork(w.status, "quotation_prepared");
  const built = fromDrafts(drafts);
  const totals = quotationTotals(built.invalid ? built.lines.filter((l) => l.description && l.quantity > 0 && l.unitPrice >= 0) : built.lines, w.materialFeePercent);
  const dirty = quoting && !sameLines(built.lines, w.quotationLines);

  const save = () => {
    if (built.invalid) return void toast.error("Each line needs a description, a quantity above 0 and a price.");
    if (!built.lines.length) return void toast.error("Add at least one line.");
    void run(
      "quote",
      async () => {
        await additionalWorksService.action(w.id, { action: "quote", lines: built.lines });
        toast.success("Quotation saved");
        await changed();
      },
      "Could not save the quotation.",
    );
  };

  return (
    <Panel
      title="Quotation" icon={<ReceiptText />}
      description={`Labour and materials. Materials carry a ${w.materialFeePercent}% handling fee; VAT on top. Save it before sharing it with the client.`}
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
        <PanelEmpty icon={<FileText />} title="No quotation" description="No quotation was prepared before this work moved on." />
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Description</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit price</TableHead>
                <TableHead className="pr-4">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {w.quotationLines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell className="max-w-[260px] pl-4 whitespace-normal">{l.description}</TableCell>
                  <TableCell>{l.kind === "labour" ? "Labour" : "Material"}</TableCell>
                  <TableCell className="tabular-nums">{l.quantity}</TableCell>
                  <TableCell>
                    <Money value={l.unitPrice} />
                  </TableCell>
                  <TableCell className="pr-4">
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
          <p className="text-muted-foreground text-xs">{built.invalid ? "Each line needs a description, a quantity above 0 and a price." : dirty ? "Unsaved changes." : null}</p>
          <SubmitButton pending={working === "quote"} pendingLabel="Saving…" disabled={busy || built.invalid || !built.lines.length || !dirty} icon={<Save className="size-4" />} onClick={save}>
            Save quotation
          </SubmitButton>
        </div>
      ) : null}
    </Panel>
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
          <div key={d.key} className="grid gap-2 rounded-lg border px-3 py-2 md:grid-cols-[minmax(0,1fr)_8rem_5rem_7rem_6.5rem_auto] md:items-center md:border-0 md:px-0 md:py-0">
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
            <span className="text-sm">{Number.isFinite(amount) ? <Money value={amount} /> : <Muted>—</Muted>}</span>
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

/* ------------------------------------------------------------------ */
/* Crew & time (11 Nov 2026)                                           */
/* ------------------------------------------------------------------ */

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * When and who does the work, once the client approved it: a slot and a
 * crew, found and checked as a call out's are (competent for the trade,
 * free, not on leave; why, when not the suggested crew). Before the
 * database update it can be scheduled for a day only.
 */
export function WorkScheduleSection({ data, working, setWorking, changed }: WorkSectionProps) {
  const { work: w, slot, canEdit } = data;
  const run = useRun(setWorking);
  const technicianName = useTechnicianName();
  const placedMinutes = slot.scheduledStart && slot.scheduledEnd ? Math.round((Date.parse(slot.scheduledEnd) - Date.parse(slot.scheduledStart)) / 60_000) : null;
  const [date, setDate] = useState(() => (slot.scheduledStart ? slotDate(slot.scheduledStart) : (w.scheduledFor ?? todayInDubai())));
  const [time, setTime] = useState(() => (slot.scheduledStart ? slotTime(slot.scheduledStart) : "09:00"));
  const [duration, setDuration] = useState(String(placedMinutes ?? 120));
  const [suggestion, setSuggestion] = useState<{ key: string; data: WorkCrewSuggestion } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [override, setOverride] = useState("");
  const ids = { date: useId(), time: useId(), duration: useId(), override: useId() };
  const [editing, setEditing] = useState(false);

  const can = canEdit && canMoveWork(w.status, "scheduled");
  const minutes = Number(duration);
  const validSlot = isIsoDate(date) && isTime(time) && Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440;
  const slotKey = `${date}|${time}|${minutes}`;
  const fresh = suggestion?.key === slotKey ? suggestion.data : null;
  const options = fresh ? crewOptions(fresh) : null;
  const suggestedIds = fresh?.suggested.technicianIds ?? [];
  const differs = fresh !== null && !sameSet(picked, suggestedIds);
  const reasonRequired = differs && suggestedIds.length > 0;
  const reasonMissing = reasonRequired && override.trim().length < 3;

  const find = () =>
    void run(
      "suggest",
      async () => {
        const result = await additionalWorksService.suggest(w.id, date, time, minutes);
        setSuggestion({ key: slotKey, data: result });
        setPicked(result.suggested.technicianIds);
        setOverride("");
        if (!result.fits.some((f) => f.blockers.length === 0)) toast.warning("Nobody competent is free at that time.");
      },
      "Could not find technicians.",
    );

  const save = (dayOnly: boolean) =>
    void run(
      "schedule",
      async () => {
        await additionalWorksService.action(
          w.id,
          dayOnly ? { action: "schedule", date } : { action: "schedule", date, time, durationMinutes: minutes, technicianIds: picked, overrideReason: override.trim() || null },
        );
        toast.success(w.status === "scheduled" ? `${w.workNo} rescheduled` : `${w.workNo} scheduled`);
        setSuggestion(null);
        setEditing(false);
        await changed();
      },
      "Could not schedule the work.",
    );

  const stateText =
    w.status === "identified" || w.status === "quotation_prepared" || w.status === "shared"
      ? "It is scheduled once the client approves the quotation."
      : w.status === "rejected"
        ? "The client declined the work."
        : !canEdit
          ? "You can see this work, but not change it."
          : "The work is done; its time and crew are kept as they were.";

  return (
    <>
      <Panel
        title="When and who" icon={<CalendarCheck />}
        description="The slot and the crew doing the work. The technician who found it is on the Finding tab."
        actions={
          can ? (
            <Button disabled={working !== null} onClick={() => setEditing(true)}>
              <CalendarCheck className="size-4" />
              {w.status === "scheduled" ? "Reschedule" : "Schedule the work"}
            </Button>
          ) : null
        }
      >
        <dl className="divide-y text-sm">
          <InfoRow label="Scheduled for">
            {slot.scheduledStart ? slotLabel(slot.scheduledStart, slot.scheduledEnd) : w.scheduledFor ? `${formatContractDate(w.scheduledFor)} (no time set)` : <Muted>Not scheduled</Muted>}
          </InfoRow>
          <InfoRow label="Crew">
            {slot.technicianIds.length ? (
              slot.technicianIds.map((t) => `${technicianName(t)}${t === slot.leadTechnicianId && slot.technicianIds.length > 1 ? " (lead)" : ""}`).join(", ")
            ) : (
              <Muted>None yet</Muted>
            )}
          </InfoRow>
          {slot.assignmentNote ? <InfoRow label="Why this crew">{slot.assignmentNote}</InfoRow> : null}
          <InfoRow label="Trade">{w.trade ? (TRADE_LABELS[w.trade as Trade] ?? w.trade) : <Muted>Not set</Muted>}</InfoRow>
        </dl>
        {!can ? <p className="text-muted-foreground text-sm">{stateText}</p> : null}
      </Panel>

      {!slot.migrated ? (
        <SectionDialog
          open={editing}
          onOpenChange={setEditing}
          title={w.status === "scheduled" ? `Reschedule ${w.workNo}` : `Schedule ${w.workNo}`}
          description="The day the work is planned. A time and a crew can be set once the database update 20261112100000 is applied."
          busy={working === "schedule"}
          submit={
            <SubmitButton pending={working === "schedule"} pendingLabel="Saving…" disabled={working !== null || !isIsoDate(date)} icon={<CalendarCheck className="size-4" />} onClick={() => save(true)}>
              Schedule
            </SubmitButton>
          }
        >
          <Field id={ids.date} label="Date">
            <DateSelect id={ids.date} value={date} onChange={setDate} />
          </Field>
        </SectionDialog>
      ) : (
        <SectionDialog
          open={editing}
          onOpenChange={setEditing}
          wide
          title={w.status === "scheduled" ? `Reschedule ${w.workNo}` : `Schedule ${w.workNo}`}
          description="Pick a day and time, then find who is competent for the trade and free. Blocked technicians show why."
          busy={working === "schedule"}
          submit={
            <SubmitButton
              pending={working === "schedule"}
              pendingLabel="Saving…"
              disabled={working !== null || !fresh || picked.length === 0 || picked.length > 10 || reasonMissing}
              icon={<CalendarCheck className="size-4" />}
              onClick={() => save(false)}
            >
              {w.status === "scheduled" ? "Reschedule" : "Schedule"}
            </SubmitButton>
          }
        >
          {!w.trade ? <p className="text-warning text-xs">This work has no trade (set it on the Finding tab), so nobody can be confirmed competent for it.</p> : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id={ids.date} label="Date">
              <DateSelect id={ids.date} value={date} onChange={setDate} />
            </Field>
            <Field id={ids.time} label="Start time">
              <TimeSelect id={ids.time} step={900} value={time} onChange={setTime} />
            </Field>
            <Field id={ids.duration} label="Duration (minutes)">
              <Input id={ids.duration} type="number" min={15} max={1440} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              {suggestion && !fresh
                ? "The day or time changed: find technicians again."
                : !validSlot
                  ? "Enter a date, a start time and 15 to 1440 minutes."
                  : !fresh
                    ? "Then choose the crew."
                    : reasonMissing
                      ? "Say why this crew was chosen instead of the suggested one."
                      : crewSummary(picked)}
            </p>
            <SubmitButton variant="outline" pending={working === "suggest"} pendingLabel="Finding…" disabled={working !== null || !validSlot} icon={<Search className="size-4" />} onClick={find}>
              Find technicians
            </SubmitButton>
          </div>
          {options ? <CrewPicker options={options} picked={picked} onPickedChange={setPicked} disabled={working !== null} /> : null}
          {fresh && differs && picked.length ? (
            <Field
              id={ids.override}
              label={reasonRequired ? "Why this crew" : "Why this crew (optional)"}
              hint={reasonRequired ? "Not the suggested crew: say why. Needed to save." : "Say why, for the record."}
            >
              <Textarea id={ids.override} rows={2} maxLength={500} value={override} onChange={(e) => setOverride(e.target.value)} />
            </Field>
          ) : null}
        </SectionDialog>
      )}
    </>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

export function WorkPhotosSection({ data, working, changed }: Omit<WorkSectionProps, "setWorking">) {
  const { work: w, photos, canEdit } = data;
  return (
    <PhotosPanel
      description="The finding, before and after."
      photos={photos}
      kinds={PHOTO_KINDS}
      labels={PHOTO_LABELS}
      editable={canEdit && !workLocked(w)}
      disabled={working !== null}
      upload={(file, kind) => additionalWorksService.addPhoto(w.id, { file, kind })}
      onUploaded={changed}
      remove={async (photoId) => {
        await additionalWorksService.removePhoto(w.id, photoId);
        await changed();
      }}
    />
  );
}
