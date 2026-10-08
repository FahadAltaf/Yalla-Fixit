"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, Clock, EllipsisVerticalIcon, FileSignature, Inbox, Megaphone, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { PageHeading, SectionCard, StatCard, StatCardGrid, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { useDebounce } from "@/hooks/use-debounce";
import { enquiriesService, type EnquiryListParams, type EnquiryRecord } from "@/modules/amc-contracts/enquiries-service";

import { AmcNotificationsBell } from "../amc-notifications-bell";
import { formatContractDate, formatDateTime } from "../contract-status";
import { ExportMenu } from "../export-menu";
import { useAmcData } from "../use-amc-data";
import { EnquiryFormDialog } from "./enquiry-dialogs";
import { EnquiryFlags, StageBadge } from "./enquiry-ui";
import { ListToolbar, ToolbarSelect } from "./list-toolbar";

type View = "open" | "mine" | "follow_ups" | "idle" | "all";

const VIEW_PARAMS: Record<View, EnquiryListParams> = {
  open: { stage: "open" },
  mine: { stage: "open", owner: "me" },
  follow_ups: { followUp: "overdue" },
  idle: { idle: true },
  all: {},
};

const VIEWS: ReadonlyArray<{ value: View; label: string }> = [
  { value: "open", label: "Open" },
  { value: "mine", label: "Mine" },
  { value: "follow_ups", label: "Follow-ups overdue" },
  { value: "idle", label: "Idle" },
  { value: "all", label: "All enquiries" },
];

const enquiryHref = (id: string) => `/extensions/amc-contracts/enquiries/${id}`;

/**
 * The enquiry pipeline (BRD 5.1, DEV-358): every enquiry, its stage, owner
 * and next follow-up, with idle and overdue flags. One board for the team,
 * laid out like Snagging's jobs table.
 */
