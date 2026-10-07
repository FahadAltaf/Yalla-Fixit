"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, CalendarPlus, ClipboardCheck, History, Inbox, MessageSquarePlus, Pencil, UserRound } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { DataRow, PageHeading, SectionCard, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState, HeadingSkeleton, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHANNEL_LABELS, LIFECYCLE_LABELS, UNIT_TYPE_LABELS } from "@/lib/amc/client-profile";
import { ATTENDANCE_LABELS, CLOSED_STAGES, ENQUIRY_STAGE, FOLLOW_UP_CHANNEL_LABELS, type FollowUpChannel, type SiteVisitAttendance } from "@/lib/amc/enquiries";
import { enquiriesService, type EnquiryDetailResponse, type EnquiryMeta } from "@/modules/amc-contracts/enquiries-service";

import { AmcSectionNav } from "../amc-section-nav";
import { formatContractDate, formatDateTime } from "../contract-status";
import { LIFECYCLE_TONE } from "../profile/identity-card";
import { useUrlTab } from "../profile/use-url-tab";
import { useAmcData } from "../use-amc-data";
import { EnquiryFormDialog, FollowUpDialog, SiteVisitDialog, StageDialog } from "./enquiry-dialogs";
import { EnquiryFlags, StageBadge } from "./enquiry-ui";

const TABS = ["overview", "follow-ups", "history"] as const;
type Dialog = { kind: "edit" } | { kind: "stage"; stage?: string } | { kind: "follow-up" } | { kind: "site-visit" } | null;

