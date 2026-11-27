"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Banknote, Plus, ReceiptText, SquarePen, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import DateSelect from "@/components/ui/date-select";
import { todayInDubai } from "@/lib/amc/contracts";
import { amcRequest } from "@/lib/amc/http-cache";
import {
  CHARGE_PAYMENT_MODES,
  CHARGE_PAYMENT_MODE_LABELS,
  CHARGE_STATUS_LABELS,
  MATERIAL_FEE_SERVICE,
  PAYMENT_TIMING_LABELS,
  chargeTotals,
  newlyFreeLines,
  type ChargeLine,
  type ChargePaymentMode,
  type PricedService,
  type VisitCharge,
} from "@/lib/amc/visit-charges";

import { errorText } from "./call-out-shared";
import { formatContractDate } from "./contract-status";
import { useAmcData } from "./use-amc-data";

/*
  What a call out or additional work costs the client (18 Nov 2026): the
  services priced from the rate card, each charged or free, VAT, and the
  one payment -- before the visit or after it (with the reason, chosen at
  Start visit). Shown on the call out, on the work's quotation and, as
  "Visit charges", on the contract's Payments tab.
*/

type Kind = "call_out" | "additional_work";
/* servicesEditable: an additional work's services can change (before approval, 19 Nov 2026). */
type ChargeResponse = { charge: VisitCharge | null; ready: boolean; services: PricedService[]; canEdit: boolean; servicesEditable?: boolean; canMarkFree?: boolean };

const url = (kind: Kind, id: string) => `/api/amc-field-work/${kind}/${encodeURIComponent(id)}/charge`;
const post = (kind: Kind, id: string, body: Record<string, unknown>) => amcRequest(url(kind, id), { method: "POST", body: JSON.stringify(body) });

export const CHARGE_TONE: Record<VisitCharge["status"], string> = {
  due: "bg-warning/10 text-warning",
  paid: "bg-success/10 text-success",
  waived: "bg-mist text-ink-soft",
};

export function useVisitCharge(kind: Kind, id: string, enabled = true) {
  return useAmcData(() => (enabled ? amcRequest<ChargeResponse>(url(kind, id)) : Promise.resolve(null)), enabled ? `visit-charge|${kind}|${id}` : "visit-charge:none");
}

/** The status, and how it is paid when chosen. */
export function ChargeStatusBadges({ charge }: { charge: VisitCharge }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary" className={`border-0 font-medium ${CHARGE_TONE[charge.status]}`}>
        {CHARGE_STATUS_LABELS[charge.status]}
      </Badge>
      {charge.status === "due" && charge.paymentTiming ? (
        <Badge variant="outline" className="font-normal" title={charge.paymentTimingReason ?? undefined}>
          {PAYMENT_TIMING_LABELS[charge.paymentTiming]}
        </Badge>
      ) : null}
    </span>
  );
}

/**
 * The charge card: lines, totals, status and payment; a call out's services
 * are changed here (Edit services), an additional work's on its quotation.
 */
