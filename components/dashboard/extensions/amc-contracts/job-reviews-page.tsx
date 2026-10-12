"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { ClipboardCheck, Database, ExternalLink, LoaderCircleIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { PageHeading, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { jobSheetsService, type JobReviewItem } from "@/modules/amc-contracts/job-sheets-service";

import { AmcNotificationsBell } from "./amc-notifications-bell";
import { ReportClockBadge, ReviewReasonBadges } from "./job-sheet-panel";
import { useAmcData } from "./use-amc-data";
import { useDialog } from "./profile/use-dialog";
import { VisitDetailDialog } from "./visit-detail-dialog";

const FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "any", label: "All job sheets" },
  { value: "review", label: "Needs a close look" },
  { value: "routine", label: "Routine" },
];

const visitHref = (r: Pick<JobReviewItem, "contractId" | "visitId">) => `/extensions/amc-contracts/${r.contractId}?tab=schedule&visit=${r.visitId}`;

function submittedLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "dd MMM HH:mm");
}

/**
 * AMC -> Job reviews (Phase 10: DEV-402, to-do 5): submitted job sheets
 * waiting for a supervisor, oldest first, with why each needs a close
 * look and its 48-hour report clock. Opening one shows the visit on its
 * Job sheet tab, where the supervisor returns it or closes the visit.
 * AMC Visits (View) reads the queue; Approve, or a named supervisor,
 * reviews.
 */
