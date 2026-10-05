"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListPager, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
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
  const [correcting, setCorrecting] = useState<UsageEntry | null>(null);
  const byId = new Map(entitlements.map((e) => [e.id, e]));

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

  const amountOf = (u: UsageEntry) => {
    const e = byId.get(u.entitlementId);
    const word = e ? unitWord(e.entitlementType, Math.abs(u.quantity)) || (Math.abs(u.quantity) === 1 ? "call-out" : "call-outs") : "";
    return `${u.quantity > 0 && u.kind !== "consumption" ? "+" : ""}${formatQuantity(u.quantity)} ${word}`.trim();
  };
  const correctedEntry = (id: string | null) => rows.find((r) => r.id === id);

  return (
    <SectionCard
      title="Usage history"
      description="Every entry against this contract. Entries are never edited or deleted; mistakes are corrected."
      icon={<ClipboardList />}
      bodyClassName="px-5 pb-5"
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
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-destructive">{error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : loading && rows.length === 0 ? (
        <ListSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {service === "all" ? "Nothing recorded against this contract yet." : "Nothing recorded for this service yet."}
        </p>
      ) : (
        <>
          <div className="-mx-5 overflow-x-auto">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Date</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>FSM reference</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => {
                  const e = byId.get(u.entitlementId);
                  const isCorrection = u.kind === "correction";
                  const original = isCorrection ? correctedEntry(u.correctsUsageId) : undefined;
                  return (
                    <TableRow key={u.id} className={isCorrection ? "bg-amber-500/5" : undefined}>
                      <TableCell className="pl-5 align-top">
                        <div className="tabular-nums">{formatContractDate(u.occurredAt.slice(0, 10))}</div>
                        <div className="text-muted-foreground text-xs" title="When the entry was made">
                          Entered {formatDateTime(u.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="font-medium">{e?.serviceLabel ?? "Service"}</div>
                        <Badge
                          variant="secondary"
                          className={`mt-1 border-none font-normal ${isCorrection ? "bg-amber-600/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-400" : ""}`}
                        >
                          {KIND_LABELS[u.kind]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right align-top tabular-nums">
                        <div className={isCorrection ? "text-amber-700 dark:text-amber-400" : undefined}>{amountOf(u)}</div>
                        {u.kind === "consumption" && u.correctedQuantity !== 0 ? (
                          <div className="text-muted-foreground text-xs">
                            {formatQuantity(u.netQuantity)} after corrections
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <div>{usageSourceLabel(u)}</div>
                        {u.fsmSyncedAt ? (
                          <div className="text-muted-foreground text-xs">Read {formatDateTime(u.fsmSyncedAt)}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        {u.externalReference ? `${externalRefLabel(u.externalType)} ${u.externalReference}` : "—"}
                        {u.fsmWorkOrderId ? (
                          <div className="text-muted-foreground text-xs">Work order {u.fsmWorkOrderId}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">{u.createdBy ?? "—"}</TableCell>
                      <TableCell className="max-w-[240px] align-top">
                        {isCorrection ? (
                          <div className="text-muted-foreground text-xs">
                            Corrects {original ? `the entry of ${formatContractDate(original.occurredAt.slice(0, 10))}` : "an earlier entry"}
                          </div>
                        ) : null}
                        <div className="break-words">{u.notes || (isCorrection ? "" : "—")}</div>
                      </TableCell>
                      <TableCell className="pr-5 text-right align-top">
                        {canCorrect && u.kind === "consumption" && u.netQuantity > 0 ? (
                          <Button size="sm" variant="ghost" onClick={() => setCorrecting(u)}>
                            <Undo2 className="size-4" />
                            Correct
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <ListPager
            className="mt-4"
            page={page}
            pageSize={pageSize}
            total={total}
            noun="entries"
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
          />
        </>
      )}

      {correcting ? (
        <CorrectUsageDialog
          open={Boolean(correcting)}
          onOpenChange={(next) => !next && setCorrecting(null)}
          contractId={contractId}
          entry={correcting}
          entitlement={byId.get(correcting.entitlementId)}
          onCorrected={() => {
            setCorrecting(null);
            onChanged();
          }}
        />
      ) : null}
    </SectionCard>
  );
}
