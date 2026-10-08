"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, CalendarClock, Database, Landmark, Lock, ScrollText, UserRound } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
import { PageHeading, SectionCard, StatCard, StatCardGrid, TabCount, type StatTone } from "@/components/dashboard/shared/kaizen";
import { ErrorState, SectionSkeleton, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import { useDebounce } from "@/hooks/use-debounce";
import { AGEING_LABELS, CHEQUE_STATUS_LABELS, CHEQUE_STATUSES, INSTALMENT_STATUS_LABELS, type AgeingBucket, type ChequeStatus } from "@/lib/amc/payments";
import { hasResourceAction } from "@/lib/role-permissions";
import type { InstalmentFilter } from "@/lib/server/amc/payments";
import {
  PaymentsRequestError,
  paymentsService,
  type BalanceSummary,
  type ChequeListRow,
  type InstalmentListRow,
  type PaymentPermissions,
} from "@/modules/amc-contracts/payments-service";
import { ActionType, ResourceType } from "@/types/types";

import { AmcNotificationsBell } from "./amc-notifications-bell";
import { formatContractDate } from "./contract-status";
import { ChequeActions, usePaymentDialogs, type PaymentDialogs } from "./payment-dialogs";
import { ChequeStatusBadge, DaysOverdue, InstalmentStatusBadge } from "./payment-status";
import { PaymentsToolbar } from "./payments-toolbar";
import { useUrlTab } from "./profile/use-url-tab";

const TABS = ["instalments", "cheques"] as const;
const contractHref = (contractId: string) => `/extensions/amc-contracts/${contractId}?tab=payments`;
/* The most the route gives in one page; a client rarely has more open. */
const CLIENT_ROWS = 100;

/* Open first: what Finance chases. "all" is every status. */
const INSTALMENT_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "due", label: INSTALMENT_STATUS_LABELS.due },
  { value: "partially_received", label: INSTALMENT_STATUS_LABELS.partially_received },
  { value: "cheque_deposited", label: INSTALMENT_STATUS_LABELS.cheque_deposited },
  { value: "bounced", label: INSTALMENT_STATUS_LABELS.bounced },
  { value: "not_due", label: INSTALMENT_STATUS_LABELS.not_due },
  { value: "settled", label: "Settled" },
  { value: "received", label: INSTALMENT_STATUS_LABELS.received },
  { value: "written_off", label: INSTALMENT_STATUS_LABELS.written_off },
  { value: "waived", label: INSTALMENT_STATUS_LABELS.waived },
  { value: "all", label: "All" },
];
const CHEQUE_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  ...CHEQUE_STATUSES.map((s) => ({ value: s, label: CHEQUE_STATUS_LABELS[s] })),
];

/* Late money reads warmer the older it gets. */
const AGEING_TONE: Record<Exclude<AgeingBucket, "current">, StatTone> = { d1_30: "progress", d31_60: "progress", d61_90: "bad", d90_plus: "bad" };

/**
 * AMC -> Payments, for Finance (DEV-383, 384): what is owed across every
 * contract and how late it is, the instalments to chase and the cheque
 * register. AMC Payments (View) only; a row opens its contract's Payments
 * tab, and the cheque actions post to that cheque's contract.
 */
