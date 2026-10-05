"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarCheck2, EllipsisVertical, EyeIcon, FileSignature, ScrollText, UserRound } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { RecordsToolbar } from "@/components/data-table/toolbars/records-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PillTabs } from "@/components/dashboard/shared/kaizen";
import { useDebounce } from "@/hooks/use-debounce";
import {
  amcContractsService,
  type ContractListRow,
  type ContractListStatus,
  type ContractSortKey,
} from "@/modules/amc-contracts/amc-contracts-service";

import { ActivateContractDialog } from "./activate-contract-dialog";
import { CONTRACT_STATUS_LABELS, contractStatusTone, formatContractDate } from "./contract-status";

const TABS: ReadonlyArray<{ value: ContractListStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "expiring", label: "Expiring" },
  { value: "expired", label: "Expired" },
  { value: "pending_activation", label: "Pending activation" },
  { value: "not_started", label: "Not started" },
  { value: "cancelled", label: "Cancelled" },
];

const ALL_MANAGERS = "__all__";

/* The server sorts; the table keeps the order it was given. */
const serverSorted = { enableSorting: true, sortingFn: () => 0 } as const;

/**
 * AMC contracts: signed agreements in operation, and signed proposals
 * waiting to be activated. Separate from AMC proposals, which stays the
 * sales and document workflow. The status filter lives in the address
 * (?status=) so a filtered list can be reloaded or shared.
 */
