"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Building2,
  CalendarPlus,
  ChevronDown,
  ClipboardCheck,
  FileSignature,
  Inbox,
  Link2,
  MapPin,
  MessageSquarePlus,
  Pencil,
  SearchX,
  Shuffle,
  TriangleAlert,
  X,
} from "lucide-react";
import { format } from "date-fns";
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
  useConfirm,
} from "@/components/dashboard/shared/kaizen-states";
import {
  GoogleLocationMap,
  hasGoogleMapsKey,
} from "@/components/dashboard/snagging/google-location-map";
import { LocationMap } from "@/components/dashboard/snagging/location-map";
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

import { AddressDialog, useAddressFormAccess } from "../address-dialog";
import { formatContractDate, formatDateTime } from "../contract-status";
import {
  DetailHeaderCard,
  DetailHeaderSkeleton,
  DetailToolbar,
  shortPlace,
} from "../detail-header";
import { EditClientDialog } from "../edit-client-dialog";
import { LIFECYCLE_TONE } from "../profile/identity-card";
import { useUrlTab } from "../profile/use-url-tab";
import { useAmcData } from "../use-amc-data";
import { HistoryCard } from "../history-card";
import {
  EnquiryFormDialog,
  FollowUpDialog,
  SiteVisitDialog,
  StageDialog,
} from "./enquiry-dialogs";
import {
  DetailList,
  HeadingIconButton,
  HeadingWithActions,
  SiteVisitStatusBadge,
  StageBadge,
  propertyRows,
} from "./enquiry-ui";
import { LinkPropertyDialog } from "./link-property-dialog";
import { formatPhone, phoneHref, toE164Phone } from "@/lib/phone/format-phone";