export function ChargeCard({
  kind,
  id,
  coverage,
  onChanged,
  refreshKey = 0,
}: {
  kind: Kind;
  id: string;
  /** A call out's coverage: a covered call out's services are free by default. */
  coverage?: string | null;
  onChanged?: () => void | Promise<void>;
  /** Bumped by the page when it reads everything again (a start sets the payment timing). */
  refreshKey?: number;
}) {
  const { data, error, loading, reload } = useVisitCharge(kind, id);
  const seen = useRef(refreshKey);
  useEffect(() => {
    if (seen.current === refreshKey) return;
    seen.current = refreshKey;
    reload();
  }, [refreshKey, reload]);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const charge = data?.charge ?? null;
  const canEdit = Boolean(data?.canEdit && data.ready);
  /* Who may change the services: a call out's until paid; an additional work's until approved (19 Nov 2026). */
  const servicesEditable = kind === "call_out" ? canEdit && charge?.status !== "paid" : Boolean(data?.servicesEditable);
  const draft = Boolean(charge?.draft);
  const changed = async () => {
    reload();
    await onChanged?.();
  };

  return (
    <SectionCard
      icon={<ReceiptText />}
      title="Services and price"
      description={
        kind === "call_out"
          ? "The services done on this call out, priced from the rate card, each charged or free. Paid before the visit or after it, chosen at Start visit."
          : "The services for this work, from the rate card or typed, each charged or free. They are the quotation the client approves; paid before the visit or after it, chosen at Start visit."
      }
      bodyClassName="px-5 pb-5"
      action={
        canEdit || servicesEditable ? (
          <div className="flex flex-wrap items-center gap-2">
            {servicesEditable ? (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <SquarePen className="size-4" />
                {charge?.lines.length ? "Edit services" : "Add services"}
              </Button>
            ) : null}
            {canEdit && charge?.status === "due" && !draft ? (
              <Button size="sm" onClick={() => setPaying(true)}>
                <Banknote className="size-4" />
                Record payment
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {error ? (
        <div className="p-5">
          <ErrorState title="Could not load the charge" message={error} onRetry={reload} />
        </div>
      ) : loading && !data ? (
        <ListSkeleton rows={2} />
      ) : !data?.ready ? (
        <EmptyState icon={<ReceiptText className="size-5" />} title="Not available yet" description="Visit charges need the database update 20261118130000." />
      ) : !charge || charge.lines.length === 0 ? (
        <EmptyState
          icon={<ReceiptText className="size-5" />}
          title="No services yet"
          description={
            kind === "call_out"
              ? coverage === "covered"
                ? "Covered by the AMC: add the services done, as free, or charge any that are not covered."
                : "Add the services the crew will do, so the client knows the price before the visit."
              : "Add the services and their price: they are the quotation the client approves."
          }
          /* Add services is in the card's header only (27 Nov 2026: it showed twice). */
        />
      ) : (
        <div className="grid gap-4">
          {/* As the proposal's Services and cost (18 Nov 2026): the lines in a table, their sum in its footer under the price. */}
          <ChargeTable charge={charge} />
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm">
            {draft ? (
              <Badge variant="secondary" className="bg-brand-50 text-brand border-0 font-medium">
                Quotation · not approved yet
              </Badge>
            ) : (
              <ChargeStatusBadges charge={charge} />
            )}
            <span className="text-muted-foreground">
              {draft
                ? "Share it with the client (Share quotation), then Approve. What they pay is due from then."
                : charge.status === "paid"
                ? `Paid ${charge.paidOn ? formatContractDate(charge.paidOn) : ""} by ${charge.paymentMode ? CHARGE_PAYMENT_MODE_LABELS[charge.paymentMode].toLowerCase() : "—"}${charge.paymentReference ? ` · ${charge.paymentReference}` : ""}`
                : charge.paymentTiming === "after_visit"
                  ? `After the visit: ${charge.paymentTimingReason ?? ""}`
                  : charge.status === "due"
                    ? "Before or after the visit is chosen at Start visit."
                    : "Nothing for the client to pay."}
            </span>
          </div>
        </div>
      )}

      {data && servicesEditable ? (
        <ServicesDialog
          open={editing}
          onOpenChange={setEditing}
          kind={kind}
          id={id}
          services={data.services}
          /* The material fee follows the materials: never edited as a service. */
          initial={(charge?.lines ?? []).filter((l) => l.serviceId !== MATERIAL_FEE_SERVICE)}
          freeByDefault={coverage === "covered"}
          chargeable={kind === "call_out" && coverage === "chargeable"}
          canMarkFree={Boolean(data.canMarkFree)}
          onSaved={changed}
        />
      ) : null}
      {charge && !draft ? <RecordChargePaymentDialog open={paying} onOpenChange={setPaying} kind={kind} id={id} charge={charge} onSaved={changed} /> : null}
    </SectionCard>
  );
}

/* The rate column, indented as the proposal's frequency column, so the sum's labels line up under it. */
const RATE_INDENT = "pl-16";

/** The lines and their sum, laid out as the proposal's Services and cost. */
function ChargeTable({ charge }: { charge: VisitCharge }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="overflow-x-auto">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10 w-[44%]">Service</TableHead>
              <TableHead className="h-10 w-[10%] text-right">Units</TableHead>
              <TableHead className={`h-10 w-[22%] ${RATE_INDENT}`}>Rate</TableHead>
              <TableHead className="h-10 w-[24%] text-right">Price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {charge.lines.map((l, i) => (
              <TableRow key={i}>
                {/* A long service name wraps in its column, not over the units and rate (19 Nov 2026). */}
                <TableCell className="align-top text-sm whitespace-normal">
                  <span className="font-medium break-words">{l.label}</span>
                  {l.cardPrice !== null && l.cardPrice !== l.unitPrice ? (
                    <span className="text-muted-foreground mt-0.5 block text-xs">Rate card {l.cardPrice.toFixed(2)}</span>
                  ) : null}
                  {!l.charged && l.freeReason ? (
                    <span className="text-muted-foreground mt-0.5 block text-xs break-words">
                      Free: {l.freeReason}
                      {l.freedBy ? ` · ${l.freedBy}` : ""}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="align-top text-right text-sm tabular-nums">{l.units}</TableCell>
                <TableCell className={`text-muted-foreground align-top ${RATE_INDENT} text-sm whitespace-nowrap`}>
                  <Money value={l.unitPrice} />
                  {l.unit ? <span className="block truncate text-xs" title={l.unit}>{l.unit}</span> : null}
                </TableCell>
                <TableCell className="align-top text-right text-sm font-medium whitespace-nowrap tabular-nums">
                  {l.charged ? (
                    <Money value={Math.round(l.units * l.unitPrice * 100) / 100} />
                  ) : (
                    <Badge variant="secondary" className="bg-mist text-ink-soft border-0 font-medium">
                      Free
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="bg-muted/20 [&_tr]:border-0 [&_td]:py-1.5">
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={2} rowSpan={3} className="max-w-0" />
              <TableCell className={`text-muted-foreground pt-3 ${RATE_INDENT} text-sm font-normal`}>Subtotal (excl. VAT)</TableCell>
              <TableCell className="pt-3 text-right text-sm font-normal tabular-nums">
                <Money value={charge.subtotal} />
              </TableCell>
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableCell className={`text-muted-foreground ${RATE_INDENT} text-sm font-normal`}>VAT (5%)</TableCell>
              <TableCell className="text-right text-sm font-normal tabular-nums">
                <Money value={charge.vatAmount} />
              </TableCell>
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableCell className={`pt-2.5 pb-3 ${RATE_INDENT} text-sm font-semibold`}>Total</TableCell>
              <TableCell className="text-brand pt-2.5 pb-3 text-right text-lg font-semibold tabular-nums">
                <Money value={charge.total} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}

/** A call out's or additional work's services: each from the rate card for the property (or custom), its units and price, charged or free. */
function ServicesDialog({
  open,
  onOpenChange,
  kind,
  id,
  services,
  initial,
  freeByDefault,
  chargeable = false,
  canMarkFree = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: Kind;
  id: string;
  services: PricedService[];
  initial: ChargeLine[];
  freeByDefault: boolean;
  /** A chargeable call out (DEV-498): a line made free needs a reason and the right. */
  chargeable?: boolean;
  canMarkFree?: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [lines, setLines] = useState<ChargeLine[]>(initial);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<string>("");
  const totals = chargeTotals(lines);

  const add = (serviceId: string) => {
    const s = services.find((x) => x.serviceId === serviceId);
    if (!s) return;
    setLines((all) => [...all, { serviceId: s.serviceId, label: s.label, unit: s.unit, units: 1, unitPrice: s.rate ?? 0, cardPrice: s.rate, charged: !freeByDefault }]);
    setPick("");
  };
  /* A service not on the rate card (18 Nov 2026): named and priced here. */
  const addCustom = () => setLines((all) => [...all, { serviceId: null, label: "", unit: null, units: 1, unitPrice: 0, cardPrice: null, charged: !freeByDefault }]);
  const set = (i: number, patch: Partial<ChargeLine>) => setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const unnamed = lines.some((l) => !l.label.trim());
  /* The lines made free in this dialog on a chargeable call out: each needs its reason (DEV-498). */
  const freshFree = new Set(newlyFreeLines(lines, initial, chargeable));
  const reasonMissing = [...freshFree].some((l) => (l.freeReason ?? "").trim().length < 3);
  const save = async () => {
    setBusy(true);
    try {
      await post(kind, id, { action: "save_services", lines: lines.map((l) => ({ ...l, label: l.label.trim() })) });
      toast.success("Services saved");
      onOpenChange(false);
      await onSaved();
    } catch (e) {
      toast.error(errorText(e, "Could not save the services."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) setLines(initial);
        onOpenChange(next);
      }}
    >
      <ActionDialogContent busy={busy} className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Services and price</DialogTitle>
          <DialogDescription>
            Pick the services for this {kind === "call_out" ? "call out" : "work"}. Each is priced from the rate card for the property, or add a custom service with its own name and
            price; switch off Charge for any that are free.{kind === "additional_work" ? " They are the quotation the client approves." : ""}
            {chargeable
              ? canMarkFree
                ? " This call out is chargeable: say why any line is free; it is kept in the history."
                : " This call out is chargeable: making a line free needs AMC Allowances (Approve) or the AMC approver right."
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="flex gap-2">
            <Select value={pick} onValueChange={add}>
              <SelectTrigger className="w-full" aria-label="Add a service">
                <SelectValue placeholder="Add a service…" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.serviceId} value={s.serviceId}>
                    {s.label}
                    {s.rate !== null ? ` · AED ${s.rate.toFixed(2)}${s.unit ? ` ${s.unit}` : ""}` : " · no rate on the card"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="shrink-0" onClick={addCustom}>
              <Plus className="size-4" />
              Custom service
            </Button>
          </div>
          {lines.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">No services yet: pick one above, or add a custom service.</p>
          ) : (
            <ul className="grid gap-2">
              {lines.map((l, i) => (
                <li key={i} className="grid gap-3 rounded-lg border px-4 py-3 sm:grid-cols-[1fr_90px_130px_auto_auto] sm:items-end">
                  {l.serviceId === null ? (
                    <div className="grid min-w-0 gap-1">
                      <Label className="text-xs" htmlFor={`custom-service-${i}`}>
                        Custom service
                      </Label>
                      <Input
                        id={`custom-service-${i}`}
                        value={l.label}
                        maxLength={300}
                        placeholder="What was done, e.g. Replace isolation valve"
                        aria-invalid={!l.label.trim()}
                        onChange={(e) => set(i, { label: e.target.value })}
                      />
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{l.label}</p>
                      <p className="text-muted-foreground text-xs">
                        {l.cardPrice !== null ? `Rate card AED ${l.cardPrice.toFixed(2)}${l.unit ? ` ${l.unit}` : ""}` : "No rate on the card: type the price"}
                      </p>
                    </div>
                  )}
                  <div className="grid gap-1">
                    <Label className="text-xs">Units</Label>
                    <Input type="number" min={1} step="1" value={l.units} onChange={(e) => set(i, { units: Math.max(0, Number(e.target.value) || 0) })} />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">Price (AED, ex VAT)</Label>
                    <Input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: Math.max(0, Number(e.target.value) || 0) })} />
                  </div>
                  <label
                    className="flex h-9 items-center gap-2 text-sm"
                    title={chargeable && !canMarkFree && l.charged ? "Making a line free needs AMC Allowances (Approve) or the AMC approver right." : undefined}
                  >
                    <Switch
                      checked={l.charged}
                      disabled={chargeable && !canMarkFree && l.charged}
                      onCheckedChange={(v) => set(i, { charged: v, ...(v ? { freeReason: null } : {}) })}
                      aria-label={`Charge ${l.label || "the custom service"}`}
                    />
                    {l.charged ? "Charge" : "Free"}
                  </label>
                  <Button size="icon" variant="ghost" className="text-destructive size-9" aria-label={`Remove ${l.label || "the custom service"}`} onClick={() => setLines((all) => all.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                  {freshFree.has(l) ? (
                    <div className="grid gap-1 sm:col-span-5">
                      <Label className="text-xs" htmlFor={`free-reason-${i}`}>
                        Why is it free?
                      </Label>
                      <Input
                        id={`free-reason-${i}`}
                        value={l.freeReason ?? ""}
                        maxLength={300}
                        placeholder="e.g. Goodwill: the first visit did not fix it"
                        aria-invalid={(l.freeReason ?? "").trim().length < 3}
                        onChange={(e) => set(i, { freeReason: e.target.value })}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>
                <Money value={totals.subtotal} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">VAT 5%</dt>
              <dd>
                <Money value={totals.vatAmount} />
              </dd>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <dt>Total</dt>
              <dd>
                <Money value={totals.total} />
              </dd>
            </div>
          </dl>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} pendingLabel="Saving…" disabled={unnamed || reasonMissing || lines.some((l) => !(l.units > 0))} icon={<Plus className="size-4" />} onClick={() => void save()}>
            Save services
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/** The one payment of a charge: the full amount, the day, how, and its reference. */
export function RecordChargePaymentDialog({
  open,
  onOpenChange,
  kind,
  id,
  charge,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: Kind;
  id: string;
  charge: VisitCharge;
  onSaved: () => void | Promise<void>;
}) {
  const [paidOn, setPaidOn] = useState(todayInDubai());
  const [mode, setMode] = useState<ChargePaymentMode>("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await post(kind, id, { action: "record_payment", amount: charge.total, paidOn, mode, reference: reference.trim() || null, note: note.trim() || null });
      toast.success("Payment recorded");
      onOpenChange(false);
      await onSaved();
    } catch (e) {
      toast.error(errorText(e, "Could not record the payment."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            {charge.ref ? `${charge.ref}: ` : ""}the full amount, <Money value={charge.total} className="font-medium" /> including VAT.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="charge-paid-on">Received on</Label>
              <DateSelect id="charge-paid-on" value={paidOn} onChange={setPaidOn} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="charge-mode">How</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as ChargePaymentMode)}>
                <SelectTrigger id="charge-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHARGE_PAYMENT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {CHARGE_PAYMENT_MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="charge-reference">Reference{mode === "cash" ? " (optional)" : ""}</Label>
            <Input id="charge-reference" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} placeholder={mode === "cash" ? "Receipt number" : "Transfer, card or cheque reference"} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="charge-note">Note (optional)</Label>
            <Textarea id="charge-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} pendingLabel="Saving…" disabled={!paidOn || (mode !== "cash" && !reference.trim())} icon={<Banknote className="size-4" />} onClick={() => void save()}>
            Record payment
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

const noop = () => undefined;
const chargeHref = (c: VisitCharge) =>
  c.kind === "call_out" ? `/extensions/amc-contracts/visits/${c.ownerId}?tab=services` : `/extensions/amc-contracts/additional-works/${c.ownerId}?tab=quotation`;

/**
 * The contract's Payments tab: its call outs' and additional works' charges,
 * as a table like Cheques and Receipts, with Record payment. Shown only once
 * there is a charge (18 Nov 2026).
 */
export function VisitChargesSection({ contractId, canRecord }: { contractId: string; canRecord: boolean }) {
  const { data, error, reload } = useAmcData(
    () => amcRequest<{ charges: VisitCharge[]; ready: boolean }>(`/api/amc-contracts/${encodeURIComponent(contractId)}/visit-charges`),
    `visit-charges|${contractId}`,
  );
  const router = useRouter();
  const [paying, setPaying] = useState<VisitCharge | null>(null);
  const charges = useMemo(() => data?.charges ?? [], [data]);
  const due = charges.filter((c) => c.status === "due").reduce((s, c) => s + c.total, 0);

  const columns = useMemo<ColumnDef<VisitCharge>[]>(
    () => [
      {
        id: "visit",
        header: "Visit",
        cell: ({ row }) => {
          const c = row.original;
          return (
            <a className="block text-sm hover:underline" href={chargeHref(c)} onClick={(e) => e.stopPropagation()}>
              <span className="font-medium">{c.ref ?? "—"}</span>
              <span className="text-muted-foreground block text-xs">{c.kind === "call_out" ? "Call out" : "Additional work"}</span>
            </a>
          );
        },
      },
      {
        id: "services",
        header: "Services",
        cell: ({ row }) => {
          const lines = row.original.lines;
          return (
            <span className="block max-w-[260px] truncate text-sm" title={lines.map((l) => l.label).join(", ")}>
              {lines.length ? lines.map((l) => l.label).join(", ") : "—"}
            </span>
          );
        },
      },
      { id: "status", header: "Status", cell: ({ row }) => <ChargeStatusBadges charge={row.original} /> },
      {
        id: "payment",
        header: "Payment",
        cell: ({ row }) => {
          const c = row.original;
          const text =
            c.status === "paid"
              ? `${c.paidOn ? formatContractDate(c.paidOn) : ""}${c.paymentMode ? ` · ${CHARGE_PAYMENT_MODE_LABELS[c.paymentMode]}` : ""}${c.paymentReference ? ` · ${c.paymentReference}` : ""}`
              : c.paymentTiming === "after_visit"
                ? `After the visit: ${c.paymentTimingReason ?? ""}`
                : c.paymentTiming === "before_visit"
                  ? "Before the visit"
                  : c.status === "due"
                    ? "Chosen at Start visit"
                    : "—";
          return (
            <span className="text-muted-foreground block max-w-[240px] truncate text-sm" title={text}>
              {text}
            </span>
          );
        },
      },
      { id: "amount", header: "Amount", cell: ({ row }) => <Money value={row.original.total} className="text-sm font-medium" /> },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) =>
          canRecord && row.original.status === "due" ? (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  setPaying(row.original);
                }}
              >
                <Banknote className="size-4" />
                Record payment
              </Button>
            </div>
          ) : null,
      },
    ],
    [canRecord],
  );

  /* Nothing to show until there is a charge (or the update is missing). */
  if (error) {
    return (
      <SectionCard icon={<ReceiptText />} title="Visit charges" bodyClassName="border-t">
        <div className="p-5">
          <ErrorState title="Could not load the visit charges" message={error} onRetry={reload} />
        </div>
      </SectionCard>
    );
  }
  if (!data || !data.ready || charges.length === 0) return null;
  return (
    <SectionCard
      icon={<ReceiptText />}
      title="Visit charges"
      description={`Call outs and additional work the client pays for, beside the instalments.${due > 0 ? ` To pay: AED ${due.toFixed(2)}.` : ""}`}
      bodyClassName="border-t"
    >
      <DataTable
        columns={columns}
        data={charges}
        /* The whole row opens the call out or the additional work (23 Nov 2026). */
        handleRowClick={(c) => router.push(chargeHref(c))}
        loading={false}
        rowCount={charges.length}
        pageSize={500}
        currentPage={0}
        onPageChange={noop}
        onPageSizeChange={noop}
        onGlobalFilterChange={noop}
      />
      {paying ? (
        <RecordChargePaymentDialog
          open={paying !== null}
          onOpenChange={(open) => !open && setPaying(null)}
          kind={paying.kind}
          id={paying.ownerId}
          charge={paying}
          onSaved={() => {
            setPaying(null);
            reload();
          }}
        />
      ) : null}
    </SectionCard>
  );
}