export function PaymentsPage() {
  const { userProfile } = useAuth();
  const { tab, setTab, isOpened } = useUrlTab(TABS, "instalments");
  const [access, setAccess] = useState<"checking" | "ok" | "forbidden">("checking");
  const [summary, setSummary] = useState<BalanceSummary | null>(null);
  const [migrated, setMigrated] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ instalments?: number; cheques?: number }>({});
  const setInstalmentCount = useCallback((n: number) => setCounts((c) => ({ ...c, instalments: n })), []);
  const setChequeCount = useCallback((n: number) => setCounts((c) => ({ ...c, cheques: n })), []);
  /* Bumped after an action, so both tables load again. */
  const [version, setVersion] = useState(0);

  /* The balance over all open money, whatever the tables are filtered to; also the access check. */
  const loadSummary = useCallback(
    () =>
      paymentsService.listInstalments({ status: "open", pageSize: 1 }).then(
        (response) => {
          setSummary(response.summary);
          setMigrated(response.migrated);
          setSummaryError(null);
          setAccess("ok");
        },
        (e) => {
          if (e instanceof PaymentsRequestError && e.status === 403) setAccess("forbidden");
          else {
            setSummaryError(e instanceof Error ? e.message : "Could not load the balance.");
            setAccess("ok");
          }
        },
      ),
    [],
  );

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const dialogs = usePaymentDialogs(() => {
    setVersion((v) => v + 1);
    return loadSummary();
  });

  /* No contract-level rights here: what the role grants decides what is offered (the route checks again). */
  const permissions: PaymentPermissions = {
    canRecord:
      hasResourceAction(userProfile, ResourceType.AMC_PAYMENTS, ActionType.CREATE) ||
      hasResourceAction(userProfile, ResourceType.AMC_PAYMENTS, ActionType.EDIT),
    canEdit: hasResourceAction(userProfile, ResourceType.AMC_PAYMENTS, ActionType.EDIT),
    canApprove: hasResourceAction(userProfile, ResourceType.AMC_PAYMENTS, ActionType.APPROVE),
  };

  const refreshAll = () => {
    void loadSummary();
  };

  const heading = (
    <PageHeading
      eyebrow="Finance"
      title="Payments"
      description="What is owed across AMC contracts and how late it is: instalments to chase and the cheque register."
      actions={<AmcNotificationsBell />}
    />
  );

  if (access === "forbidden") {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        {heading}
        <Card className="p-0">
          <EmptyState
            icon={<Lock className="size-5" />}
            title="You don't have access to payments"
            description="This page needs AMC Payments (View). Ask an admin to add it to your role."
          />
        </Card>
      </div>
    );
  }

  const panel = (value: (typeof TABS)[number], children: React.ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-6 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {heading}

      {!migrated ? (
        <Alert className="border-warning/30 bg-warning/5 items-start p-4">
          <Database className="text-warning" />
          <AlertTitle>Payments need a database update</AlertTitle>
          <AlertDescription>
            The payments tables are not on this database yet (migration 20261008100000). Ask an admin to apply it.
          </AlertDescription>
        </Alert>
      ) : null}

      {summaryError ? <ErrorState title="Could not load the balance" message={summaryError} onRetry={() => void loadSummary()} /> : null}

      {summary ? (
        <>
          <StatCardGrid columns={3}>
            <StatCard label="Outstanding" value={<Money value={summary.outstanding} className="text-xl" />} headline="Open instalments, all contracts" />
            <StatCard
              label="Overdue"
              value={<Money value={summary.overdue} className="text-xl" />}
              headline={summary.overdueCount ? `${summary.overdueCount} ${summary.overdueCount === 1 ? "instalment" : "instalments"} late` : "Nothing late"}
              tone={summary.overdueCount ? "bad" : "neutral"}
              onSelect={() => setTab("instalments")}
              selectLabel="Show the instalments"
            />
            <StatCard label={AGEING_LABELS.current} value={<Money value={summary.ageing.current} className="text-xl" />} headline="Due later" />
          </StatCardGrid>
          <StatCardGrid columns={4}>
            {(["d1_30", "d31_60", "d61_90", "d90_plus"] as const).map((bucket) => (
              <StatCard
                key={bucket}
                label={AGEING_LABELS[bucket]}
                value={<Money value={summary.ageing[bucket]} className="text-xl" />}
                headline={summary.ageing[bucket] > 0 ? "Overdue" : "Nothing this late"}
                tone={summary.ageing[bucket] > 0 ? AGEING_TONE[bucket] : "neutral"}
              />
            ))}
          </StatCardGrid>
        </>
      ) : access === "checking" ? (
        <>
          <StatGridSkeleton count={3} />
          <StatGridSkeleton count={4} />
        </>
      ) : null}

      {access === "ok" ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="instalments">
              Instalments
              <TabCount value={counts.instalments} />
            </TabsTrigger>
            <TabsTrigger value="cheques">
              Cheques
              <TabCount value={counts.cheques} />
            </TabsTrigger>
          </TabsList>
          {panel(
            "instalments",
            <InstalmentsTable version={version} onTotal={setInstalmentCount} onRefresh={refreshAll} />,
          )}
          {panel(
            "cheques",
            <ChequesTable
              version={version}
              permissions={permissions}
              dialogs={dialogs}
              onTotal={setChequeCount}
              onRefresh={refreshAll}
            />,
          )}
        </Tabs>
      ) : null}

      {dialogs.dialogs}
    </div>
  );
}

