"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { PageHeading, PillTabs, SectionCard, StatCard, StatCardGrid, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebounce } from "@/hooks/use-debounce";
import { enquiriesService, type EnquiryListParams } from "@/modules/amc-contracts/enquiries-service";

import { AmcSectionNav } from "../amc-section-nav";
import { formatContractDate, formatDateTime } from "../contract-status";
import { ExportMenu } from "../export-menu";
import { useAmcData } from "../use-amc-data";
import { EnquiryFormDialog } from "./enquiry-dialogs";
import { EnquiryFlags, StageBadge } from "./enquiry-ui";

const PAGE_SIZE = 25;
type View = "open" | "mine" | "follow_ups" | "idle" | "all";

const VIEW_PARAMS: Record<View, EnquiryListParams> = {
  open: { stage: "open" },
  mine: { stage: "open", owner: "me" },
  follow_ups: { followUp: "overdue" },
  idle: { idle: true },
  all: {},
};

/**
 * The enquiry pipeline (BRD 5.1, DEV-358): every enquiry, its stage, owner
 * and next follow-up, with idle and overdue flags. One board for the team.
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
  const [adding, setAdding] = useState(false);

  const params: EnquiryListParams = {
    ...VIEW_PARAMS[view],
    ...(stage !== "any" ? { stage } : {}),
    ...(source !== "any" ? { source } : {}),
    ...(owner !== "any" ? { owner } : {}),
    ...(followUp !== "any" ? { followUp: followUp as EnquiryListParams["followUp"] } : {}),
    q: term || null,
    page,
    pageSize: PAGE_SIZE,
  };
  const key = JSON.stringify(params);
  const { data, error, loading, reload } = useAmcData(() => enquiriesService.list(params), key);
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
  const total = data?.total ?? 0;
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * PAGE_SIZE);
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="AMC"
        title="Enquiries"
        description="Every AMC enquiry from first contact to won or lost: who owns it, what was said, when to follow up."
        actions={
          m?.canCreate ? (
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Log enquiry
            </Button>
          ) : null
        }
      />
      <AmcSectionNav current="enquiries" />

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

          <PillTabs<View>
            value={view}
            onChange={resetPage(setView)}
            tabs={[
              { value: "open", label: "Open" },
              { value: "mine", label: "Mine" },
              { value: "follow_ups", label: "Follow-ups overdue" },
              { value: "idle", label: "Idle" },
              { value: "all", label: "All" },
            ]}
          />

          <SectionCard
            title="Enquiries"
            icon={<Inbox />}
            bodyClassName="pb-2"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Input className="h-8 w-48" placeholder="Search" value={q} onChange={(e) => resetPage(setQ)(e.target.value)} aria-label="Search enquiries" />
                <Button size="icon" variant="outline" className="size-8" onClick={reload} aria-label="Refresh">
                  <RefreshCw className="size-4" />
                </Button>
                {m?.canExport ? (
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
                ) : null}
              </div>
            }
          >
            <div className="flex flex-wrap gap-2 px-5 pb-3">
              <FilterSelect label="Stage" value={stage} onChange={resetPage(setStage)} options={(m?.stages ?? []).map((s) => [s, s])} />
              <FilterSelect label="Source" value={source} onChange={resetPage(setSource)} options={(m?.sources ?? []).map((s) => [s, s])} />
              <FilterSelect label="Owner" value={owner} onChange={resetPage(setOwner)} options={(m?.people ?? []).map((p) => [p.id, p.name])} />
              <FilterSelect
                label="Follow-up"
                value={followUp}
                onChange={resetPage(setFollowUp)}
                options={[
                  ["overdue", "Overdue"],
                  ["today", "Today"],
                  ["week", "Within 7 days"],
                ]}
              />
              <label className="text-muted-foreground flex items-center gap-2 text-sm">
                <Switch checked={view === "idle"} onCheckedChange={(v) => resetPage(setView)(v ? "idle" : "open")} aria-label="Idle only" />
                Idle only
              </label>
            </div>
            {error ? (
              <div className="px-5 pb-4">
                <ErrorState title="Could not load enquiries" message={error} onRetry={reload} />
              </div>
            ) : loading ? (
              <div className="px-5 pb-4">
                <ListSkeleton rows={6} />
              </div>
            ) : data!.enquiries.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState
                  icon={<Inbox className="size-5" />}
                  title={term || view !== "all" ? "No enquiries match" : "No enquiries yet"}
                  description={term || view !== "all" ? "Try another view or clear the filters." : "Log the first one when a client gets in touch."}
                  action={m?.canCreate && !term ? { label: "Log enquiry", onClick: () => setAdding(true) } : undefined}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[960px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Enquiry</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Need</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="pr-5">Next follow-up</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data!.enquiries.map((e) => (
                      <TableRow key={e.id} className="cursor-pointer" onClick={() => router.push(`/extensions/amc-contracts/enquiries/${e.id}`)}>
                        <TableCell className="pl-5">
                          <Link href={`/extensions/amc-contracts/enquiries/${e.id}`} className="font-medium hover:underline" onClick={(ev) => ev.stopPropagation()}>
                            {e.enquiryNumber}
                          </Link>
                          <div className="text-muted-foreground text-xs tabular-nums">{formatContractDate(e.enquiredAt)}</div>
                        </TableCell>
                        <TableCell>
                          <IdentityCell title={e.customer.name} subtitle={[e.contactName !== e.customer.name ? e.contactName : null, e.contactPhone ?? e.contactWhatsapp ?? e.contactEmail].filter(Boolean).join(" · ")} />
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <span className="line-clamp-2 text-sm">{e.need}</span>
                        </TableCell>
                        <TableCell className="text-sm">{e.source}</TableCell>
                        <TableCell className="text-sm">{e.owner?.name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                        <TableCell>
                          <div className="grid gap-1">
                            <StageBadge stage={e.stage} stages={m?.stages ?? []} className="w-fit" />
                            <EnquiryFlags enquiry={e} compact />
                          </div>
                        </TableCell>
                        <TableCell className="pr-5 text-sm tabular-nums">
                          {e.nextFollowUpAt ? (
                            <span className={e.followUp === "overdue" ? "text-destructive" : undefined} title={formatDateTime(e.nextFollowUpAt)}>
                              {formatDateTime(e.nextFollowUpAt)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Last activity {timeAgo(e.lastActivityAt)}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="text-muted-foreground flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="tabular-nums">
                    Showing {first} to {last} of {total}
                  </span>
                  {total > PAGE_SIZE ? (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="rounded-full" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                        Previous
                      </Button>
                      <Button variant="outline" size="sm" className="rounded-full" disabled={last >= total} onClick={() => setPage((p) => p + 1)}>
                        Next
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {adding && m ? (
        <EnquiryFormDialog
          meta={m}
          enquiry={null}
          onClose={() => setAdding(false)}
          onSaved={(saved) => {
            toast.success(`Enquiry ${saved.enquiryNumber} logged`);
            router.push(`/extensions/amc-contracts/enquiries/${saved.id}`);
          }}
        />
      ) : null}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-[140px]" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="any">{`Any ${label.toLowerCase()}`}</SelectItem>
        {options.map(([k, l]) => (
          <SelectItem key={k} value={k}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
