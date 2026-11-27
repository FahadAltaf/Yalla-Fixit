"use client";

import { useCallback, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardCheck, Database, ExternalLink, FilePen, FileSignature, FileText, LoaderCircleIcon, PhoneCall, SearchIcon, Wrench } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { PageHeading, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { jobSheetsService, type ApprovalReviewItem, type JobReviewItem, type SiteVisitReviewItem } from "@/modules/amc-contracts/job-sheets-service";

import { ReportClockBadge, ReviewReasonBadges } from "./job-sheet-panel";
import { useAmcData } from "./use-amc-data";
import { TruncatedText } from "@/components/ui/truncated-text";
import { ModuleGuide } from "@/components/dashboard/extensions/amc-contracts/module-guide";
import { visitPageHref } from "@/lib/amc/field-visits";

import { formatDubaiShort } from "@/lib/amc/dubai-clock";
import { AmcRefreshButton } from "./refresh-button";

/*
  One table for everything waiting for a review (27 Nov 2026): the job
  sheets and the site visit reports to approve, told apart by Type, with a
  Type and a Status filter.
*/
type ReviewType = JobReviewItem["kind"] | "site_visit" | "proposal" | "amendment";
type ReviewStatus = "close_look" | "routine" | "to_approve";

interface ReviewRow {
  key: string;
  type: ReviewType;
  ref: string;
  contractNumber: string | null;
  customerName: string;
  propertyLabel: string;
  submittedAt: string | null;
  status: ReviewStatus;
  job: JobReviewItem | null;
  siteVisit: SiteVisitReviewItem | null;
  approval: ApprovalReviewItem | null;
  href: string;
}

const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "any", label: "All types" },
  { value: "proposal", label: "Proposals" },
  { value: "amendment", label: "Contract amendments" },
  { value: "site_visit", label: "Site visit reports" },
  { value: "ppm", label: "Planned visits" },
  { value: "call_out", label: "Call outs" },
  { value: "additional_work", label: "Additional work" },
];
const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "any", label: "All statuses" },
  { value: "to_approve", label: "To approve" },
  { value: "close_look", label: "Needs a close look" },
  { value: "routine", label: "Routine" },
];

const TYPE_LABEL: Record<ReviewType, string> = {
  ppm: "Planned visit",
  call_out: "Call out",
  additional_work: "Additional work",
  site_visit: "Site visit report",
  proposal: "Proposal",
  amendment: "Contract amendment",
};
const TYPE_ICON: Record<ReviewType, typeof ClipboardCheck> = { ppm: ClipboardCheck, call_out: PhoneCall, additional_work: Wrench, site_visit: FileSignature, proposal: FileText, amendment: FilePen };

function rowsFrom(items: JobReviewItem[], siteVisits: SiteVisitReviewItem[], approvals: ApprovalReviewItem[]): ReviewRow[] {
  const decisions = approvals.map<ReviewRow>((a) => ({
    key: `${a.type}:${a.id}`,
    type: a.type,
    ref: a.title,
    contractNumber: null,
    /* "Client · AED 4,510" or "Client · reason", as the home page lists it. */
    customerName: a.subtitle ?? "",
    propertyLabel: "",
    submittedAt: a.when,
    status: "to_approve",
    job: null,
    siteVisit: null,
    approval: a,
    href: a.href,
  }));
  const visits = siteVisits.map<ReviewRow>((v) => ({
    key: `sv:${v.id}`,
    type: "site_visit",
    ref: v.number,
    contractNumber: null,
    customerName: v.customerName ?? "",
    propertyLabel: v.propertyLabel ?? "",
    submittedAt: v.completedAt,
    status: "to_approve",
    job: null,
    siteVisit: v,
    approval: null,
    href: v.href,
  }));
  const sheets = items.map<ReviewRow>((r) => ({
    key: `js:${r.kind}:${r.visitId}`,
    type: r.kind ?? "ppm",
    ref: r.ref ?? `Visit ${r.visitNo}`,
    contractNumber: r.contractNumber || null,
    customerName: r.customerName,
    propertyLabel: r.propertyLabel,
    submittedAt: r.submittedAt,
    status: r.reviewReasons.length ? "close_look" : "routine",
    job: r,
    siteVisit: null,
    approval: null,
    href: r.href ?? `${visitPageHref(r.visitId)}?tab=job_sheet`,
  }));
  /* Oldest first, whatever the type. */
  return [...decisions, ...visits, ...sheets].sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
}

/* Its place in the contract: the schedule for a planned visit, Call outs & work for the rest (DEV-497). */
const contractHref = (r: Pick<JobReviewItem, "contractId" | "visitId" | "kind">) =>
  r.kind === "ppm" ? `/extensions/amc-contracts/${r.contractId}?tab=schedule&visit=${r.visitId}` : `/extensions/amc-contracts/${r.contractId}?tab=call-outs`;

