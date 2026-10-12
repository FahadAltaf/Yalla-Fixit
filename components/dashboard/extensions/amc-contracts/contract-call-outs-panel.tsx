"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Database, Gauge, Hammer, History, PhoneCall, Plus } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, SectionSkeleton, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { additionalWorksService } from "@/modules/amc-contracts/additional-works-service";
import { callOutsService, type AllowanceMovementKind } from "@/modules/amc-contracts/call-outs-service";

import { AdditionalWorkDetailDialog } from "./additional-work-detail-dialog";
import { workColumns } from "./additional-works-page";
import { CallOutDetailDialog } from "./call-out-detail-dialog";
import { callOutColumns } from "./call-outs-page";
import { Muted } from "./call-out-shared";
import { formatDateTime } from "./contract-status";
import { LogCallOutDialog } from "./log-call-out-dialog";
import { RaiseAdditionalWorkDialog } from "./raise-additional-work-dialog";
import { useAmcData } from "./use-amc-data";
import { useDialog } from "./profile/use-dialog";

const MOVEMENT_LABELS: Record<AllowanceMovementKind, { label: string; tone: string }> = {
  reserve: { label: "Booked", tone: "bg-brand-50 text-brand" },
  release: { label: "Released", tone: "bg-mist text-ink-soft" },
  consumption: { label: "Used", tone: "bg-success/10 text-success" },
  adjustment: { label: "Adjustment", tone: "bg-warning/10 text-warning" },
  correction: { label: "Correction", tone: "bg-warning/10 text-warning" },
};

const noop = () => undefined;

/**
 * A contract's Call outs tab (Phase 11: DEV-405, 407, 409): the allowance
 * per service (used, booked, remaining, near zero), the additional-work
 * money by stage, the contract's call outs and additional work, and every
 * allowance movement. Logging a call out here preselects the contract.
 */
