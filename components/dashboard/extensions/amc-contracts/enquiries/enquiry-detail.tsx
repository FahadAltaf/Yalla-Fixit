"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarPlus,
  ChevronDown,
  ClipboardCheck,
  FileSignature,
  History,
  Inbox,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  SearchX,
  Shuffle,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import {
  DataRow,
  PillTabs,
  SectionCard,
  StatCard,
  StatCardGrid,
  SubHeading,
  timeAgo,
} from "@/components/dashboard/shared/kaizen";
import {
  ErrorState,
  SectionSkeleton,
  StatGridSkeleton,
  SubmitButton,
} from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CHANNEL_LABELS,
  LIFECYCLE_LABELS,
  UNIT_TYPE_LABELS,
} from "@/lib/amc/client-profile";
import {
  ATTENDANCE_LABELS,
  CLOSED_STAGES,
  ENQUIRY_STAGE,
  FOLLOW_UP_CHANNEL_LABELS,
  type FollowUpChannel,
  type SiteVisitAttendance,
} from "@/lib/amc/enquiries";
import { enquiriesService } from "@/modules/amc-contracts/enquiries-service";
import { proposalRulesService } from "@/modules/amc-submissions";

import { formatContractDate, formatDateTime } from "../contract-status";
import { LIFECYCLE_TONE } from "../profile/identity-card";
import { useUrlTab } from "../profile/use-url-tab";
import { useAmcData } from "../use-amc-data";
import {
  EnquiryFormDialog,
  FollowUpDialog,
  SiteVisitDialog,
  StageDialog,
} from "./enquiry-dialogs";
import { DetailList, SiteVisitStatusBadge, StageBadge } from "./enquiry-ui";
import { LinkPropertyDialog } from "./link-property-dialog";

/* Three tabs, as on a quotation: what it is, the work done for it (site visits), and what happened to it. */
const TABS = ["details", "site-visits", "activity"] as const;
type OpenDialog = "edit" | "stage" | "follow-up" | "site-visit" | "link" | null;
type ActivityView = "follow-ups" | "history";

const ENQUIRIES = "/extensions/amc-contracts/enquiries";

/**
 * One enquiry (BRD 5.1, 5.2), laid out like a quotation's page: the way back
 * and everything the enquiry can do in one toolbar, what is holding it up as
 * alerts, then Details (the figures, client and property, the enquiry
 * itself), Site visits, and Activity (follow-ups and the stage history).
 */
