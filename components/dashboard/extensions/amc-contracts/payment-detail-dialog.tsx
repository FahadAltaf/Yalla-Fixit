"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Building2, CalendarClock, ChevronDown, ExternalLink, FileSignature, Landmark, ReceiptText, UserRound } from "lucide-react";

import { ActionDialogContent, ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { PAYMENT_MODE_LABELS } from "@/lib/amc/payments";
import { todayInDubai } from "@/lib/amc/contracts";
import { daysBetween } from "@/lib/amc/ppm";
import { cn } from "@/lib/utils";
import { paymentsService, type ContractPaymentsResponse } from "@/modules/amc-contracts/payments-service";

import { formatContractDate } from "./contract-status";
import { chequeActionItems, instalmentActionItems, type PaymentActionItem, type PaymentDialogs } from "./payment-dialogs";
import { ChequeStatusBadge, InstalmentStatusBadge } from "./payment-status";

/** What a row of Finance's Payments page opens (23 Nov 2026). */
export interface PaymentDetailTarget {
  kind: "instalment" | "cheque";
  id: string;
  contractId: string;
  /** "Instalment 2", "Cheque 004512". */
  ref: string;
  client: string;
  contractNumber: string | null;
  property: string | null;
}

const contractHref = (contractId: string) => `/extensions/amc-contracts/${contractId}?tab=payments`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" }) : null);

/** "In 30 days", "Today", "12 days late" against today in Dubai. */
function dueWords(dueDate: string, settled: boolean): { text: string; tone: "late" | "soon" | "calm" } | null {
  if (settled) return null;
  const days = daysBetween(todayInDubai(), dueDate);
  if (days < 0) return { text: `${-days} ${days === -1 ? "day" : "days"} late`, tone: "late" };
  if (days === 0) return { text: "Due today", tone: "soon" };
  return { text: `In ${days} ${days === 1 ? "day" : "days"}`, tone: days <= 7 ? "soon" : "calm" };
}

/**
 * One instalment or cheque from Finance's Payments page, in a pop-up
 * (23 Nov 2026): who and what it is, the money as three figures with how
 * much is in, its details, what was received against it, the same actions
 * as the contract's Payments tab (by the contract's own rights: the main
 * one as a button, the rest under More), and the way to the contract. An
 * action closes the pop-up and opens its own dialog.
 */
export function PaymentDetailDialog({
  target,
  onOpenChange,
  dialogs,
  version,
}: {
  target: PaymentDetailTarget | null;
  onOpenChange: (open: boolean) => void;
  dialogs: PaymentDialogs;
  /** Bumped after an action, so the pop-up reads again when reopened. */
  version: number;
}) {
  const [data, setData] = useState<{ key: string; payments: ContractPaymentsResponse } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const contractId = target?.contractId ?? null;
  const key = `${contractId}:${version}`;

  useEffect(() => {
    if (!contractId) return;
    let live = true;
    paymentsService.contractPayments(contractId).then(
      (payments) => live && setData({ key, payments }),
      (e) => live && setFailure({ key, message: e instanceof Error ? e.message : "Could not load the payments." }),
    );
    return () => {
      live = false;
    };
  }, [contractId, key]);

  const payments = data?.key === key ? data.payments : null;
  const error = failure?.key === key ? failure.message : null;
  const act = (item: PaymentActionItem) => () => {
    onOpenChange(false);
    item.onSelect();
  };

  let status: ReactNode = null;
  let body: ReactNode;
  let actions: PaymentActionItem[] = [];
  if (error) body = <ErrorState title="Could not load the payment" message={error} />;
  else if (!payments || !target) body = <LoadingBody />;
  else if (target.kind === "instalment") {
    const i = payments.instalments.find((x) => x.id === target.id);
    if (!i) body = <Missing what="instalment" />;
    else {
      actions = instalmentActionItems(target.contractId, i, payments.permissions, dialogs);
      status = <InstalmentStatusBadge status={i.status} />;
      const receipts = payments.payments.filter((p) => p.instalmentId === i.id);
      const cheques = payments.cheques.filter((c) => c.instalmentId === i.id);
      const settled = i.outstanding <= 0 || ["received", "written_off", "waived"].includes(i.status);
      const due = dueWords(i.dueDate, settled);
      const share = i.total > 0 ? Math.min(100, Math.round((i.receivedAmount / i.total) * 100)) : 0;
      body = (
        <div className="grid gap-5">
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              <Figure label="Total" hint="incl. VAT">
                <Money value={i.total} />
              </Figure>
              <Figure label="Received" hint={i.receivedDate ? `on ${formatContractDate(i.receivedDate)}` : `${share}% in`}>
                <Money value={i.receivedAmount} />
              </Figure>
              <Figure label="Outstanding" hint={due?.text ?? (settled ? "Nothing left" : null)} tone={due?.tone === "late" ? "bad" : i.outstanding > 0 ? "main" : "good"}>
                <Money value={i.outstanding} />
              </Figure>
            </div>
            <div className="bg-muted h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100} aria-label="Received">
              <div className={cn("h-full rounded-full", share >= 100 ? "bg-success" : "bg-brand")} style={{ width: `${share}%` }} />
            </div>
          </div>

          <Details>
            <Detail label="Due date">
              {formatContractDate(i.dueDate)}
              {due ? <span className={cn("ml-1.5 text-xs", due.tone === "late" ? "text-danger" : due.tone === "soon" ? "text-warning" : "text-muted-foreground")}>({due.text})</span> : null}
            </Detail>
            <Detail label="Expected mode">{i.expectedMode ? PAYMENT_MODE_LABELS[i.expectedMode] : <Muted>Not set</Muted>}</Detail>
            <Detail label="Before VAT">
              <Money value={i.amount} />
            </Detail>
            <Detail label="VAT">
              <Money value={i.vatAmount} />
            </Detail>
            <Detail label="Reminders">
              {i.reminderCount ? `${i.reminderCount === 1 ? "Once" : `${i.reminderCount} times`}${i.lastReminderAt ? `, last ${when(i.lastReminderAt)}` : ""}` : <Muted>None sent</Muted>}
            </Detail>
            <Detail label="Last reference">{i.lastReference ?? <Muted>None</Muted>}</Detail>
            {i.statusReason ? (
              <Detail label="Reason" wide>
                {i.statusReason}
              </Detail>
            ) : null}
          </Details>

          <Section icon={<ReceiptText className="size-4" />} title="Payments received" count={receipts.length} empty="Nothing received against this instalment yet.">
            {receipts.map((p) => (
              <Line
                key={p.id}
                struck={Boolean(p.voidedAt)}
                main={`${PAYMENT_MODE_LABELS[p.mode] ?? p.mode}${p.receiptNo ? ` · Receipt ${p.receiptNo}` : ""}`}
                sub={[formatContractDate(p.receivedOn), p.reference, p.voidedAt ? `Void: ${p.voidReason ?? "no reason"}` : null].filter(Boolean).join(" · ")}
                end={<Money value={p.amount} className="font-medium" />}
              />
            ))}
          </Section>
          {cheques.length ? (
            <Section icon={<Landmark className="size-4" />} title="Cheques" count={cheques.length} empty="">
              {cheques.map((c) => (
                <Line
                  key={c.id}
                  main={`Cheque ${c.chequeNo}`}
                  sub={[c.bank, formatContractDate(c.chequeDate)].filter(Boolean).join(" · ")}
                  end={
                    <span className="flex items-center gap-2">
                      <Money value={c.amount} className="font-medium" />
                      <ChequeStatusBadge status={c.status} />
                    </span>
                  }
                />
              ))}
            </Section>
          ) : null}
        </div>
      );
    }
  } else {
    const c = payments.cheques.find((x) => x.id === target.id);
    if (!c) body = <Missing what="cheque" />;
    else {
      actions = chequeActionItems(target.contractId, c, payments.permissions, dialogs);
      status = <ChequeStatusBadge status={c.status} />;
      const instalment = payments.instalments.find((x) => x.id === c.instalmentId);
      body = (
        <div className="grid gap-5">
          <div className="grid grid-cols-3 gap-3">
            <Figure label="Amount" tone="main">
              <Money value={c.amount} />
            </Figure>
            <Figure label="Cheque date">{formatContractDate(c.chequeDate)}</Figure>
            <Figure label="For" hint={instalment ? `due ${formatContractDate(instalment.dueDate)}` : null}>
              {instalment ? `Instalment ${instalment.instalmentNo}` : "—"}
            </Figure>
          </div>
          <Details>
            <Detail label="Cheque no.">{c.chequeNo}</Detail>
            <Detail label="Bank">{c.bank || <Muted>Not given</Muted>}</Detail>
            <Detail label="Held by">{c.custody ?? <Muted>Not recorded</Muted>}</Detail>
            <Detail label="Recorded">{when(c.createdAt)}</Detail>
            {c.depositedOn ? <Detail label="Deposited">{formatContractDate(c.depositedOn)}</Detail> : null}
            {c.clearedOn ? <Detail label="Cleared">{formatContractDate(c.clearedOn)}</Detail> : null}
            {c.bouncedOn ? <Detail label="Bounced">{formatContractDate(c.bouncedOn)}</Detail> : null}
            {c.bounceCharges ? (
              <Detail label="Bounce charges">
                <Money value={c.bounceCharges} />
              </Detail>
            ) : null}
            {c.bounceReason ? (
              <Detail label="Bounce reason" wide>
                {c.bounceReason}
              </Detail>
            ) : null}
            {c.statusReason ? (
              <Detail label="Reason" wide>
                {c.statusReason}
              </Detail>
            ) : null}
          </Details>
        </div>
      );
    }
  }

  /* The first action leads; the rest wait under More, destructive ones last. */
  const [primary, ...more] = actions;

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <ActionDialogContent busy={false} className="max-h-[88vh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <DialogHeader className="gap-2 border-b px-6 py-5 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <span className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-lg">
              {target?.kind === "cheque" ? <Landmark className="size-4" /> : <CalendarClock className="size-4" />}
            </span>
            <DialogTitle className="text-lg">{target?.ref}</DialogTitle>
            {status}
          </div>
          <DialogDescription asChild>
            <div className="text-muted-foreground grid gap-1 text-sm">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-foreground inline-flex items-center gap-1.5 font-medium">
                  <UserRound className="size-3.5" />
                  {target?.client}
                </span>
                {target?.contractNumber ? (
                  <span className="inline-flex items-center gap-1.5">
                    <FileSignature className="size-3.5" />
                    {target.contractNumber}
                  </span>
                ) : null}
              </span>
              {target?.property ? (
                <span className="inline-flex items-start gap-1.5">
                  <Building2 className="mt-0.5 size-3.5 shrink-0" />
                  <span className="line-clamp-2">{target.property}</span>
                </span>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5">{body}</div>

        <DialogFooter className="bg-muted/30 flex-row flex-wrap items-center justify-between gap-2 border-t px-6 py-4">
          {contractId ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={contractHref(contractId)}>
                <ExternalLink className="size-4" />
                Open in contract
              </Link>
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {more.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    More
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {more.map((item) => (
                    <div key={item.key}>
                      {item.danger || item.group ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem variant={item.danger ? "destructive" : "default"} onClick={act(item)}>
                        {item.icon}
                        {item.label}
                      </DropdownMenuItem>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {primary ? (
              <Button size="sm" variant={primary.danger ? "destructive" : "default"} onClick={act(primary)}>
                {primary.icon}
                {primary.label}
              </Button>
            ) : payments ? (
              <span className="text-muted-foreground text-sm">Nothing to do on it</span>
            ) : null}
          </div>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function Figure({ label, hint, tone = "plain", children }: { label: string; hint?: string | null; tone?: "plain" | "main" | "good" | "bad"; children: ReactNode }) {
  return (
    <div className={cn("grid gap-1 rounded-xl border px-4 py-3", tone === "main" && "bg-muted/50", tone === "bad" && "border-danger/30 bg-danger/5")}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn("text-lg font-semibold tabular-nums", tone === "good" && "text-success", tone === "bad" && "text-danger")}>{children}</span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </div>
  );
}

function Details({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-8 rounded-xl border px-4 py-1 sm:grid-cols-2">{children}</dl>;
}

function Detail({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 border-b py-2.5 text-sm last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0", wide && "sm:col-span-2")}>
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-muted-foreground">{children}</span>;

function Section({ icon, title, count, empty, children }: { icon: ReactNode; title: string; count: number; empty: string; children: ReactNode[] }) {
  return (
    <div className="grid gap-2">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {title}
        {count ? <span className="text-muted-foreground font-normal tabular-nums">({count})</span> : null}
      </p>
      {children.length ? (
        <ul className="divide-y rounded-xl border">{children}</ul>
      ) : (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-4 text-center text-sm">{empty}</p>
      )}
    </div>
  );
}

function Line({ main, sub, end, struck = false }: { main: string; sub: string; end: ReactNode; struck?: boolean }) {
  return (
    <li className={cn("flex items-center justify-between gap-3 px-4 py-2.5 text-sm", struck && "text-muted-foreground line-through")}>
      <span className="min-w-0">
        <span className="block font-medium">{main}</span>
        <span className="text-muted-foreground block text-xs">{sub}</span>
      </span>
      {end}
    </li>
  );
}

function LoadingBody() {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-36" />
    </div>
  );
}

const Missing = ({ what }: { what: string }) => <p className="text-muted-foreground text-sm">This {what} is no longer on the contract. Refresh the list.</p>;