export function ContractsList({ onRefresh }: { onRefresh?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const statusParam = searchParams.get("status");
  const status: ContractListStatus = TABS.some((t) => t.value === statusParam)
    ? (statusParam as ContractListStatus)
    : "all";

  const [rows, setRows] = useState<ContractListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Partial<Record<ContractListStatus, number>>>({});
  const [managers, setManagers] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [manager, setManager] = useState(ALL_MANAGERS);
  const [sort, setSort] = useState<{ key: ContractSortKey; dir: "asc" | "desc" }>({ key: "end", dir: "asc" });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [activating, setActivating] = useState<ContractListRow | null>(null);
  const debouncedSearch = useDebounce(search.trim(), 300);

  const setStatus = (value: ContractListStatus) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "all") next.delete("status");
    else next.set("status", value);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    setPage(0);
  };

  /* Only the latest request fills the table. */
  const ticket = useRef(0);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await amcContractsService.list({
        status,
        search: debouncedSearch || undefined,
        manager: manager === ALL_MANAGERS ? undefined : manager,
        sort: sort.key,
        dir: sort.dir,
        page,
        pageSize,
      });
      if (mine !== ticket.current) return;
      setRows(response.rows);
      setTotal(response.totalCount);
      setCounts(response.counts);
      setManagers(response.managers ?? []);
    } catch (error) {
      if (mine !== ticket.current) return;
      setRows([]);
      setTotal(0);
      setLoadError(error instanceof Error ? error.message : "Could not load AMC contracts.");
    } finally {
      if (mine === ticket.current) setIsLoading(false);
    }
  }, [status, debouncedSearch, manager, sort, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const hrefOf = (row: ContractListRow) =>
    row.kind === "contract" ? `/extensions/amc-contracts/${row.id}` : `/extensions/amc/${row.submissionId}`;
  const open = (row: ContractListRow) => router.push(hrefOf(row));

  const columns: ColumnDef<ContractListRow>[] = [
    {
      id: "contract",
      header: "Contract",
      accessorFn: (row) => row.proposalNumber,
      ...serverSorted,
      cell: ({ row }) => (
        <Link
          href={hrefOf(row.original)}
          className="focus-visible:ring-ring rounded-md text-sm font-medium tabular-nums hover:underline focus-visible:ring-2 focus-visible:outline-none"
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.proposalNumber || "—"}
        </Link>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      accessorFn: (row) => row.customerName,
      ...serverSorted,
      cell: ({ row }) => (
        <IdentityCell title={row.original.customerName || "Unnamed customer"} subtitle={undefined} icon={UserRound} />
      ),
    },
    {
      id: "property",
      header: "Property",
      accessorFn: (row) => row.propertyLabel,
      ...serverSorted,
      cell: ({ row }) => (
        <span className="text-muted-foreground line-clamp-2 max-w-[220px] text-sm">{row.original.propertyLabel || "—"}</span>
      ),
    },
    {
      id: "manager",
      header: "Account manager",
      cell: ({ row }) => <span className="text-sm">{row.original.accountManagers.join(", ") || "—"}</span>,
      enableSorting: false,
    },
    {
      id: "start",
      header: "Start",
      accessorFn: (row) => row.startDate,
      ...serverSorted,
      cell: ({ row }) => <span className="text-sm tabular-nums">{formatContractDate(row.original.startDate)}</span>,
    },
    {
      id: "end",
      header: "End",
      accessorFn: (row) => row.endDate,
      ...serverSorted,
      cell: ({ row }) => (
        <div className="text-sm leading-tight">
          <div className="tabular-nums">{formatContractDate(row.original.endDate)}</div>
          <div className="text-muted-foreground text-xs">
            {row.original.kind === "pending" ? "Proposed dates" : row.original.expiryLabel}
          </div>
        </div>
      ),
    },
    {
      id: "coverage",
      header: "Coverage",
      cell: ({ row }) => {
        const c = row.original.coverage;
        if (!c) return <span className="text-muted-foreground text-sm">—</span>;
        return (
          <div className="text-sm leading-tight">
            <div>{c.totalServices} services</div>
            <div className={`text-xs ${c.exhausted ? "text-destructive" : "text-muted-foreground"}`}>
              {c.exhausted ? `${c.exhausted} exhausted` : c.withRemaining ? "Allowances left" : c.unlimited ? "Unlimited" : "Included"}
            </div>
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: "value",
      header: "Value",
      accessorFn: (row) => row.grandTotal,
      ...serverSorted,
      cell: ({ row }) => <Money value={row.original.grandTotal} className="text-sm font-medium" />,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant="secondary" className={`border-none ${contractStatusTone(row.original.displayStatus)}`}>
          {CONTRACT_STATUS_LABELS[row.original.displayStatus]}
        </Badge>
      ),
      enableSorting: false,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Actions">
                <EllipsisVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {row.original.kind === "pending" ? (
                <>
                  {row.original.canActivate ? (
                    <DropdownMenuItem onClick={() => setActivating(row.original)}>
                      <CalendarCheck2 className="size-4" />
                      Activate AMC
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onClick={() => open(row.original)}>
                    <FileSignature className="size-4" />
                    Open signed proposal
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem onClick={() => open(row.original)}>
                    <EyeIcon className="size-4" />
                    Open contract
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push(`/extensions/amc/${row.original.submissionId}`)}>
                    <FileSignature className="size-4" />
                    Open source proposal
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
      enableSorting: false,
    },
  ];

  const filtered = status !== "all" || Boolean(search) || manager !== ALL_MANAGERS;

  return (
    <div className="flex flex-col gap-4">
      <PillTabs
        tabs={TABS.map((tab) => ({ ...tab, count: counts[tab.value] }))}
        value={status}
        onChange={setStatus}
      />
      <Card className="py-0">
        {loadError ? (
          <EmptyState
            className="border-0"
            icon={<ScrollText className="size-5" />}
            title="Could not load AMC contracts"
            description={loadError}
            action={{ label: "Retry", onClick: () => void load() }}
          />
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            loading={isLoading}
            rowCount={total}
            pageSize={pageSize}
            currentPage={page}
            isPagination
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
            onSortingChange={(key, dir) => {
              setSort(key && key in { contract: 1, customer: 1, property: 1, start: 1, end: 1, value: 1 }
                ? { key: key as ContractSortKey, dir: dir ?? "asc" }
                : { key: "end", dir: "asc" });
              setPage(0);
            }}
            onGlobalFilterChange={(value) => {
              setSearch(value);
              setPage(0);
            }}
            handleRowClick={(row) => open(row)}
            toolbar={
              <RecordsToolbar
                fetchRecords={() => {
                  void load();
                  onRefresh?.();
                }}
                globalFilter={search}
                onGlobalFilterChange={(value) => {
                  setSearch(value);
                  setPage(0);
                }}
                isSearchLoading={isLoading}
                searchPlaceholder="Search customer, property, number or account manager…"
                pageSize={pageSize}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(0);
                }}
                filters={
                  <Select
                    value={manager}
                    onValueChange={(value) => {
                      setManager(value);
                      setPage(0);
                    }}
                  >
                    <SelectTrigger className="h-9 w-full sm:w-[200px]" aria-label="Filter by account manager">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_MANAGERS}>All account managers</SelectItem>
                      {managers.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            }
            emptyState={
              <EmptyState
                className="border-0"
                icon={<ScrollText className="size-5" />}
                title={filtered ? "No matching contracts" : "No AMC contracts yet"}
                description={
                  filtered
                    ? "Nothing matches this search and filter."
                    : "When a client signs an AMC proposal it appears here, ready to be activated."
                }
                action={
                  filtered
                    ? {
                        label: "Clear filters",
                        variant: "outline",
                        onClick: () => {
                          setSearch("");
                          setManager(ALL_MANAGERS);
                          setStatus("all");
                        },
                      }
                    : { label: "Go to AMC proposals", onClick: () => router.push("/extensions/amc") }
                }
              />
            }
          />
        )}
      </Card>

      {activating ? (
        <ActivateContractDialog
          open={Boolean(activating)}
          onOpenChange={(next) => !next && setActivating(null)}
          submissionId={activating.submissionId}
          onActivated={(contractId) => {
            setActivating(null);
            toast.message("Opening the contract…");
            router.push(`/extensions/amc-contracts/${contractId}`);
          }}
        />
      ) : null}
    </div>
  );
}
