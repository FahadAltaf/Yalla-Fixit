"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, CalendarCheck2, EllipsisVertical, EyeIcon, FileSignature, ScrollText, UserRound } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
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
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { useDebounce } from "@/hooks/use-debounce";
import {
  amcContractsService,
  type ContractListRow,
  type ContractListStatus,
  type ContractSortKey,
} from "@/modules/amc-contracts/amc-contracts-service";

import { ActivateContractDialog } from "./activate-contract-dialog";
import { CONTRACT_STATUS_LABELS, contractStatusTone, formatContractDate } from "./contract-status";
import { ALL_MANAGERS, ContractsToolbar } from "./contracts-toolbar";

const STATUSES: ReadonlyArray<{ value: ContractListStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "expiring", label: "Expiring" },
  { value: "expired", label: "Expired" },
  { value: "pending_activation", label: "Pending activation" },
  { value: "not_started", label: "Not started" },
  { value: "cancelled", label: "Cancelled" },
];

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
  const status: ContractListStatus = STATUSES.some((t) => t.value === statusParam)
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
  /* Kept after the dialog closes, so it can animate out with its content. */
  const [activating, setActivating] = useState<ContractListRow | null>(null);
  const [activateOpen, setActivateOpen] = useState(false);
  const debouncedSearch = useDebounce(search.trim(), 300);

  const setStatus = (value: string) => {
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

  const refresh = () => {
    void load();
    onRefresh?.();
  };

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
      header: "Client",
      accessorFn: (row) => row.customerName,
      ...serverSorted,
      cell: ({ row }) => (
        <IdentityCell
          title={row.original.customerName || "Unnamed client"}
          subtitle={row.original.accountManagers.join(", ") || undefined}
          icon={UserRound}
        />
      ),
    },
    {
      id: "property",
      header: "Property",
      accessorFn: (row) => row.propertyLabel,
      ...serverSorted,
      cell: ({ row }) =>
        row.original.propertyLabel ? (
          <span className="flex max-w-[240px] items-start gap-1.5 text-sm">
            <Building2 className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="line-clamp-2">{row.original.propertyLabel}</span>
          </span>
        ) : (
          <IconText icon={Building2} muted>
            —
          </IconText>
        ),
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
            <div className={`text-xs ${c.exhausted ? "text-danger" : "text-muted-foreground"}`}>
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
        <Badge variant="secondary" className={`border-0 font-medium ${contractStatusTone(row.original.displayStatus)}`}>
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
              <Button variant="ghost" size="icon" className="size-8">
                <EllipsisVertical className="size-4" />
                <span className="sr-only">Actions for {row.original.proposalNumber || "this contract"}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {row.original.kind === "pending" ? (
                <>
                  {row.original.canActivate ? (
                    <DropdownMenuItem
                      onClick={() => {
                        setActivating(row.original);
                        setActivateOpen(true);
                      }}
                    >
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
    <div className="flex flex-col gap-6">
      {loadError ? (
        <ErrorState
          title="Could not load AMC contracts"
          message={loadError}
          onRetry={() => void load()}
          retrying={isLoading}
        />
      ) : null}

      <Card className="py-0">
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
            <ContractsToolbar
              search={search}
              onSearchChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              isLoading={isLoading}
              statusOptions={STATUSES.map((entry) => ({ ...entry, count: counts[entry.value] }))}
              status={status}
              onStatusChange={setStatus}
              managers={managers}
              manager={manager}
              onManagerChange={(value) => {
                setManager(value);
                setPage(0);
              }}
              pageSize={pageSize}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              onRefresh={refresh}
            />
          }
          emptyState={
            <EmptyState
              icon={<ScrollText />}
              title={loadError ? "Contracts could not be loaded" : filtered ? "No matching contracts" : "No AMC contracts yet"}
              description={
                loadError
                  ? "Try again once the connection is back."
                  : filtered
                    ? "Nothing matches this search and filter."
                    : "When a client signs an AMC proposal it appears here, ready to be activated."
              }
              {...(loadError
                ? {}
                : {
                    action: filtered
                      ? {
                          label: "Clear filters",
                          variant: "outline" as const,
                          onClick: () => {
                            setSearch("");
                            setManager(ALL_MANAGERS);
                            setStatus("all");
                          },
                        }
                      : { label: "Go to AMC proposals", onClick: () => router.push("/extensions/amc") },
                  })}
            />
          }
        />
      </Card>

      {activating ? (
        <ActivateContractDialog
          open={activateOpen}
          onOpenChange={setActivateOpen}
          submissionId={activating.submissionId}
          onActivated={(contractId) => {
            setActivateOpen(false);
            toast.message("Opening the contract…");
            router.push(`/extensions/amc-contracts/${contractId}`);
          }}
        />
      ) : null}
    </div>
  );
}
