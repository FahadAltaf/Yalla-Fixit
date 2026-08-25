"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { getSnaggingJobColumns } from "@/components/data-table/columns/column-snagging-job";
import { SnaggingJobsToolbar } from "@/components/data-table/toolbars/snagging-jobs-toolbar";
import { DataTable } from "@/components/data-table";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/context/AuthContext";
import { useDebounce } from "@/hooks/use-debounce";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService, type SnaggingTaskFilters } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingTaskSummary } from "@/types/types";

import { ErrorState, PageHeading } from "./shared";

/**
 * The jobs table: every inspection task, its round, and what the field
 * has sent back so far.
 *
 * Built on the shared DataTable so it behaves exactly like the users and
 * roles lists — server-side paging with a numbered footer, sortable
 * headers that hand the sort key back to the API, and search in the
 * toolbar. Filtering stays on status pills rather than a dropdown
 * because status is the axis ops actually work along.
 */

const FILTERS = [
  { value: "all", label: "All", statuses: "all" },
  { value: "assigned", label: "Assigned", statuses: "assigned" },
  { value: "in_progress", label: "In progress", statuses: "in_progress" },
  { value: "submitted", label: "Submitted", statuses: "submitted,in_review" },
  { value: "approved", label: "Approved", statuses: "approved,delivered" },
  { value: "rejected", label: "Needs correction", statuses: "rejected" },
] as const;

type FilterValue = (typeof FILTERS)[number]["value"];

export default function JobsTable() {
  const router = useRouter();
  const params = useSearchParams();
  const { userProfile } = useAuth();

  const initialFilter = (params.get("status") as FilterValue) ?? "all";
  const [filter, setFilter] = useState<FilterValue>(
    FILTERS.some((entry) => entry.value === initialFilter) ? initialFilter : "all",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchTerm = useDebounce(searchQuery, 500);

  const [tasks, setTasks] = useState<SnaggingTaskSummary[]>([]);
  const [recordCount, setRecordCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [isRefetching, setIsRefetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<{
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }>({});

  const canCreate = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.CREATE);

  const filters = useMemo<SnaggingTaskFilters>(() => {
    const active = FILTERS.find((entry) => entry.value === filter);
    return {
      status: active?.statuses,
      search: debouncedSearchTerm || undefined,
      // Sorting is resolved by the API; the table only reports which
      // column was clicked. Updated-desc stays the default view.
      sortBy: sorting.sortBy ?? "updated_at",
      sortDirection: sorting.sortOrder ?? "desc",
    };
  }, [filter, debouncedSearchTerm, sorting]);

  const fetchJobs = useCallback(async () => {
    setIsRefetching(true);
    setError(null);
    try {
      const response = await snaggingService.listTasks(filters, currentPage, pageSize);
      setTasks(response.data ?? []);
      setRecordCount(response.totalCount ?? 0);
    } catch (err) {
      // A failed fetch used to clear the table and toast once, so a
      // coordinator read "no jobs here" and went looking for work that
      // was actually there.
      setError(err instanceof Error ? err.message : "Could not load jobs");
      setTasks([]);
      setRecordCount(0);
    } finally {
      setIsRefetching(false);
    }
  }, [filters, currentPage, pageSize]);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  // Every filter, search or sort change puts the user back on page one,
  // so they never land on an empty page 4 of a shorter result set.
  function handleGlobalFilterChange(value: string) {
    setSearchQuery(value);
    setCurrentPage(0);
  }

  function handlePageChange(pageIndex: number) {
    setCurrentPage(pageIndex);
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    setCurrentPage(0);
  }

  function handleSortingChange(sortBy?: string, sortOrder?: "asc" | "desc") {
    setSorting({ sortBy, sortOrder });
    setCurrentPage(0);
  }

  function handleStatusChange(value: string) {
    setFilter(value as FilterValue);
    setCurrentPage(0);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Operations"
        title="Jobs"
        description="Every inspection task, its round, its inspector, and the snag counts the field has sent back."
      />

      {error ? (
        <ErrorState
          title="Could not load jobs"
          message={error}
          onRetry={() => void fetchJobs()}
          retrying={isRefetching}
        />
      ) : null}

      <Card className="py-0">
        <DataTable
          data={tasks}
          toolbar={
            <SnaggingJobsToolbar
              fetchRecords={() => void fetchJobs()}
              onGlobalFilterChange={handleGlobalFilterChange}
              isSearchLoading={isRefetching}
              pageSize={pageSize}
              onPageSizeChange={handlePageSizeChange}
              statusTabs={FILTERS.map((entry) => ({
                value: entry.value,
                label: entry.label,
              }))}
              statusValue={filter}
              onStatusChange={handleStatusChange}
              canCreate={canCreate}
              onCreate={() => router.push("/snagging/jobs/new")}
            />
          }
          columns={getSnaggingJobColumns()}
          onGlobalFilterChange={handleGlobalFilterChange}
          onSortingChange={handleSortingChange}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          pageSize={pageSize}
          currentPage={currentPage}
          loading={isRefetching}
          rowCount={recordCount}
          type="snagging-jobs"
          isPagination={true}
          handleRowClick={(row) => router.push(`/snagging/${row.id}`)}
          emptyState={
            <EmptyState
              icon={<ClipboardCheck />}
              title={error ? "Jobs could not be loaded" : "No jobs here"}
              description={
                error
                  ? "Try again once the connection is back."
                  : "Nothing matches this filter yet."
              }
              {...(canCreate && !error
                ? {
                    action: {
                      label: "New job",
                      onClick: () => router.push("/snagging/jobs/new"),
                    },
                  }
                : {})}
            />
          }
        />
      </Card>

      <p className="text-muted-foreground text-xs">
        Snag counts read high / medium / low. Severity colour is always paired with a position and
        a value, never colour alone.
      </p>
    </div>
  );
}