export function EnquiryDetail({ id }: { id: string }) {
  /* Set by Refresh and cleared when the answer lands; the page stays on screen meanwhile. */
  const [refreshing, setRefreshing] = useState(false);
  const { data, error, loading, reload } = useAmcData(
    () => enquiriesService.get(id).finally(() => setRefreshing(false)),
    id,
  );
  const meta = useAmcData(() => enquiriesService.meta(), "enquiry-meta");
  useBreadcrumbLabel("enquiries", "Enquiries");
  useBreadcrumbLabel(id, data?.enquiry.enquiryNumber ?? "Enquiry");
  const { tab, setTab, isOpened } = useUrlTab(TABS, "details");
  const [activity, setActivityState] = useState<ActivityView>("follow-ups");
  const [activityOpened, setActivityOpened] = useState<Set<ActivityView>>(
    () => new Set<ActivityView>(["follow-ups"]),
  );
  const setActivity = useCallback((next: ActivityView) => {
    setActivityState(next);
    setActivityOpened((prev) =>
      prev.has(next) ? prev : new Set(prev).add(next),
    );
  }, []);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [stageChoice, setStageChoice] = useState<string | undefined>(undefined);
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    reload();
  };
  const ready = data && meta.data && !error && !meta.error;

  if (error && /not found/i.test(error)) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <BackToEnquiries />
        <Card className="p-0">
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="This enquiry could not be found"
            description="It may have been removed, or the link may be out of date."
            action={{
              label: "Back to enquiries",
              onClick: () => router.push(ENQUIRIES),
              variant: "outline",
            }}
          />
        </Card>
      </div>
    );
  }

  const e = data?.enquiry;
  const m = meta.data;
  const canEdit = Boolean(data?.canEdit);
  const closed = e ? CLOSED_STAGES.includes(e.stage) : false;
  const siteVisits = data?.siteVisits ?? [];
  const followUps = data?.followUps ?? [];
  const history = data?.history ?? [];
  const completedVisits = siteVisits.filter(
    (v) => v.status === "completed",
  ).length;
  const completedVisit = completedVisits > 0;
  const stageIndex = e && m ? m.stages.indexOf(e.stage) : -1;
  const nextStage =
    e && m && !closed && e.stage !== ENQUIRY_STAGE.onHold && stageIndex >= 0
      ? m.stages[stageIndex + 1]
      : undefined;
  const suggestNext =
    nextStage &&
    !CLOSED_STAGES.includes(nextStage) &&
    nextStage !== ENQUIRY_STAGE.onHold
      ? nextStage
      : undefined;
  const needsVisit = Boolean(e?.siteVisitRequired) && !completedVisit;
  const canStartProposal = Boolean(e) && canEdit && !closed && !e?.proposal;

  /* DEV-365: the proposal, prefilled from the enquiry, its property and its site visit. */
  const startProposal = async () => {
    if (!e) return;
    setStarting(true);
    try {
      const result = await proposalRulesService.proposalFromEnquiry(e.id);
      for (const w of result.warnings) toast.warning(w);
      toast.success(
        `Proposal ${result.proposalNumber} started from ${result.source === "site_visit" ? "the site visit" : result.source === "scope" ? "the property's scope" : "the enquiry"}.`,
      );
      router.push(`/extensions/amc/${result.submissionId}/edit`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not start the proposal.",
      );
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
      <TabsContent
        value={value}
        forceMount
        className="mt-4 flex flex-col gap-4 data-[state=inactive]:hidden"
      >
        {children}
      </TabsContent>
    ) : null;
  const unitType = (v: string | null) =>
    v ? (UNIT_TYPE_LABELS[v as keyof typeof UNIT_TYPE_LABELS] ?? v) : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {/* Back to the list on the left, everything this enquiry can do on the right: the toolbar a quotation carries. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackToEnquiries />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading || refreshing}
            aria-label="Refresh this enquiry"
          >
            <RefreshCw
              className={refreshing ? "size-4 animate-spin" : "size-4"}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          {ready && e ? (
            <>
              {e.proposal ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/extensions/amc/${e.proposal.id}`}>
                    <FileSignature className="size-4" />
                    Proposal {e.proposal.proposalNumber}
                  </Link>
                </Button>
              ) : canStartProposal ? (
                <SubmitButton
                  variant="outline"
                  size="sm"
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog("edit")}
                  >
                    <Pencil className="size-4" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openStage()}
                  >
                    <Shuffle className="size-4" />
                    Change stage
                  </Button>
                  {/* One button for reaching the client, as a quotation's Share: a follow-up, or a visit to the property. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm">
                        <MessageSquarePlus className="size-4" />
                        Log activity
                        <ChevronDown className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setDialog("follow-up")}>
                        <MessageSquarePlus className="size-4" />
                        Log follow-up
                      </DropdownMenuItem>
                      {!closed ? (
                        <DropdownMenuItem
                          onClick={() => setDialog("site-visit")}
                        >
                          <CalendarPlus className="size-4" />
                          Book site visit
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {error || meta.error ? (
        <ErrorState
          title="Could not load this enquiry"
          message={error ?? meta.error}
          onRetry={() => {
            refresh();
            meta.reload();
          }}
          retrying={refreshing}
        />
      ) : !ready || !e || !m || !data ? (
        <EnquiryBodySkeleton tab={tab} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* What is holding the enquiry up, as a quotation shows what is holding it up. */}
          {e.stage === ENQUIRY_STAGE.lost ? (
            <Alert variant="destructive">
              <X />
              <AlertTitle>
                Lost{e.lostReason ? `: ${e.lostReason}` : ""}
              </AlertTitle>
              <AlertDescription>
                {e.lostNotes || "No further notes were given."}
              </AlertDescription>
            </Alert>
          ) : null}
          {needsVisit && !closed ? (
            <Alert>
              <TriangleAlert />
              <AlertTitle>
                A completed site visit is needed before a proposal
              </AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>
                  {m.siteVisitRule === "block"
                    ? "AMC configuration requires one for this category."
                    : "AMC configuration flags a proposal without one for this category."}
                  {siteVisits.length > 0
                    ? " The visit booked is not completed yet."
                    : ""}
                </span>
                {canEdit && siteVisits.length === 0 ? (
                  <Button size="sm" onClick={() => setDialog("site-visit")}>
                    <CalendarPlus className="size-4" />
                    Book site visit
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {canEdit && suggestNext && !needsVisit ? (
            <Alert>
              <ArrowRight />
              <AlertTitle>Next stage: {suggestNext}</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>
                  Move it on once{" "}
                  {e.stage === ENQUIRY_STAGE.new
                    ? "the client has been contacted"
                    : `the "${e.stage}" step is done`}
                  .
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openStage(suggestNext)}
                >
                  Move to {suggestNext}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="site-visits">Site visits</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            {panel(
              "details",
              <>
                {/* The four answers somebody opens an enquiry for. */}
                <StatCardGrid columns={4}>
                  <StatCard
                    label="Stage"
                    value={e.stage}
                    headline={`Enquiry ${e.enquiryNumber} · ${e.source}`}
                    caption={`Since ${formatContractDate(e.stageChangedAt)}`}
                    tone={
                      e.stage === ENQUIRY_STAGE.won
                        ? "good"
                        : e.stage === ENQUIRY_STAGE.lost
                          ? "bad"
                          : e.stage === ENQUIRY_STAGE.onHold
                            ? "neutral"
                            : "progress"
                    }
                    onSelect={canEdit ? () => openStage() : undefined}
                    selectLabel="Change the stage"
                  />
                  <StatCard
                    label="Next follow-up"
                    value={
                      e.nextFollowUpAt
                        ? formatContractDate(e.nextFollowUpAt)
                        : "None"
                    }
                    tone={
                      e.followUp === "overdue"
                        ? "bad"
                        : e.followUp === "today"
                          ? "progress"
                          : "neutral"
                    }
                    headline={
                      e.followUp === "overdue"
                        ? "Overdue"
                        : e.followUp === "today"
                          ? "Due today"
                          : e.nextFollowUpAt
                            ? "Planned"
                            : "Not planned"
                    }
                    caption={
                      e.nextFollowUpAt
                        ? formatDateTime(e.nextFollowUpAt)
                        : "Log a follow-up to plan one"
                    }
                  />
                  <StatCard
                    label="Last activity"
                    value={timeAgo(e.lastActivityAt)}
                    tone={
                      e.idle.state === "escalate"
                        ? "bad"
                        : e.idle.state
                          ? "progress"
                          : "good"
                    }
                    headline={
                      e.idle.state === "escalate"
                        ? "Idle, escalated to management"
                        : e.idle.state
                          ? "Idle, owner warned"
                          : "Active"
                    }
                    caption={`${followUps.length} follow-up${followUps.length === 1 ? "" : "s"} logged`}
                    onSelect={() => {
                      setActivity("follow-ups");
                      setTab("activity");
                    }}
                    selectLabel="Open the follow-ups"
                  />
                  <StatCard
                    label="Site visits"
                    value={siteVisits.length}
                    tone={
                      needsVisit
                        ? "progress"
                        : completedVisit
                          ? "good"
                          : "neutral"
                    }
                    headline={`${completedVisits} completed`}
                    caption={
                      e.siteVisitRequired
                        ? "One is needed before a proposal"
                        : "Not required for this category"
                    }
                    onSelect={() => setTab("site-visits")}
                    selectLabel="Open the site visits"
                  />
                </StatCardGrid>

                <SectionCard
                  title="Client & property"
                  icon={<Building2 />}
                  description="Who is enquiring, how to reach them, and the property it is for."
                  bodyClassName="px-5 pb-5"
                >
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="min-w-0 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <SubHeading>Client</SubHeading>
                        <Badge
                          variant="secondary"
                          className={`border-0 font-medium ${LIFECYCLE_TONE[e.customer.lifecycle as keyof typeof LIFECYCLE_TONE] ?? ""}`}
                        >
                          {LIFECYCLE_LABELS[
                            e.customer
                              .lifecycle as keyof typeof LIFECYCLE_LABELS
                          ] ?? e.customer.lifecycle}
                        </Badge>
                      </div>
                      <DetailList
                        rows={[
                          {
                            label: "Name",
                            value: (
                              <Link
                                href={`/extensions/amc-contracts/customers/${e.customer.id}`}
                                className="hover:text-brand underline underline-offset-2"
                              >
                                {e.customer.name}
                              </Link>
                            ),
                          },
                          {
                            label: "Customer ID",
                            value: e.customer.customerRef,
                          },
                          {
                            label: "Contact",
                            value:
                              e.contactName !== e.customer.name
                                ? e.contactName
                                : null,
                          },
                          {
                            label: "Phone",
                            value: e.contactPhone ? (
                              <a
                                href={`tel:${e.contactPhone}`}
                                className="hover:text-brand underline underline-offset-2"
                              >
                                {e.contactPhone}
                              </a>
                            ) : null,
                          },
                          {
                            label: "Email",
                            value: e.contactEmail ? (
                              <a
                                href={`mailto:${e.contactEmail}`}
                                className="hover:text-brand underline underline-offset-2"
                              >
                                {e.contactEmail}
                              </a>
                            ) : null,
                          },
                          { label: "WhatsApp", value: e.contactWhatsapp },
                          {
                            label: "Prefers",
                            value:
                              [
                                e.preferredChannel
                                  ? (CHANNEL_LABELS[
                                      e.preferredChannel as keyof typeof CHANNEL_LABELS
                                    ] ?? e.preferredChannel)
                                  : null,
                                e.preferredLanguage,
                              ]
                                .filter(Boolean)
                                .join(" · ") || null,
                          },
                        ].filter((row) => row.label !== "Contact" || row.value)}
                      />
                    </div>

                    <div className="min-w-0 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <SubHeading>Property</SubHeading>
                        {e.property ? (
                          <Button
                            asChild
                            size="sm"
                            variant="ghost"
                            className="-my-1 h-7"
                          >
                            <Link
                              href={`/extensions/amc-contracts/properties/${e.property.id}?tab=assets&view=scope`}
                            >
                              Assets and scope
                            </Link>
                          </Button>
                        ) : canEdit ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="-my-1 h-7"
                            onClick={() => setDialog("link")}
                          >
                            Link a property
                          </Button>
                        ) : null}
                      </div>
                      <DetailList
                        rows={[
                          {
                            label: "Address",
                            value: e.property ? (
                              <Link
                                href={`/extensions/amc-contracts/properties/${e.property.id}`}
                                className="hover:text-brand underline underline-offset-2"
                              >
                                {e.property.label}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground font-normal">
                                Not linked yet
                              </span>
                            ),
                          },
                          {
                            label: "Type",
                            value:
                              unitType(e.property?.unitType ?? null) ??
                              unitType(e.unitType),
                          },
                          {
                            label: "Category",
                            value:
                              capitalise(
                                e.property?.propertyCategory ??
                                  e.propertyCategory ??
                                  "",
                              ) || null,
                          },
                          { label: "Area", value: e.area },
                        ]}
                      />
                      {!e.property ? (
                        <p className="text-muted-foreground text-xs">
                          The property record, assets and scope are captured at
                          the site visit, or on the{" "}
                          <Link
                            href={`/extensions/amc-contracts/customers/${e.customer.id}`}
                            className="hover:text-foreground underline underline-offset-2"
                          >
                            client&apos;s page
                          </Link>
                          .
                        </p>
                      ) : null}
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  title="The enquiry"
                  icon={<Inbox />}
                  description="What they asked for, where they came from, and who owns it."
                  bodyClassName="px-5 pb-5"
                >
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="min-w-0 space-y-3">
                      <SubHeading>What they need</SubHeading>
                      <p className="text-sm whitespace-pre-wrap">{e.need}</p>
                    </div>
                    <div className="min-w-0 space-y-3">
                      <SubHeading>Ownership</SubHeading>
                      <DetailList
                        rows={[
                          {
                            label: "Source",
                            value: e.referrer
                              ? `${e.source} (referred by ${e.referrer})`
                              : e.source,
                          },
                          {
                            label: "Enquired on",
                            value: formatDateTime(e.enquiredAt),
                          },
                          {
                            label: "Owner",
                            value: e.owner?.name ?? "Unassigned",
                          },
                          {
                            label: "In this stage since",
                            value: formatDateTime(e.stageChangedAt),
                          },
                          ...(e.proposal
                            ? [
                                {
                                  label: "Proposal",
                                  value: (
                                    <Link
                                      href={`/extensions/amc/${e.proposal.id}`}
                                      className="hover:text-brand underline underline-offset-2"
                                    >
                                      {e.proposal.proposalNumber} (
                                      {e.proposal.status.replace(/_/g, " ")})
                                    </Link>
                                  ),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </div>
                  </div>
                </SectionCard>
              </>,
            )}

            {panel(
              "site-visits",
              <SectionCard
                title="Site visits"
                description="Visits to the property booked from this enquiry. A completed one feeds the proposal: asset counts, condition and recommended scope."
                icon={<ClipboardCheck />}
                bodyClassName={
                  siteVisits.length === 0 ? "border-t" : "px-5 pb-5"
                }
                action={
                  canEdit && !closed ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDialog("site-visit")}
                    >
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
                    description={
                      e.siteVisitRequired
                        ? "One is needed for this category before a proposal."
                        : "Book one when the client wants the property seen first."
                    }
                    action={
                      canEdit && !closed
                        ? {
                            label: "Book site visit",
                            onClick: () => setDialog("site-visit"),
                            variant: "outline",
                          }
                        : undefined
                    }
                  />
                ) : (
                  siteVisits.map((v) => (
                    <DataRow
                      key={v.id}
                      icon={<ClipboardCheck />}
                      title={
                        <Link
                          href={`/extensions/amc-contracts/assessments/${v.id}`}
                          className="hover:underline"
                        >
                          {v.assessmentNumber}
                        </Link>
                      }
                      subtitle={
                        [
                          v.scheduledAt ? formatDateTime(v.scheduledAt) : null,
                          v.assessorName,
                          v.property?.label,
                        ]
                          .filter(Boolean)
                          .join(" · ") || undefined
                      }
                      trailing={
                        <div className="flex flex-col items-end gap-1">
                          <SiteVisitStatusBadge status={v.status} />
                          {v.attendance ? (
                            <span className="text-muted-foreground text-xs">
                              {ATTENDANCE_LABELS[
                                v.attendance as SiteVisitAttendance
                              ] ?? v.attendance}
                            </span>
                          ) : null}
                        </div>
                      }
                    />
                  ))
                )}
              </SectionCard>,
            )}

            {panel(
              "activity",
              /* Follow-ups and the stage history, each its own tab, as a quotation's Activity. */
              <>
                <PillTabs<ActivityView>
                  value={activity}
                  onChange={setActivity}
                  tabs={[
                    {
                      value: "follow-ups",
                      label: "Follow-ups",
                      count: followUps.length,
                    },
                    {
                      value: "history",
                      label: "Stage history",
                      count: history.length,
                    },
                  ]}
                />
                {activityOpened.has("follow-ups") ? (
                  <div hidden={activity !== "follow-ups"}>
                    <SectionCard
                      title="Follow-ups"
                      description="Every contact with the client about this enquiry, newest first. Each one also appears in the client's communication log."
                      icon={<MessageSquarePlus />}
                      bodyClassName="border-t"
                      action={
                        canEdit ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDialog("follow-up")}
                          >
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
                          action={
                            canEdit
                              ? {
                                  label: "Log follow-up",
                                  onClick: () => setDialog("follow-up"),
                                  variant: "outline",
                                }
                              : undefined
                          }
                        />
                      ) : (
                        <ul className="divide-y">
                          {followUps.map((f) => (
                            <li key={f.id} className="px-5 py-3.5">
                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                <Badge
                                  variant="secondary"
                                  className="bg-mist text-ink-soft border-0 font-medium"
                                >
                                  {FOLLOW_UP_CHANNEL_LABELS[
                                    f.channel as FollowUpChannel
                                  ] ?? f.channel}
                                </Badge>
                                <span className="font-medium">{f.outcome}</span>
                                <span
                                  className="text-muted-foreground ml-auto text-xs tabular-nums"
                                  title={formatDateTime(f.occurredAt)}
                                >
                                  {timeAgo(f.occurredAt)} · {f.loggedBy ?? "—"}
                                </span>
                              </div>
                              {f.notes ? (
                                <p className="text-muted-foreground mt-1 text-sm whitespace-pre-wrap">
                                  {f.notes}
                                </p>
                              ) : null}
                              {f.nextFollowUpAt ? (
                                <p className="text-muted-foreground mt-1 text-xs">
                                  Next follow-up planned for{" "}
                                  {formatDateTime(f.nextFollowUpAt)}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </SectionCard>
                  </div>
                ) : null}
                {activityOpened.has("history") ? (
                  <div hidden={activity !== "history"}>
                    <SectionCard
                      title="Stage history"
                      description="Who moved the enquiry, when, and why."
                      icon={<History />}
                      bodyClassName="border-t"
                    >
                      {history.length === 0 ? (
                        <EmptyState
                          icon={<History className="size-5" />}
                          title="No changes recorded"
                          description="Each stage change is listed here with who made it and why."
                        />
                      ) : (
                        <ul className="divide-y">
                          {[...history].reverse().map((h, i) => (
                            <li
                              key={`${h.at}-${i}`}
                              className="flex flex-wrap items-start gap-2 px-5 py-3 text-sm"
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                {h.from ? (
                                  <>
                                    <StageBadge
                                      stage={h.from}
                                      stages={m.stages}
                                    />
                                    <ArrowRight className="text-muted-foreground size-3.5" />
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">
                                    Logged at
                                  </span>
                                )}
                                <StageBadge stage={h.to} stages={m.stages} />
                              </div>
                              <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                                {formatDateTime(h.at)} ·{" "}
                                {h.actorLabel ??
                                  (h.origin === "system" ? "Portal" : "—")}
                              </span>
                              {h.reason ? (
                                <p className="text-muted-foreground w-full text-sm">
                                  {h.reason}
                                </p>
                              ) : null}
                              {typeof h.details.warning === "string" ? (
                                <p className="text-warning w-full text-xs">
                                  {h.details.warning}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </SectionCard>
                  </div>
                ) : null}
              </>,
            )}
          </Tabs>
        </div>
      )}

      {/* Always mounted and controlled, as on Snagging; each starts fresh when opened. */}
      {e && m ? (
        <>
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
            onSave={async (input) =>
              after(
                "Stage changed",
                await enquiriesService.changeStage(e.id, input),
              )
            }
          />
          <FollowUpDialog
            open={dialog === "follow-up"}
            onOpenChange={(open) => !open && setDialog(null)}
            meta={m}
            enquiry={e}
            onSave={async (input) =>
              after(
                input.moveToStage ? `Follow-up logged. Moved to ${input.moveToStage}.` : "Follow-up logged",
                await enquiriesService.addFollowUp(e.id, input),
              )
            }
          />
          {dialog === "link" ? (
            <LinkPropertyDialog
              open
              onOpenChange={(open) => !open && setDialog(null)}
              enquiry={e}
              onLinked={reload}
            />
          ) : null}
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
        </>
      ) : null}
    </div>
  );
}

/** The loading shape of the tab being opened, so the page does not jump when it lands. */
function EnquiryBodySkeleton({ tab }: { tab: (typeof TABS)[number] }) {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading the enquiry">
      <Skeleton className="h-9 w-full rounded-lg" />
      {tab === "details" ? (
        <>
          <StatGridSkeleton count={4} />
          <SectionSkeleton />
          <SectionSkeleton />
        </>
      ) : tab === "activity" ? (
        <>
          <div className="flex gap-1.5">
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="h-8 w-32 rounded-full" />
          </div>
          <SectionSkeleton />
        </>
      ) : (
        <SectionSkeleton />
      )}
    </div>
  );
}

function BackToEnquiries() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
      <Link href={ENQUIRIES}>
        <ArrowLeft className="size-4" />
        Back to enquiries
      </Link>
    </Button>
  );
}

const capitalise = (v: string) =>
  v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
