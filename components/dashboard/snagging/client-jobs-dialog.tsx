"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { getSnaggingJobColumns } from "@/components/data-table/columns/column-snagging-job";
import { RecordsToolbar } from "@/components/data-table/toolbars/records-toolbar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useDebounce } from "@/hooks/use-debounce";
import { snaggingService, type SnaggingClientOption } from "@/modules/snagging";
import type { SnaggingTaskSummary } from "@/types/types";

import { ErrorState, POPUP_PAGE_SIZES as PAGE_SIZES } from "./shared";

/**
 * Every job raised for one client, in the house table.
 *
 * Search, paging, sorting and refresh all go to the server, filtered by
 * the client, so a client with hundreds of jobs opens as fast as one with
 * two. A row opens the job.
 */
export function ClientJobsDialog({
  client,
  onClose,
}: {
  client: SnaggingClientOption | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<SnaggingTaskSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ sortBy?: string; sortOrder?: "asc" | "desc" }>({});
  const debouncedSearch = useDebounce(search.trim(), 300);

  // A fresh first page, with no search, whenever another client opens.
  const clientId = client?.id ?? null;
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (clientId !== shownFor) {
    setShownFor(clientId);
    setPage(0);
    setSearch("");
    setSort({});
    setRows([]);
    setTotal(0);
  }

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await snaggingService.listTasks(
        {
          clientId,
          search: debouncedSearch || undefined,
          sortBy: sort.sortBy,
          sortDirection: sort.sortOrder,
        },
        page,
        pageSize,
      );
      setRows(result.data ?? []);
      setTotal(result.totalCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this client's jobs");
    } finally {
      setLoading(false);
    }
  }, [clientId, debouncedSearch, page, pageSize, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  // The Jobs list's own columns, so a job reads the same in both places.
  const columns = useMemo(() => getSnaggingJobColumns(), []);

  return (
    <Dialog open={client !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(64rem,calc(100vw-3rem))]"
        showCloseButton
      >
        <DialogHeader className="px-6 pt-6 pb-4 text-left">
          <DialogTitle className="pr-10 text-lg">
            {client?.client_name ?? "Client"} · jobs
          </DialogTitle>
          <DialogDescription>
            Every job raised for this client, newest first. Open a row to go to the job.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-t">
          {error ? (
            <div className="px-6 py-4">
              <ErrorState
                title="Could not load this client's jobs"
                message={error}
                onRetry={() => void load()}
                retrying={loading}
              />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              loading={loading}
              rowCount={total}
              pageSize={pageSize}
              currentPage={page}
              isPagination
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              onSortingChange={(sortBy, sortOrder) => {
                setSort({ sortBy, sortOrder });
                setPage(0);
              }}
              onGlobalFilterChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              type="snagging-jobs"
              handleRowClick={(row) => router.push(`/snagging/${row.id}`)}
              toolbar={
                <RecordsToolbar
                  fetchRecords={() => void load()}
                  globalFilter={search}
                  onGlobalFilterChange={(value) => {
                    setSearch(value);
                    setPage(0);
                  }}
                  isSearchLoading={loading}
                  pageSize={pageSize}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(0);
                  }}
                  searchPlaceholder="Search..."
                  pageSizes={PAGE_SIZES}
                />
              }
              emptyState={
                <EmptyState
                  icon={<Briefcase />}
                  title={debouncedSearch ? "Nothing matches that" : "No jobs yet"}
                  description={
                    debouncedSearch
                      ? "Try part of the unit, the building or the job code."
                      : "Jobs raised for this client appear here."
                  }
                />
              }
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
