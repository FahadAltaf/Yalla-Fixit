"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, CalendarPlus, ClipboardCheck, FileSignature, History, Inbox, MessageSquarePlus, MoreHorizontal, Pencil, RefreshCw, SearchX, Shuffle, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { DataRow, SectionCard, StatCard, StatCardGrid, TabCount, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState, SectionSkeleton, StatGridSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHANNEL_LABELS, LIFECYCLE_LABELS, UNIT_TYPE_LABELS } from "@/lib/amc/client-profile";
import { ATTENDANCE_LABELS, CLOSED_STAGES, ENQUIRY_STAGE, FOLLOW_UP_CHANNEL_LABELS, type FollowUpChannel, type SiteVisitAttendance } from "@/lib/amc/enquiries";
import { enquiriesService } from "@/modules/amc-contracts/enquiries-service";
import { proposalRulesService } from "@/modules/amc-submissions";

import { formatContractDate, formatDateTime } from "../contract-status";
import { LIFECYCLE_TONE } from "../profile/identity-card";
import { useUrlTab } from "../profile/use-url-tab";
import { useAmcData } from "../use-amc-data";
import { EnquiryFormDialog, FollowUpDialog, SiteVisitDialog, StageDialog } from "./enquiry-dialogs";
import { DetailList, EnquiryFlags, SiteVisitStatusBadge, StageBadge, formatClock } from "./enquiry-ui";

const TABS = ["overview", "site-visits", "follow-ups", "history"] as const;
type OpenDialog = "edit" | "stage" | "follow-up" | "site-visit" | null;

