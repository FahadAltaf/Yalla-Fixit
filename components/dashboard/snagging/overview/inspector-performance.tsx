"use client";

import { useRef, useState } from "react";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/data-table";
import { getSnaggingInspectorPerformanceColumns } from "@/components/data-table/columns/column-snagging-inspector-performance";

import { SectionShell, TableSkeleton } from "./section-shell";
import { useInView, useSection } from "./use-section";

type Performance = {
  rows: Array<{ id: string; name: string; assigned: number; inProgress: number; completed: number }>;
  rowCount: number;
};

/**
 * Inspector workload (§7).
 *
 * Below the fold and loaded only once it is scrolled to, because it is a
 * management view rather than something anybody acts on this morning —
 * and because its counts are the heaviest query on the page. Paged at
 * the query level so it stays flat as the team grows.
 */
export function InspectorPerformance() {
  const anchor = useRef<HTMLDivElement>(null);
  const visible = useInView(anchor);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const { data, loading, error, reload } = useSection<Performance>(
    `/api/snagging/overview/inspectors?page=${page}&pageSize=${pageSize}`,
    { staleMs: 600_000, enabled: visible },
  );

  return (
    <div ref={anchor}>
      <SectionShell
        title="Inspector performance"
        description="Workload per inspector. Snag counts are deliberately absent — they measure the building, not the person."
        icon={<Users />}
        muted
        loading={!visible || loading}
        error={error}
        onRetry={reload}
        isEmpty={visible && !loading && (data?.rowCount ?? 0) === 0}
        empty={
          <EmptyState
            icon={<Users />}
            title="No inspectors assigned yet"
            description="Rows appear here once jobs are assigned to inspectors."
            className="py-10"
          />
        }
        skeleton={<TableSkeleton rows={4} columns={4} />}
        bodyClassName="px-0 pb-0"
      >
        <DataTable
          data={data?.rows ?? []}
          columns={getSnaggingInspectorPerformanceColumns()}
          onGlobalFilterChange={() => {}}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          pageSize={pageSize}
          currentPage={page}
          loading={loading}
          rowCount={data?.rowCount ?? 0}
          type="snagging-inspector-performance"
          isPagination={true}
        />
      </SectionShell>
    </div>
  );
}
