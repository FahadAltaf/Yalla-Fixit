"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Briefcase,
  FileText,
  Plus,
  UserRound,
} from "lucide-react";

import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
import { DirhamIcon } from "@/components/ui/dirham-icon";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { SnaggingQuotationsToolbar } from "@/components/data-table/toolbars/snagging-quotations-toolbar";
import { useDebounce } from "@/hooks/use-debounce";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import {
  snaggingService,
  type SnaggingQuotationSummary,
} from "@/modules/snagging";
import { ActionType, ResourceType } from "@/types/types";

import {
  ErrorState,
  PageHeading,
  QuotationStatusBadge,
  formatLocalDate,
} from "./shared";
import { DesnagQuotationDialog } from "./desnag-quotation-dialog";


const KIND_LABEL: Record<string, string> = {
  inspection: "Inspection",
  visit: "Additional visit",
  desnag: "De-snagging",
};

/**
 * Quotations, as their own section (BA v2, changes 1-3; BRD §6.2).
 *
 * The team quotes a client and raises the job only once that quotation
 * comes back approved. Until now a quotation was a tab inside a job, which
 * forced the opposite order: every enquiry began by creating work nobody
 * had agreed to pay for, and the ones that went nowhere left draft jobs
 * behind.
 *
 * The column that makes this screen worth opening is the last one. An
 * approved quotation with no job yet is the team's actual to-do list, and
 * it says so with a button rather than a status word.
 */
