"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardCheck, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

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
import {
  JOB_FILTERS,
  JOBS_FIRST_PAGE_SIZE,
  type JobFilterValue,
} from "@/lib/snagging/job-filters";

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

// Shared with the Jobs page, which reads the first page on the server.
const FILTERS = JOB_FILTERS;
type FilterValue = JobFilterValue;

export default function JobsTable({
  initial,
}: {
  /*
    The first page, read on the server before the page was sent (see
    app/(dashboard)/snagging/jobs/page.tsx). The table shows it at once
    instead of asking for it after it has loaded; every later page, filter
    and search is asked for as before.
  */
  initial?: { data: SnaggingTaskSummary[]; totalCount: number } | null;
} = {}) {
  const router = useRouter();
  const params = useSearchParams();
  const { userProfile } = useAuth();

  const initialFilter = (params.get("status") as FilterValue) ?? "all";
  /*
    One inspector's jobs, when the Overview's performance table sent the
    reader here (FR-10.01). Read once from the URL rather than held as
    state: it is where the reader arrived, not a control on this screen,
    and the toolbar's own filters still narrow it further.
  */
  const assigneeId = params.get("assignee") ?? undefined;
  /* A single day from the Overview's activity chart, by when a job was
     raised rather than when it is booked in. */
  const createdFrom = params.get("createdFrom") ?? undefined;
  const createdTo = params.get("createdTo") ?? undefined;
  const [filter, setFilter] = useState<FilterValue>(
    FILTERS.some((entry) => entry.value === initialFilter) ? initialFilter : "all",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchTerm = useDebounce(searchQuery, 500);

  const [tasks, setTasks] = useState<SnaggingTaskSummary[]>(initial?.data ?? []);
  const [recordCount, setRecordCount] = useState(initial?.totalCount ?? 0);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(JOBS_FIRST_PAGE_SIZE);
  const [isRefetching, setIsRefetching] = useState(!initial);
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
      assigneeId,
      createdFrom,
      createdTo,
      search: debouncedSearchTerm || undefined,
      // Sorting is resolved by the API; the table only reports which
      // column was clicked. Updated-desc stays the default view.
      /*
        Newest first, by when the job was raised.

        updated_at reshuffled the table on every edit, sync and status
        change, so a job was never twice in the same place and a
        coordinator lost their spot each time the list refreshed.
        Creation order never moves.
      */
      sortBy: sorting.sortBy ?? "created_at",
      sortDirection: sorting.sortOrder ?? "desc",
    };
  }, [filter, debouncedSearchTerm, sorting, assigneeId, createdFrom, createdTo]);

  /* Only the latest request may fill the table: a slower reply for an
     earlier filter or page used to land last and show the wrong rows. */
  const ticket = useRef(0);
  const fetchJobs = useCallback(async () => {
    const mine = ++ticket.current;
    setIsRefetching(true);
    setError(null);
    try {
      const response = await snaggingService.listTasks(filters, currentPage, pageSize);
      if (mine !== ticket.current) return;
      setTasks(response.data ?? []);
      setRecordCount(response.totalCount ?? 0);
    } catch (err) {
      if (mine !== ticket.current) return;
      // A failed fetch used to clear the table and toast once, so a
      // coordinator read "no jobs here" and went looking for work that
      // was actually there.
      setError(err instanceof Error ? err.message : "Could not load jobs");
      setTasks([]);
      setRecordCount(0);
    } finally {
      if (mine === ticket.current) setIsRefetching(false);
    }
  }, [filters, currentPage, pageSize]);

  // The first fetch is skipped when the server already sent the first page.
  const skipFirstFetch = useRef(Boolean(initial));
  useEffect(() => {
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false;
      return;
    }
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
        actions={
          canCreate ? (
            // A job starts from a quotation the client has approved.
            <Button onClick={() => router.push("/snagging/quotations/new")}>
              <Plus className="size-4" />
              New quotation
            </Button>
          ) : null
        }
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
              onCreate={() => router.push("/snagging/quotations/new")}
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
                      label: "New quotation",
                      onClick: () => router.push("/snagging/quotations/new"),
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
