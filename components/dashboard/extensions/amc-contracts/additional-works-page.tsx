"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Database, Hammer, Plus } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { PageHeading, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Money } from "@/components/ui/money";
import { additionalWorksService, type AdditionalWorkRecord } from "@/modules/amc-contracts/additional-works-service";

import { AdditionalWorkDetailDialog, workSourceLabel } from "./additional-work-detail-dialog";
import { AmcNotificationsBell } from "./amc-notifications-bell";
import { ListToolbar, RiskBadge, WorkStatusBadge, useUrlDialog } from "./call-out-shared";
import { RaiseAdditionalWorkDialog } from "./raise-additional-work-dialog";
import { useAmcData } from "./use-amc-data";
import { useDialog } from "./profile/use-dialog";

const SCOPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "open", label: "Open work" },
  { value: "awaiting", label: "Awaiting the client" },
  { value: "all", label: "All work" },
];

/* Paid or rejected is finished; everything else still needs someone. */
export const isOpenWork = (w: Pick<AdditionalWorkRecord, "status">) => w.status !== "paid" && w.status !== "rejected";

/** Shared columns for the page and the contract's tab. */
export function workColumns({ withClient = true }: { withClient?: boolean } = {}): ColumnDef<AdditionalWorkRecord>[] {
  return [
    {
      id: "work",
      header: "Work",
      cell: ({ row }) => <IdentityCell title={row.original.workNo} subtitle={withClient ? row.original.contractNumber || "Contract" : null} icon={Hammer} />,
    },
    ...(withClient
      ? [
          {
            id: "client",
            header: "Client",
            cell: ({ row }) => (
              <span className="flex max-w-[240px] flex-col text-sm">
                <span>{row.original.customerName || <span className="text-muted-foreground">—</span>}</span>
                {row.original.propertyLabel ? <span className="text-muted-foreground line-clamp-1 text-xs">{row.original.propertyLabel}</span> : null}
              </span>
            ),
          } satisfies ColumnDef<AdditionalWorkRecord>,
        ]
      : []),
    {
      id: "source",
      header: "Found on",
      cell: ({ row }) => <span className="text-sm whitespace-nowrap">{workSourceLabel(row.original)}</span>,
    },
    {
      id: "finding",
      header: "Finding",
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-[280px] text-sm" title={row.original.finding}>
          {row.original.finding}
        </span>
      ),
    },
    {
      id: "risk",
      header: "Risk",
      cell: ({ row }) => <RiskBadge risk={row.original.risk} />,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <WorkStatusBadge status={row.original.status} />,
    },
    {
      id: "total",
      header: () => <span className="block text-right">Total</span>,
      cell: ({ row }) => (
        <span className="block text-right text-sm">
          {row.original.quotationLines.length ? <Money value={row.original.totals.total} /> : <span className="text-muted-foreground">Not quoted</span>}
        </span>
      ),
    },
    {
      id: "raised",
      header: "Raised",
      cell: ({ row }) => <span className="text-muted-foreground text-sm whitespace-nowrap">{timeAgo(row.original.createdAt)}</span>,
    },
  ];
}

/**
 * AMC -> Additional work (Phase 11: DEV-407): work outside the contract
 * found on a visit or a call out, or raised by hand, from the finding to
 * the quotation, the client's approval, the work, the invoice and the
 * payment. ?open=<id> (from a notification) opens that work.
 */
export function AdditionalWorksPage() {
  const { data, error, loading, reload } = useAmcData(() => additionalWorksService.list(), "additional-works");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("open");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const detail = useUrlDialog("open");
  const raising = useDialog<true>();

  const term = search.trim().toLowerCase();
  const all = useMemo(() => data?.works ?? [], [data]);
  const matching = useMemo(
    () =>
      all.filter(
        (w) =>
          (scope === "all" || (scope === "open" ? isOpenWork(w) : w.status === "quotation_prepared" || w.status === "shared")) &&
          (!term || [w.workNo, w.contractNumber, w.customerName, w.propertyLabel, w.finding, w.callOutNo ?? ""].some((v) => v.toLowerCase().includes(term))),
      ),
    [all, scope, term],
  );
  const rows = matching.slice(page * pageSize, (page + 1) * pageSize);
  const filtered = Boolean(term) || scope !== "all";
  const columns = useMemo(() => workColumns(), []);
  const options = useMemo(
    () =>
      SCOPE_OPTIONS.map((o) => ({
        ...o,
        count: o.value === "all" ? all.length : o.value === "open" ? all.filter(isOpenWork).length : all.filter((w) => w.status === "quotation_prepared" || w.status === "shared").length,
      })),
    [all],
  );

  const clearFilters = () => {
    setSearch("");
    setScope("all");
    setPage(0);
  };

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Operations"
        title="Additional work"
        description="Work outside the contract found on visits and call outs: quoted to the client, approved with evidence, done, invoiced and paid."
        actions={
          <>
            <AmcNotificationsBell />
            {data?.canCreate && data.migrated ? (
              <Button onClick={() => raising.show(true)}>
                <Plus className="size-4" />
                Raise additional work
              </Button>
            ) : null}
          </>
        }
      />

      {data && !data.migrated ? (
        <Alert className="border-warning/30 bg-warning/5 items-start p-4">
          <Database className="text-warning" />
          <AlertTitle>Additional work is not set up on this database yet</AlertTitle>
          <AlertDescription>The additional-work tables are not on this database yet (migration 20261012120000). Ask an admin to apply it.</AlertDescription>
        </Alert>
      ) : null}

      {error ? <ErrorState title="Could not load the additional work" message={error} onRetry={reload} /> : null}

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
          handleRowClick={(row) => detail.show(row.id)}
          toolbar={
            <ListToolbar
              search={search}
              onSearchChange={(v) => {
                setSearch(v);
                setPage(0);
              }}
              placeholder="Search work no., client, property or finding…"
              searchLabel="Search additional work"
              loading={loading}
              filters={[
                {
                  value: scope,
                  onChange: (v) => {
                    setScope(v);
                    setPage(0);
                  },
                  options,
                  label: "Filter by stage",
                },
              ]}
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
              icon={<Hammer />}
              title={all.length && filtered ? "No matching additional work" : "No additional work yet"}
              description={
                all.length && filtered
                  ? "Nothing matches this search and filter."
                  : "Work outside the contract that a crew finds on a visit or a call out is raised here, then quoted to the client."
              }
              action={
                all.length && filtered
                  ? { label: "Show all", variant: "outline", onClick: clearFilters }
                  : data?.canCreate && data.migrated
                    ? { label: "Raise additional work", onClick: () => raising.show(true) }
                    : undefined
              }
            />
          }
        />
      </Card>

      <AdditionalWorkDetailDialog key={`detail-${detail.key}`} workId={detail.target} open={detail.open} onOpenChange={detail.onOpenChange} onChanged={reload} />
      <RaiseAdditionalWorkDialog
        key={`raise-${raising.key}`}
        open={raising.open}
        onOpenChange={raising.onOpenChange}
        source="manual"
        onRaised={async (w) => {
          await reload();
          detail.show(w.id);
        }}
      />
    </div>
  );
}
