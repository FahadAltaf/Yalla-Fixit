"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Briefcase,
  FileText,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { SnaggingQuotationsToolbar } from "@/components/data-table/toolbars/snagging-quotations-toolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import {
  snaggingService,
  type SnaggingQuotationSummary,
} from "@/modules/snagging";
import {
  ActionType,
  ResourceType,
  type SnaggingTaskSummary,
} from "@/types/types";

import {
  ErrorState,
  PageHeading,
  QuotationStatusBadge,
  SubmitButton,
  formatGstDate,
} from "./shared";


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
              {formatGstDate(row.original.created_at)}
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
            <IdentityCell
              title={q.client_name || "—"}
              subtitle={place || "No property recorded"}
              seed={q.client_id ?? q.id}
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

          if (q.job_id) {
            return (
              <Link
                href={`/snagging/${q.job_id}`}
                className="text-primary inline-flex items-center gap-1.5 text-sm hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                <Briefcase className="size-3.5" />
                {q.job_code ?? "Open job"}
              </Link>
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
      {awaitingJob > 0 ? (
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
      ) : null}

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
        onClose={() => setDesnagOpen(false)}
        onCreated={(id) => {
          setDesnagOpen(false);
          router.push(`/snagging/quotations/${id}`);
        }}
      />
    </div>
  );
}

/**
 * Raises a de-snag quotation against a job already carried out.
 *
 * Only finished jobs are offered. A de-snag verifies fixes to defects that
 * have been reported, so quoting one against an inspection still being
 * walked would price a return visit to a first visit that has not
 * happened.
 */
function DesnagQuotationDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (quotationId: string) => void;
}) {
  const [jobs, setJobs] = useState<SnaggingTaskSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await snaggingService.listTasks(
          { status: "approved,delivered" },
          0,
          200,
        );
        if (!cancelled) setJobs(res.data ?? []);
      } catch {
        if (!cancelled) setJobs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function create() {
    if (!jobId) return;
    setSaving(true);
    try {
      const quote = await snaggingService.createDesnagQuotation(jobId);
      toast.success(`De-snag quotation ${quote.quote_number} created`);
      onCreated(quote.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not raise the quotation",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quote a de-snagging visit</DialogTitle>
          <DialogDescription>
            The client, the unit and the price come from the original
            inspection. Once they approve it, the round is opened from that
            job with its outstanding defects carried across.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="desnag-job" className="text-muted-foreground text-xs font-medium">
            Which inspection?
          </Label>
          <Select value={jobId} onValueChange={setJobId} disabled={loading}>
            <SelectTrigger id="desnag-job" className="w-full">
              <SelectValue
                placeholder={
                  loading
                    ? "Loading finished inspections…"
                    : jobs.length === 0
                      ? "No finished inspections yet"
                      : "Pick the inspection to return to"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {jobs.map((job) => (
                <SelectItem key={job.id} value={job.id}>
                  {job.code} — {job.unit_label}
                  {job.building_name ? `, ${job.building_name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton
            onClick={() => void create()}
            pending={saving}
            pendingLabel="Pricing…"
            disabled={!jobId}
          >
            Raise quotation
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
