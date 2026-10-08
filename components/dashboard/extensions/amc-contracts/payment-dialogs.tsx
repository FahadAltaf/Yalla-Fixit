"use client";

import { useState, type ReactNode } from "react";
import {
  Ban,
  Banknote,
  BellRing,
  CheckCheck,
  EllipsisVertical,
  ExternalLink,
  HandCoins,
  Landmark,
  Play,
  Replace,
  RotateCcw,
  Save,
  Undo2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { todayInDubai } from "@/lib/amc/contracts";
import { PAYMENT_MODE_LABELS } from "@/lib/amc/payments";
import {
  paymentsService,
  type ChequeRecord,
  type InstalmentRecord,
  type PaymentActionInput,
  type PaymentPermissions,
  type PaymentRecord,
} from "@/modules/amc-contracts/payments-service";

import { formatContractDate } from "./contract-status";
import { isSettled } from "./payment-status";

/**
 * Every AMC payment dialog (Phase 7), owned by whichever screen offers the
 * actions: a contract's Payments tab and header, or Finance's Payments
 * page, where each cheque belongs to a different contract. The dialogs
 * stay mounted and are opened by name with the contract they post to, so
 * they animate in and out like every other dialog in the product.
 */

type InstalmentTarget = Pick<InstalmentRecord, "id" | "instalmentNo" | "label" | "outstanding" | "total" | "dueDate" | "status">;
type ChequeTarget = Pick<ChequeRecord, "id" | "chequeNo" | "bank" | "amount" | "chequeDate" | "status">;
type PaymentTarget = Pick<PaymentRecord, "id" | "amount" | "mode" | "receivedOn">;

export type PaymentDialogRequest =
  | { kind: "record_payment" | "record_cheque" | "write_off" | "waive"; instalment: InstalmentTarget }
  | { kind: "cheque_deposit" | "cheque_clear" | "cheque_bounce" | "cheque_replace" | "cheque_return"; cheque: ChequeTarget }
  | { kind: "void_payment" | "handover"; payment: PaymentTarget }
  | { kind: "override_gate" };

type Kind = PaymentDialogRequest["kind"];
type Current = { contractId: string; request: PaymentDialogRequest };

export function usePaymentDialogs(onChanged: () => unknown) {
  /* Kept after a dialog closes, so it animates out with its content. */
  const [current, setCurrent] = useState<Current | null>(null);
  const [openKind, setOpenKind] = useState<Kind | null>(null);
  const [whatsapp, setWhatsapp] = useState<{ text: string; url: string } | null>(null);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [reminding, setReminding] = useState<string | null>(null);

  const open = (contractId: string, request: PaymentDialogRequest) => {
    setCurrent({ contractId, request });
    setOpenKind(request.kind);
  };
  const close = (next: boolean) => !next && setOpenKind(null);

  /* The dialog keeps its own pending state and shows a failure as a toast; this posts, reloads and closes. */
  const submit = async (action: PaymentActionInput, success: string) => {
    if (!current) return;
    await paymentsService.paymentAction(current.contractId, action);
    toast.success(success);
    await onChanged();
    setOpenKind(null);
  };

  /* Email 4 goes from the server; the WhatsApp text comes back for the coordinator to send. */
  const sendReminder = async (contractId: string, instalment: Pick<InstalmentRecord, "id" | "instalmentNo">) => {
    setReminding(instalment.id);
    try {
      const result = await paymentsService.paymentAction(contractId, { action: "send_reminder", instalmentId: instalment.id });
      if (result.outcome === "sent") toast.success(`Reminder emailed for instalment ${instalment.instalmentNo}`);
      else if (result.outcome === "failed") toast.error("The reminder email could not be sent. Try again, or send the WhatsApp message.");
      else toast.warning("The client has no email address, so no email was sent.");
      if (result.whatsapp) {
        setWhatsapp({ text: result.message ?? "", url: result.whatsapp });
        setWhatsappOpen(true);
      }
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the reminder.");
    } finally {
      setReminding(null);
    }
  };

  const request = current?.request;
  const instalment = request && "instalment" in request ? request.instalment : null;
  const cheque = request && "cheque" in request ? request.cheque : null;
  const payment = request && "payment" in request ? request.payment : null;
  const reasonKind = request && REASON_KINDS.includes(request.kind as ReasonKind) ? (request.kind as ReasonKind) : "write_off";

  const dialogs = (
    <>
      <RecordPaymentDialog open={openKind === "record_payment"} onOpenChange={close} instalment={instalment} submit={submit} />
      <ChequeDialog
        open={openKind === "record_cheque" || openKind === "cheque_replace"}
        onOpenChange={close}
        replacing={request?.kind === "cheque_replace" ? cheque : null}
        instalment={request?.kind === "record_cheque" ? instalment : null}
        submit={submit}
      />
      <ChequeDateDialog
        open={openKind === "cheque_deposit" || openKind === "cheque_clear"}
        onOpenChange={close}
        clearing={request?.kind === "cheque_clear"}
        cheque={cheque}
        submit={submit}
      />
      <BounceDialog open={openKind === "cheque_bounce"} onOpenChange={close} cheque={cheque} submit={submit} />
      <ReasonDialog
        open={openKind !== null && REASON_KINDS.includes(openKind as ReasonKind)}
        onOpenChange={close}
        kind={reasonKind}
        instalment={instalment}
        cheque={cheque}
        payment={payment}
        submit={submit}
      />
      <HandoverDialog open={openKind === "handover"} onOpenChange={close} payment={payment} submit={submit} />
      <WhatsappDialog open={whatsappOpen} onOpenChange={setWhatsappOpen} message={whatsapp} />
    </>
  );

  return { open, sendReminder, reminding, dialogs };
}

export type PaymentDialogs = ReturnType<typeof usePaymentDialogs>;

/* ------------------------------------------------------------------ */
/* Row actions                                                         */
/* ------------------------------------------------------------------ */

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8">
            <EllipsisVertical className="size-4" />
            <span className="sr-only">{label}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** What can be done to an instalment, by right; nothing at all once it is settled. */
export function InstalmentActions({
  contractId,
  instalment,
  permissions,
  dialogs,
}: {
  contractId: string;
  instalment: InstalmentRecord;
  permissions: PaymentPermissions;
  dialogs: PaymentDialogs;
}) {
  if (isSettled(instalment.status)) return null;
  const collect = permissions.canRecord && instalment.outstanding > 0;
  if (!permissions.canRecord && !permissions.canApprove) return null;
  return (
    <RowMenu label={`Actions for instalment ${instalment.instalmentNo}`}>
      {collect ? (
        <>
          <DropdownMenuItem onClick={() => dialogs.open(contractId, { kind: "record_payment", instalment })}>
            <Banknote className="size-4" />
            Record payment
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => dialogs.open(contractId, { kind: "record_cheque", instalment })}>
            <Landmark className="size-4" />
            Record cheque
          </DropdownMenuItem>
        </>
      ) : null}
      {permissions.canRecord ? (
        <DropdownMenuItem disabled={dialogs.reminding === instalment.id} onClick={() => void dialogs.sendReminder(contractId, instalment)}>
          <BellRing className="size-4" />
          {dialogs.reminding === instalment.id ? "Sending…" : "Send reminder"}
        </DropdownMenuItem>
      ) : null}
      {permissions.canApprove ? (
        <>
          {permissions.canRecord ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onClick={() => dialogs.open(contractId, { kind: "waive", instalment })}>
            <Undo2 className="size-4" />
            Waive
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => dialogs.open(contractId, { kind: "write_off", instalment })}>
            <XCircle className="size-4" />
            Write off
          </DropdownMenuItem>
        </>
      ) : null}
    </RowMenu>
  );
}

