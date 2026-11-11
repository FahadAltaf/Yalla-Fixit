"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FileSignature, Hammer, XCircle } from "lucide-react";

import { SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WORK_RISK_LABELS } from "@/lib/amc/call-outs";
import { TRADE_LABELS } from "@/lib/amc/client-profile";
import { visitPageHref } from "@/lib/amc/field-visits";
import { amcRefresh } from "@/lib/amc/http-cache";
import type { Trade } from "@/lib/amc/visits";
import { additionalWorksService, type AdditionalWorkResponse } from "@/modules/amc-contracts/additional-works-service";

import {
  WorkFindingSection,
  WorkPartiesSection,
  WorkPhotosSection,
  WorkQuotationSection,
  WorkScheduleSection,
  WorkSteps,
  useWorkActions,
  workSourceLabel,
  type WorkWorking,
} from "./additional-work-sections";
import { Muted, Panel, PanelSurface, RiskBadge, WorkStatusBadge, shortDateTime } from "./call-out-shared";
import { formatContractDate, formatDateTime } from "./contract-status";
import { DetailHeaderCard, DetailHeaderSkeleton, DetailToolbar, shortPlace } from "./detail-header";
import { DetailList } from "./enquiries/enquiry-ui";
import { useTechnicianName } from "./people-pickers";
import { useUrlTab } from "./profile/use-url-tab";
import { useAmcData } from "./use-amc-data";
import { HistoryPanel } from "./visit-page";
import { slotLabel } from "./visit-status";

const TABS = ["overview", "finding", "quotation", "parties", "crew", "photos", "history"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  finding: "Finding",
  quotation: "Quotation",
  parties: "Parties",
  crew: "Crew & time",
  photos: "Photos",
  history: "History",
};

const LIST = "/extensions/amc-contracts/additional-works";

/**
 * One additional work on its own page, as a visit: the header with where it
 * stands and the next commercial step (share, approve, schedule, complete,
 * invoice, paid, reject), then tabs that load when first opened and stay
 * mounted (?tab=…): Overview, Finding, Quotation, Parties, Crew & time (the
 * slot and crew once approved), Photos, History. It is a quotation before
 * approval and a visit after, so it has its own page at every status.
 */
export function AdditionalWorkPage({ id }: { id: string }) {
  const router = useRouter();
  const work = useAmcData(async () => ({ ...(await additionalWorksService.work(id)), fetchedAt: Date.now() }), `additional-work:${id}`);
  const { tab, setTab, isOpened } = useUrlTab<Tab>(TABS, "overview");
  const history = useAmcData(() => (isOpened("history") ? additionalWorksService.history(id) : Promise.resolve(null)), isOpened("history") ? `additional-work-history:${id}` : "history:none");
  const [working, setWorking] = useState<WorkWorking>(null);
  const data = work.data;
  const w = data?.work ?? null;

  const reloadAll = () => {
    work.reload();
    history.reload();
  };
  const changed = async () => reloadAll();
  const refresh = () => amcRefresh(reloadAll);
  const actions = useWorkActions(data, changed, working !== null, () => setTab("crew"));
  const notFound = work.error && /not found/i.test(work.error);

  const panel = (value: Tab, children: ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-4 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;
  const withWork = (render: (d: AdditionalWorkResponse) => ReactNode) => (data ? render(data) : <SectionSkeleton />);
  const props = (d: AdditionalWorkResponse) => ({ data: d, working, setWorking, changed });

  if (notFound) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <DetailToolbar backHref={LIST} backLabel="Additional work" />
        <Card className="p-0">
          <EmptyState
            icon={<Hammer className="size-6" />}
            title="This additional work could not be found"
            description="It may have been removed, or you may not have access to it."
            action={{ label: "Back to additional work", onClick: () => router.push(LIST), variant: "outline" }}
          />
        </Card>
      </div>
    );
  }

  const sourceHref = w?.source === "visit" && w.visitId ? visitPageHref(w.visitId) : w?.source === "call_out" && w.callOutId ? visitPageHref(w.callOutId) : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <DetailToolbar backHref={LIST} backLabel="Additional work" fetchedAt={data?.fetchedAt ?? null} refreshing={work.reloading || history.reloading} onRefresh={refresh} />

      {work.error ? (
        <ErrorState title="Could not load the additional work" message={work.error} onRetry={work.reload} />
      ) : !w || !data ? (
        <DetailHeaderSkeleton />
      ) : (
        <DetailHeaderCard
          badges={
            <>
              <Badge variant="outline">Additional work</Badge>
              <Badge variant="outline" className="tabular-nums">
                {w.workNo}
              </Badge>
              <RiskBadge risk={w.risk} />
            </>
          }
          title={w.customerName || "Additional work"}
          status={
            <span className="flex items-center gap-2">
              <WorkStatusBadge status={w.status} />
              <span className="text-muted-foreground text-sm">{workSourceLabel(w)}</span>
            </span>
          }
          subline={[
            shortPlace(w.propertyLabel),
            w.totals.total ? `AED ${w.totals.total.toLocaleString("en-AE", { minimumFractionDigits: 2 })}` : "Not quoted yet",
            data.slot.scheduledStart ? slotLabel(data.slot.scheduledStart, data.slot.scheduledEnd) : w.scheduledFor ? formatContractDate(w.scheduledFor) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          actions={
            <>
              <Button asChild variant="outline">
                <Link href={`/extensions/amc-contracts/${w.contractId}`}>
                  <FileSignature className="size-4" />
                  Open contract
                </Link>
              </Button>
              {sourceHref ? (
                <Button asChild variant="outline">
                  <Link href={sourceHref}>
                    <ExternalLink className="size-4" />
                    Open {w.source === "visit" ? "visit" : "call out"}
                  </Link>
                </Button>
              ) : null}
              {actions.buttons}
            </>
          }
        />
      )}

      {actions.notice}
      {w?.status === "rejected" ? (
        <Alert variant="destructive" className="border-destructive/30 items-start p-4">
          <XCircle />
          <AlertTitle>Rejected{w.rejectedAt ? ` ${formatDateTime(w.rejectedAt)}` : ""}</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap">{w.rejectionReason ?? "No reason given."}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {w ? (
        <PanelSurface.Provider value="card">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
              {TABS.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TAB_LABELS[t]}
                  {t === "photos" && data?.photos.length ? <span className="text-muted-foreground ml-1 tabular-nums">({data.photos.length})</span> : null}
                </TabsTrigger>
              ))}
            </TabsList>

            {panel("overview", withWork((d) => <WorkOverview data={d} onTab={setTab} />))}
            {panel("finding", withWork((d) => <WorkFindingSection {...props(d)} />))}
            {panel("quotation", withWork((d) => <WorkQuotationSection {...props(d)} />))}
            {panel("parties", withWork((d) => <WorkPartiesSection {...props(d)} />))}
            {panel("crew", withWork((d) => <WorkScheduleSection {...props(d)} />))}
            {panel("photos", withWork((d) => <WorkPhotosSection data={d} working={working} changed={changed} />))}
            {panel("history", <HistoryPanel data={history} description="Everything that happened to this work, newest first: each step from the finding to the payment, and who took it." />)}
          </Tabs>
        </PanelSurface.Provider>
      ) : null}

      {actions.dialogs}
    </div>
  );
}

