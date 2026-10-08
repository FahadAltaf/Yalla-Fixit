"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Banknote, CalendarClock, Database, Landmark, Play, ReceiptText, Wallet } from "lucide-react";
import { toast } from "sonner";

import { SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, SectionSkeleton, StatGridSkeleton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAYMENT_MODE_LABELS } from "@/lib/amc/payments";
import { paymentsService, type ContractPaymentsResponse } from "@/modules/amc-contracts/payments-service";

import { formatContractDate, formatDateTime } from "./contract-status";
import { ChequeActions, InstalmentActions, ReceiptActions, type PaymentDialogs } from "./payment-dialogs";
import { ChequeStatusBadge, DaysOverdue, InstalmentStatusBadge, isSettled } from "./payment-status";

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
          The payments tables are not on this database yet (migration 20261008100000). Ask an admin to apply it; until then no schedule is
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

      <SectionCard
        title="Instalments"
        description="The schedule made on activation. Status follows what is received and the due date."
        icon={<CalendarClock />}
        bodyClassName="pb-2"
      >
        <div className="overflow-x-auto">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 pl-5">#</TableHead>
                <TableHead>Instalment</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Overdue</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {instalments.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="pl-5 tabular-nums">{i.instalmentNo}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{i.label}</div>
                    {i.statusReason && (i.status === "written_off" || i.status === "waived") ? (
                      <div className="text-muted-foreground max-w-[260px] truncate text-xs">{i.statusReason}</div>
                    ) : i.reminderCount ? (
                      <div className="text-muted-foreground text-xs">
                        Reminded {i.reminderCount === 1 ? "once" : `${i.reminderCount} times`}
                        {i.lastReminderAt ? `, last ${formatDateTime(i.lastReminderAt)}` : ""}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{formatContractDate(i.dueDate)}</TableCell>
                  <TableCell className="text-right">
                    <Money value={i.total} className="text-sm" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={i.receivedAmount} className="text-sm" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={i.outstanding} className="text-sm font-medium" />
                  </TableCell>
                  <TableCell>
                    <InstalmentStatusBadge status={i.status} />
                  </TableCell>
                  <TableCell className="text-sm">
                    <DaysOverdue days={i.daysOverdue} />
                  </TableCell>
                  <TableCell className="pr-5">
                    <InstalmentActions contractId={contractId} instalment={i} permissions={permissions} dialogs={dialogs} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>

      <SectionCard
        title="Cheques"
        description="Held until deposited, then cleared into the instalment or bounced."
        icon={<Landmark />}
        bodyClassName={cheques.length ? "pb-2" : "px-5 pb-5"}
      >
        {cheques.length === 0 ? (
          <p className="text-muted-foreground text-sm">No cheques recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Cheque no.</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Instalment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Bounce reason</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cheques.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="pl-5 text-sm font-medium tabular-nums">{c.chequeNo}</TableCell>
                    <TableCell className="text-sm">{c.bank}</TableCell>
                    <TableCell className="text-sm tabular-nums">{formatContractDate(c.chequeDate)}</TableCell>
                    <TableCell className="text-right">
                      <Money value={c.amount} className="text-sm" />
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{instalmentNo(c.instalmentId) ?? "—"}</TableCell>
                    <TableCell>
                      <ChequeStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="max-w-[220px] text-sm">
                      {c.bounceReason ? (
                        <>
                          <span className="line-clamp-2">{c.bounceReason}</span>
                          {c.bounceCharges ? (
                            <span className="text-muted-foreground text-xs">
                              Charges <Money value={c.bounceCharges} />
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-5">
                      <ChequeActions contractId={contractId} cheque={c} permissions={permissions} dialogs={dialogs} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Receipts"
        description="Every payment received, newest first. A voided one stays on record with its reason."
        icon={<ReceiptText />}
        bodyClassName={receipts.length ? "pb-2" : "px-5 pb-5"}
      >
        {receipts.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing received yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Received</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Reference / receipt</TableHead>
                  <TableHead>Collected by</TableHead>
                  <TableHead>Handed over</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((p) => {
                  const voided = Boolean(p.voidedAt);
                  const struck = voided ? "text-muted-foreground line-through" : "";
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="pl-5 text-sm">
                        <div className={`tabular-nums ${struck}`}>{formatContractDate(p.receivedOn)}</div>
                        <div className="text-muted-foreground text-xs">
                          {voided ? `Void: ${p.voidReason ?? "no reason given"}` : `Instalment ${instalmentNo(p.instalmentId) ?? "—"}`}
                        </div>
                      </TableCell>
                      <TableCell className={`text-sm ${struck}`}>{PAYMENT_MODE_LABELS[p.mode] ?? p.mode}</TableCell>
                      <TableCell className="text-right">
                        <Money value={p.amount} className={`text-sm font-medium ${struck}`} />
                      </TableCell>
                      <TableCell className={`text-sm ${struck}`}>
                        {[p.reference, p.receiptNo ? `Receipt ${p.receiptNo}` : null].filter(Boolean).join(" · ") || "—"}
                      </TableCell>
                      <TableCell className={`text-sm ${struck}`}>{p.collectorName ?? "—"}</TableCell>
                      <TableCell className={`text-sm ${struck}`}>
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
                      </TableCell>
                      <TableCell className={`text-sm ${struck}`}>{p.recordedByName ?? "—"}</TableCell>
                      <TableCell className="pr-5">
                        <ReceiptActions contractId={contractId} payment={p} permissions={permissions} dialogs={dialogs} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
      {confirmDialog}
    </>
  );
}
