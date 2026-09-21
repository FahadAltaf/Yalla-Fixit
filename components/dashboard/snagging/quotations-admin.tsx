"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Briefcase,
  FileText,
  Plus,
  UserRound,
} from "lucide-react";

import { DataTable } from "@/components/data-table";
import { SnaggingQuotationsToolbar } from "@/components/data-table/toolbars/snagging-quotations-toolbar";
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await snaggingService.listQuotations({ status }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load quotations");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [row.quote_number, row.client_name, row.unit_label, row.building_name, row.job_code]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [rows, search]);

  const paginated = useMemo(
    () => filtered.slice(page * pageSize, page * pageSize + pageSize),
    [filtered, page, pageSize],
  );

  /*
    Status as pills rather than a dropdown, matching the jobs table: a
    coordinator filters far more often than they search, and a count on
    each pill answers "how much is waiting" without applying the filter.
  */
  const statusTabs = useMemo(() => {
    const count = (value: string) =>
      value === "all" ? rows.length : rows.filter((r) => r.status === value).length;
    return [
      { value: "all", label: "All", count: count("all") },
      { value: "draft", label: "Draft", count: count("draft") },
      { value: "sent", label: "Sent", count: count("sent") },
      { value: "approved", label: "Approved", count: count("approved") },
      { value: "rejected", label: "Rejected", count: count("rejected") },
    ];
  }, [rows]);

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
            <span className="font-medium tabular-nums">
              {row.original.quote_number}
            </span>
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
            <div className="flex items-center gap-2.5">
              {/*
                One neutral person mark rather than coloured initials.

                A quotation list is read down the Client column looking
                for a name, and eight differently-tinted circles pull the
                eye away from the words that actually distinguish the
                rows.
              */}
              <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
                <UserRound className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate font-medium">{q.client_name || "—"}</div>
                <div className="text-muted-foreground truncate text-sm">
                  {place || "No property recorded"}
                </div>
              </div>
            </div>
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
          <span className="text-sm font-medium tabular-nums">
            {new Intl.NumberFormat("en-AE", {
              style: "currency",
              currency: row.original.currency || "AED",
              minimumFractionDigits: 2,
            }).format(row.original.total ?? 0)}
          </span>
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
          data={paginated}
          loading={loading}
          rowCount={filtered.length}
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