function WorkOverview({ data, onTab }: { data: AdditionalWorkResponse; onTab: (tab: Tab) => void }) {
  const { work: w, slot, photos } = data;
  const technicianName = useTechnicianName();
  const quoted = w.quotationLines.length > 0;
  const approved = ["approved", "scheduled", "completed", "invoiced", "paid"].includes(w.status);
  return (
    <>
      <StatCardGrid columns={4}>
        <StatCard
          label="Quotation"
          value={quoted ? <Money value={w.totals.total} /> : "Not quoted"}
          headline={w.approvedAt ? `Approved ${shortDateTime(w.approvedAt)}` : w.sharedAt ? `Shared ${shortDateTime(w.sharedAt)}` : quoted ? "Ready to share" : "Prepare it on Quotation"}
          caption={`${w.quotationLines.length} ${w.quotationLines.length === 1 ? "line" : "lines"}, VAT included`}
          tone={approved ? "good" : w.status === "rejected" ? "bad" : w.sharedAt ? "review" : "neutral"}
          onSelect={() => onTab("quotation")}
          selectLabel="Open the quotation"
        />
        <StatCard
          label="When"
          value={slot.scheduledStart ? slotLabel(slot.scheduledStart, slot.scheduledEnd).split(",")[0] : w.scheduledFor ? formatContractDate(w.scheduledFor) : "Not scheduled"}
          headline={slot.scheduledStart ? slotLabel(slot.scheduledStart, slot.scheduledEnd) : approved ? "Schedule it on Crew & time" : "After the client approves"}
          tone={w.completedAt ? "good" : slot.scheduledStart || w.scheduledFor ? "progress" : "neutral"}
          onSelect={() => onTab("crew")}
          selectLabel="Open crew and time"
        />
        <StatCard
          label="Crew"
          value={slot.technicianIds.length ? (technicianName(slot.leadTechnicianId ?? slot.technicianIds[0]) ?? "—") : "Not assigned"}
          headline={slot.technicianIds.length > 1 ? `+${slot.technicianIds.length - 1} more` : slot.technicianIds.length ? "Lead technician" : "No crew yet"}
          caption={w.technicianId ? `Found by ${technicianName(w.technicianId)}` : undefined}
          tone={slot.technicianIds.length ? "good" : "neutral"}
          onSelect={() => onTab("crew")}
          selectLabel="Open crew and time"
        />
        <StatCard
          label="Photos"
          value={photos.length}
          headline={photos.length ? "Of the finding, before and after" : "None yet"}
          tone={photos.length ? "good" : "neutral"}
          onSelect={() => onTab("photos")}
          selectLabel="Open the photos"
        />
      </StatCardGrid>

      <Panel title="Where it stands" description="From the finding to the payment.">
        <WorkSteps work={w} />
      </Panel>

      <SectionCard title="Work details" description="What was found, where, how serious it is, and the commercial record." icon={<Hammer />} bodyClassName="px-5 pb-4">
        <DetailList
          rows={[
            { label: "Finding", value: <span className="line-clamp-3 whitespace-pre-wrap">{w.finding}</span> },
            { label: "Risk", value: WORK_RISK_LABELS[w.risk] },
            { label: "Trade", value: w.trade ? (TRADE_LABELS[w.trade as Trade] ?? w.trade) : <Muted>Not set</Muted> },
            { label: "Found on", value: workSourceLabel(w) },
            { label: "Raised", value: shortDateTime(w.createdAt) },
            ...(w.approvalEvidence ? [{ label: "Approval", value: w.approvalEvidence }] : []),
            ...(w.completedAt ? [{ label: "Completed", value: shortDateTime(w.completedAt) }] : []),
            ...(w.invoiceNumber ? [{ label: "Invoice", value: w.invoiceNumber }] : []),
            ...(w.paymentReference ? [{ label: "Payment reference", value: w.paymentReference }] : []),
          ]}
        />
        <div className="pt-3">
          <Button size="sm" variant="outline" onClick={() => onTab("finding")}>
            Edit the finding
          </Button>
        </div>
      </SectionCard>
    </>
  );
}
