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
import { PillTabs } from "@/components/dashboard/shared/kaizen";
import { useDebounce } from "@/hooks/use-debounce";
import {
  amcContractsService,
  type ContractListRow,
  type ContractListStatus,
} from "@/modules/amc-contracts/amc-contracts-service";

import { ActivateContractDialog } from "./activate-contract-dialog";
import {
  CONTRACT_STATUS_LABELS,
  contractStatusTone,
  daysRemainingLabel,
  formatContractDate,
} from "./contract-status";

const TABS: ReadonlyArray<{ value: ContractListStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending_activation", label: "Pending activation" },
  { value: "active", label: "Active" },
  { value: "expiring", label: "Expiring" },
  { value: "not_started", label: "Not started" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * AMC contracts: signed agreements in operation, and signed proposals
 * waiting to be activated. Separate from AMC proposals, which stays the
 * sales and document workflow. The status filter lives in the address
 * (?status=) so a filtered list can be reloaded or shared.
 */
export function ContractsList() {
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
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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
        page,
        pageSize,
      });
      if (mine !== ticket.current) return;
      setRows(response.rows);
      setTotal(response.totalCount);
      setCounts(response.counts);
    } catch (error) {
      if (mine !== ticket.current) return;
      setRows([]);
      setTotal(0);
      setLoadError(error instanceof Error ? error.message : "Could not load AMC contracts.");
    } finally {
      if (mine === ticket.current) setIsLoading(false);
    }
  }, [status, debouncedSearch, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (row: ContractListRow) =>
    router.push(row.kind === "contract" ? `/extensions/amc-contracts/${row.id}` : `/extensions/amc/${row.submissionId}`);

  const columns: ColumnDef<ContractListRow>[] = [
    {
      id: "customer",
      header: "Customer / Property",
      cell: ({ row }) => (
        <Link
          href={
            row.original.kind === "contract"
              ? `/extensions/amc-contracts/${row.original.id}`
              : `/extensions/amc/${row.original.submissionId}`
          }
          className="focus-visible:ring-ring block rounded-md hover:opacity-80 focus-visible:ring-2 focus-visible:outline-none"
          onClick={(event) => event.stopPropagation()}
        >
          <IdentityCell
            title={row.original.customerName || "Unnamed customer"}
            subtitle={row.original.propertyLabel || "No address"}
            icon={UserRound}
          />
        </Link>
      ),
      enableSorting: false,
    },
    {
      id: "number",
      header: "Contract no.",
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.proposalNumber || "—"}</span>,
      enableSorting: false,
    },
    {
      id: "manager",
      header: "Account manager",
      cell: ({ row }) => <span className="text-sm">{row.original.accountManager || "—"}</span>,
      enableSorting: false,
    },
    {
      id: "period",
      header: "Period",
      cell: ({ row }) => (
        <div className="text-sm leading-tight">
          <div className="tabular-nums">
            {formatContractDate(row.original.startDate)} – {formatContractDate(row.original.endDate)}
          </div>
          <div className="text-muted-foreground text-xs">
            {row.original.kind === "pending" ? "Proposed" : daysRemainingLabel(row.original.daysRemaining)}
          </div>
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "value",
      header: "Contract value",
      cell: ({ row }) => <Money value={row.original.grandTotal} className="text-sm font-medium" />,
      enableSorting: false,
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

  const filtered = status !== "all" || Boolean(search);

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
            onGlobalFilterChange={(value) => {
              setSearch(value);
              setPage(0);
            }}
            handleRowClick={(row) => open(row)}
            toolbar={
              <RecordsToolbar
                fetchRecords={() => void load()}
                globalFilter={search}
                onGlobalFilterChange={(value) => {
                  setSearch(value);
                  setPage(0);
                }}
                isSearchLoading={isLoading}
                searchPlaceholder="Search by customer, number or address…"
                pageSize={pageSize}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(0);
                }}
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
          proposalNumber={activating.proposalNumber}
          customerName={activating.customerName}
          proposedStart={activating.startDate}
          proposedEnd={activating.endDate}
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