/**
 * A cheque's next steps follow its status: held is deposited, deposited
 * clears or bounces, and a held or bounced one can be replaced or handed
 * back. Bouncing, replacing and returning are Finance's (Edit).
 */
export function ChequeActions({
  contractId,
  cheque,
  permissions,
  dialogs,
}: {
  contractId: string;
  cheque: ChequeTarget;
  permissions: PaymentPermissions;
  dialogs: PaymentDialogs;
}) {
  const s = cheque.status;
  const items = [
    s === "held" && permissions.canRecord
      ? { key: "deposit", label: "Deposit", icon: <Landmark className="size-4" />, kind: "cheque_deposit" as const }
      : null,
    s === "deposited" && permissions.canRecord
      ? { key: "clear", label: "Clear", icon: <CheckCheck className="size-4" />, kind: "cheque_clear" as const }
      : null,
    (s === "held" || s === "deposited") && permissions.canEdit
      ? { key: "bounce", label: "Bounce", icon: <Ban className="size-4" />, kind: "cheque_bounce" as const, danger: true }
      : null,
    (s === "held" || s === "bounced") && permissions.canEdit
      ? { key: "replace", label: "Replace", icon: <Replace className="size-4" />, kind: "cheque_replace" as const }
      : null,
    (s === "held" || s === "bounced") && permissions.canEdit
      ? { key: "return", label: "Return", icon: <RotateCcw className="size-4" />, kind: "cheque_return" as const }
      : null,
  ].filter((item) => item !== null);
  if (items.length === 0) return null;
  return (
    <RowMenu label={`Actions for cheque ${cheque.chequeNo}`}>
      {items.map((item) => (
        <DropdownMenuItem
          key={item.key}
          variant={"danger" in item && item.danger ? "destructive" : "default"}
          onClick={() => dialogs.open(contractId, { kind: item.kind, cheque })}
        >
          {item.icon}
          {item.label}
        </DropdownMenuItem>
      ))}
    </RowMenu>
  );
}

