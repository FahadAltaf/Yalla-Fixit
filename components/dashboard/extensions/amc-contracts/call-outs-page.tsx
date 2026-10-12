"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Database, PhoneCall, Plus } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { PageHeading, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { CALL_OUT_PRIORITY_LABELS } from "@/lib/amc/call-outs";
import { callOutsService, type CallOutRecord } from "@/modules/amc-contracts/call-outs-service";

import { AmcNotificationsBell } from "./amc-notifications-bell";
import { CallOutDetailDialog } from "./call-out-detail-dialog";
import { CallOutStatusBadge, CoverageBadge, ListToolbar, PriorityBadge, SlaBadge, shortDateTime, useUrlDialog } from "./call-out-shared";
import { LogCallOutDialog } from "./log-call-out-dialog";
import { useAmcData } from "./use-amc-data";
import { useDialog } from "./profile/use-dialog";

const SCOPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "open", label: "Open call outs" },
  { value: "all", label: "All call outs" },
];
const PRIORITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "any", label: "Any priority" },
  { value: "emergency", label: CALL_OUT_PRIORITY_LABELS.emergency },
  { value: "non_emergency", label: CALL_OUT_PRIORITY_LABELS.non_emergency },
];

/** Shared columns for the page and the contract's tab. */
export function callOutColumns({ withClient = true }: { withClient?: boolean } = {}): ColumnDef<CallOutRecord>[] {
  return [
    {
      id: "callOut",
      header: "Call out",
      cell: ({ row }) => (
        <IdentityCell
          title={row.original.callOutNo}
          subtitle={withClient ? row.original.contractNumber || "Contract" : null}
          icon={PhoneCall}
          badge={row.original.priority === "emergency" ? <PriorityBadge priority="emergency" /> : null}
        />
      ),
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
          } satisfies ColumnDef<CallOutRecord>,
        ]
      : []),
    {
      id: "issue",
      header: "Issue",
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-[280px] text-sm" title={row.original.issue}>
          {row.original.issue}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <CallOutStatusBadge status={row.original.status} />,
    },
    {
      id: "sla",
      header: "SLA",
      cell: ({ row }) => <SlaBadge state={row.original.slaState} dueAt={row.original.attendDueAt ?? row.original.scheduleDueAt} />,
    },
    {
      id: "coverage",
      header: "Coverage",
      cell: ({ row }) => <CoverageBadge coverage={row.original.coverage} reserved={row.original.reserved} />,
    },
    {
      id: "reported",
      header: "Reported",
      cell: ({ row }) => (
        <span className="flex flex-col text-sm whitespace-nowrap">
          <span>{shortDateTime(row.original.reportedAt)}</span>
          <span className="text-muted-foreground text-xs">{timeAgo(row.original.reportedAt)}</span>
        </span>
      ),
    },
  ];
}

/**
 * AMC -> Call outs (Phase 11: DEV-405, 406): every call out the person
 * may see, newest first, with its SLA and coverage. Logging one shows the
 * coverage answer before it is confirmed; opening one schedules the crew,
 * records attendance and findings, and closes it. ?open=<id> (from a
 * notification) opens that call out.
 */
export function CallOutsPage() {
  const [scope, setScope] = useState("open");
  const { data, error, loading, reload } = useAmcData(() => callOutsService.list({ open: scope === "open" }), `call-outs:${scope}`);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("any");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const detail = useUrlDialog("open");
  const logging = useDialog<true>();

  const term = search.trim().toLowerCase();
  const all = useMemo(() => data?.callOuts ?? [], [data]);
  const matching = useMemo(
    () =>
      all.filter(
        (c) =>
          (priority === "any" || c.priority === priority) &&
          (!term || [c.callOutNo, c.contractNumber, c.customerName, c.propertyLabel, c.issue].some((v) => v.toLowerCase().includes(term))),
      ),
    [all, priority, term],
  );
  const rows = matching.slice(page * pageSize, (page + 1) * pageSize);
  const filtered = Boolean(term) || priority !== "any";
  const columns = useMemo(() => callOutColumns(), []);

  const clearFilters = () => {
    setSearch("");
    setPriority("any");
    setPage(0);
  };

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Operations"
        title="Call outs"
        description="Emergency and non-emergency call outs on AMC contracts: the SLA clock, whether each is covered, and the visit, findings and additional work."
        actions={
          <>
            <AmcNotificationsBell />
            {data?.canCreate && data.migrated ? (
              <Button onClick={() => logging.show(true)}>
                <Plus className="size-4" />
                Log call out
              </Button>
            ) : null}
          </>
        }
      />

      {data && !data.migrated ? (
        <Alert className="border-warning/30 bg-warning/5 items-start p-4">
          <Database className="text-warning" />
          <AlertTitle>Call outs are not set up on this database yet</AlertTitle>
          <AlertDescription>The call-out tables are not on this database yet (migration 20261012120000). Ask an admin to apply it.</AlertDescription>
        </Alert>
      ) : null}

      {error ? <ErrorState title="Could not load the call outs" message={error} onRetry={reload} /> : null}

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
              placeholder="Search call out, client, property or issue…"
              searchLabel="Search call outs"
              loading={loading}
              filters={[
                {
                  value: scope,
                  onChange: (v) => {
                    setScope(v);
                    setPage(0);
                  },
                  options: SCOPE_OPTIONS,
                  label: "Open or all call outs",
                },
                {
                  value: priority,
                  onChange: (v) => {
                    setPriority(v);
                    setPage(0);
                  },
                  options: PRIORITY_OPTIONS,
                  label: "Filter by priority",
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
              icon={<PhoneCall />}
              title={all.length && filtered ? "No matching call outs" : scope === "open" ? "No open call outs" : "No call outs yet"}
              description={
                all.length && filtered
                  ? "No call out matches this search and filter."
                  : "When a client calls about a fault on an AMC property, log it here: the coverage answer and the SLA clock start at once."
              }
              action={
                all.length && filtered
                  ? { label: "Clear filters", variant: "outline", onClick: clearFilters }
                  : data?.canCreate && data.migrated
                    ? { label: "Log call out", onClick: () => logging.show(true) }
                    : undefined
              }
            />
          }
        />
      </Card>

      <CallOutDetailDialog key={`detail-${detail.key}`} callOutId={detail.target} open={detail.open} onOpenChange={detail.onOpenChange} onChanged={reload} />
      <LogCallOutDialog
        key={`log-${logging.key}`}
        open={logging.open}
        onOpenChange={logging.onOpenChange}
        onLogged={reload}
        onOpenCallOut={(id) => {
          logging.onOpenChange(false);
          detail.show(id);
        }}
      />
    </div>
  );
}