/* Three tabs, as on a quotation: what it is, the work done for it (site visits), and what happened to it. */
const TABS = ["details", "site-visits", "activity"] as const;
type OpenDialog =
  | "edit"
  | "stage"
  | "follow-up"
  | "site-visit"
  | "link"
  | "client"
  | "property"
  | null;
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
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { data, error, loading, reload } = useAmcData(
    () =>
      enquiriesService
        .get(id)
        .then((result) => {
          setFetchedAt(Date.now());
          return result;
        })
        .finally(() => setRefreshing(false)),
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
  /* The address form saves through Snagging; without Snagging (Create) the property is edited on its own page. */
  const addressForm = useAddressFormAccess();
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
  /* Asked first (11 Nov 2026): it acts at once, so it is confirmed like every other step. */
  const startProposal = () =>
    void confirm({ title: "Create a proposal from this enquiry?", description: "Starts a draft proposal prefilled from the enquiry, its property and its site visit, then opens it to enter the prices. Nothing is sent to the client.", confirmText: "Create proposal" }).then((ok) => {
      if (ok) void startProposalNow();
    });
  const startProposalNow = async () => {
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
      {/* As the client page: the way back and Refresh, then the enquiry's card with what it can do. */}
      <DetailToolbar
        backHref={ENQUIRIES}
        backLabel="Enquiries"
        fetchedAt={fetchedAt}
        refreshing={refreshing || loading}
        onRefresh={refresh}
      />

      {!ready || !e || !m ? (
        error || meta.error ? null : (
          <DetailHeaderSkeleton />
        )
      ) : (
        <DetailHeaderCard
          badges={
            <>
              <Badge variant="outline">Enquiry</Badge>
              <Badge variant="outline" className="tabular-nums">
                {e.enquiryNumber}
              </Badge>
              <Badge variant="outline">{e.source}</Badge>
            </>
          }
          title={e.customer.name || "Enquiry"}
          status={<StageBadge stage={e.stage} stages={m.stages} />}
          subline={[shortPlace(e.property?.label) ?? "No property yet", `Enquired ${formatDateTime(e.enquiredAt)}`, e.owner ? e.owner.name : "No owner yet"].join(" · ")}
          actions={
            <>
              {ready && e ? (
                <>
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
                      <Button
                        variant="outline"
                        onClick={() => setDialog("edit")}
                      >
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                      <Button variant="outline" onClick={() => openStage()}>
                        <Shuffle className="size-4" />
                        Change stage
                      </Button>
                      {/* One button for reaching the client, as a quotation's Share: a follow-up, or a visit to the property. */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button>
                            <MessageSquarePlus className="size-4" />
                            Log activity
                            <ChevronDown className="size-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setDialog("follow-up")}
                          >
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
            </>
          }
        />
      )}

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
                    /* The time goes in the headline: stat cards no longer draw their caption line. */
                    headline={
                      e.nextFollowUpAt
                        ? `${
                            e.followUp === "overdue"
                              ? "Overdue"
                              : e.followUp === "today"
                                ? "Due today"
                                : "Planned"
                          } at ${timeOf(e.nextFollowUpAt)}`
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
                  {/*
                    As the job's Setup tab: the two lists stacked on the left and
                    the map filling the right. Side by side, Client (seven rows)
                    and Property (four) left a hole under the shorter one.
                  */}
                  <div className="grid items-stretch gap-6 lg:grid-cols-2">
                    <div className="min-w-0 space-y-6">
                      <div className="space-y-3">
                        <SubHeading
                          action={
                            <Badge
                              variant="secondary"
                              className={`border-0 font-medium ${LIFECYCLE_TONE[e.customer.lifecycle as keyof typeof LIFECYCLE_TONE] ?? ""}`}
                            >
                              {LIFECYCLE_LABELS[
                                e.customer
                                  .lifecycle as keyof typeof LIFECYCLE_LABELS
                              ] ?? e.customer.lifecycle}
                            </Badge>
                          }
                        >
                          <HeadingWithActions label="Client">
                            {canEdit ? (
                              <HeadingIconButton
                                label="Edit client"
                                icon={<Pencil />}
                                onClick={() => setDialog("client")}
                              />
                            ) : null}
                          </HeadingWithActions>
                        </SubHeading>
                        <DetailList
                          rows={[
                            {
                              label: "Name",
                              value: (
                                <Link
                                  href={`/extensions/amc-contracts/customers/${e.customer.id}`}
                                  className={LINK}
                                >
                                  {e.customer.name}
                                </Link>
                              ),
                            },
                            {
                              label: "Customer ID",
                              value: e.customer.customerRef,
                            },
                            ...(e.contactName &&
                            e.contactName !== e.customer.name
                              ? [{ label: "Contact", value: e.contactName }]
                              : []),
                            {
                              label: "Phone",
                              value: e.contactPhone ? (
                                <a
                                  href={phoneHref(e.contactPhone)}
                                  className={LINK}
                                >
                                  {formatPhone(e.contactPhone)}
                                </a>
                              ) : null,
                            },
                            {
                              label: "Email",
                              value: e.contactEmail ? (
                                <a
                                  href={`mailto:${e.contactEmail}`}
                                  className={LINK}
                                >
                                  {e.contactEmail}
                                </a>
                              ) : null,
                            },
                            {
                              label: "WhatsApp",
                              value: e.contactWhatsapp ? (
                                <a
                                  href={`https://wa.me/${toE164Phone(e.contactWhatsapp).slice(1)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={LINK}
                                >
                                  {formatPhone(e.contactWhatsapp)}
                                </a>
                              ) : null,
                            },
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
                          ]}
                        />
                      </div>

                      <div className="space-y-3">
                        <SubHeading
                          action={
                            e.property ? (
                              <Button asChild variant="ghost" size="sm">
                                <Link
                                  href={`/extensions/amc-contracts/properties/${e.property.id}?tab=assets&view=scope`}
                                >
                                  <Boxes className="size-3.5" />
                                  Assets and scope
                                </Link>
                              </Button>
                            ) : canEdit ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDialog("link")}
                              >
                                <Link2 className="size-3.5" />
                                Link a property
                              </Button>
                            ) : null
                          }
                        >
                          <HeadingWithActions label="Property">
                            {e.property && canEdit && addressForm ? (
                              <HeadingIconButton
                                label="Edit property"
                                icon={<Pencil />}
                                onClick={() => setDialog("property")}
                              />
                            ) : null}
                          </HeadingWithActions>
                        </SubHeading>
                        <DetailList
                          rows={[
                            /* As the job's Setup tab, then the area the client named on the enquiry. */
                            ...propertyRows({
                              unit: e.property ? (
                                <Link
                                  href={`/extensions/amc-contracts/properties/${e.property.id}`}
                                  className={LINK}
                                >
                                  {e.property.label}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground font-normal">
                                  Not linked yet
                                </span>
                              ),
                              place: e.property,
                              typeLabel:
                                unitType(e.property?.unitType ?? null) ??
                                unitType(e.unitType),
                              category:
                                capitalise(
                                  e.property?.propertyCategory ??
                                    e.propertyCategory ??
                                    "",
                                ) || null,
                            }),
                            { label: "Area", value: e.area },
                          ]}
                        />
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-col space-y-3">
                      <SubHeading>Location</SubHeading>
                      {e.property?.lat != null && e.property?.lng != null ? (
                        hasGoogleMapsKey() ? (
                          <GoogleLocationMap
                            className="min-h-64 flex-1"
                            lat={e.property.lat}
                            lng={e.property.lng}
                            label={e.property.label || null}
                          />
                        ) : (
                          <LocationMap
                            className="min-h-64 flex-1"
                            lat={e.property.lat}
                            lng={e.property.lng}
                            label={e.property.label || null}
                          />
                        )
                      ) : (
                        <div className="text-muted-foreground flex min-h-48 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center text-sm">
                          {e.property ? (
                            <>
                              <p>No location pinned on the property record.</p>
                              <Button asChild variant="outline" size="sm">
                                <Link
                                  href={`/extensions/amc-contracts/properties/${e.property.id}`}
                                >
                                  <MapPin className="size-3.5" />
                                  Open the property
                                </Link>
                              </Button>
                            </>
                          ) : (
                            <p className="max-w-xs">
                              No property linked yet. The property record,
                              assets and scope are captured at the site visit,
                              or on the{" "}
                              <Link
                                href={`/extensions/amc-contracts/customers/${e.customer.id}`}
                                className="hover:text-foreground underline underline-offset-2"
                              >
                                client&apos;s page
                              </Link>
                              .
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  title="The enquiry"
                  icon={<Inbox />}
                  description="What they asked for, where they came from, who owns it and when they are next contacted."
                  bodyClassName="px-5 pb-5"
                >
                  <div className="grid items-stretch gap-6 lg:grid-cols-2">
                    {/* The request in a box that runs the column's height, as the map does above, so it never ends in a hole. */}
                    <div className="flex min-w-0 flex-col space-y-3">
                      <SubHeading>What they need</SubHeading>
                      <p className="bg-muted/30 flex-1 rounded-lg border p-4 text-sm leading-relaxed whitespace-pre-wrap">
                        {e.need}
                      </p>
                    </div>
                    <div className="min-w-0 space-y-3">
                      <SubHeading>Owner and follow-up</SubHeading>
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
                            label: "Next follow-up",
                            value: e.nextFollowUpAt ? (
                              formatDateTime(e.nextFollowUpAt)
                            ) : (
                              <span className="text-muted-foreground font-normal">
                                Not planned
                              </span>
                            ),
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
                                      className={LINK}
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
                bodyClassName="border-t"
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
                  <div className="divide-y">
                    {siteVisits.map((v) => (
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
                    ))}
                  </div>
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
                    {/* As a Snagging job's Activity (11 Nov 2026), as every AMC history. */}
                    <HistoryCard
                      title="Stage history"
                      description="Who moved the enquiry, when, and why."
                      noun="changes"
                      entries={[...history].reverse().map((h, i) => ({
                        key: `${h.at}-${i}`,
                        icon: <ArrowRight aria-hidden />,
                        title: (
                          <span className="flex flex-wrap items-center gap-1.5">
                            {h.from ? (
                              <>
                                <StageBadge stage={h.from} stages={m.stages} />
                                <ArrowRight className="text-muted-foreground size-3.5" />
                              </>
                            ) : (
                              <span className="text-muted-foreground font-normal">Logged at</span>
                            )}
                            <StageBadge stage={h.to} stages={m.stages} />
                          </span>
                        ),
                        actor: h.actorLabel ?? (h.origin === "system" ? "Portal" : null),
                        detail:
                          h.reason || typeof h.details.warning === "string" ? (
                            <>
                              {h.reason ? `"${h.reason}"` : null}
                              {typeof h.details.warning === "string" ? <span className="text-warning"> {h.details.warning}</span> : null}
                            </>
                          ) : null,
                        at: h.at,
                      }))}
                      emptyTitle="No changes recorded"
                      emptyDescription="Each stage change is listed here with who made it and why."
                    />
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
                input.moveToStage
                  ? `Follow-up logged. Moved to ${input.moveToStage}.`
                  : "Follow-up logged",
                await enquiriesService.addFollowUp(e.id, input),
              )
            }
          />
          <EditClientDialog
            open={dialog === "client"}
            onOpenChange={(open) => !open && setDialog(null)}
            customerId={e.customer.id}
            onSaved={reload}
          />
          {e.property && addressForm ? (
            <AddressDialog
              open={dialog === "property"}
              onOpenChange={(open) => !open && setDialog(null)}
              clientId={e.customer.id}
              clientName={e.customer.name}
              propertyId={e.property.id}
              editing
              onSaved={() => {
                setDialog(null);
                toast.success("Property saved");
                reload();
              }}
            />
          ) : null}
          {confirmDialog}
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
        Enquiries
      </Link>
    </Button>
  );
}

/* A link inside a detail row, as the job and quotation pages draw them. */
const LINK = "hover:text-brand underline underline-offset-2";

/** "14:30", in the same 24-hour clock as formatDateTime. */
const timeOf = (value: string) => format(new Date(value), "HH:mm");

const capitalise = (v: string) =>
  v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