export function EnquiriesPage() {
  useBreadcrumbLabel("enquiries", "Enquiries");
  const router = useRouter();
  const meta = useAmcData(() => enquiriesService.meta(), "enquiry-meta");
  const [view, setView] = useState<View>("open");
  const [stage, setStage] = useState<string>("any");
  const [source, setSource] = useState<string>("any");
  const [owner, setOwner] = useState<string>("any");
  const [followUp, setFollowUp] = useState<string>("any");
  const [q, setQ] = useState("");
  const term = useDebounce(q.trim(), 250);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [adding, setAdding] = useState(false);
  /* Set by Refresh and cleared when the answer lands; the rows stay on screen meanwhile. */
  const [refreshing, setRefreshing] = useState(false);

  const params: EnquiryListParams = {
    ...VIEW_PARAMS[view],
    ...(stage !== "any" ? { stage } : {}),
    ...(source !== "any" ? { source } : {}),
    ...(owner !== "any" ? { owner } : {}),
    ...(followUp !== "any" ? { followUp: followUp as EnquiryListParams["followUp"] } : {}),
    q: term || null,
    page,
    pageSize,
  };
  const key = JSON.stringify(params);
  const { data, error, loading, reload } = useAmcData(() => enquiriesService.list(params).finally(() => setRefreshing(false)), key);
  /* Headline counts for the tiles (cheap: one row each, the total is what matters). */
  const counts = useAmcData(
    () =>
      Promise.all([
        enquiriesService.list({ stage: "open", pageSize: 1 }),
        enquiriesService.list({ followUp: "overdue", pageSize: 1 }),
        enquiriesService.list({ followUp: "today", pageSize: 1 }),
        enquiriesService.list({ idle: true, pageSize: 1 }),
      ]).then(([open, overdue, today, idle]) => ({ open: open.total, overdue: overdue.total, today: today.total, idle: idle.total })),
    `enquiry-counts|${data?.total ?? ""}`,
  );

  const m = meta.data;
  const stages = m?.stages;
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };
  const filtered = !!term || view !== "all" || stage !== "any" || source !== "any" || owner !== "any" || followUp !== "any";
  const clearFilters = () => {
    setView("all");
    setStage("any");
    setSource("any");
    setOwner("any");
    setFollowUp("any");
    setQ("");
    setPage(0);
  };
  const refresh = () => {
    setRefreshing(true);
    reload();
  };

  const columns = useMemo<ColumnDef<EnquiryRecord>[]>(
    () => [
      {
        id: "client",
        header: "Client",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-48">
            <IdentityCell title={row.original.customer.name} subtitle={`${row.original.enquiryNumber} · ${formatContractDate(row.original.enquiredAt)}`} />
          </div>
        ),
      },
      {
        id: "contact",
        header: "Contact",
        enableSorting: false,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm">{e.contactName}</span>
              <span className="text-muted-foreground truncate text-xs">{e.contactPhone ?? e.contactWhatsapp ?? e.contactEmail ?? "No contact details"}</span>
            </div>
          );
        },
      },
      {
        id: "need",
        header: "Need",
        enableSorting: false,
        cell: ({ row }) => <span className="line-clamp-2 max-w-[260px] text-sm whitespace-normal">{row.original.need}</span>,
      },
      {
        id: "source",
        header: "Source",
        enableSorting: false,
        cell: ({ row }) => <IconText icon={Megaphone}>{row.original.source}</IconText>,
      },
      {
        id: "owner",
        header: "Owner",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.owner ? (
            <IconText icon={UserRound}>{row.original.owner.name}</IconText>
          ) : (
            <IconText icon={UserRound} muted>
              Unassigned
            </IconText>
          ),
      },
      {
        id: "stage",
        header: "Stage",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="grid gap-1">
            <StageBadge stage={row.original.stage} stages={stages ?? []} className="w-fit" />
            <EnquiryFlags enquiry={row.original} compact />
          </div>
        ),
      },
      {
        id: "next",
        header: "Next follow-up",
        enableSorting: false,
        cell: ({ row }) => {
          const e = row.original;
          return e.nextFollowUpAt ? (
            <IconText icon={CalendarClock} className={e.followUp === "overdue" ? "text-danger" : "tabular-nums"}>
              {formatDateTime(e.nextFollowUpAt)}
            </IconText>
          ) : (
            <IconText icon={Clock} muted>
              Last activity {timeAgo(e.lastActivityAt)}
            </IconText>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        cell: ({ row }) => <EnquiryRowActions enquiry={row.original} />,
      },
    ],
    [stages],
  );

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Sales"
        title="Enquiries"
        description="Every AMC enquiry from first contact to won or lost: who owns it, what was said, when to follow up."
        actions={
          <>
            <AmcNotificationsBell />
            {m?.canCreate ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="size-4" />
                New enquiry
              </Button>
            ) : null}
          </>
        }
      />

      {data?.migrated === false ? (
        <SectionCard title="Enquiries" icon={<Inbox />} bodyClassName="px-5 pb-5">
          <p className="text-muted-foreground text-sm">Enquiries arrive with the AMC database update 20261007130000, which has not been applied to this database yet.</p>
        </SectionCard>
      ) : (
        <>
          <StatCardGrid columns={4}>
            <StatCard label="Open enquiries" value={counts.data?.open ?? "—"} headline="Not won or lost" caption="Across the team" onSelect={() => resetPage(setView)("open")} />
            <StatCard label="Follow-ups overdue" value={counts.data?.overdue ?? "—"} tone={counts.data?.overdue ? "bad" : "neutral"} headline="Past the planned date" caption="Open enquiries" onSelect={() => resetPage(setView)("follow_ups")} />
            <StatCard label="Follow-ups today" value={counts.data?.today ?? "—"} headline="Planned for today" caption="Dubai time" />
            <StatCard
              label="Idle"
              value={counts.data?.idle ?? "—"}
              tone={counts.data?.idle ? "progress" : "neutral"}
              headline={m ? `No activity for ${m.idleDays}+ days` : "No recent activity"}
              caption={m ? `Management after ${m.managementEscalationDays} days` : ""}
              onSelect={() => resetPage(setView)("idle")}
            />
          </StatCardGrid>

          {error ? <ErrorState title="Could not load enquiries" message={error} onRetry={refresh} retrying={refreshing} /> : null}

          <Card className="py-0">
            <DataTable
              data={data?.enquiries ?? []}
              columns={columns}
              loading={loading}
              rowCount={data?.total ?? 0}
              pageSize={pageSize}
              currentPage={page}
              isPagination
              onPageChange={setPage}
              onPageSizeChange={resetPage(setPageSize)}
              onGlobalFilterChange={resetPage(setQ)}
              handleRowClick={(e) => router.push(enquiryHref(e.id))}
              toolbar={
                <ListToolbar
                  search={q}
                  onSearchChange={resetPage(setQ)}
                  searchPlaceholder="Search by client, contact or enquiry…"
                  searchLabel="Search enquiries"
                  loading={loading || refreshing}
                  pageSize={pageSize}
                  onPageSizeChange={resetPage(setPageSize)}
                  onRefresh={refresh}
                  filters={
                    <>
                      <ToolbarSelect label="View" value={view} onChange={(v) => resetPage(setView)(v as View)} options={VIEWS} />
                      <ToolbarSelect label="Stage" value={stage} onChange={resetPage(setStage)} anyLabel="All stages" options={(m?.stages ?? []).map((s) => ({ value: s, label: s }))} />
                      <ToolbarSelect label="Source" value={source} onChange={resetPage(setSource)} anyLabel="All sources" options={(m?.sources ?? []).map((s) => ({ value: s, label: s }))} />
                      <ToolbarSelect label="Owner" value={owner} onChange={resetPage(setOwner)} anyLabel="All owners" options={(m?.people ?? []).map((p) => ({ value: p.id, label: p.name }))} />
                      <ToolbarSelect
                        label="Follow-up"
                        value={followUp}
                        onChange={resetPage(setFollowUp)}
                        anyLabel="Any follow-up"
                        options={[
                          { value: "overdue", label: "Overdue" },
                          { value: "today", label: "Today" },
                          { value: "week", label: "Within 7 days" },
                        ]}
                      />
                    </>
                  }
                  extra={
                    m?.canExport ? (
                      <ExportMenu
                        name="enquiries"
                        columns={[
                          { key: "number", label: "Enquiry" },
                          { key: "date", label: "Date" },
                          { key: "client", label: "Client" },
                          { key: "contact", label: "Contact" },
                          { key: "phone", label: "Phone" },
                          { key: "source", label: "Source" },
                          { key: "need", label: "Need" },
                          { key: "owner", label: "Owner" },
                          { key: "stage", label: "Stage" },
                          { key: "next", label: "Next follow-up" },
                          { key: "idleDays", label: "Days since activity" },
                        ]}
                        rows={(data?.enquiries ?? []).map((e) => ({
                          number: e.enquiryNumber,
                          date: formatContractDate(e.enquiredAt),
                          client: e.customer.name,
                          contact: e.contactName,
                          phone: e.contactPhone ?? e.contactWhatsapp ?? "",
                          source: e.source,
                          need: e.need,
                          owner: e.owner?.name ?? "",
                          stage: e.stage,
                          next: e.nextFollowUpAt ? formatDateTime(e.nextFollowUpAt) : "",
                          idleDays: e.idle.days,
                        }))}
                      />
                    ) : null
                  }
                />
              }
              emptyState={
                error ? (
                  <EmptyState icon={<Inbox className="size-5" />} title="Enquiries could not be loaded" description="Try again once the connection is back." />
                ) : filtered ? (
                  <EmptyState
                    icon={<Inbox className="size-5" />}
                    title="No enquiries match"
                    description="Nothing matches this view, these filters or that search."
                    action={{ label: "Show all enquiries", onClick: clearFilters, variant: "outline" }}
                  />
                ) : (
                  <EmptyState
                    icon={<Inbox className="size-5" />}
                    title="No enquiries yet"
                    description="Log the first one when a client gets in touch."
                    action={m?.canCreate ? { label: "New enquiry", onClick: () => setAdding(true) } : undefined}
                  />
                )
              }
            />
          </Card>
        </>
      )}

      {m ? (
        <EnquiryFormDialog
          open={adding}
          onOpenChange={setAdding}
          meta={m}
          enquiry={null}
          onSaved={(saved) => {
            toast.success(`Enquiry ${saved.enquiryNumber} logged`);
            router.push(enquiryHref(saved.id));
          }}
        />
      ) : null}
    </div>
  );
}

/** The row's kebab: the enquiry, its client and its proposal. Clicks stay out of the row's own click. */
function EnquiryRowActions({ enquiry }: { enquiry: EnquiryRecord }) {
  const router = useRouter();
  return (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${enquiry.enquiryNumber}`}>
            <EllipsisVerticalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max">
          <DropdownMenuItem onClick={() => router.push(enquiryHref(enquiry.id))}>
            <Inbox className="mr-2 size-4" />
            Open enquiry
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(`/extensions/amc-contracts/customers/${enquiry.customer.id}`)}>
            <UserRound className="mr-2 size-4" />
            Open client
          </DropdownMenuItem>
          {enquiry.proposal ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push(`/extensions/amc/${enquiry.proposal!.id}`)}>
                <FileSignature className="mr-2 size-4" />
                Proposal {enquiry.proposal.proposalNumber}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
