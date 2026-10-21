"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Clock, Hourglass, PauseCircle, Scale } from "lucide-react";

import { PageHeading, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, SectionSkeleton, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { QueueMetrics, QueueSummary } from "@/lib/finance/metrics";
import { financeService } from "@/modules/finance/finance-service";

import { aed } from "./shared";

/**
 * Invoicing controls (BRD §5.1 Step 8, §6.9; DEV-441). Every figure comes
 * from the queue's own timestamps and records: nothing is typed in.
 */
export function FinanceMetricsPage() {
  const [data, setData] = useState<{ summary: QueueSummary; metrics: QueueMetrics } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await financeService.metrics();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the metrics");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const heading = (
    <>
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/finance/queue">
            <ArrowLeft className="size-4" />
            Ready to invoice
          </Link>
        </Button>
      </div>
      <PageHeading
        eyebrow="Finance"
        title="Invoicing metrics"
        description="Days from ready to invoiced, what is waiting and for how long, holds, exclusions and variance."
      />
    </>
  );

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <ErrorState title="Could not load the metrics" message={error} onRetry={() => void load()} retrying={loading} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <StatGridSkeleton count={4} />
        <SectionSkeleton />
      </div>
    );
  }

  const { summary, metrics } = data;
  return (
    <div className="flex flex-col gap-6">
      {heading}

      <StatCardGrid columns={4}>
        <StatCard label="Awaiting invoice" value={aed(metrics.openValue)} headline="Pending, in progress, query or hold" />
        <StatCard
          label="Average days to invoice"
          value={metrics.daysToInvoice.average === null ? "—" : metrics.daysToInvoice.average}
          headline={`Over ${summary.invoiced.count} invoice(s)`}
        />
        <StatCard
          label="Invoices with a variance"
          value={`${metrics.variance.withVariance} of ${metrics.variance.invoices}`}
          headline={`Net ${aed(metrics.variance.total)}`}
        />
        <StatCard label="Excluded value" value={aed(summary.excluded.value)} headline={`${summary.excluded.count} verified item(s)`} />
      </StatCardGrid>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard icon={<Hourglass />} title="Ageing of waiting items" description="Days since each item entered the queue." bodyClassName="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Age</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="pr-5 text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.ageing.map((band) => (
                <TableRow key={band.key}>
                  <TableCell className="pl-5">{band.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{band.count}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">{aed(band.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>

        <SectionCard icon={<Clock />} title="Days to invoice, by Finance user" bodyClassName="border-t">
          {metrics.daysToInvoice.byUser.length === 0 ? (
            <p className="text-muted-foreground px-5 py-4 text-sm">No invoices recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Recorded by</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="pr-5 text-right">Average days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.daysToInvoice.byUser.map((row) => (
                  <TableRow key={row.user}>
                    <TableCell className="pl-5">{row.user}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.invoices}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">{row.averageDays}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard icon={<PauseCircle />} title="On hold" bodyClassName="border-t">
          {metrics.onHold.length === 0 ? (
            <p className="text-muted-foreground px-5 py-4 text-sm">Nothing is on hold.</p>
          ) : (
            <ul className="divide-y">
              {metrics.onHold.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-4 px-5 py-3 text-sm">
                  <Link href={`/finance/queue/${row.id}`} className="hover:underline">
                    {row.reason || "No reason recorded"}
                  </Link>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {aed(row.value)} · {row.days} days
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard icon={<Ban />} title="Excluded value by reason" bodyClassName="border-t">
          {metrics.excludedByReason.length === 0 ? (
            <p className="text-muted-foreground px-5 py-4 text-sm">No verified exclusions yet.</p>
          ) : (
            <Table>
              <TableBody>
                {metrics.excludedByReason.map((row) => (
                  <TableRow key={row.reason}>
                    <TableCell className="pl-5">{row.reason}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">{aed(row.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>

      <SectionCard icon={<Scale />} title="Variance between queue value and invoiced amount" bodyClassName="px-5 pb-5">
        <p className="text-sm">
          {metrics.variance.withVariance} of {metrics.variance.invoices} invoice(s) differ from their queue value. Net{" "}
          {aed(metrics.variance.total)}; total of the differences either way {aed(metrics.variance.absoluteTotal)}.
        </p>
      </SectionCard>
    </div>
  );
}