/** One enquiry (BRD 5.1, 5.2): details, client and property, site visits, follow-ups and the stage history. */
export function EnquiryDetail({ id }: { id: string }) {
  /* Set by Refresh and cleared when the answer lands; the page stays on screen meanwhile. */
  const [refreshing, setRefreshing] = useState(false);
  const { data, error, loading, reload } = useAmcData(
    () =>
      enquiriesService
        .get(id)
        .then((r) => ({ ...r, fetchedAt: Date.now() }))
        .finally(() => setRefreshing(false)),
    id,
  );
  const meta = useAmcData(() => enquiriesService.meta(), "enquiry-meta");
  useBreadcrumbLabel("enquiries", "Enquiries");
  useBreadcrumbLabel(id, data?.enquiry.enquiryNumber ?? "Enquiry");
  const { tab, setTab, isOpened } = useUrlTab(TABS, "overview");
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [stageChoice, setStageChoice] = useState<string | undefined>(undefined);
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    reload();
  };

  /* Renders straight away, before any data: the way back and Refresh. */
  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <BackToEnquiries />
      <div className="flex items-center gap-3">
        {data ? <span className="text-muted-foreground hidden text-xs sm:inline">Updated {formatClock(data.fetchedAt)}</span> : null}
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading || refreshing} aria-label="Refresh this enquiry">
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>
    </div>
  );

  if (error && /not found/i.test(error)) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        <BackToEnquiries />
        <Card className="p-0">
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="This enquiry could not be found"
            description="It may have been removed, or the link may be out of date."
            action={{ label: "Back to enquiries", onClick: () => router.push("/extensions/amc-contracts/enquiries"), variant: "outline" }}
          />
        </Card>
      </div>
    );
  }
  if (error || meta.error) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {toolbar}
        <ErrorState
          title="Could not load this enquiry"
          message={error ?? meta.error}
          onRetry={() => {
            refresh();
            meta.reload();
          }}
          retrying={refreshing}
        />
      </div>
    );
  }
  if (loading || meta.loading || !data || !meta.data) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        {toolbar}
        <Skeleton className="h-32 w-full rounded-xl" />
        <StatGridSkeleton count={4} />
        <SectionSkeleton />
      </div>
    );
  }

  const { enquiry: e, followUps, siteVisits, history } = data;
  const m = meta.data;
  const canEdit = data.canEdit;
  const closed = CLOSED_STAGES.includes(e.stage);
  const completedVisits = siteVisits.filter((v) => v.status === "completed").length;
  const completedVisit = completedVisits > 0;
  const stageIndex = m.stages.indexOf(e.stage);
  const nextStage = !closed && e.stage !== ENQUIRY_STAGE.onHold && stageIndex >= 0 ? m.stages[stageIndex + 1] : undefined;
  const suggestNext = nextStage && !CLOSED_STAGES.includes(nextStage) && nextStage !== ENQUIRY_STAGE.onHold ? nextStage : undefined;
  const needsVisit = e.siteVisitRequired && !completedVisit;
  const canStartProposal = canEdit && !closed && !e.proposal;
  /* DEV-365: the proposal, prefilled from the enquiry, its property and its site visit. */
  const startProposal = async () => {
    setStarting(true);
    try {
      const result = await proposalRulesService.proposalFromEnquiry(e.id);
      for (const w of result.warnings) toast.warning(w);
      toast.success(`Proposal ${result.proposalNumber} started from ${result.source === "site_visit" ? "the site visit" : result.source === "scope" ? "the property's scope" : "the enquiry"}.`);
      router.push(`/extensions/amc/${result.submissionId}/edit`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the proposal.");
      setStarting(false);
    }
  };
  /* A save that came back with a warning says so instead of a plain success. */
  const after = (message: string, result?: { warning: string | null }) => {
    if (result?.warning) toast.warning(result.warning);
    else toast.success(message);
    reload();
  };
  const openStage = (stage?: string) => {
    setStageChoice(stage);
    setDialog("stage");
  };
  const panel = (value: (typeof TABS)[number], children: React.ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-6 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;
  const unitType = (v: string | null) => (v ? (UNIT_TYPE_LABELS[v as keyof typeof UNIT_TYPE_LABELS] ?? v) : null);

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      {toolbar}

      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{e.source}</Badge>
              <EnquiryFlags enquiry={e} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl">{e.enquiryNumber}</h2>
              <StageBadge stage={e.stage} stages={m.stages} />
            </div>
            <p className="text-muted-foreground text-sm">
              {[e.customer.name, `enquired ${formatContractDate(e.enquiredAt)}`, e.owner ? `owned by ${e.owner.name}` : "unassigned"].join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {e.proposal ? (
              <Button asChild variant="outline">
                <Link href={`/extensions/amc/${e.proposal.id}`}>
                  <FileSignature className="size-4" />
                  Proposal {e.proposal.proposalNumber}
                </Link>
              </Button>
            ) : canStartProposal ? (
              <SubmitButton
                variant="outline"
                onClick={() => void startProposal()}
                pending={starting}
                pendingLabel="Starting…"
                disabled={!e.property}
                title={e.property ? undefined : "Link the property first"}
                icon={<FileSignature className="size-4" />}
              >
                Create proposal
              </SubmitButton>
            ) : null}
            {canEdit ? (
              <>
                <Button variant="outline" onClick={() => openStage()}>
                  <Shuffle className="size-4" />
                  Change stage
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="More actions">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-max">
                    <DropdownMenuItem onClick={() => setDialog("edit")}>
                      <Pencil className="mr-2 size-4" />
                      Edit enquiry
                    </DropdownMenuItem>
                    {!closed ? (
                      <DropdownMenuItem onClick={() => setDialog("site-visit")}>
                        <CalendarPlus className="mr-2 size-4" />
                        Book site visit
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button onClick={() => setDialog("follow-up")}>
                  <MessageSquarePlus className="size-4" />
                  Log follow-up
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {/* What is holding the enquiry up, then the step after this one. */}
        {e.stage === ENQUIRY_STAGE.lost ? (
          <div className="border-danger/30 bg-danger/5 border-t px-5 py-3">
            <p className="text-danger text-sm font-medium">Lost{e.lostReason ? `: ${e.lostReason}` : ""}</p>
            {e.lostNotes ? <p className="text-muted-foreground mt-1 text-sm">{e.lostNotes}</p> : null}
          </div>
        ) : needsVisit || (canEdit && suggestNext) ? (
          <div className={needsVisit ? "border-warning/30 bg-warning/5 flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3" : "flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3"}>
            <p className={needsVisit ? "text-sm" : "text-muted-foreground text-sm"}>
              {needsVisit
                ? `A completed site visit is needed before a proposal (${m.siteVisitRule === "block" ? "required" : "flagged"} by AMC configuration).`
                : `Next stage: ${suggestNext}.`}
            </p>
            {canEdit && suggestNext ? (
              <Button size="sm" variant="ghost" onClick={() => openStage(suggestNext)}>
                Move to {suggestNext}
                <ArrowRight className="size-4" />
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>

      <StatCardGrid columns={4}>
        <StatCard
          label="Next follow-up"
          value={e.nextFollowUpAt ? formatContractDate(e.nextFollowUpAt) : "None"}
          tone={e.followUp === "overdue" ? "bad" : "neutral"}
          headline={e.followUp === "overdue" ? "Overdue" : e.followUp === "today" ? "Due today" : e.nextFollowUpAt ? "Planned" : "Not planned"}
          caption={e.nextFollowUpAt ? formatDateTime(e.nextFollowUpAt) : "Log a follow-up to plan one"}
        />
        <StatCard
          label="Last activity"
          value={timeAgo(e.lastActivityAt)}
          tone={e.idle.state === "escalate" ? "bad" : e.idle.state ? "progress" : "neutral"}
          headline={e.idle.state === "escalate" ? "Idle, escalated to management" : e.idle.state ? "Idle" : "Active"}
          caption={formatDateTime(e.lastActivityAt)}
        />
        <StatCard label="Follow-ups" value={followUps.length} headline="Contacts logged" caption="Calls, messages and meetings" onSelect={() => setTab("follow-ups")} />
        <StatCard
          label="Site visits"
          value={siteVisits.length}
          tone={needsVisit ? "progress" : "neutral"}
          headline={`${completedVisits} completed`}
          caption={e.siteVisitRequired ? "One is needed before a proposal" : "Not required for this category"}
          onSelect={() => setTab("site-visits")}
        />
      </StatCardGrid>

      <Tabs value={tab} onValueChange={setTab}>
        {/* Wraps onto a second line on a narrow screen rather than scrolling sideways. */}
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="site-visits">
            Site visits
            <TabCount value={siteVisits.length} />
          </TabsTrigger>
          <TabsTrigger value="follow-ups">
            Follow-ups
            <TabCount value={followUps.length} />
          </TabsTrigger>
          <TabsTrigger value="history">
            Stage history
            <TabCount value={history.length} />
          </TabsTrigger>
        </TabsList>

        {panel(
          "overview",
          <>
            <div className="grid gap-6 lg:grid-cols-3">
              <SectionCard title="Enquiry" icon={<Inbox />} bodyClassName="px-5 pb-4 grid gap-3" className="lg:col-span-2">
                <div className="grid gap-1">
                  <span className="text-muted-foreground text-sm">What the client needs</span>
                  <p className="text-sm whitespace-pre-wrap">{e.need}</p>
                </div>
                <DetailList
                  rows={[
                    { label: "Source", value: e.referrer ? `${e.source} (referred by ${e.referrer})` : e.source },
                    { label: "Owner", value: e.owner?.name ?? "Unassigned" },
                    { label: "Area", value: e.area },
                    { label: "Property type", value: [unitType(e.unitType), e.propertyCategory ? capitalise(e.propertyCategory) : null].filter(Boolean).join(" · ") || null },
                    { label: "Next follow-up", value: e.nextFollowUpAt ? <span className={e.followUp === "overdue" ? "text-danger" : undefined}>{formatDateTime(e.nextFollowUpAt)}</span> : "Not planned" },
                    { label: "Last activity", value: `${timeAgo(e.lastActivityAt)} · ${formatDateTime(e.lastActivityAt)}` },
                    { label: "In this stage since", value: formatDateTime(e.stageChangedAt) },
                    ...(e.stage === ENQUIRY_STAGE.lost ? [{ label: "Lost because", value: [e.lostReason, e.lostNotes].filter(Boolean).join(": ") }] : []),
                    ...(e.proposal
                      ? [
                          {
                            label: "Proposal",
                            value: (
                              <Link href={`/extensions/amc/${e.proposal.id}`} className="hover:text-brand underline underline-offset-2">
                                {e.proposal.proposalNumber} ({e.proposal.status.replace(/_/g, " ")})
                              </Link>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </SectionCard>

              <SectionCard
                title="Client"
                icon={<UserRound />}
                bodyClassName="px-5 pb-4 grid gap-3"
                action={
                  <Badge variant="secondary" className={`border-0 font-medium ${LIFECYCLE_TONE[e.customer.lifecycle as keyof typeof LIFECYCLE_TONE] ?? ""}`}>
                    {LIFECYCLE_LABELS[e.customer.lifecycle as keyof typeof LIFECYCLE_LABELS] ?? e.customer.lifecycle}
                  </Badge>
                }
              >
                <Link href={`/extensions/amc-contracts/customers/${e.customer.id}`} className="hover:text-brand text-sm font-medium">
                  {e.customer.name}
                  {e.customer.customerRef ? <span className="text-muted-foreground font-normal"> · {e.customer.customerRef}</span> : null}
                </Link>
                <DetailList
                  rows={[
                    { label: "Contact", value: e.contactName },
                    { label: "Phone", value: e.contactPhone },
                    { label: "WhatsApp", value: e.contactWhatsapp },
                    { label: "Email", value: e.contactEmail },
                    {
                      label: "Prefers",
                      value: [e.preferredChannel ? (CHANNEL_LABELS[e.preferredChannel as keyof typeof CHANNEL_LABELS] ?? e.preferredChannel) : null, e.preferredLanguage].filter(Boolean).join(" · ") || null,
                    },
                  ]}
                />
              </SectionCard>
            </div>

            <SectionCard
              title="Property and scope"
              description="Captured once on the property's page: details, assets, access rules and scope. Proposals start from it."
              icon={<Building2 />}
              bodyClassName="px-5 pb-5"
              action={
                canEdit && !e.property ? (
                  <Button size="sm" variant="outline" onClick={() => setDialog("edit")}>
                    Link a property
                  </Button>
                ) : null
              }
            >
              {e.property ? (
                <DataRow
                  icon={<Building2 />}
                  title={
                    <Link href={`/extensions/amc-contracts/properties/${e.property.id}`} className="hover:underline">
                      {e.property.label}
                    </Link>
                  }
                  subtitle={[unitType(e.property.unitType), e.property.propertyCategory ? capitalise(e.property.propertyCategory) : null].filter(Boolean).join(" · ") || undefined}
                  trailing={
                    <Link href={`/extensions/amc-contracts/properties/${e.property.id}?tab=scope`} className="text-sm hover:underline">
                      Assets and scope
                    </Link>
                  }
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  No property linked yet. Add it on the{" "}
                  <Link href={`/extensions/amc-contracts/customers/${e.customer.id}`} className="hover:underline">
                    client&apos;s page
                  </Link>
                  , or when booking the site visit.
                </p>
              )}
            </SectionCard>
          </>,
        )}

        {panel(
          "site-visits",
          <SectionCard
            title="Site visits"
            description="Visits to the property booked from this enquiry. A completed one feeds the proposal."
            icon={<ClipboardCheck />}
            bodyClassName={siteVisits.length === 0 ? "border-t" : "px-5 pb-5"}
            action={
              canEdit && !closed ? (
                <Button size="sm" variant="outline" onClick={() => setDialog("site-visit")}>
                  <CalendarPlus className="size-4" />
                  Book site visit
                </Button>
              ) : null
            }
          >
            {siteVisits.length === 0 ? (
              <EmptyState
                icon={<ClipboardCheck className="size-5" />}
                title="No site visits booked"
                description={e.siteVisitRequired ? "One is needed for this category before a proposal." : "Book one when the client wants the property seen first."}
                action={canEdit && !closed ? { label: "Book site visit", onClick: () => setDialog("site-visit"), variant: "outline" } : undefined}
              />
            ) : (
              siteVisits.map((v) => (
                <DataRow
                  key={v.id}
                  icon={<ClipboardCheck />}
                  title={
                    <Link href={`/extensions/amc-contracts/assessments/${v.id}`} className="hover:underline">
                      {v.assessmentNumber}
                    </Link>
                  }
                  subtitle={[v.scheduledAt ? formatDateTime(v.scheduledAt) : null, v.assessorName, v.property?.label].filter(Boolean).join(" · ") || undefined}
                  trailing={
                    <div className="flex flex-col items-end gap-1">
                      <SiteVisitStatusBadge status={v.status} />
                      {v.attendance ? <span className="text-muted-foreground text-xs">{ATTENDANCE_LABELS[v.attendance as SiteVisitAttendance] ?? v.attendance}</span> : null}
                    </div>
                  }
                />
              ))
            )}
          </SectionCard>,
        )}

        {panel(
          "follow-ups",
          <SectionCard
            title="Follow-ups"
            description="Every contact with the client about this enquiry, newest first. Each one also appears in the client's communication log."
            icon={<MessageSquarePlus />}
            bodyClassName="border-t"
            action={
              canEdit ? (
                <Button size="sm" variant="outline" onClick={() => setDialog("follow-up")}>
                  <MessageSquarePlus className="size-4" />
                  Log follow-up
                </Button>
              ) : null
            }
          >
            {followUps.length === 0 ? (
              <EmptyState
                icon={<MessageSquarePlus className="size-5" />}
                title="No follow-ups yet"
                description="Log each call, message or meeting, and plan the next one."
                action={canEdit ? { label: "Log follow-up", onClick: () => setDialog("follow-up"), variant: "outline" } : undefined}
              />
            ) : (
              <ul className="divide-y">
                {followUps.map((f) => (
                  <li key={f.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary" className="bg-mist text-ink-soft border-0 font-medium">
                        {FOLLOW_UP_CHANNEL_LABELS[f.channel as FollowUpChannel] ?? f.channel}
                      </Badge>
                      <span className="font-medium">{f.outcome}</span>
                      <span className="text-muted-foreground ml-auto text-xs tabular-nums" title={formatDateTime(f.occurredAt)}>
                        {timeAgo(f.occurredAt)} · {f.loggedBy ?? "—"}
                      </span>
                    </div>
                    {f.notes ? <p className="text-muted-foreground mt-1 text-sm whitespace-pre-wrap">{f.notes}</p> : null}
                    {f.nextFollowUpAt ? <p className="text-muted-foreground mt-1 text-xs">Next follow-up planned for {formatDateTime(f.nextFollowUpAt)}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>,
        )}

        {panel(
          "history",
          <SectionCard title="Stage history" description="Who moved the enquiry, when, and why (BRD 6.9)." icon={<History />} bodyClassName="border-t">
            {history.length === 0 ? (
              <EmptyState icon={<History className="size-5" />} title="No changes recorded" description="Each stage change is listed here with who made it and why." />
            ) : (
              <ul className="divide-y">
                {[...history].reverse().map((h, i) => (
                  <li key={`${h.at}-${i}`} className="flex flex-wrap items-start gap-2 px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {h.from ? (
                        <>
                          <StageBadge stage={h.from} stages={m.stages} />
                          <ArrowRight className="text-muted-foreground size-3.5" />
                        </>
                      ) : (
                        <span className="text-muted-foreground">Logged at</span>
                      )}
                      <StageBadge stage={h.to} stages={m.stages} />
                    </div>
                    <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                      {formatDateTime(h.at)} · {h.actorLabel ?? (h.origin === "system" ? "Portal" : "—")}
                    </span>
                    {h.reason ? <p className="text-muted-foreground w-full text-sm">{h.reason}</p> : null}
                    {typeof h.details.warning === "string" ? <p className="text-warning w-full text-xs">{h.details.warning}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>,
        )}
      </Tabs>

      {/* Always mounted and controlled, as on Snagging; each starts fresh when opened. */}
      <EnquiryFormDialog
        open={dialog === "edit"}
        onOpenChange={(open) => !open && setDialog(null)}
        meta={m}
        enquiry={e}
        onSaved={() => {
          toast.success("Enquiry saved");
          reload();
        }}
      />
      <StageDialog
        open={dialog === "stage"}
        onOpenChange={(open) => !open && setDialog(null)}
        meta={m}
        enquiry={e}
        hasCompletedSiteVisit={completedVisit}
        initialStage={stageChoice}
        onSave={async (input) => after("Stage changed", await enquiriesService.changeStage(e.id, input))}
      />
      <FollowUpDialog
        open={dialog === "follow-up"}
        onOpenChange={(open) => !open && setDialog(null)}
        meta={m}
        enquiry={e}
        onSave={async (input) => after("Follow-up logged", await enquiriesService.addFollowUp(e.id, input))}
      />
      <SiteVisitDialog
        open={dialog === "site-visit"}
        onOpenChange={(open) => !open && setDialog(null)}
        meta={m}
        enquiry={e}
        onSave={async (input) => {
          await enquiriesService.scheduleSiteVisit(e.id, input);
          after("Site visit booked; the assessor has been told");
        }}
      />
    </div>
  );
}

function BackToEnquiries() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
      <Link href="/extensions/amc-contracts/enquiries">
        <ArrowLeft className="size-4" />
        Enquiries
      </Link>
    </Button>
  );
}

const capitalise = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