/**
 * Server paging for one of Finance's tables: the search waits for typing
 * to settle, and only the latest request fills the table. fetchPage must
 * be stable (the module-level fetchers below).
 */
function usePagedList<Row>(
  fetchPage: ListFetch<Row>,
  initialStatus: string,
  version: number,
) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const q = useDebounce(search.trim(), 300);
  const ticket = useRef(0);

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPage({ status, q, page: page + 1, pageSize });
      if (mine !== ticket.current) return;
      setRows(result.rows);
      setTotal(result.total);
    } catch (e) {
      if (mine !== ticket.current) return;
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : "Could not load this list.");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [fetchPage, status, q, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load, version]);

  return {
    rows,
    total,
    loading,
    error,
    load,
    search,
    setSearch: (value: string) => {
      setSearch(value);
      setPage(0);
    },
    status,
    setStatus: (value: string) => {
      setStatus(value);
      setPage(0);
    },
    page,
    setPage,
    pageSize,
    setPageSize: (size: number) => {
      setPageSize(size);
      setPage(0);
    },
  };
}

type ListFetch<Row> = (params: { status: string; q: string; page: number; pageSize: number }) => Promise<{ rows: Row[]; total: number }>;

const fetchInstalments: ListFetch<InstalmentListRow> = async ({ status, q, page, pageSize }) => {
  const r = await paymentsService.listInstalments({ status: status === "all" ? null : (status as InstalmentFilter), q, page, pageSize });
  return { rows: r.instalments, total: r.total };
};

const fetchCheques: ListFetch<ChequeListRow> = async ({ status, q, page, pageSize }) => {
  const r = await paymentsService.listCheques({ status: status === "all" ? null : (status as ChequeStatus), q, page, pageSize });
  return { rows: r.cheques, total: r.total };
};

function ClientCell({ contract, extra }: { contract: InstalmentListRow["contract"]; extra?: string | null }) {
  return (
    <IdentityCell
      title={contract?.customerName || "Unnamed client"}
      subtitle={[contract?.contractNumber ? `Contract ${contract.contractNumber}` : null, extra].filter(Boolean).join(" · ") || undefined}
      icon={UserRound}
    />
  );
}

function InstalmentsTable({ version, onTotal, onRefresh }: { version: number; onTotal: (n: number) => void; onRefresh: () => void }) {
  const router = useRouter();
  const list = usePagedList(fetchInstalments, "open", version);
  const { total } = list;
  useEffect(() => onTotal(total), [total, onTotal]);

  const columns: ColumnDef<InstalmentListRow>[] = [
    { id: "client", header: "Client", cell: ({ row }) => <ClientCell contract={row.original.contract} /> },
    {
      id: "property",
      header: "Property",
      cell: ({ row }) =>
        row.original.contract?.propertyLabel ? (
          <span className="flex max-w-[240px] items-start gap-1.5 text-sm">
            <Building2 className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="line-clamp-2">{row.original.contract.propertyLabel}</span>
          </span>
        ) : (
          <IconText icon={Building2} muted>
            —
          </IconText>
        ),
    },
    { id: "no", header: "#", cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.instalmentNo}</span> },
    { id: "due", header: "Due", cell: ({ row }) => <span className="text-sm tabular-nums">{formatContractDate(row.original.dueDate)}</span> },
    { id: "total", header: "Total", cell: ({ row }) => <Money value={row.original.total} className="text-sm" /> },
    { id: "outstanding", header: "Outstanding", cell: ({ row }) => <Money value={row.original.outstanding} className="text-sm font-medium" /> },
    { id: "status", header: "Status", cell: ({ row }) => <InstalmentStatusBadge status={row.original.status} /> },
    { id: "late", header: "Overdue", cell: ({ row }) => <span className="text-sm"><DaysOverdue days={row.original.daysOverdue} /></span> },
  ];

  const searched = Boolean(list.search.trim());
  return (
    <>
      {list.error ? <ErrorState title="Could not load the instalments" message={list.error} onRetry={() => void list.load()} retrying={list.loading} /> : null}
      <Card className="py-0">
        <DataTable
          columns={columns}
          data={list.rows}
          loading={list.loading}
          rowCount={list.total}
          pageSize={list.pageSize}
          currentPage={list.page}
          isPagination
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
          onGlobalFilterChange={list.setSearch}
          handleRowClick={(row) => router.push(contractHref(row.contractId))}
          toolbar={
            <PaymentsToolbar
              search={list.search}
              onSearchChange={list.setSearch}
              searchLabel="Search instalments"
              loading={list.loading}
              statusOptions={INSTALMENT_FILTERS}
              status={list.status}
              onStatusChange={list.setStatus}
              pageSize={list.pageSize}
              onPageSizeChange={list.setPageSize}
              onRefresh={() => {
                void list.load();
                onRefresh();
              }}
            />
          }
          emptyState={
            <EmptyState
              icon={<CalendarClock />}
              title={searched || !["open", "all"].includes(list.status) ? "No matching instalments" : list.status === "open" ? "Nothing open" : "No instalments yet"}
              description={
                searched || !["open", "all"].includes(list.status)
                  ? "Nothing matches this search and filter."
                  : list.status === "open"
                    ? "Every instalment is settled."
                    : "Instalments appear when a contract is activated."
              }
              action={
                searched || list.status !== "open"
                  ? {
                      label: "Clear filters",
                      variant: "outline",
                      onClick: () => {
                        list.setSearch("");
                        list.setStatus("open");
                      },
                    }
                  : undefined
              }
            />
          }
        />
      </Card>
    </>
  );
}