/** A receipt: cash is handed over to Finance once; anything can be voided by Finance (Edit). */
export function ReceiptActions({
  contractId,
  payment,
  permissions,
  dialogs,
}: {
  contractId: string;
  payment: PaymentRecord;
  permissions: PaymentPermissions;
  dialogs: PaymentDialogs;
}) {
  if (payment.voidedAt) return null;
  const handover = payment.mode === "cash" && !payment.handedOverAt && permissions.canRecord;
  if (!handover && !permissions.canEdit) return null;
  return (
    <RowMenu label="Actions for this receipt">
      {handover ? (
        <DropdownMenuItem onClick={() => dialogs.open(contractId, { kind: "handover", payment })}>
          <HandCoins className="size-4" />
          Hand over
        </DropdownMenuItem>
      ) : null}
      {permissions.canEdit ? (
        <DropdownMenuItem variant="destructive" onClick={() => dialogs.open(contractId, { kind: "void_payment", payment })}>
          <XCircle className="size-4" />
          Void
        </DropdownMenuItem>
      ) : null}
    </RowMenu>
  );
}

/* ------------------------------------------------------------------ */
/* The dialogs                                                         */
/* ------------------------------------------------------------------ */

type Submit = (action: PaymentActionInput, success: string) => Promise<void>;
type BaseProps = { open: boolean; onOpenChange: (open: boolean) => void; submit: Submit };

/*
  Starts the form afresh each time its dialog opens. Done while rendering,
  not in an effect, so the first frame already shows the fresh form.
*/
function useResetOnOpen(open: boolean, reset: () => void) {
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) reset();
  }
}

