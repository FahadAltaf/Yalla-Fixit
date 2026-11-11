"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Undo2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { formatQuantity, unitWord } from "@/lib/amc/contracts";
import {
  amcContractsService,
  type ContractDetail,
  type UsageEntry,
} from "@/modules/amc-contracts/amc-contracts-service";

import { CorrectUsageDialog } from "./correct-usage-dialog";
import { externalRefLabel, formatContractDate, formatDateTime } from "./contract-status";

type Entitlement = ContractDetail["entitlements"][number];

/* Where an entry came from: typed in, read from FSM (confirmed by a person or automatic), or an FSM reversal. */
export function usageSourceLabel(u: Pick<UsageEntry, "source" | "kind" | "createdBy">): string {
  if (u.source !== "fsm") return u.source === "system" ? "System" : "Manual";
  if (u.kind === "correction") return "FSM correction";
  return u.createdBy ? "FSM (confirmed)" : "FSM (automatic)";
}

const KIND_LABELS: Record<UsageEntry["kind"], string> = {
  consumption: "Used",
  correction: "Correction",
  adjustment: "Adjustment",
};

const KIND_TONE: Record<UsageEntry["kind"], string> = {
  consumption: "bg-brand-50 text-brand",
  correction: "bg-warning/10 text-warning",
  adjustment: "bg-mist text-ink-soft",
};

const noop = () => undefined;

/**
 * The contract's usage ledger, newest first, a page at a time. Read-only:
 * entries are never edited or deleted. A mistaken entry gets a Correct
 * action, which adds a correction entry referencing it.
 */
