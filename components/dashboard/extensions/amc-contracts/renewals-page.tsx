"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Database, EllipsisVerticalIcon, ExternalLink, Flag, Repeat } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { PageHeading, PillTabs, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { RENEWAL_OUTCOME_LABELS, type RenewalStage } from "@/lib/amc/renewal-outcomes";
import type { ExportColumn, ExportRow } from "@/lib/snagging/export-table";
import { proposalEditHref, proposalHref, renewalsService, type RenewalDueRow } from "@/modules/amc-contracts/renewals-service";

import { AmcNotificationsBell } from "./amc-notifications-bell";
import { ListToolbar } from "./call-out-shared";
import { formatContractDate } from "./contract-status";
import { ExportMenu } from "./export-menu";
import { useDialog } from "./profile/use-dialog";
import {
  ProposalStatusBadge,
  RENEWAL_STAGE_LABELS,
  RecordOutcomeDialog,
  RenewalOutcomeBadge,
  RenewalStageBadge,
  daysLeftLabel,
} from "./renewal-shared";
import { useAmcData } from "./use-amc-data";

type StageFilter = "all" | Exclude<RenewalStage, "not_due">;

const renewalTabHref = (contractId: string) => `/extensions/amc-contracts/${contractId}?tab=renewal`;

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "number", label: "Contract" },
  { key: "client", label: "Client" },
  { key: "property", label: "Property" },
  { key: "endDate", label: "Ends" },
  { key: "daysLeft", label: "Days left" },
  { key: "value", label: "Value (AED)" },
  { key: "suggested", label: "Suggested renewal (AED)" },
  { key: "stage", label: "Stage" },
  { key: "proposal", label: "Renewal proposal" },
  { key: "proposalStatus", label: "Proposal status" },
  { key: "outcome", label: "Outcome" },
  { key: "outcomeReason", label: "Outcome reason" },
  { key: "managers", label: "Account managers" },
];

function exportRow(r: RenewalDueRow): ExportRow {
  return {
    number: r.number,
    client: r.customerName,
    property: r.propertyLabel,
    endDate: r.endDate,
    daysLeft: r.daysLeft,
    value: r.grandTotal,
    suggested: r.suggestedTotal,
    stage: RENEWAL_STAGE_LABELS[r.stage],
    proposal: r.renewalProposal ? r.renewalProposal.proposalNumber || "Draft" : "",
    proposalStatus: r.renewalProposal?.status.replace(/_/g, " ") ?? "",
    outcome: r.outcome ? RENEWAL_OUTCOME_LABELS[r.outcome] : "",
    outcomeReason: r.outcomeReason ?? "",
    managers: r.accountManagers.join(", "),
  };
}

/**
 * AMC -> Renewals (Phase 13: DEV-415, 416): contracts inside the renewal
 * window, renewals nobody has moved since the reminder (management has
 * heard), ones that ended without a renewal, and recent outcomes. Starting
 * a renewal makes a draft in AMC proposals, priced with the configured
 * escalation; the outcome is recorded here or on the contract.
 */