/** One enquiry (BRD 5.1, 5.2): details, client and property, site visits, follow-ups and the stage history. */
export function EnquiryDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useAmcData(() => enquiriesService.get(id), id);
  const meta = useAmcData(() => enquiriesService.meta(), "enquiry-meta");
  useBreadcrumbLabel("enquiries", "Enquiries");
  useBreadcrumbLabel(id, data?.enquiry.enquiryNumber ?? "Enquiry");
  const { tab, setTab, isOpened } = useUrlTab(TABS, "overview");
  const [dialog, setDialog] = useState<Dialog>(null);

  if (loading || meta.loading) {
    if (error || meta.error) return <ErrorState title="Could not load this enquiry" message={error ?? meta.error} onRetry={reload} />;
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <HeadingSkeleton withActions />
        <SectionSkeleton />
      </div>
    );
  }
  if (error || !data || !meta.data) return <ErrorState title="Could not load this enquiry" message={error ?? meta.error} onRetry={reload} />;

  const { enquiry: e, followUps, siteVisits, history } = data;
  const m = meta.data;
  const canEdit = data.canEdit;
  const closed = CLOSED_STAGES.includes(e.stage);
  const completedVisit = siteVisits.some((v) => v.status === "completed");
  const stageIndex = m.stages.indexOf(e.stage);
  const nextStage = !closed && e.stage !== ENQUIRY_STAGE.onHold && stageIndex >= 0 ? m.stages[stageIndex + 1] : undefined;
  const suggestNext = nextStage && !CLOSED_STAGES.includes(nextStage) && nextStage !== ENQUIRY_STAGE.onHold ? nextStage : undefined;
  const after = (message: string) => (result?: { warning: string | null }) => {
    setDialog(null);
    if (result?.warning) toast.warning(result.warning);
    else toast.success(message);
    reload();
  };
  const panel = (value: (typeof TABS)[number], children: React.ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="flex flex-col gap-6 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow={`Enquiry · ${formatContractDate(e.enquiredAt)} · ${e.source}`}
        title={`${e.enquiryNumber} · ${e.customer.name}`}
        description={e.need}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StageBadge stage={e.stage} stages={m.stages} />
            {canEdit ? (
              <>
                <Button variant="outline" onClick={() => setDialog({ kind: "edit" })}>
                  <Pencil className="size-4" />
                  Edit
                </Button>
                <Button variant="outline" onClick={() => setDialog({ kind: "stage" })}>
                  Change stage
                </Button>
                {!closed ? (
                  <Button variant="outline" onClick={() => setDialog({ kind: "site-visit" })}>
                    <CalendarPlus className="size-4" />
                    Book site visit
                  </Button>
                ) : null}
                <Button onClick={() => setDialog({ kind: "follow-up" })}>
                  <MessageSquarePlus className="size-4" />
                  Log follow-up
                </Button>
              </>
            ) : null}
          </div>
        }
      />
      <AmcSectionNav current="enquiries" />

      <div className="flex flex-wrap items-center gap-3">
        <EnquiryFlags enquiry={e} />
        {e.siteVisitRequired && !completedVisit ? (
          <span className="text-muted-foreground text-sm">
            A completed site visit is needed before a proposal ({m.siteVisitRule === "block" ? "required" : "flagged"} by AMC configuration).
          </span>
        ) : null}
        {canEdit && suggestNext ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDialog({ kind: "stage", stage: suggestNext })}>
            Move to {suggestNext}
            <ArrowRight className="size-4" />
          </Button>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="follow-ups">Follow-ups ({followUps.length})</TabsTrigger>
          <TabsTrigger value="history">Stage history</TabsTrigger>
        </TabsList>

        {panel(
          "overview",
          <>
            <div className="grid gap-6 lg:grid-cols-3">
              <SectionCard title="Enquiry" icon={<Inbox />} bodyClassName="px-5 pb-5 grid gap-3 text-sm" className="lg:col-span-2">
                <Detail label="What the client needs" value={<span className="whitespace-pre-wrap">{e.need}</span>} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Detail label="Source" value={e.referrer ? `${e.source} (referred by ${e.referrer})` : e.source} />
                  <Detail label="Owner" value={e.owner?.name ?? "Unassigned"} />
                  <Detail label="Area" value={e.area} />
                  <Detail
                    label="Property"
                    value={[e.unitType ? UNIT_TYPE_LABELS[e.unitType as keyof typeof UNIT_TYPE_LABELS] : null, e.propertyCategory ? capitalise(e.propertyCategory) : null].filter(Boolean).join(" · ") || null}
                  />
                  <Detail label="Next follow-up" value={e.nextFollowUpAt ? <span className={e.followUp === "overdue" ? "text-destructive" : undefined}>{formatDateTime(e.nextFollowUpAt)}</span> : "Not planned"} />
                  <Detail label="Last activity" value={`${timeAgo(e.lastActivityAt)} · ${formatDateTime(e.lastActivityAt)}`} />
                  <Detail label="In this stage since" value={formatDateTime(e.stageChangedAt)} />
                  {e.stage === ENQUIRY_STAGE.lost ? <Detail label="Lost because" value={[e.lostReason, e.lostNotes].filter(Boolean).join(": ")} /> : null}
                  {e.proposal ? (
                    <Detail
                      label="Proposal"
                      value={
                        <Link href={`/extensions/amc/${e.proposal.id}`} className="hover:underline">
                          {e.proposal.proposalNumber} ({e.proposal.status.replace(/_/g, " ")})
                        </Link>
                      }
                    />
                  ) : null}
                </div>
              </SectionCard>

              <SectionCard
                title="Client"
                icon={<UserRound />}
                bodyClassName="px-5 pb-5 grid gap-3 text-sm"
                action={
                  <Badge variant="secondary" className={`border-none ${LIFECYCLE_TONE[e.customer.lifecycle as keyof typeof LIFECYCLE_TONE] ?? ""}`}>
                    {LIFECYCLE_LABELS[e.customer.lifecycle as keyof typeof LIFECYCLE_LABELS] ?? e.customer.lifecycle}
                  </Badge>
                }
              >
                <Link href={`/extensions/amc-contracts/customers/${e.customer.id}`} className="font-medium hover:underline">
                  {e.customer.name}
                  {e.customer.customerRef ? <span className="text-muted-foreground font-normal"> · {e.customer.customerRef}</span> : null}
                </Link>
                <Detail label="Contact" value={e.contactName} />
                <Detail label="Phone" value={e.contactPhone} />
                <Detail label="WhatsApp" value={e.contactWhatsapp} />
                <Detail label="Email" value={e.contactEmail} />
                <Detail
                  label="Prefers"
                  value={[e.preferredChannel ? (CHANNEL_LABELS[e.preferredChannel as keyof typeof CHANNEL_LABELS] ?? e.preferredChannel) : null, e.preferredLanguage].filter(Boolean).join(" · ") || null}
                />
              </SectionCard>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <SectionCard
                title="Property and scope"
                description="Captured once on the property's page: details, assets, access rules and scope. Proposals start from it."
                icon={<Building2 />}
                bodyClassName="px-5 pb-5"
                action={
                  canEdit && !e.property ? (
                    <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "edit" })}>
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
                    subtitle={[e.property.unitType ? UNIT_TYPE_LABELS[e.property.unitType as keyof typeof UNIT_TYPE_LABELS] : null, e.property.propertyCategory ? capitalise(e.property.propertyCategory) : null].filter(Boolean).join(" · ") || undefined}
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

              <SectionCard
                title="Site visits"
                icon={<ClipboardCheck />}
                bodyClassName="px-5 pb-5"
                action={
                  canEdit && !closed ? (
                    <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "site-visit" })}>
                      <CalendarPlus className="size-4" />
                      Book
                    </Button>
                  ) : null
                }
              >
                {siteVisits.length === 0 ? (
                  <p className="text-muted-foreground text-sm">None booked{e.siteVisitRequired ? "; one is needed for this category before a proposal" : ""}.</p>
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
                          <Badge variant="secondary" className="font-normal capitalize">
                            {v.status}
                          </Badge>
                          {v.attendance ? <span className="text-muted-foreground text-xs">{ATTENDANCE_LABELS[v.attendance as SiteVisitAttendance] ?? v.attendance}</span> : null}
                        </div>
                      }
                    />
                  ))
                )}
              </SectionCard>
            </div>
          </>,
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
                <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "follow-up" })}>
                  <MessageSquarePlus className="size-4" />
                  Log follow-up
                </Button>
              ) : null
            }
          >
            {followUps.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={<MessageSquarePlus className="size-5" />} title="No follow-ups yet" description="Log each call, message or meeting, and plan the next one." />
              </div>
            ) : (
              <ul className="divide-y">
                {followUps.map((f) => (
                  <li key={f.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary" className="font-normal">
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
              <p className="text-muted-foreground px-5 py-4 text-sm">No changes recorded.</p>
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
                    {typeof h.details.warning === "string" ? <p className="w-full text-xs text-amber-700 dark:text-amber-400">{h.details.warning}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>,
        )}
      </Tabs>

      <Dialogs dialog={dialog} data={data} meta={m} hasCompletedSiteVisit={completedVisit} onClose={() => setDialog(null)} after={after} reload={reload} />
    </div>
  );
}

function Dialogs({
  dialog,
  data,
  meta,
  hasCompletedSiteVisit,
  onClose,
  after,
  reload,
}: {
  dialog: Dialog;
  data: EnquiryDetailResponse;
  meta: EnquiryMeta;
  hasCompletedSiteVisit: boolean;
  onClose: () => void;
  after: (message: string) => (result?: { warning: string | null }) => void;
  reload: () => void;
}) {
  const e = data.enquiry;
  if (!dialog) return null;
  switch (dialog.kind) {
    case "edit":
      return (
        <EnquiryFormDialog
          meta={meta}
          enquiry={e}
          onClose={onClose}
          onSaved={() => {
            onClose();
            toast.success("Enquiry saved");
            reload();
          }}
        />
      );
    case "stage":
      return (
        <StageDialog
          meta={meta}
          enquiry={e}
          hasCompletedSiteVisit={hasCompletedSiteVisit}
          initialStage={dialog.stage}
          onClose={onClose}
          onSave={async (input) => after("Stage changed")(await enquiriesService.changeStage(e.id, input))}
        />
      );
    case "follow-up":
      return <FollowUpDialog meta={meta} enquiry={e} onClose={onClose} onSave={async (input) => after("Follow-up logged")(await enquiriesService.addFollowUp(e.id, input))} />;
    case "site-visit":
      return (
        <SiteVisitDialog
          meta={meta}
          enquiry={e}
          onClose={onClose}
          onSave={async (input) => {
            await enquiriesService.scheduleSiteVisit(e.id, input);
            after("Site visit booked; the assessor has been told")();
          }}
        />
      );
  }
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span>{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

const capitalise = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
