"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { complianceService, type OverviewKpis } from "@/modules/compliance";
import { ITEM_STATUS_LABEL } from "@/lib/compliance/statuses";
import type { ComplianceItemStatus } from "@/lib/compliance/status";
import { StatusPill, formatDateOnly } from "./status-pill";

const ORDER: ComplianceItemStatus[] = ["valid", "due_90", "due_60", "due_30", "expired", "missing_expiry"];

/**
 * Compliance overview (FRD FR-5, phase 1): the KPI cards. Charts (site,
 * training coverage, Emirates ID pie) arrive in phase 2. Counts cover
 * active manpower only; archived employees are shown separately.
 */
export default function ComplianceOverviewDashboard() {
  const [data, setData] = useState<OverviewKpis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await complianceService.kpis());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Manpower compliance"
        title="Overview"
        description={data ? `Emirates ID, passport and training status for active staff, as of ${formatDateOnly(data.as_of)}.` : "Emirates ID, passport and training status for active staff."}
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /> Refresh
          </Button>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} retrying={loading} />
      ) : loading || !data ? (
        <StatGridSkeleton count={4} />
      ) : (
        <>
          <StatCardGrid columns={4}>
            <StatCard label="Total employees" value={data.total} caption={data.archived ? `${data.archived} archived not counted` : "On the compliance register"} href="/workforce" />
            <StatCard label="Active manpower" value={data.active} caption="Active and On Leave" href="/workforce?employment_status=active_manpower" tone="good" />
            <StatCard label="Emirates ID expired" value={data.emirates_id.expired} caption="Active staff, including today" tone={data.emirates_id.expired > 0 ? "bad" : "neutral"} href="/workforce?employment_status=active_manpower&item_status=expired" />
            <StatCard label="Items needing action" value={data.reminder_items} caption="Due, expired or missing a date" tone={data.reminder_items > 0 ? "progress" : "neutral"} href="/compliance/reminders" />
          </StatCardGrid>

          <div className="grid gap-4 md:grid-cols-2">
            <StatusBreakdown title="Emirates ID" counts={data.emirates_id} itemKey="emirates_id" />
            <StatusBreakdown title="Passport" counts={data.passport} itemKey="passport" />
          </div>
        </>
      )}
    </div>
  );
}

function StatusBreakdown({ title, counts, itemKey }: { title: string; counts: Record<ComplianceItemStatus, number>; itemKey: string }) {
  const total = ORDER.reduce((sum, s) => sum + counts[s], 0);
  return (
    <SectionCard title={`${title} by status`} description={`${total} active staff`} icon={<BadgeCheck className="size-4" />} bodyClassName="px-5 pb-5">
      <ul className="divide-y">
        {ORDER.map((s) => (
          <li key={s} className="flex items-center justify-between py-2 text-sm">
            <Link href={`/compliance/reminders?item=${itemKey}&status=${s}`} className="flex items-center gap-2 hover:underline">
              <StatusPill status={s} />
              <span className="sr-only">{ITEM_STATUS_LABEL[s]}</span>
            </Link>
            <span className="font-medium tabular-nums">{counts[s]}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
