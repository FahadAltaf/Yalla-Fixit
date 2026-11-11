"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Banknote, CalendarClock, Database, Landmark, Play, ReceiptText, Wallet } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, SectionSkeleton, StatGridSkeleton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAYMENT_MODE_LABELS, PAYMENT_MODES, type PaymentMode } from "@/lib/amc/payments";
import { cn } from "@/lib/utils";
import { paymentsService, type ContractPaymentsResponse, type InstalmentRecord } from "@/modules/amc-contracts/payments-service";

import { formatContractDate, formatDateTime } from "./contract-status";
import { ChequeActions, InstalmentActions, ReceiptActions, type PaymentDialogs } from "./payment-dialogs";
import { ChequeStatusBadge, DaysOverdue, InstalmentStatusBadge, isSettled } from "./payment-status";
import { TruncatedText } from "@/components/ui/truncated-text";

/**
 * A contract's payments (Phase 7), loaded by the contract page itself so
 * its header (Record payment while it waits for the first instalment) and
 * the Payments tab read the same figures. A failed refresh keeps what is
 * on screen; only a first load shows the error.
 */
export function useContractPayments(contractId: string, enabled: boolean) {
  const [data, setData] = useState<ContractPaymentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const ticket = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const mine = ++ticket.current;
    setLoading(true);
    try {
      const next = await paymentsService.contractPayments(contractId);
      if (mine !== ticket.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the payments.");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [contractId, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

export type ContractPaymentsState = ReturnType<typeof useContractPayments>;

/** Instalments still expecting money: the Payments tab's count. */
export const openInstalmentCount = (data: ContractPaymentsResponse | null) =>
  data ? data.instalments.filter((i) => !isSettled(i.status)).length : 0;

/* A contract activated before payments existed has no schedule; Finance makes it (the route checks too). */
const SCHEDULABLE = ["active", "on_hold"];

const NOT_SET = "__none";

/**
 * How an instalment is expected to be paid (BRD 5.8). Whoever records
 * payments changes it in place while something is still owed; otherwise it
 * reads as text.
 */
function ExpectedModeCell({
  contractId,
  instalment,
  editable,
  onSaved,
}: {
  contractId: string;
  instalment: InstalmentRecord;
  editable: boolean;
  onSaved: () => unknown;
}) {
  const [saving, setSaving] = useState(false);
  const current = instalment.expectedMode;
  if (!editable || isSettled(instalment.status)) {
    return <span className={current ? "text-sm" : "text-muted-foreground text-sm"}>{current ? PAYMENT_MODE_LABELS[current] : "—"}</span>;
  }
  const change = async (value: string) => {
    const mode = value === NOT_SET ? null : (value as PaymentMode);
    if (mode === current) return;
    setSaving(true);
    try {
      await paymentsService.paymentAction(contractId, { action: "set_expected_mode", instalmentId: instalment.id, mode });
      toast.success(
        mode
          ? `Instalment ${instalment.instalmentNo} expected by ${PAYMENT_MODE_LABELS[mode].toLowerCase()}`
          : `Instalment ${instalment.instalmentNo}: expected mode cleared`,
      );
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the expected mode.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Select value={current ?? NOT_SET} onValueChange={(v) => void change(v)} disabled={saving}>
      <SelectTrigger size="sm" className="w-[150px]" aria-label={`Expected mode for instalment ${instalment.instalmentNo}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOT_SET}>Not set</SelectItem>
        {PAYMENT_MODES.map((m) => (
          <SelectItem key={m} value={m}>
            {PAYMENT_MODE_LABELS[m]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type ChequeRecord = ContractPaymentsResponse["cheques"][number];
type ReceiptRecord = ContractPaymentsResponse["payments"][number];

type PanelContext = {
  contractId: string;
  permissions: ContractPaymentsResponse["permissions"];
  dialogs: PaymentDialogs;
  reload: () => unknown;
  instalmentNo: (id: string) => InstalmentRecord["instalmentNo"] | undefined;
};

/*
 * What the table cells need from the panel. Read from a context rather than
 * closed over, so the columns below never change: a new column list would
 * remount every cell, closing an open row menu or a saving mode select
 * whenever the panel re-renders.
 */
const PanelCtx = createContext<PanelContext | null>(null);

function usePanel() {
  const ctx = useContext(PanelCtx);
  if (!ctx) throw new Error("A payments table cell must sit inside ContractPaymentsPanel.");
  return ctx;
}

function InstalmentModeCell({ instalment }: { instalment: InstalmentRecord }) {
  const { contractId, permissions, reload } = usePanel();
  return <ExpectedModeCell contractId={contractId} instalment={instalment} editable={permissions.canRecord} onSaved={reload} />;
}

function InstalmentActionsCell({ instalment }: { instalment: InstalmentRecord }) {
  const { contractId, permissions, dialogs } = usePanel();
  return <InstalmentActions contractId={contractId} instalment={instalment} permissions={permissions} dialogs={dialogs} />;
}

function ChequeInstalmentCell({ cheque }: { cheque: ChequeRecord }) {
  const { instalmentNo } = usePanel();
  return <span className="text-sm tabular-nums">{instalmentNo(cheque.instalmentId) ?? "—"}</span>;
}

function ChequeActionsCell({ cheque }: { cheque: ChequeRecord }) {
  const { contractId, permissions, dialogs } = usePanel();
  return <ChequeActions contractId={contractId} cheque={cheque} permissions={permissions} dialogs={dialogs} />;
}

/* A voided receipt stays on the list, struck through. */
const struckClass = (p: ReceiptRecord) => (p.voidedAt ? "text-muted-foreground line-through" : "");

function ReceiptReceivedCell({ payment: p }: { payment: ReceiptRecord }) {
  const { instalmentNo } = usePanel();
  return (
    <div className="text-sm">
      <div className={cn("tabular-nums", struckClass(p))}>{formatContractDate(p.receivedOn)}</div>
      <div className="text-muted-foreground text-xs">
        {p.voidedAt ? `Void: ${p.voidReason ?? "no reason given"}` : `Instalment ${instalmentNo(p.instalmentId) ?? "—"}`}
      </div>
    </div>
  );
}

function ReceiptActionsCell({ payment }: { payment: ReceiptRecord }) {
  const { contractId, permissions, dialogs } = usePanel();
  return <ReceiptActions contractId={contractId} payment={payment} permissions={permissions} dialogs={dialogs} />;
}

const actionsHeader = () => <span className="sr-only">Actions</span>;

const INSTALMENT_COLUMNS: ColumnDef<InstalmentRecord>[] = [
  { id: "no", header: "#", size: 48, cell: ({ row }) => <span className="tabular-nums">{row.original.instalmentNo}</span> },
  {
    id: "instalment",
    header: "Instalment",
    cell: ({ row }) => {
      const i = row.original;
      /* A write-off or waiver says why; otherwise how often the client was reminded. */
      const subtitle =
        i.statusReason && (i.status === "written_off" || i.status === "waived")
          ? i.statusReason
          : i.reminderCount
            ? `Reminded ${i.reminderCount === 1 ? "once" : `${i.reminderCount} times`}${i.lastReminderAt ? `, last ${formatDateTime(i.lastReminderAt)}` : ""}`
            : null;
      return <IdentityCell title={i.label} subtitle={subtitle} icon={CalendarClock} />;
    },
  },
  { id: "due", header: "Due", cell: ({ row }) => <span className="text-sm tabular-nums">{formatContractDate(row.original.dueDate)}</span> },
  { id: "mode", header: "Expected mode", cell: ({ row }) => <InstalmentModeCell instalment={row.original} /> },
  { id: "total", header: "Total", cell: ({ row }) => <Money value={row.original.total} className="text-sm" /> },
  { id: "received", header: "Received", cell: ({ row }) => <Money value={row.original.receivedAmount} className="text-sm" /> },
  { id: "outstanding", header: "Outstanding", cell: ({ row }) => <Money value={row.original.outstanding} className="text-sm font-medium" /> },
  { id: "status", header: "Status", cell: ({ row }) => <InstalmentStatusBadge status={row.original.status} /> },
  {
    id: "overdue",
    header: "Overdue",
    cell: ({ row }) => (
      <span className="text-sm">
        <DaysOverdue days={row.original.daysOverdue} />
      </span>
    ),
  },
  { id: "actions", header: actionsHeader, cell: ({ row }) => <InstalmentActionsCell instalment={row.original} /> },
];

const CHEQUE_COLUMNS: ColumnDef<ChequeRecord>[] = [
  { id: "no", header: "Cheque no.", cell: ({ row }) => <IdentityCell title={row.original.chequeNo} icon={Landmark} /> },
  { id: "bank", header: "Bank", cell: ({ row }) => <span className="text-sm">{row.original.bank}</span> },
  { id: "date", header: "Date", cell: ({ row }) => <span className="text-sm tabular-nums">{formatContractDate(row.original.chequeDate)}</span> },
  { id: "amount", header: "Amount", cell: ({ row }) => <Money value={row.original.amount} className="text-sm" /> },
  { id: "instalment", header: "Instalment", cell: ({ row }) => <ChequeInstalmentCell cheque={row.original} /> },
  { id: "status", header: "Status", cell: ({ row }) => <ChequeStatusBadge status={row.original.status} /> },
  {
    id: "bounce",
    header: "Bounce reason",
    cell: ({ row }) => {
      const c = row.original;
      return (
        <div className="max-w-[220px] text-sm">
          {c.bounceReason ? (
            <>
              <TruncatedText>{c.bounceReason}</TruncatedText>
              {c.bounceCharges ? (
                <span className="text-muted-foreground text-xs">
                  Charges <Money value={c.bounceCharges} />
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      );
    },
  },
  { id: "actions", header: actionsHeader, cell: ({ row }) => <ChequeActionsCell cheque={row.original} /> },
];

const RECEIPT_COLUMNS: ColumnDef<ReceiptRecord>[] = [
  { id: "received", header: "Received", cell: ({ row }) => <ReceiptReceivedCell payment={row.original} /> },
  {
    id: "mode",
    header: "Mode",
    cell: ({ row }) => <span className={cn("text-sm", struckClass(row.original))}>{PAYMENT_MODE_LABELS[row.original.mode] ?? row.original.mode}</span>,
  },
  {
    id: "amount",
    header: "Amount",
    cell: ({ row }) => <Money value={row.original.amount} className={cn("text-sm font-medium", struckClass(row.original))} />,
  },
  {
    id: "reference",
    header: "Reference / receipt",
    cell: ({ row }) => {
      const p = row.original;
      return (
        <span className={cn("text-sm", struckClass(p))}>
          {[p.reference, p.receiptNo ? `Receipt ${p.receiptNo}` : null].filter(Boolean).join(" · ") || "—"}
        </span>
      );
    },
  },
  {
    id: "collector",
    header: "Collected by",
    cell: ({ row }) => <span className={cn("text-sm", struckClass(row.original))}>{row.original.collectorName ?? "—"}</span>,
  },
  {
    id: "handover",
    header: "Handed over",
    cell: ({ row }) => {
      const p = row.original;
      return (
        <div className={cn("text-sm", struckClass(p))}>
          {p.handedOverAt ? (
            <>
              <div>{p.handedOverTo ?? "Handed over"}</div>
              <div className="text-muted-foreground text-xs">{formatDateTime(p.handedOverAt)}</div>
            </>
          ) : p.mode === "cash" ? (
            <span className="text-warning">Not yet</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      );
    },
  },
  {
    id: "recorder",
    header: "Recorded by",
    cell: ({ row }) => <span className={cn("text-sm", struckClass(row.original))}>{row.original.recordedByName ?? "—"}</span>,
  },
  { id: "actions", header: actionsHeader, cell: ({ row }) => <ReceiptActionsCell payment={row.original} /> },
];

const noop = () => undefined;

export function ContractPaymentsPanel({
  contractId,
  contractStatus,
  payments,
  dialogs,
  onChanged,
}: {
  contractId: string;
  contractStatus: string;
  payments: ContractPaymentsState;
  dialogs: PaymentDialogs;
  /* After the schedule is made: the contract and its payments both move. */
  onChanged: () => unknown;
}) {
  const { data, error, loading, reload } = payments;
  const { confirm, dialog: confirmDialog } = useConfirm();

  if (!data && loading) {
    return (
      <>
        <StatGridSkeleton count={4} />
        <SectionSkeleton />
      </>
    );
  }
  if (!data) {
    return <ErrorState title="Could not load the payments" message={error} onRetry={() => void reload()} retrying={loading} />;
  }
  if (!data.migrated) {
    return (
      <Alert className="border-warning/30 bg-warning/5 items-start p-4">
        <Database className="text-warning" />
        <AlertTitle>Payments need a database update</AlertTitle>
        <AlertDescription>
          The payments tables are not on this database yet (migration 20261008100100). Ask an admin to apply it; until then no schedule is
          made and nothing can be recorded.
        </AlertDescription>
      </Alert>
    );
  }

  const { summary, instalments, cheques, payments: receipts, gate, permissions } = data;
  const first = gate.firstInstalment;
  const instalmentNo = (id: string) => instalments.find((i) => i.id === id)?.instalmentNo;

  const makeSchedule = () =>
    void confirm({
      title: "Make the payment schedule?",
      description: "The instalments are made from the contract's payment plan, commencement date and term. Nothing is sent to the client.",
      confirmText: "Make schedule",
      action: async () => {
        await paymentsService.paymentAction(contractId, { action: "generate_schedule" });
        toast.success("Payment schedule made");
        await onChanged();
      },
    });

  if (instalments.length === 0) {
    const canMake = SCHEDULABLE.includes(contractStatus) && permissions.canEdit;
    return (
      <>
        <Card className="p-0">
          <EmptyState
            icon={<Wallet className="size-5" />}
            title="No payment schedule"
            description={
              canMake
                ? "This contract was activated before payments were tracked. Make its schedule from the payment plan, commencement date and term."
                : SCHEDULABLE.includes(contractStatus)
                  ? "This contract has no payment schedule. Finance (AMC Payments, Edit) can make one."
                  : "The schedule is made when the contract is activated, from the payment plan agreed in the proposal."
            }
            action={canMake ? { label: "Make payment schedule", onClick: makeSchedule } : undefined}
          />
        </Card>
        {confirmDialog}
      </>
    );
  }

  const receivedShare = summary.billed > 0 ? Math.round((summary.received / summary.billed) * 100) : 0;
  const nextDue = instalments.find((i) => !isSettled(i.status) && i.outstanding > 0);

  return (
    <>
      <StatCardGrid columns={4}>
        <StatCard
          label="Billed"
          value={<Money value={summary.billed} className="text-xl" />}
          headline={`${instalments.length} ${instalments.length === 1 ? "instalment" : "instalments"}, incl. VAT`}
        />
        <StatCard
          label="Received"
          value={<Money value={summary.received} className="text-xl" />}
          headline={`${receivedShare}% of billed`}
          tone={summary.billed > 0 && summary.received >= summary.billed ? "good" : "neutral"}
        />
        <StatCard
          label="Outstanding"
          value={<Money value={summary.outstanding} className="text-xl" />}
          headline={nextDue ? `Next: instalment ${nextDue.instalmentNo}, due ${formatContractDate(nextDue.dueDate)}` : "Nothing left to collect"}
          tone={summary.outstanding > 0 ? "progress" : "good"}
        />
        <StatCard
          label="Overdue"
          value={<Money value={summary.overdue} className="text-xl" />}
          headline={summary.overdueCount ? `${summary.overdueCount} ${summary.overdueCount === 1 ? "instalment" : "instalments"} late` : "Nothing late"}
          tone={summary.overdueCount ? "bad" : "neutral"}
        />
      </StatCardGrid>

      {gate.pending && first ? (
        <div className="border-warning/30 bg-warning/5 flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4">
          <div className="min-w-0">
            <p className="text-warning text-sm font-medium">Waiting for the first instalment</p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              <Money value={first.outstanding || first.total} />, due {formatContractDate(first.dueDate)}. No visits are released until it is received.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {permissions.canApprove ? (
              <Button variant="outline" onClick={() => dialogs.open(contractId, { kind: "override_gate" })}>
                <Play className="size-4" />
                Start before payment
              </Button>
            ) : null}
            {permissions.canRecord && first.outstanding > 0 ? (
              <Button onClick={() => dialogs.open(contractId, { kind: "record_payment", instalment: first })}>
                <Banknote className="size-4" />
                Record payment
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {gate.override ? (
        <div className="bg-muted/40 text-muted-foreground rounded-xl border px-5 py-3 text-sm">
          Started before the first payment{gate.override.by ? ` by ${gate.override.by}` : ""} on {formatDateTime(gate.override.at)}
          {gate.override.reason ? ` — ${gate.override.reason}` : ""}
        </div>
      ) : null}

      <PanelCtx.Provider value={{ contractId, permissions, dialogs, reload, instalmentNo }}>
        <SectionCard
          title="Instalments"
          description="The schedule made on activation. Status follows what is received and the due date."
          icon={<CalendarClock />}
          bodyClassName="border-t"
        >
          <DataTable
            columns={INSTALMENT_COLUMNS}
            data={instalments}
            loading={false}
            rowCount={instalments.length}
            pageSize={500}
            currentPage={0}
            onPageChange={noop}
            onPageSizeChange={noop}
            onGlobalFilterChange={noop}
          />
        </SectionCard>

        <SectionCard
          title="Cheques"
          description="Held until deposited, then cleared into the instalment or bounced."
          icon={<Landmark />}
          bodyClassName="border-t"
        >
          <DataTable
            columns={CHEQUE_COLUMNS}
            data={cheques}
            loading={false}
            rowCount={cheques.length}
            pageSize={500}
            currentPage={0}
            onPageChange={noop}
            onPageSizeChange={noop}
            onGlobalFilterChange={noop}
            emptyState={
              <EmptyState
                icon={<Landmark />}
                title="No cheques recorded"
                description="Cheques recorded against this contract's instalments appear here."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Receipts"
          description="Every payment received, newest first. A voided one stays on record with its reason."
          icon={<ReceiptText />}
          bodyClassName="border-t"
        >
          <DataTable
            columns={RECEIPT_COLUMNS}
            data={receipts}
            loading={false}
            rowCount={receipts.length}
            pageSize={500}
            currentPage={0}
            onPageChange={noop}
            onPageSizeChange={noop}
            onGlobalFilterChange={noop}
            emptyState={
              <EmptyState icon={<ReceiptText />} title="Nothing received yet" description="Payments recorded on this contract appear here." />
            }
          />
        </SectionCard>
      </PanelCtx.Provider>
      {confirmDialog}
    </>
  );
}