export function ContractCallOutsPanel({ contractId, contractOpen }: { contractId: string; contractOpen: boolean }) {
  const allowances = useAmcData(() => callOutsService.allowances(contractId), `allowances:${contractId}`);
  const callOuts = useAmcData(() => callOutsService.list({ contractId }), `call-outs:${contractId}`);
  const works = useAmcData(() => additionalWorksService.list({ contractId }), `works:${contractId}`);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const logging = useDialog<true>();
  const raising = useDialog<true>();
  const callOut = useDialog<string>();
  const work = useDialog<string>();

  const reloadAll = () => {
    allowances.reload();
    callOuts.reload();
    works.reload();
  };

  const callOutCols = useMemo(() => callOutColumns({ withClient: false }), []);
  const workCols = useMemo(() => workColumns({ withClient: false }), []);

  const migrated = allowances.data?.migrated !== false && callOuts.data?.migrated !== false;
  const rollup = allowances.data?.additionalWork;
  const canLog = Boolean(callOuts.data?.canCreate && callOuts.data.migrated && contractOpen);
  const canRaise = Boolean(works.data?.canCreate && works.data.migrated);

  if (!migrated) {
    return (
      <Alert className="border-warning/30 bg-warning/5 items-start p-4">
        <Database className="text-warning" />
        <AlertTitle>Call outs are not set up on this database yet</AlertTitle>
        <AlertDescription>The call-out and allowance tables are not on this database yet (migration 20261012120000). Ask an admin to apply it.</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      {/* Allowances */}
      {allowances.loading ? (
        <SectionSkeleton />
      ) : allowances.error ? (
        <ErrorState title="Could not load the allowances" message={allowances.error} onRetry={allowances.reload} />
      ) : allowances.data ? (
        <SectionCard
          title="Allowances"
          description="Per service: included, used, booked by open call outs, and what is left."
          icon={<Gauge />}
          bodyClassName="pb-2"
        >
          {allowances.data.allowances.length === 0 ? (
            <p className="text-muted-foreground px-5 pb-4 text-sm">This contract has no counted services.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[620px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Service</TableHead>
                    <TableHead className="text-right">Included</TableHead>
                    <TableHead className="text-right">Used</TableHead>
                    <TableHead className="text-right">Booked</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="pr-5" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allowances.data.allowances.map((a) => (
                    <TableRow key={a.entitlementId}>
                      <TableCell className="pl-5 font-medium">{a.serviceLabel}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.unlimited ? "Unlimited" : (a.included ?? <Muted>—</Muted>)}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.used}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.reserved}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.unlimited ? "Unlimited" : (a.remaining ?? <Muted>—</Muted>)}</TableCell>
                      <TableCell className="pr-5 text-right">
                        {a.nearZero ? (
                          <Badge variant="secondary" className={cn("border-0 font-medium", a.remaining === 0 ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning")}>
                            {a.remaining === 0 ? "Used up" : "Nearly used up"}
                          </Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      ) : null}

      {/* Additional-work money by stage */}
      {allowances.loading ? (
        <StatGridSkeleton count={4} />
      ) : rollup ? (
        <StatCardGrid columns={4}>
          <StatCard label="Quoted" value={<Money value={rollup.quoted} className="text-xl" />} caption={`${rollup.count} additional ${rollup.count === 1 ? "work" : "works"}`} />
          <StatCard label="Approved" value={<Money value={rollup.approved} className="text-xl" />} tone="progress" caption={rollup.rejected ? `Rejected AED ${rollup.rejected.toLocaleString("en-AE")}` : undefined} />
          <StatCard label="Invoiced" value={<Money value={rollup.invoiced} className="text-xl" />} tone="review" />
          <StatCard label="Paid" value={<Money value={rollup.paid} className="text-xl" />} tone="good" />
        </StatCardGrid>
      ) : null}

      {/* Call outs */}
      <SectionCard
        title="Call outs"
        description="Every call out on this contract, newest first."
        icon={<PhoneCall />}
        action={
          canLog ? (
            <Button size="sm" onClick={() => logging.show(true)}>
              <Plus className="size-4" />
              Log call out
            </Button>
          ) : null
        }
      >
        {callOuts.error ? (
          <div className="px-5 pb-5">
            <ErrorState title="Could not load the call outs" message={callOuts.error} onRetry={callOuts.reload} />
          </div>
        ) : (
          <div className="border-t">
            <DataTable
              columns={callOutCols}
              data={callOuts.data?.callOuts ?? []}
              loading={callOuts.loading}
              rowCount={callOuts.data?.callOuts.length ?? 0}
              pageSize={500}
              currentPage={0}
              onPageChange={noop}
              onPageSizeChange={noop}
              onGlobalFilterChange={noop}
              handleRowClick={(row) => callOut.show(row.id)}
              emptyState={
                <EmptyState
                  icon={<PhoneCall />}
                  title="No call outs yet"
                  description="When the client calls about a fault, log it here: the coverage answer and the SLA clock start at once."
                  action={canLog ? { label: "Log call out", onClick: () => logging.show(true) } : undefined}
                />
              }
            />
          </div>
        )}
      </SectionCard>

      {/* Additional work */}
      <SectionCard
        title="Additional work"
        description="Work outside the contract found on visits and call outs, and its quotation."
        icon={<Hammer />}
        action={
          canRaise ? (
            <Button size="sm" variant="outline" onClick={() => raising.show(true)}>
              <Plus className="size-4" />
              Raise additional work
            </Button>
          ) : null
        }
      >
        {works.error ? (
          <div className="px-5 pb-5">
            <ErrorState title="Could not load the additional work" message={works.error} onRetry={works.reload} />
          </div>
        ) : (
          <div className="border-t">
            <DataTable
              columns={workCols}
              data={works.data?.works ?? []}
              loading={works.loading}
              rowCount={works.data?.works.length ?? 0}
              pageSize={500}
              currentPage={0}
              onPageChange={noop}
              onPageSizeChange={noop}
              onGlobalFilterChange={noop}
              handleRowClick={(row) => work.show(row.id)}
              emptyState={
                <EmptyState
                  icon={<Hammer />}
                  title="No additional work"
                  description="Work outside the contract a crew finds on a visit or a call out shows here once raised."
                />
              }
            />
          </div>
        )}
      </SectionCard>

      {/* Allowance movements */}
      {allowances.data ? (
        <Collapsible open={ledgerOpen} onOpenChange={setLedgerOpen}>
          <SectionCard
            title="Allowance movements"
            description="Every booking, release, use, adjustment and correction, newest first."
            icon={<History />}
            action={
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="ghost" aria-label={ledgerOpen ? "Hide the movements" : "Show the movements"}>
                  {ledgerOpen ? "Hide" : `Show ${allowances.data.movements.length}`}
                  <ChevronDown className={cn("size-4 transition-transform", ledgerOpen && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
            }
          >
            <CollapsibleContent>
              {allowances.data.movements.length === 0 ? (
                <p className="text-muted-foreground px-5 pb-5 text-sm">No movements yet.</p>
              ) : (
                <div className="overflow-x-auto border-t">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-5">When</TableHead>
                        <TableHead>Service</TableHead>
                        <TableHead>Movement</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead>Call out</TableHead>
                        <TableHead className="pr-5">Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allowances.data.movements.map((m) => {
                        const kind = MOVEMENT_LABELS[m.kind as AllowanceMovementKind];
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="pl-5 whitespace-nowrap">{formatDateTime(m.occurredAt)}</TableCell>
                            <TableCell>{m.serviceLabel || <Muted>—</Muted>}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={cn("border-0 font-medium", kind?.tone ?? "bg-mist text-ink-soft")}>
                                {kind?.label ?? m.kind}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{m.quantity}</TableCell>
                            <TableCell>{m.callOutNo ?? <Muted>—</Muted>}</TableCell>
                            <TableCell className="text-muted-foreground max-w-[260px] pr-5 whitespace-normal">{m.notes ?? "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CollapsibleContent>
          </SectionCard>
        </Collapsible>
      ) : null}

      <LogCallOutDialog
        key={`log-${logging.key}`}
        open={logging.open}
        onOpenChange={logging.onOpenChange}
        contractId={contractId}
        onLogged={reloadAll}
        onOpenCallOut={(id) => {
          logging.onOpenChange(false);
          callOut.show(id);
        }}
      />
      <CallOutDetailDialog key={`call-out-${callOut.key}`} callOutId={callOut.target} open={callOut.open} onOpenChange={callOut.onOpenChange} onChanged={reloadAll} />
      <RaiseAdditionalWorkDialog
        key={`raise-${raising.key}`}
        open={raising.open}
        onOpenChange={raising.onOpenChange}
        contractId={contractId}
        source="manual"
        onRaised={(w) => {
          reloadAll();
          work.show(w.id);
        }}
      />
      <AdditionalWorkDetailDialog key={`work-${work.key}`} workId={work.target} open={work.open} onOpenChange={work.onOpenChange} onChanged={reloadAll} />
    </>
  );
}