export function JobReviewsPage() {
  const { data, error, loading, reload } = useAmcData(() => jobSheetsService.reviews(), "job-reviews");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("any");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const reviewing = useDialog<string>();
  const showReview = reviewing.show;

  const term = search.trim().toLowerCase();
  const all = useMemo(() => data?.items ?? [], [data]);
  const matching = useMemo(
    () =>
      all.filter(
        (r) =>
          (filter === "any" || (filter === "review" ? r.reviewReasons.length > 0 : r.reviewReasons.length === 0)) &&
          (!term || [r.contractNumber, r.customerName, r.propertyLabel, `visit ${r.visitNo}`].some((v) => v.toLowerCase().includes(term))),
      ),
    [all, filter, term],
  );
  const rows = matching.slice(page * pageSize, (page + 1) * pageSize);
  const filtered = Boolean(term) || filter !== "any";

  const columns = useMemo<ColumnDef<JobReviewItem>[]>(
    () => [
      {
        id: "visit",
        header: "Visit",
        cell: ({ row }) => (
          <IdentityCell title={`Visit ${row.original.visitNo}`} subtitle={row.original.contractNumber || "Contract"} icon={ClipboardCheck} />
        ),
      },
      {
        id: "client",
        header: "Client",
        cell: ({ row }) => <span className="text-sm">{row.original.customerName || <span className="text-muted-foreground">—</span>}</span>,
      },
      {
        id: "property",
        header: "Property",
        cell: ({ row }) =>
          row.original.propertyLabel ? (
            <span className="line-clamp-2 max-w-[240px] text-sm">{row.original.propertyLabel}</span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
      {
        id: "submitted",
        header: "Submitted",
        cell: ({ row }) => (
          <span className="flex flex-col text-sm whitespace-nowrap">
            <span>{submittedLabel(row.original.submittedAt)}</span>
            <span className="text-muted-foreground text-xs">{timeAgo(row.original.submittedAt)}</span>
          </span>
        ),
      },
      {
        id: "reasons",
        header: "Review",
        cell: ({ row }) => (
          <span className="flex max-w-[280px] flex-wrap gap-1">
            <ReviewReasonBadges reasons={row.original.reviewReasons} />
          </span>
        ),
      },
      {
        id: "returns",
        header: "Returns",
        cell: ({ row }) =>
          row.original.returnCount ? (
            <span className="text-sm tabular-nums">{row.original.returnCount}</span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
      {
        id: "report",
        header: "Report",
        cell: ({ row }) => <ReportClockBadge state={row.original.reportState} />,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="outline" onClick={() => showReview(row.original.visitId)}>
              Review
            </Button>
            <Button size="icon" variant="ghost" className="size-8" asChild>
              <Link href={visitHref(row.original)} aria-label={`Open the contract for visit ${row.original.visitNo}`} title="Open in the contract">
                <ExternalLink className="size-4" />
              </Link>
            </Button>
          </span>
        ),
      },
    ],
    [showReview],
  );

  const clearFilters = () => {
    setSearch("");
    setFilter("any");
    setPage(0);
  };

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Operations"
        title="Job reviews"
        description="Submitted job sheets waiting for a supervisor, oldest first. Return one with what needs fixing, or close the visit to send the client the service report within 48 hours."
        actions={<AmcNotificationsBell />}
      />

      {data && !data.migrated ? (
        <Alert className="border-warning/30 bg-warning/5 items-start p-4">
          <Database className="text-warning" />
          <AlertTitle>Job reviews need a database update</AlertTitle>
          <AlertDescription>
            The job sheet tables are not on this database yet (migration 20261012110000). Ask an admin to apply it.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? <ErrorState title="Could not load the job reviews" message={error} onRetry={reload} /> : null}

      <Card className="py-0">
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          rowCount={matching.length}
          pageSize={pageSize}
          currentPage={page}
          isPagination
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          onGlobalFilterChange={setSearch}
          handleRowClick={(row) => reviewing.show(row.visitId)}
          toolbar={
            <JobReviewsToolbar
              search={search}
              onSearchChange={(v) => {
                setSearch(v);
                setPage(0);
              }}
              loading={loading}
              filter={filter}
              onFilterChange={(v) => {
                setFilter(v);
                setPage(0);
              }}
              pageSize={pageSize}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              onRefresh={reload}
            />
          }
          emptyState={
            <EmptyState
              icon={<ClipboardCheck />}
              title={all.length && filtered ? "No matching job sheets" : "Nothing to review"}
              description={
                all.length && filtered
                  ? "No submitted job sheet matches this search and filter."
                  : "When a crew submits a visit's job sheet, it waits here for a supervisor to return it or close the visit."
              }
              action={all.length && filtered ? { label: "Clear filters", variant: "outline", onClick: clearFilters } : undefined}
            />
          }
        />
      </Card>

      <VisitDetailDialog
        key={reviewing.key}
        visitId={reviewing.target}
        open={reviewing.open}
        onOpenChange={reviewing.onOpenChange}
        onChanged={reload}
        initialTab="job_sheet"
      />
    </div>
  );
}

/** The same shape as Snagging's jobs toolbar: search and filter on the left, page size and Refresh on the right. */
function JobReviewsToolbar({
  search,
  onSearchChange,
  loading,
  filter,
  onFilterChange,
  pageSize,
  onPageSizeChange,
  onRefresh,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  filter: string;
  onFilterChange: (value: string) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
}) {
  const searchId = useId();
  const rowsId = useId();

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80 sm:flex-none">
            <Input
              id={searchId}
              type="search"
              placeholder="Search client, property or contract no.…"
              className="peer w-full ps-9"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label="Search job reviews"
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
              {loading ? <LoaderCircleIcon aria-label="Loading..." className="animate-spin" role="status" size={16} /> : <SearchIcon aria-hidden="true" size={16} />}
            </div>
          </div>
          <StatusSelect options={FILTER_OPTIONS} value={filter} onChange={onFilterChange} label="Filter by review" />
        </div>

        <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="hidden w-full items-center gap-2 sm:flex sm:w-auto">
            <Label htmlFor={rowsId} className="sr-only">
              Show
            </Label>
            <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger id={rowsId} className="w-full whitespace-nowrap sm:w-fit">
                <SelectValue placeholder="Select number of results" />
              </SelectTrigger>
              <SelectContent className="[&_*[role=option]]:pr-8 [&_*[role=option]]:pl-2 [&_*[role=option]>span]:right-2 [&_*[role=option]>span]:left-auto">
                {[10, 25, 50].map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={onRefresh} variant="outline" disabled={loading}>
            <RefreshCwIcon className="size-4 sm:mr-1" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