export function RenewalsPage() {
  const router = useRouter();
  const { data, error, loading, reload } = useAmcData(() => renewalsService.due(), "renewals");
  const [stage, setStage] = useState<StageFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const outcomeDialog = useDialog<RenewalDueRow>();
  const showOutcome = outcomeDialog.show;
  const { confirm, dialog: confirmDialog } = useConfirm();

  const all = useMemo(() => data?.rows ?? [], [data]);
  const counts = useMemo(() => {
    const c: Record<RenewalStage, number> = { not_due: 0, due: 0, idle: 0, overdue: 0, settled: 0 };
    for (const r of all) c[r.stage] += 1;
    return c;
  }, [all]);

  const term = search.trim().toLowerCase();
  const matching = useMemo(
    () =>
      all.filter(
        (r) =>
          (stage === "all" || r.stage === stage) &&
          (!term ||
            [r.number, r.customerName, r.propertyLabel, r.renewalProposal?.proposalNumber ?? "", ...r.accountManagers].some((v) => v.toLowerCase().includes(term))),
      ),
    [all, stage, term],
  );
  const rows = matching.slice(page * pageSize, (page + 1) * pageSize);
  const filtered = Boolean(term) || stage !== "all";
  const escalation = data?.escalationPercent ?? 0;

  const startRenewal = useCallback(
    async (r: RenewalDueRow) => {
      const created = { submissionId: "" };
      const done = await confirm({
        title: `Start the renewal of AMC ${r.number}?`,
        description: `A draft renewal proposal is made in AMC proposals with the same client, property, account managers and services${
          escalation ? `, at last year's prices plus ${escalation}%` : ""
        }. Nothing is sent and the contract does not change.`,
        confirmText: "Start renewal",
        action: async () => {
          created.submissionId = (await renewalsService.startRenewal(r.contractId)).submissionId;
        },
      });
      if (!done || !created.submissionId) return;
      toast.success("Renewal proposal created as a draft", {
        action: { label: "Open draft", onClick: () => router.push(proposalEditHref(created.submissionId)) },
      });
      reload();
    },
    [confirm, escalation, reload, router],
  );

  const columns = useMemo<ColumnDef<RenewalDueRow>[]>(
    () => [
      {
        id: "contract",
        header: "Contract",
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
              <Repeat className="size-4" aria-hidden />
            </span>
            <div className="flex max-w-[260px] min-w-0 flex-col">
              <Link
                href={renewalTabHref(row.original.contractId)}
                className="truncate font-medium hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {row.original.number || "Contract"}
              </Link>
              <span className="text-muted-foreground truncate text-xs">
                {[row.original.customerName, row.original.propertyLabel].filter(Boolean).join(" · ") || "—"}
              </span>
            </div>
          </div>
        ),
      },
      {
        id: "ends",
        header: "Ends",
        cell: ({ row }) => (
          <span className="flex flex-col text-sm whitespace-nowrap">
            <span className="tabular-nums">{formatContractDate(row.original.endDate)}</span>
            <span className={row.original.daysLeft < 0 ? "text-danger text-xs" : "text-muted-foreground text-xs"}>{daysLeftLabel(row.original.daysLeft)}</span>
          </span>
        ),
      },
      {
        id: "value",
        header: "Value",
        cell: ({ row }) => (
          <span className="flex flex-col text-sm whitespace-nowrap">
            <Money value={row.original.grandTotal} />
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs" title="Suggested renewal total, with the configured escalation">
              Renewal <Money value={row.original.suggestedTotal} dp={0} />
              {escalation ? <span>(+{escalation}%)</span> : null}
            </span>
          </span>
        ),
      },
      {
        id: "stage",
        header: "Stage",
        cell: ({ row }) => <RenewalStageBadge stage={row.original.stage} />,
      },
      {
        id: "proposal",
        header: "Renewal proposal",
        cell: ({ row }) => {
          const p = row.original.renewalProposal;
          if (!p) return <span className="text-muted-foreground text-sm">Not started</span>;
          return (
            <span className="flex flex-col items-start gap-1">
              <Link href={proposalHref(p.id)} className="text-sm font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                {p.proposalNumber || "Draft"}
              </Link>
              <ProposalStatusBadge status={p.status} />
            </span>
          );
        },
      },
      {
        id: "outcome",
        header: "Outcome",
        cell: ({ row }) => (
          <span className="flex max-w-[200px] flex-col items-start gap-1">
            <RenewalOutcomeBadge outcome={row.original.outcome} />
            {row.original.outcomeReason ? (
              <span className="text-muted-foreground line-clamp-1 text-xs" title={row.original.outcomeReason}>
                {row.original.outcomeReason}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "managers",
        header: "Account managers",
        cell: ({ row }) =>
          row.original.accountManagers.length ? (
            <span className="line-clamp-2 max-w-[200px] text-sm">{row.original.accountManagers.join(", ")}</span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const r = row.original;
          const canStart = !r.renewalProposal && r.stage !== "settled";
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${r.number}`}>
                    <EllipsisVerticalIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-max">
                  <DropdownMenuItem onClick={() => router.push(renewalTabHref(r.contractId))}>
                    <ExternalLink className="mr-2 size-4" />
                    Open contract
                  </DropdownMenuItem>
                  {r.renewalProposal ? (
                    <DropdownMenuItem onClick={() => router.push(proposalHref(r.renewalProposal!.id))}>
                      <Repeat className="mr-2 size-4" />
                      Open renewal proposal
                    </DropdownMenuItem>
                  ) : null}
                  {canStart || r.stage !== "settled" ? <DropdownMenuSeparator /> : null}
                  {canStart ? (
                    <DropdownMenuItem onClick={() => void startRenewal(r)}>
                      <Repeat className="mr-2 size-4" />
                      Start renewal
                    </DropdownMenuItem>
                  ) : null}
                  {r.stage !== "settled" ? (
                    <DropdownMenuItem onClick={() => showOutcome(r)}>
                      <Flag className="mr-2 size-4" />
                      Record outcome
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [escalation, router, showOutcome, startRenewal],
  );

  const tabs: ReadonlyArray<{ value: StageFilter; label: string; count?: number }> = [
    { value: "all", label: "All", count: data ? all.length : undefined },
    { value: "due", label: "Due", count: data ? counts.due : undefined },
    { value: "idle", label: "Idle", count: data ? counts.idle : undefined },
    { value: "overdue", label: "Ended", count: data ? counts.overdue : undefined },
    { value: "settled", label: "Settled", count: data ? counts.settled : undefined },
  ];

  const clearFilters = () => {
    setSearch("");
    setStage("all");
    setPage(0);
  };

  const leadDays = data?.leadDays;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Contracts"
        title="Renewals"
        description={`Contracts inside the ${leadDays ?? "configured"}-day renewal window, idle renewals, and ones that ended without a renewal.`}
        actions={
          <>
            <AmcNotificationsBell />
            <ExportMenu name="renewals" columns={EXPORT_COLUMNS} rows={matching.map(exportRow)} />
          </>
        }
      />

      {data && !data.migrated ? (
        <Alert className="border-warning/30 bg-warning/5 items-start p-4">
          <Database className="text-warning" />
          <AlertTitle>Renewal outcomes are not set up on this database yet</AlertTitle>
          <AlertDescription>
            The list still shows what is due, but outcomes, reminders and idle escalation need migration 20261012140000. Ask an admin to apply it.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? <ErrorState title="Could not load the renewals" message={error} onRetry={reload} /> : null}

      {loading ? (
        <StatGridSkeleton count={4} />
      ) : data ? (
        <StatCardGrid columns={4}>
          <StatCard
            label="Due"
            value={counts.due}
            headline={`Ending within ${data.leadDays} days`}
            tone="review"
            onSelect={() => {
              setStage("due");
              setPage(0);
            }}
            selectLabel="Show the renewals due"
          />
          <StatCard
            label="Idle (escalated)"
            value={counts.idle}
            headline={counts.idle ? "Nothing done since the reminder" : "None idle"}
            tone={counts.idle ? "progress" : "neutral"}
            onSelect={() => {
              setStage("idle");
              setPage(0);
            }}
            selectLabel="Show the idle renewals"
          />
          <StatCard
            label="Ended without renewal"
            value={counts.overdue}
            headline={counts.overdue ? "Ended in the last 90 days" : "None ended unrenewed"}
            tone={counts.overdue ? "bad" : "neutral"}
            onSelect={() => {
              setStage("overdue");
              setPage(0);
            }}
            selectLabel="Show the contracts that ended without a renewal"
          />
          <StatCard
            label="Settled"
            value={counts.settled}
            headline="Renewed or outcome recorded"
            tone="good"
            onSelect={() => {
              setStage("settled");
              setPage(0);
            }}
            selectLabel="Show the settled renewals"
          />
        </StatCardGrid>
      ) : null}

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
          handleRowClick={(row) => router.push(renewalTabHref(row.contractId))}
          toolbar={
            <div>
              <ListToolbar
                search={search}
                onSearchChange={(v) => {
                  setSearch(v);
                  setPage(0);
                }}
                placeholder="Search contract, client, property or manager…"
                searchLabel="Search renewals"
                loading={loading}
                filters={[]}
                pageSize={pageSize}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(0);
                }}
                onRefresh={reload}
              />
              <div className="px-4 pb-4">
                <PillTabs
                  tabs={tabs}
                  value={stage}
                  onChange={(v) => {
                    setStage(v);
                    setPage(0);
                  }}
                />
              </div>
            </div>
          }
          emptyState={
            <EmptyState
              icon={<Repeat />}
              title={all.length && filtered ? "No matching renewals" : "No renewals to look at"}
              description={
                all.length && filtered
                  ? "No contract matches this search and stage."
                  : `When a contract comes within ${leadDays ?? "the configured number of"} days of its end date it shows here, with last year's value and the suggested renewal.`
              }
              action={all.length && filtered ? { label: "Clear filters", variant: "outline", onClick: clearFilters } : undefined}
            />
          }
        />
      </Card>

      <RecordOutcomeDialog
        key={outcomeDialog.key}
        open={outcomeDialog.open}
        onOpenChange={outcomeDialog.onOpenChange}
        contractId={outcomeDialog.target?.contractId ?? null}
        contractNumber={outcomeDialog.target?.number ?? ""}
        current={outcomeDialog.target?.outcome ?? null}
        onRecorded={reload}
      />
      {confirmDialog}
    </div>
  );
}