/* One submit at a time: success closes (in submit), a failure is a toast and the dialog stays. */
function useSubmitting() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function Shell({
  open,
  onOpenChange,
  busy,
  title,
  description,
  footer,
  wide = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  title: string;
  description: string;
  footer: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className={wide ? "max-h-[88vh] overflow-y-auto sm:max-w-lg" : "sm:max-w-md"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {footer}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/** A positive amount with at most two decimals, as the route accepts. */
function amountOk(value: string): boolean {
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) && n > 0 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
}
const amountText = (n: number | undefined) => (n && n > 0 ? String(Math.round(n * 100) / 100) : "");
const orNull = (v: string) => (v.trim() ? v.trim() : null);

function RecordPaymentDialog({ open, onOpenChange, instalment, submit }: BaseProps & { instalment: InstalmentTarget | null }) {
  const [mode, setMode] = useState<"cash" | "transfer" | "link">("transfer");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(todayInDubai());
  const [reference, setReference] = useState("");
  const [valueDate, setValueDate] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [notes, setNotes] = useState("");
  const { busy, run } = useSubmitting();

  useResetOnOpen(open, () => {
    setMode("transfer");
    setAmount(amountText(instalment?.outstanding));
    setReceivedOn(todayInDubai());
    setReference("");
    setValueDate("");
    setReceiptNo("");
    setNotes("");
  });

  const needsReference = mode === "transfer" && !reference.trim();
  const ready = !!instalment && amountOk(amount) && !!receivedOn && !needsReference;
  const save = () =>
    run(() =>
      submit(
        {
          action: "record_payment",
          instalmentId: instalment!.id,
          mode,
          amount: Number(amount),
          receivedOn,
          reference: orNull(reference),
          valueDate: valueDate || null,
          receiptNo: orNull(receiptNo),
          notes: orNull(notes),
        },
        `Payment recorded against instalment ${instalment!.instalmentNo}`,
      ),
    );

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      wide
      title="Record payment"
      description={`Money received against instalment ${instalment?.instalmentNo ?? ""}${instalment?.label ? ` (${instalment.label})` : ""}. A part payment is fine.`}
      footer={
        <SubmitButton pending={busy} pendingLabel="Saving…" icon={<Save className="size-4" />} disabled={!ready} onClick={() => void save()}>
          Record payment
        </SubmitButton>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pay-mode" label="Mode">
          <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <SelectTrigger id="pay-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["cash", "transfer", "link"] as const).map((m) => (
                <SelectItem key={m} value={m}>
                  {PAYMENT_MODE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          id="pay-amount"
          label="Amount (AED)"
          hint={instalment ? <>Left to collect: <Money value={instalment.outstanding} /></> : undefined}
        >
          <Input id="pay-amount" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pay-received" label="Received on">
          <Input id="pay-received" type="date" max={todayInDubai()} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
        </Field>
        <Field id="pay-value-date" label="Value date (optional)">
          <Input id="pay-value-date" type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pay-ref" label={mode === "transfer" ? "Transfer reference" : "Reference (optional)"} hint={mode === "transfer" ? "Needed for a bank transfer." : undefined}>
          <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
        </Field>
        <Field id="pay-receipt" label="Receipt no. (optional)">
          <Input id="pay-receipt" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} maxLength={60} />
        </Field>
      </div>
      <Field id="pay-notes" label="Notes (optional)">
        <Textarea id="pay-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </Field>
    </Shell>
  );
}

/** A new cheque against an instalment, or one that replaces a held or bounced cheque. */
function ChequeDialog({
  open,
  onOpenChange,
  instalment,
  replacing,
  submit,
}: BaseProps & { instalment: InstalmentTarget | null; replacing: ChequeTarget | null }) {
  const [chequeNo, setChequeNo] = useState("");
  const [bank, setBank] = useState("");
  const [chequeDate, setChequeDate] = useState(todayInDubai());
  const [amount, setAmount] = useState("");
  const [custody, setCustody] = useState("");
  const { busy, run } = useSubmitting();

  useResetOnOpen(open, () => {
    setChequeNo("");
    setBank(replacing?.bank ?? "");
    setChequeDate(todayInDubai());
    setAmount(amountText(replacing ? replacing.amount : instalment?.outstanding));
    setCustody("");
  });

  const ready = (!!instalment || !!replacing) && chequeNo.trim().length > 0 && bank.trim().length >= 2 && !!chequeDate && amountOk(amount);
  const fields = { chequeNo: chequeNo.trim(), bank: bank.trim(), chequeDate, amount: Number(amount), custody: orNull(custody) };
  const save = () =>
    run(() =>
      replacing
        ? submit({ action: "cheque_replace", chequeId: replacing.id, ...fields }, `Cheque ${replacing.chequeNo} replaced`)
        : submit({ action: "record_cheque", instalmentId: instalment!.id, ...fields }, `Cheque recorded against instalment ${instalment!.instalmentNo}`),
    );

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={replacing ? "Replace cheque" : "Record cheque"}
      description={
        replacing
          ? `The new cheque takes the place of cheque ${replacing.chequeNo}, which is marked replaced.`
          : `A cheque for instalment ${instalment?.instalmentNo ?? ""}. It is held until it is deposited and clears.`
      }
      footer={
        <SubmitButton pending={busy} pendingLabel="Saving…" icon={<Save className="size-4" />} disabled={!ready} onClick={() => void save()}>
          {replacing ? "Replace cheque" : "Record cheque"}
        </SubmitButton>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="chq-no" label="Cheque no.">
          <Input id="chq-no" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} maxLength={40} />
        </Field>
        <Field id="chq-bank" label="Bank">
          <Input id="chq-bank" value={bank} onChange={(e) => setBank(e.target.value)} maxLength={120} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="chq-date" label="Cheque date">
          <Input id="chq-date" type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
        </Field>
        <Field id="chq-amount" label="Amount (AED)">
          <Input id="chq-amount" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <Field id="chq-custody" label="Kept by (optional)" hint="Who holds the cheque until it is deposited, e.g. the office safe.">
        <Input id="chq-custody" value={custody} onChange={(e) => setCustody(e.target.value)} maxLength={120} />
      </Field>
    </Shell>
  );
}

function ChequeDateDialog({ open, onOpenChange, clearing, cheque, submit }: BaseProps & { clearing: boolean; cheque: ChequeTarget | null }) {
  const [date, setDate] = useState(todayInDubai());
  const { busy, run } = useSubmitting();
  useResetOnOpen(open, () => setDate(todayInDubai()));

  const save = () =>
    run(() =>
      clearing
        ? submit({ action: "cheque_clear", chequeId: cheque!.id, clearedOn: date }, `Cheque ${cheque!.chequeNo} cleared`)
        : submit({ action: "cheque_deposit", chequeId: cheque!.id, depositedOn: date }, `Cheque ${cheque!.chequeNo} deposited`),
    );

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={clearing ? "Clear cheque" : "Deposit cheque"}
      description={
        clearing
          ? `Cheque ${cheque?.chequeNo ?? ""} has cleared: its amount is recorded as received against the instalment.`
          : `Cheque ${cheque?.chequeNo ?? ""} has gone to the bank. The instalment waits for it to clear.`
      }
      footer={
        <SubmitButton
          pending={busy}
          pendingLabel="Saving…"
          icon={clearing ? <CheckCheck className="size-4" /> : <Landmark className="size-4" />}
          disabled={!cheque || !date}
          onClick={() => void save()}
        >
          {clearing ? "Clear" : "Deposit"}
        </SubmitButton>
      }
    >
      {cheque ? (
        <p className="text-muted-foreground text-sm">
          {cheque.bank} · <Money value={cheque.amount} />
        </p>
      ) : null}
      <Field id="chq-when" label={clearing ? "Cleared on" : "Deposited on"}>
        <Input id="chq-when" type="date" max={todayInDubai()} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </Shell>
  );
}