function submittedLabel(iso: string): string {
  return formatDubaiShort(iso);
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
  const [type, setType] = useState("any");
  const [status, setStatus] = useState("any");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const router = useRouter();
  /* The review is the visit page's Job sheet tab. */
  /* Each sheet opens on its own page (DEV-497): a visit or call out on the visit page, additional work on its page. */
  const showReview = useCallback((row: ReviewRow) => router.push(row.href), [router]);

  const term = search.trim().toLowerCase();
  const all = useMemo(() => rowsFrom(data?.items ?? [], data?.siteVisits ?? [], data?.approvals ?? []), [data]);
  const matching = useMemo(
    () =>
      all.filter(
        (r) =>
          (type === "any" || r.type === type) &&
          (status === "any" || r.status === status) &&
          (!term || [r.contractNumber ?? "", r.customerName, r.propertyLabel, r.ref, TYPE_LABEL[r.type]].some((v) => v.toLowerCase().includes(term))),
      ),
    [all, type, status, term],
  );
  const rows = matching.slice(page * pageSize, (page + 1) * pageSize);
  const filtered = Boolean(term) || type !== "any" || status !== "any";

  const columns = useMemo<ColumnDef<ReviewRow>[]>(
    () => [
      {
        id: "item",
        header: "Item",
        cell: ({ row }) => (
          <IdentityCell
            title={row.original.ref}
            subtitle={
              row.original.contractNumber ??
              (row.original.approval ? (row.original.approval.status ?? TYPE_LABEL[row.original.type]) : row.original.siteVisit?.assessorName ? `By ${row.original.siteVisit.assessorName}` : "Before a proposal")
            }
            icon={TYPE_ICON[row.original.type]}
          />
        ),
      },
      {
        id: "type",
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="secondary" className="border-0 font-medium whitespace-nowrap">
            {TYPE_LABEL[row.original.type]}
          </Badge>
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
            <TruncatedText text={row.original.propertyLabel} className="max-w-[240px] text-sm" />
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
      {
        id: "submitted",
        header: "Submitted",
        cell: ({ row }) =>
          row.original.submittedAt ? (
            <span className="flex flex-col text-sm whitespace-nowrap">
              <span>{submittedLabel(row.original.submittedAt)}</span>
              <span className="text-muted-foreground text-xs">{timeAgo(row.original.submittedAt)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <span className="flex max-w-[280px] flex-wrap gap-1">
            {row.original.job ? (
              <ReviewReasonBadges reasons={row.original.job.reviewReasons} />
            ) : (
              <Badge variant="secondary" className="bg-warning/10 text-warning border-0 font-medium">
                {row.original.type === "amendment" ? "To decide" : "To approve"}
              </Badge>
            )}
          </span>
        ),
      },
      {
        id: "returns",
        header: "Returns",
        cell: ({ row }) =>
          row.original.job?.returnCount ? (
            <span className="text-sm tabular-nums">{row.original.job.returnCount}</span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
      {
        id: "report",
        header: "Report",
        cell: ({ row }) => (row.original.job ? <ReportClockBadge state={row.original.job.reportState} /> : <span className="text-muted-foreground text-sm">—</span>),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="outline" onClick={() => showReview(row.original)}>
              {row.original.job ? "Review" : row.original.type === "amendment" ? "Decide" : "Approve"}
            </Button>
            {row.original.job ? (
              <Button size="icon" variant="ghost" className="size-8" asChild>
                <Link href={contractHref(row.original.job)} aria-label={`Open the contract for ${row.original.ref}`} title="Open in the contract">
                  <ExternalLink className="size-4" />
                </Link>
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [showReview],
  );

  const clearFilters = () => {
    setSearch("");
    setType("any");
    setStatus("any");
    setPage(0);
  };

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Operations"
        title="Approvals & reviews"
        info={<ModuleGuide module="jobReviews" />}
        description="Everything waiting for your decision or review, oldest first: proposals, contract amendments and site visit reports to approve, and the submitted job sheets of planned visits, call outs and additional work."
      />

      {data && !data.migrated ? (
        <Alert variant="warning">
          <Database className="text-warning" />
          <AlertTitle>Job sheet reviews need a database update</AlertTitle>
          <AlertDescription>
            The job sheet tables are not on this database yet (migration 20261012110000). Ask an admin to apply it.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? <ErrorState title="Could not load the approvals and reviews" message={error} onRetry={reload} /> : null}

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
          handleRowClick={(row) => showReview(row)}
          toolbar={
            <JobReviewsToolbar
              search={search}
              onSearchChange={(v) => {
                setSearch(v);
                setPage(0);
              }}
              loading={loading}
              type={type}
              onTypeChange={(v) => {
                setType(v);
                setPage(0);
              }}
              status={status}
              onStatusChange={(v) => {
                setStatus(v);
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
              title={all.length && filtered ? "Nothing matches" : "Nothing to review"}
              description={
                all.length && filtered
                  ? "Nothing waiting for a review matches this search and these filters."
                  : "Proposals, contract amendments and completed site visits wait here for their approver, and submitted job sheets (planned visits, call outs and additional work) for a supervisor to return or close them."
              }
              action={all.length && filtered ? { label: "Clear filters", variant: "outline", onClick: clearFilters } : undefined}
            />
          }
        />
      </Card>

    </div>
  );
}

/** The same shape as Snagging's jobs toolbar: search and filter on the left, page size and Refresh on the right. */
function JobReviewsToolbar({
  search,
  onSearchChange,
  loading,
  type,
  onTypeChange,
  status,
  onStatusChange,
  pageSize,
  onPageSizeChange,
  onRefresh,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  type: string;
  onTypeChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
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
              placeholder="Search number, client, property or contract no.…"
              className="peer w-full ps-9"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label="Search approvals and reviews"
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
              {loading ? <LoaderCircleIcon aria-label="Loading..." className="animate-spin" role="status" size={16} /> : <SearchIcon aria-hidden="true" size={16} />}
            </div>
          </div>
          <StatusSelect options={TYPE_OPTIONS} value={type} onChange={onTypeChange} label="Filter by type" />
          <StatusSelect options={STATUS_OPTIONS} value={status} onChange={onStatusChange} label="Filter by status" />
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

          <AmcRefreshButton onRefresh={onRefresh} loading={loading} />
        </div>
      </div>
    </div>
  );
}