export function UsageHistory({
  contractId,
  entitlements,
  canCorrect,
  refreshKey,
  onChanged,
}: {
  contractId: string;
  entitlements: Entitlement[];
  canCorrect: boolean;
  /** Bumped by the page after it records usage, to reload this list. */
  refreshKey: number;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<UsageEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [service, setService] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* Kept after the dialog closes, so it can animate out with its content. */
  const [correcting, setCorrecting] = useState<UsageEntry | null>(null);
  const [correctOpen, setCorrectOpen] = useState(false);
  const byId = useMemo(() => new Map(entitlements.map((e) => [e.id, e])), [entitlements]);

  const ticket = useRef(0);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const result = await amcContractsService.usage(contractId, {
        page,
        pageSize,
        entitlementId: service === "all" ? null : service,
      });
      if (mine !== ticket.current) return;
      setRows(result.rows);
      setTotal(result.totalCount);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the usage history.");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [contractId, page, pageSize, service]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  /* The ledger columns; the Correct action opens the dialog below. */
  const columns = useMemo<ColumnDef<UsageEntry>[]>(() => {
    const amountOf = (u: UsageEntry) => {
      const e = byId.get(u.entitlementId);
      const word = e ? unitWord(e.entitlementType, Math.abs(u.quantity)) || (Math.abs(u.quantity) === 1 ? "call-out" : "call-outs") : "";
      return `${u.quantity > 0 && u.kind !== "consumption" ? "+" : ""}${formatQuantity(u.quantity)} ${word}`.trim();
    };
    const correctedEntry = (id: string | null) => rows.find((r) => r.id === id);
    return [
      {
        id: "date",
        header: "Date",
        cell: ({ row: { original: u } }) => (
          <div>
            <div className="tabular-nums">{formatContractDate(u.occurredAt.slice(0, 10))}</div>
            <div className="text-muted-foreground text-xs" title="When the entry was made">
              Entered {formatDateTime(u.createdAt)}
            </div>
          </div>
        ),
      },
      {
        id: "service",
        header: "Service",
        cell: ({ row: { original: u } }) => (
          <div>
            <div className="font-medium">{byId.get(u.entitlementId)?.serviceLabel ?? "Service"}</div>
            <Badge variant="secondary" className={`mt-1 border-0 font-medium ${KIND_TONE[u.kind]}`}>
              {KIND_LABELS[u.kind]}
            </Badge>
          </div>
        ),
      },
      {
        id: "quantity",
        header: "Quantity",
        cell: ({ row: { original: u } }) => (
          <div className="tabular-nums">
            <div className={u.kind === "correction" ? "text-warning" : undefined}>{amountOf(u)}</div>
            {u.kind === "consumption" && u.correctedQuantity !== 0 ? (
              <div className="text-muted-foreground text-xs">
                {formatQuantity(u.netQuantity)} after corrections
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "source",
        header: "Source",
        cell: ({ row: { original: u } }) => (
          <div>
            <div>{usageSourceLabel(u)}</div>
            {u.fsmSyncedAt ? (
              <div className="text-muted-foreground text-xs">Read {formatDateTime(u.fsmSyncedAt)}</div>
            ) : null}
          </div>
        ),
      },
      {
        id: "fsmReference",
        header: "FSM reference",
        cell: ({ row: { original: u } }) => (
          <div>
            {u.externalReference ? `${externalRefLabel(u.externalType)} ${u.externalReference}` : "—"}
            {u.fsmWorkOrderId ? (
              <div className="text-muted-foreground text-xs">Work order {u.fsmWorkOrderId}</div>
            ) : null}
          </div>
        ),
      },
      {
        id: "recordedBy",
        header: "Recorded by",
        cell: ({ row: { original: u } }) => u.createdBy ?? "—",
      },
      {
        id: "notes",
        header: "Notes",
        cell: ({ row: { original: u } }) => {
          const isCorrection = u.kind === "correction";
          const original = isCorrection ? correctedEntry(u.correctsUsageId) : undefined;
          return (
            <div className="max-w-[240px] whitespace-normal">
              {isCorrection ? (
                <div className="text-muted-foreground text-xs">
                  Corrects {original ? `the entry of ${formatContractDate(original.occurredAt.slice(0, 10))}` : "an earlier entry"}
                </div>
              ) : null}
              <div className="break-words">{u.notes || (isCorrection ? "" : "—")}</div>
            </div>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row: { original: u } }) => (
          <div className="text-right">
            {canCorrect && u.kind === "consumption" && u.netQuantity > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCorrecting(u);
                  setCorrectOpen(true);
                }}
              >
                <Undo2 className="size-4" />
                Correct
              </Button>
            ) : null}
          </div>
        ),
      },
    ];
  }, [byId, rows, canCorrect]);

  return (
    <SectionCard
      title="Usage history"
      description="Every entry against this contract. Entries are never edited or deleted; mistakes are corrected."
      icon={<ClipboardList />}
      action={
        <Select
          value={service}
          onValueChange={(value) => {
            setService(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="h-8 w-[180px]" aria-label="Filter by service">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            {entitlements
              .filter((e) => e.consumable)
              .map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.serviceLabel}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      }
    >
      {error ? (
        <div className="px-5 pb-5">
          <ErrorState title="Could not load the usage history" message={error} onRetry={() => void load()} retrying={loading} />
        </div>
      ) : (
        <div className="border-t">
          {/* Server-paginated: the footer pages through `total` entries. */}
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            rowCount={total}
            pageSize={pageSize}
            currentPage={page}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
            onGlobalFilterChange={noop}
            emptyState={
              <EmptyState
                icon={<ClipboardList />}
                title={service === "all" ? "Nothing recorded against this contract yet" : "Nothing recorded for this service yet"}
                description="Usage typed in or read from Zoho FSM shows here, newest first."
              />
            }
          />
        </div>
      )}

      {correcting ? (
        <CorrectUsageDialog
          open={correctOpen}
          onOpenChange={setCorrectOpen}
          contractId={contractId}
          entry={correcting}
          entitlement={byId.get(correcting.entitlementId)}
          onCorrected={() => {
            setCorrectOpen(false);
            onChanged();
          }}
        />
      ) : null}
    </SectionCard>
  );
}
