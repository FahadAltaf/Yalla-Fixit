"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { useSection } from "@/components/dashboard/snagging/overview/use-section";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInZone } from "@/lib/scheduling/org-time";
import type { MonthEndRevenue } from "@/lib/server/finance/revenue";

import { aed } from "./shared";

/**
 * Revenue at month end (26 Oct, change 7): per work order, what was
 * recognised (in the month and to date), invoiced and still to invoice as
 * of the month's last day, so Finance can book revenue without an invoice.
 * Amounts with VAT, as the rest of Finance; the before-VAT total is under
 * the table for booking.
 */

const MONTHS = 12;
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function lastMonths(count: number): string[] {
  const [year, month] = todayInZone().slice(0, 7).split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function RevenueSection() {
  const months = lastMonths(MONTHS);
  const [month, setMonth] = useState(months[0]);
  const { data, loading, error, reload } = useSection<MonthEndRevenue>(`/api/finance/revenue?month=${month}`, { staleMs: 60_000 });
  const revenue = data;
  const rows = revenue?.rows ?? [];

  return (
    <SectionCard
      icon={<CalendarCheck />}
      title="Revenue at month end"
      description={`Recognised, invoiced and still to invoice per work order as of ${revenue ? revenue.asOf : "the month's last day"}, incl. VAT. Recognised: all of work Completed in FSM, else Operations' latest % done.`}
      bodyClassName="border-t"
      action={
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger size="sm" className="w-[170px]" aria-label="Month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {monthLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {error && !revenue ? (
        <div className="p-5">
          <ErrorState title="Could not work out the revenue" message={error} onRetry={reload} retrying={loading} />
        </div>
      ) : !revenue ? (
        <ListSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="size-6" />}
          title={`Nothing recognised by the end of ${monthLabel(month)}`}
          description="Work counts here once it is Completed in FSM, Operations records it partly done, or an invoice is recorded against it."
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Work order</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Recognised in {monthLabel(month).split(" ")[0]}</TableHead>
                  <TableHead className="text-right">Recognised to date</TableHead>
                  <TableHead className="text-right">Invoiced</TableHead>
                  <TableHead className="pr-5 text-right">Still to invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.workOrderId}>
                    <TableCell className="pl-5">
                      <Link href={`/finance/queue/${r.workOrderId}`} className="font-medium hover:underline">
                        {r.quotationNumber ? `Quotation ${r.quotationNumber}` : (r.number ?? r.workOrderId)}
                      </Link>
                      <p className="text-muted-foreground text-xs">{[r.quotationNumber ? r.number : null, r.clientName].filter(Boolean).join(" · ")}</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{aed(r.withVat.value)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{aed(r.withVat.recognisedInMonth)}</TableCell>
                    <TableCell className="text-right tabular-nums">{aed(r.withVat.recognised)}</TableCell>
                    <TableCell className="text-right tabular-nums">{aed(r.withVat.invoiced)}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">{aed(r.withVat.remaining)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="hover:bg-transparent">
                  <TableCell className="pl-5 font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{aed(revenue.totals.value)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{aed(revenue.totals.recognisedInMonth)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{aed(revenue.totals.recognised)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{aed(revenue.totals.invoiced)}</TableCell>
                  <TableCell className="pr-5 text-right font-semibold tabular-nums">{aed(revenue.totals.remaining)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground border-t px-5 py-3 text-xs">
            For booking, before VAT: recognised in {monthLabel(month)} {aed(revenue.totals.beforeVat.recognisedInMonth)}, to date{" "}
            {aed(revenue.totals.beforeVat.recognised)}; invoiced {aed(revenue.totals.beforeVat.invoiced)}.
            {revenue.progressReady ? "" : " Operations' % done is not counted yet: a database update is still to be applied."}
          </p>
        </>
      )}
    </SectionCard>
  );
}
