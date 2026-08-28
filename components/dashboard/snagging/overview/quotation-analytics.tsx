"use client";

import { useRef } from "react";
import { FileSignature } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";

import { QUOTATION_COLOR } from "@/lib/snagging/chart-palette";

import { LinesSkeleton, SectionShell } from "./section-shell";
import { useInView, useSection } from "./use-section";

type Quotations = {
  stages: Array<{ key: string; label: string; count: number }>;
  approvalRate: number | null;
  decided: number;
};

/**
 * The quotation funnel (§8).
 *
 * Drawn as the same horizontal bars as the inspection pipeline, because
 * it is the same idea one step earlier in the business: work narrowing
 * as it moves along. Bars are proportional to the widest stage, so the
 * drop-off between generated and approved is the shape you see.
 */
export function QuotationAnalytics() {
  const anchor = useRef<HTMLDivElement>(null);
  const visible = useInView(anchor);

  const { data, loading, error, reload } = useSection<Quotations>(
    "/api/snagging/overview/quotations",
    { staleMs: 600_000, enabled: visible },
  );

  const widest = Math.max(1, ...(data?.stages ?? []).map((stage) => stage.count));
  const generated = data?.stages.find((stage) => stage.key === "generated")?.count ?? 0;

  return (
    <div ref={anchor}>
      <SectionShell
        title="Quotation analytics"
        description="How quotations move from raised to answered."
        icon={<FileSignature />}
        muted
        loading={!visible || loading}
        error={error}
        onRetry={reload}
        isEmpty={visible && !loading && generated === 0}
        empty={
          <EmptyState
            icon={<FileSignature />}
            title="No quotations raised"
            description="The funnel fills in once quotations are generated against jobs."
            className="py-10"
          />
        }
        skeleton={<LinesSkeleton rows={5} />}
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
          <ul className="min-w-0 space-y-3">
            {(data?.stages ?? []).map((stage) => (
              <li key={stage.key} className="flex items-center gap-3">
                <span className="text-muted-foreground w-20 shrink-0 text-sm">{stage.label}</span>
                {/*
                  Raised and sent are steps rather than verdicts, so they
                  stay neutral; only the three outcomes take a colour.
                */}
                <Progress
                  value={(stage.count / widest) * 100}
                  className="h-2 flex-1"
                  indicatorStyle={{ background: QUOTATION_COLOR[stage.key] }}
                />
                <span className="w-8 shrink-0 text-right text-sm font-medium tabular-nums">
                  {stage.count}
                </span>
              </li>
            ))}
          </ul>

          <div className="bg-muted/50 flex flex-col justify-center rounded-lg border px-6 py-4 lg:w-52">
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Approval rate
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {data?.approvalRate === null || data?.approvalRate === undefined
                ? "—"
                : `${data.approvalRate}%`}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {data && data.decided > 0
                ? `Of ${data.decided} the client answered`
                : "No quotation answered yet"}
            </p>
          </div>
        </div>
      </SectionShell>
    </div>
  );
}
