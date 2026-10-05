"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { DataRow, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { formatQuantity } from "@/lib/amc/contracts";
import { amcContractsService, type ContractsDashboard } from "@/modules/amc-contracts/amc-contracts-service";

import { formatContractDate } from "./contract-status";

const BASE = "/extensions/amc-contracts";

/**
 * The figures above the contracts list, counted from the contracts the
 * viewer can see. Each card opens the matching filter.
 */
export function ContractsSummary({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<ContractsDashboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stale = false;
    amcContractsService.summary().then(
      (r) => {
        if (stale) return;
        setData(r.summary);
        setFailed(false);
      },
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [refreshKey]);

  /* The list below shows its own error; the cards just step aside. */
  if (failed) return null;
  if (!data) return <StatGridSkeleton count={5} columns={5} />;

  return (
    <div className="flex flex-col gap-4">
      <StatCardGrid columns={5}>
        <StatCard
          label="In force"
          value={<span className="tabular-nums">{data.inForce}</span>}
          headline={`AED ${data.inForceValue.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          caption="Total value in force, incl. VAT"
          href={`${BASE}?status=active`}
        />
        <StatCard
          label="Pending activation"
          value={<span className="tabular-nums">{data.pendingActivation}</span>}
          headline={data.pendingActivation ? "Signed, waiting to start" : "Nothing waiting"}
          caption="Signed proposals without a contract"
          tone={data.pendingActivation ? "progress" : "neutral"}
          href={`${BASE}?status=pending_activation`}
        />
        <StatCard
          label="Expiring soon"
          value={<span className="tabular-nums">{data.expiringSoon}</span>}
          headline={data.expiringSoon ? "Plan the renewals" : "None due"}
          caption={`Ending within ${data.expiringWindowDays} days`}
          tone={data.expiringSoon ? "progress" : "neutral"}
          href={`${BASE}?status=expiring`}
        />
        <StatCard
          label="Expired"
          value={<span className="tabular-nums">{data.expired}</span>}
          headline={data.expired ? "Not renewed" : "None"}
          caption="Past their end date"
          href={`${BASE}?status=expired`}
        />
        <StatCard
          label="Allowance used up"
          value={<span className="tabular-nums">{data.withExhaustedEntitlements}</span>}
          headline={data.withExhaustedEntitlements ? "Further work is chargeable" : "None used up"}
          caption="In-force contracts with a visit or hour allowance at zero"
        />
      </StatCardGrid>

      {data.recentUsage.length ? (
        <SectionCard
          title="Recent usage"
          description={`${data.usageLast30Days} ${data.usageLast30Days === 1 ? "entry" : "entries"} of usage in the last 30 days.`}
          icon={<ClipboardList />}
          bodyClassName="px-5 pb-5"
        >
          <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.recentUsage.map((u) => (
              <DataRow
                key={u.id}
                title={
                  <Link href={`${BASE}/${u.contractId}`} className="hover:underline">
                    {u.customerName || u.proposalNumber}
                  </Link>
                }
                subtitle={`${u.serviceLabel} · ${formatContractDate(u.occurredAt.slice(0, 10))}${u.kind === "correction" ? " · correction" : ""}`}
                trailing={<span className="text-sm tabular-nums">{u.quantity > 0 ? "" : "−"}{formatQuantity(Math.abs(u.quantity))}</span>}
              />
            ))}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