export default function QuotationsAdmin() {
  const router = useRouter();
  const { userProfile } = useAuth();
  const canCreate = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.CREATE,
  );

  const [rows, setRows] = useState<SnaggingQuotationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /*
    Seeded from ?status=, so the Overview's quotation funnel can open this
    list already filtered (FR-10.01) rather than dropping the reader on
    "All" and making them find the bar they just clicked.
  */
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [desnagOpen, setDesnagOpen] = useState(false);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Searched on the server, a moment after typing stops.
  const debouncedSearch = useDebounce(search.trim(), 300);

  /*
    A page at a time from the server, searched there too. The list used
    to arrive whole and stop silently at the newest 400 quotations.
  */
  /* Only the latest request may fill the table: a slower reply for an
     earlier filter or page used to land last and show the wrong rows. */
  const ticket = useRef(0);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const result = await snaggingService.listQuotations({
        status,
        search: debouncedSearch || undefined,
        page,
        pageSize,
      });
      if (mine !== ticket.current) return;
      setRows(result.data);
      setTotal(result.totalCount);
      setCounts(result.counts ?? {});
    } catch (err) {
      if (mine !== ticket.current) return;
      setError(err instanceof Error ? err.message : "Could not load quotations");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [status, debouncedSearch, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    Status as pills rather than a dropdown, matching the jobs table: a
    coordinator filters far more often than they search, and a count on
    each pill answers "how much is waiting" without applying the filter.
  */
  const statusTabs = useMemo(() => {
    const count = (value: string) => counts[value] ?? 0;
    return [
      { value: "all", label: "All", count: count("all") },
      { value: "draft", label: "Draft", count: count("draft") },
      { value: "sent", label: "Sent", count: count("sent") },
      { value: "approved", label: "Approved", count: count("approved") },
      { value: "rejected", label: "Rejected", count: count("rejected") },
    ];
  }, [counts]);

  /* The whole point of the section: approved, and nobody has raised it yet. */
  const awaitingJob = useMemo(
    () => rows.filter((r) => r.status === "approved" && !r.job_id).length,
    [rows],
  );

  const columns = useMemo<ColumnDef<SnaggingQuotationSummary>[]>(
    () => [
      {
        id: "quote_number",
        header: "Quotation",
        accessorKey: "quote_number",
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <IconText icon={FileText} className="font-medium tabular-nums">
              {row.original.quote_number}
            </IconText>
            <span className="text-muted-foreground text-xs">
              {KIND_LABEL[row.original.quote_kind] ?? row.original.quote_kind} ·{" "}
              {formatLocalDate(row.original.created_at)}
            </span>
          </div>
        ),
      },
      {
        id: "client_name",
        header: "Client & property",
        accessorKey: "client_name",
        cell: ({ row }) => {
          const q = row.original;
          const place = [q.unit_label, q.building_name].filter(Boolean).join(", ");
          return (
            // The shared identity cell, as the Jobs table uses it.
            <IdentityCell
              title={q.client_name || "—"}
              subtitle={place || "No property recorded"}
              icon={UserRound}
            />
          );
        },
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ row }) => <QuotationStatusBadge status={row.original.status} />,
      },
      {
        id: "total",
        header: "Total",
        accessorKey: "total",
        cell: ({ row }) => (
          // Dirhams carry the dirham sign; any other currency keeps its code.
          (row.original.currency || "AED") === "AED" ? (
            <IconText icon={DirhamIcon} className="font-medium tabular-nums">
              {new Intl.NumberFormat("en-AE", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }).format(row.original.total ?? 0)}
            </IconText>
          ) : (
            <span className="text-sm font-medium tabular-nums">
              {new Intl.NumberFormat("en-AE", {
                style: "currency",
                currency: row.original.currency,
                minimumFractionDigits: 2,
              }).format(row.original.total ?? 0)}
            </span>
          )
        ),
      },
      {
        id: "job",
        header: "Job",
        enableSorting: false,
        cell: ({ row }) => {
          const q = row.original;

          /*
            One button per state, and the code is not one of them.

            The column used to print a job code, which reads as an
            identifier to memorise when the only thing anybody wants from
            it is to go there. Whoever raised the job is on the job
            itself; repeating it here made the cell wide and told nobody
            anything they act on.
          */
          if (q.job_id) {
            return (
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => {
                  event.stopPropagation();
                  router.push(`/snagging/${q.job_id}`);
                }}
              >
                <Briefcase className="size-4" />
                Open job
              </Button>
            );
          }

          /*
            Approved with no job is the one row that needs an action rather
            than a status. This is where the team's day starts.
          */
          if (q.status === "approved") {
            return canCreate ? (
              <Button
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  router.push(`/snagging/jobs/new?quotation=${q.id}`);
                }}
              >
                <Plus className="size-4" />
                Create job
              </Button>
            ) : (
              <Badge className="bg-primary/10 text-primary rounded-sm border-none">
                Approved — awaiting a job
              </Badge>
            );
          }

          return (
            <span className="text-muted-foreground text-sm">
              {q.status === "rejected" ? "Not proceeding" : "Not yet approved"}
            </span>
          );
        },
      },
    ],
    [canCreate, router],
  );

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading
          eyebrow="Sales"
          title="Quotations"
          description="Every price quoted, and which of them have become jobs."
        />
        <ErrorState
          title="Could not load quotations"
          message={error}
          onRetry={() => void load()}
          retrying={loading}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Sales"
        title="Quotations"
        description="Price a client's property first. The job is raised once they approve."
        actions={
          // A de-snag quotation starts from a finished job, through its own
          // dialog (setDesnagOpen); that button is off for now.
          canCreate ? (
            <Button onClick={() => router.push("/snagging/quotations/new")}>
              <Plus className="size-4" />
              New quotation
            </Button>
          ) : null
        }
      />


      {/*
        One line, because one number matters: how much agreed work has not
        been turned into a job yet.
      */}
      {/* {awaitingJob > 0 ? (
        <Alert>
          <Briefcase />
          <AlertTitle>
            {awaitingJob} approved quotation{awaitingJob === 1 ? "" : "s"}{" "}
            {awaitingJob === 1 ? "has" : "have"} no job yet
          </AlertTitle>
          <AlertDescription>
            Raise the job from the row, and the client and property carry over.
          </AlertDescription>
        </Alert>
      ) : null} */}

      <Card className="py-0">
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          rowCount={total}
          pageSize={pageSize}
          currentPage={page}
          isPagination
          onPageChange={setPage}
          onPageSizeChange={() => undefined}
          onGlobalFilterChange={(value) => {
            setSearch(value);
            setPage(0);
          }}
          handleRowClick={(row) => router.push(`/snagging/quotations/${row.id}`)}
          toolbar={
            <SnaggingQuotationsToolbar
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
              statusTabs={statusTabs}
              statusValue={status}
              onStatusChange={(value) => {
                setStatus(value);
                setPage(0);
              }}
              canCreate={canCreate}
              onCreate={() => router.push("/snagging/quotations/new")}
              onCreateDesnag={() => setDesnagOpen(true)}
            />
          }
          emptyState={
            <EmptyState
              icon={<FileText className="size-5" />}
              title={
                search.trim() || status !== "all"
                  ? "Nothing matches that"
                  : "No quotations yet"
              }
              description={
                search.trim() || status !== "all"
                  ? "Try a different status, or part of the client's name."
                  : "Quote a client's property and the job follows once they approve it."
              }
            />
          }
        />
      </Card>

      <DesnagQuotationDialog
        open={desnagOpen}
        onOpenChange={setDesnagOpen}
        onCreated={(quote) => {
          setDesnagOpen(false);
          router.push(`/snagging/quotations/${quote.id}`);
        }}
      />
    </div>
  );
}