function BounceDialog({ open, onOpenChange, cheque, submit }: BaseProps & { cheque: ChequeTarget | null }) {
  const [date, setDate] = useState(todayInDubai());
  const [reason, setReason] = useState("");
  const [charges, setCharges] = useState("");
  const { busy, run } = useSubmitting();

  useResetOnOpen(open, () => {
    setDate(todayInDubai());
    setReason("");
    setCharges("");
  });

  const chargesOk = charges.trim() === "" || (Number.isFinite(Number(charges)) && Number(charges) >= 0);
  const save = () =>
    run(() =>
      submit(
        {
          action: "cheque_bounce",
          chequeId: cheque!.id,
          bouncedOn: date,
          reason: reason.trim(),
          charges: charges.trim() === "" ? null : Number(charges),
        },
        `Cheque ${cheque!.chequeNo} marked bounced`,
      ),
    );

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title="Bounce cheque"
      description={`Cheque ${cheque?.chequeNo ?? ""} was returned unpaid. The instalment is open again and the owner is told.`}
      footer={
        <SubmitButton
          variant="destructive"
          pending={busy}
          pendingLabel="Saving…"
          icon={<Ban className="size-4" />}
          disabled={!cheque || !date || reason.trim().length < 3 || !chargesOk}
          onClick={() => void save()}
        >
          Mark bounced
        </SubmitButton>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="bnc-date" label="Bounced on">
          <Input id="bnc-date" type="date" max={todayInDubai()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="bnc-charges" label="Bank charges (optional)">
          <Input id="bnc-charges" type="number" inputMode="decimal" min={0} step="0.01" value={charges} onChange={(e) => setCharges(e.target.value)} />
        </Field>
      </div>
      <Field id="bnc-reason" label="Reason">
        <Textarea id="bnc-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Insufficient funds" />
      </Field>
    </Shell>
  );
}

const REASON_KINDS = ["cheque_return", "void_payment", "write_off", "waive", "override_gate"] as const;
type ReasonKind = (typeof REASON_KINDS)[number];

/** Every action that only needs a reason: what it does, and how it reads. */
function reasonCopy(
  kind: ReasonKind,
  t: { instalment: InstalmentTarget | null; cheque: ChequeTarget | null; payment: PaymentTarget | null },
): { title: string; description: ReactNode; button: string; success: string; danger: boolean; icon: ReactNode } {
  switch (kind) {
    case "cheque_return":
      return {
        title: "Return cheque",
        description: `Cheque ${t.cheque?.chequeNo ?? ""} is handed back to the client and no longer counts toward the instalment.`,
        button: "Return cheque",
        success: `Cheque ${t.cheque?.chequeNo ?? ""} returned`,
        danger: false,
        icon: <RotateCcw className="size-4" />,
      };
    case "void_payment":
      return {
        title: "Void receipt",
        description: (
          <>
            The payment of <Money value={t.payment?.amount} /> stops counting toward the instalment. It stays on record, struck through, with
            your reason.
          </>
        ),
        button: "Void receipt",
        success: "Receipt voided",
        danger: true,
        icon: <XCircle className="size-4" />,
      };
    case "write_off":
      return {
        title: `Write off instalment ${t.instalment?.instalmentNo ?? ""}`,
        description: (
          <>
            What is still owed (<Money value={t.instalment?.outstanding} />) is no longer collected. The reason is recorded.
          </>
        ),
        button: "Write off",
        success: `Instalment ${t.instalment?.instalmentNo ?? ""} written off`,
        danger: true,
        icon: <XCircle className="size-4" />,
      };
    case "waive":
      return {
        title: `Waive instalment ${t.instalment?.instalmentNo ?? ""}`,
        description: (
          <>
            The client does not have to pay what is left (<Money value={t.instalment?.outstanding} />). The reason is recorded.
          </>
        ),
        button: "Waive",
        success: `Instalment ${t.instalment?.instalmentNo ?? ""} waived`,
        danger: false,
        icon: <Undo2 className="size-4" />,
      };
    case "override_gate":
      return {
        title: "Start before payment",
        description:
          "The contract becomes active now and releases visits before the first instalment is received, on agreed credit terms. The reason is recorded.",
        button: "Start contract",
        success: "Contract started before the first payment",
        danger: false,
        icon: <Play className="size-4" />,
      };
  }
}

function ReasonDialog({
  open,
  onOpenChange,
  kind,
  instalment,
  cheque,
  payment,
  submit,
}: BaseProps & { kind: ReasonKind; instalment: InstalmentTarget | null; cheque: ChequeTarget | null; payment: PaymentTarget | null }) {
  const [reason, setReason] = useState("");
  const { busy, run } = useSubmitting();
  useResetOnOpen(open, () => setReason(""));

  const copy = reasonCopy(kind, { instalment, cheque, payment });
  const text = reason.trim();
  const action = (): PaymentActionInput | null => {
    switch (kind) {
      case "cheque_return":
        return cheque ? { action: "cheque_return", chequeId: cheque.id, reason: text } : null;
      case "void_payment":
        return payment ? { action: "void_payment", paymentId: payment.id, reason: text } : null;
      case "write_off":
      case "waive":
        return instalment ? { action: kind, instalmentId: instalment.id, reason: text } : null;
      case "override_gate":
        return { action: "override_gate", reason: text };
    }
  };
  const body = action();

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <Field id="pay-reason" label="Reason">
            <Textarea id="pay-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton
            variant={copy.danger ? "destructive" : "default"}
            pending={busy}
            pendingLabel="Saving…"
            icon={copy.icon}
            disabled={!body || text.length < 3}
            onClick={() => body && void run(() => submit(body, copy.success))}
          >
            {copy.button}
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function HandoverDialog({ open, onOpenChange, payment, submit }: BaseProps & { payment: PaymentTarget | null }) {
  const [to, setTo] = useState("");
  const { busy, run } = useSubmitting();
  useResetOnOpen(open, () => setTo(""));

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title="Hand over cash"
      description="Record who in Finance received this cash from the collector."
      footer={
        <SubmitButton
          pending={busy}
          pendingLabel="Saving…"
          icon={<HandCoins className="size-4" />}
          disabled={!payment || to.trim().length < 2}
          onClick={() => void run(() => submit({ action: "handover", paymentId: payment!.id, handedOverTo: to.trim() }, "Handover recorded"))}
        >
          Hand over
        </SubmitButton>
      }
    >
      {payment ? (
        <p className="text-muted-foreground text-sm">
          <Money value={payment.amount} /> in cash, received {formatContractDate(payment.receivedOn)}
        </p>
      ) : null}
      <Field id="handover-to" label="Handed to">
        <Input id="handover-to" value={to} onChange={(e) => setTo(e.target.value)} maxLength={120} placeholder="Name in Finance" />
      </Field>
    </Shell>
  );
}

/** The reminder's WhatsApp text, ready for the coordinator to send from their own phone. */
function WhatsappDialog({
  open,
  onOpenChange,
  message,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: { text: string; url: string } | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionDialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>WhatsApp message</DialogTitle>
          <DialogDescription>The reminder text is ready. Open WhatsApp to send it to the client.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <Textarea readOnly rows={8} value={message?.text ?? ""} aria-label="Prepared WhatsApp message" className="text-sm" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {message?.url ? (
            <Button asChild>
              <a href={message.url} target="_blank" rel="noreferrer" onClick={() => onOpenChange(false)}>
                <ExternalLink className="size-4" />
                Open WhatsApp
              </a>
            </Button>
          ) : null}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