function ChequesTable({
  version,
  permissions,
  dialogs,
  onTotal,
  onRefresh,
}: {
  version: number;
  permissions: PaymentPermissions;
  dialogs: PaymentDialogs;
  onTotal: (n: number) => void;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const list = usePagedList(fetchCheques, "all", version);
  const { total } = list;
  useEffect(() => onTotal(total), [total, onTotal]);

  const columns: ColumnDef<ChequeListRow>[] = [
    { id: "no", header: "Cheque no.", cell: ({ row }) => <span className="text-sm font-medium tabular-nums">{row.original.chequeNo}</span> },
    {
      id: "bank",
      header: "Bank",
      cell: ({ row }) => (
        <IconText icon={Landmark} muted={!row.original.bank}>
          {row.original.bank || "—"}
        </IconText>
      ),
    },
    { id: "date", header: "Date", cell: ({ row }) => <span className="text-sm tabular-nums">{formatContractDate(row.original.chequeDate)}</span> },
    { id: "amount", header: "Amount", cell: ({ row }) => <Money value={row.original.amount} className="text-sm font-medium" /> },
    {
      id: "client",
      header: "Client",
      cell: ({ row }) => (
        <ClientCell contract={row.original.contract} extra={row.original.instalmentNo ? `Instalment ${row.original.instalmentNo}` : null} />
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <ChequeStatusBadge status={row.original.status} />
          {row.original.bounceReason ? <div className="text-muted-foreground max-w-[200px] truncate text-xs">{row.original.bounceReason}</div> : null}
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <ChequeActions contractId={row.original.contractId} cheque={row.original} permissions={permissions} dialogs={dialogs} />,
    },
  ];

  const filtered = Boolean(list.search.trim()) || list.status !== "all";
  return (
    <>
      {list.error ? <ErrorState title="Could not load the cheques" message={list.error} onRetry={() => void list.load()} retrying={list.loading} /> : null}
      <Card className="py-0">
        <DataTable
          columns={columns}
          data={list.rows}
          loading={list.loading}
          rowCount={list.total}
          pageSize={list.pageSize}
          currentPage={list.page}
          isPagination
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
          onGlobalFilterChange={list.setSearch}
          handleRowClick={(row) => router.push(contractHref(row.contractId))}
          toolbar={
            <PaymentsToolbar
              search={list.search}
              onSearchChange={list.setSearch}
              searchLabel="Search cheques"
              loading={list.loading}
              statusOptions={CHEQUE_FILTERS}
              status={list.status}
              onStatusChange={list.setStatus}
              pageSize={list.pageSize}
              onPageSizeChange={list.setPageSize}
              onRefresh={() => {
                void list.load();
                onRefresh();
              }}
            />
          }
          emptyState={
            <EmptyState
              icon={<ScrollText />}
              title={filtered ? "No matching cheques" : "No cheques yet"}
              description={filtered ? "Nothing matches this search and filter." : "Cheques recorded against an instalment appear here."}
              action={
                filtered
                  ? {
                      label: "Clear filters",
                      variant: "outline",
                      onClick: () => {
                        list.setSearch("");
                        list.setStatus("all");
                      },
                    }
                  : undefined
              }
            />
          }
        />
      </Card>
    </>
  );
}

/**
 * A client's payments, on the client's page: their balance and every
 * instalment still open across their contracts. A row opens the contract's
 * Payments tab, where the money is recorded.
 */
export function ClientPaymentsPanel({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [data, setData] = useState<{ migrated: boolean; instalments: InstalmentListRow[]; total: number; summary: BalanceSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await paymentsService.listInstalments({ clientId, status: "open", pageSize: CLIENT_ROWS }));
      setError(null);
    } catch (e) {
      if (e instanceof PaymentsRequestError && e.status === 403) setForbidden(true);
      else setError(e instanceof Error ? e.message : "Could not load the payments.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) {
    return (
      <Card className="p-0">
        <EmptyState icon={<Lock className="size-5" />} title="You don't have access to payments" description="Payments need AMC Payments (View). Ask an admin to add it to your role." />
      </Card>
    );
  }
  if (!data && loading) {
    return (
      <>
        <StatGridSkeleton count={4} />
        <SectionSkeleton />
      </>
    );
  }
  if (!data) return <ErrorState title="Could not load the payments" message={error} onRetry={() => void load()} retrying={loading} />;
  if (!data.migrated) {
    return (
      <Alert className="border-warning/30 bg-warning/5 items-start p-4">
        <Database className="text-warning" />
        <AlertTitle>Payments need a database update</AlertTitle>
        <AlertDescription>The payments tables are not on this database yet (migration 20261008100000). Ask an admin to apply it.</AlertDescription>
      </Alert>
    );
  }

  const { summary, instalments, total } = data;
  return (
    <>
      <StatCardGrid columns={4}>
        <StatCard label="Outstanding" value={<Money value={summary.outstanding} className="text-xl" />} headline="Open instalments, all contracts" />
        <StatCard
          label="Overdue"
          value={<Money value={summary.overdue} className="text-xl" />}
          headline={summary.overdueCount ? `${summary.overdueCount} ${summary.overdueCount === 1 ? "instalment" : "instalments"} late` : "Nothing late"}
          tone={summary.overdueCount ? "bad" : "neutral"}
        />
        <StatCard label={AGEING_LABELS.current} value={<Money value={summary.ageing.current} className="text-xl" />} headline="Due later" />
        <StatCard
          label={AGEING_LABELS.d90_plus}
          value={<Money value={summary.ageing.d90_plus} className="text-xl" />}
          headline={summary.ageing.d90_plus > 0 ? "Overdue" : "Nothing this late"}
          tone={summary.ageing.d90_plus > 0 ? "bad" : "neutral"}
        />
      </StatCardGrid>

      <SectionCard
        title="Open instalments"
        description={
          total > instalments.length
            ? `The first ${instalments.length} of ${total}, oldest due first. Open a contract to record a payment.`
            : "Everything still owed across the client's contracts. Open a contract to record a payment."
        }
        icon={<CalendarClock />}
        bodyClassName={instalments.length ? "pb-2" : "border-t"}
      >
        {instalments.length === 0 ? (
          <EmptyState icon={<CalendarClock className="size-5" />} title="Nothing owed" description="This client has no open instalments." />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Contract</TableHead>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5">Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instalments.map((i) => (
                  <TableRow key={i.id} className="cursor-pointer" onClick={() => router.push(contractHref(i.contractId))}>
                    <TableCell className="pl-5">
                      <div className="text-sm font-medium tabular-nums">{i.contract?.contractNumber || "Contract"}</div>
                      {i.contract?.propertyLabel ? <div className="text-muted-foreground max-w-[260px] truncate text-xs">{i.contract.propertyLabel}</div> : null}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{i.instalmentNo}</TableCell>
                    <TableCell className="text-sm tabular-nums">{formatContractDate(i.dueDate)}</TableCell>
                    <TableCell className="text-right">
                      <Money value={i.outstanding} className="text-sm font-medium" />
                    </TableCell>
                    <TableCell>
                      <InstalmentStatusBadge status={i.status} />
                    </TableCell>
                    <TableCell className="pr-5 text-sm">
                      <DaysOverdue days={i.daysOverdue} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
