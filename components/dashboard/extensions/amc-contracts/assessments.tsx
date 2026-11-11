"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowLeft,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  EllipsisVerticalIcon,
  FileSignature,
  Inbox,
  MapPin,
  Pencil,
  Plus,
  SearchX,
  Trash2,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import DateTimeSelect from "@/components/ui/date-time-select";
import { GoogleLocationMap, hasGoogleMapsKey } from "@/components/dashboard/snagging/google-location-map";
import { LocationMap } from "@/components/dashboard/snagging/location-map";
import { PageHeading, SectionCard, StatCard, StatCardGrid, SubHeading } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SectionSkeleton, StatGridSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { DatePickerField } from "@/components/dashboard/extensions/amc/components/date-picker-field";
import { assessmentSummary, checkAssessmentCompletion, type AssessmentResult } from "@/lib/amc/business";
import { ATTENDANCE_LABELS, SITE_VISIT_ATTENDANCE, type SiteVisitAttendance } from "@/lib/amc/enquiries";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { amcContractsService, type AssessmentRecord, type CustomerRecord } from "@/modules/amc-contracts/amc-contracts-service";

import { AssessmentPhotos } from "./assessment-photos";
import { CustomerSearch, UNIT_TYPE_LABELS } from "./customer-pickers";
import { UNIT_TYPE_CATEGORY } from "@/lib/amc/client-profile";
import { formatContractDate, formatDateTime } from "./contract-status";
import { AddressDialog, useAddressFormAccess } from "./address-dialog";
import { DetailHeaderCard, DetailHeaderSkeleton, DetailToolbar } from "./detail-header";
import { EditClientDialog } from "./edit-client-dialog";
import { EnquiryPropertySelect } from "./enquiries/enquiry-property-select";
import { PropertyPickerField } from "./property-picker-field";
import { DetailList, HeadingIconButton, HeadingWithActions, PersonSelect, SiteVisitStatusBadge, clientRows, fromLocalInput, propertyRows, toLocalInput } from "./enquiries/enquiry-ui";
import { ListToolbar } from "./enquiries/list-toolbar";
import { useUrlTab } from "./profile/use-url-tab";
import { useAmcData } from "./use-amc-data";
import { ModuleGuide } from "@/components/dashboard/extensions/amc-contracts/module-guide";

const RESULT_LABELS: Record<AssessmentResult, string> = {
  ok: "OK",
  attention: "Attention required",
  not_applicable: "Not applicable",
};
const RESULT_TONES: Record<AssessmentResult, string> = {
  ok: "bg-success/10 text-success",
  attention: "bg-warning/10 text-warning",
  not_applicable: "bg-mist text-ink-soft",
};

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "completed", label: "Completed" },
] as const;

const visitHref = (id: string) => `/extensions/amc-contracts/assessments/${id}`;

/* ------------------------------------------------------------------ */
/* List                                                                 */
/* ------------------------------------------------------------------ */

/** Site visits (the assessment records), laid out like Snagging's jobs table. */
export function AssessmentsPage() {
  useBreadcrumbLabel("assessments", "Site visits");
  const router = useRouter();
  const [status, setStatus] = useState<"all" | "draft" | "completed">("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [starting, setStarting] = useState(false);
  /* Set by Refresh and cleared when the answer lands; the rows stay on screen meanwhile. */
  const [refreshing, setRefreshing] = useState(false);
  const term = useDebounce(q.trim(), 250);
  const { data, error, loading, reload } = useAmcData(
    () =>
      amcContractsService
        .assessments({
          status: status === "all" ? undefined : status,
          q: term || undefined,
          page,
          pageSize,
        })
        .finally(() => setRefreshing(false)),
    `${status}|${term}|${page}|${pageSize}`,
  );
  const filtered = !!term || status !== "all";
  const refresh = () => {
    setRefreshing(true);
    reload();
  };
  const resetPage =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(0);
    };

  const columns = useMemo<ColumnDef<AssessmentRecord>[]>(
    () => [
      {
        id: "client",
        header: "Client & property",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-48">
            <IdentityCell title={row.original.customer?.name ?? "No client"} subtitle={row.original.property?.label ?? "No property recorded"} />
          </div>
        ),
      },
      {
        id: "number",
        header: "Site visit",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm font-medium">{row.original.assessmentNumber}</span>
            {row.original.enquiryId ? <span className="text-muted-foreground text-xs">From an enquiry</span> : null}
          </div>
        ),
      },
      {
        id: "date",
        header: "Date",
        enableSorting: false,
        cell: ({ row }) => {
          const a = row.original;
          const when = a.assessedOn ? formatContractDate(a.assessedOn) : a.scheduledAt ? formatDateTime(a.scheduledAt) : null;
          return when ? (
            <IconText icon={CalendarClock} className="tabular-nums">
              {when}
            </IconText>
          ) : (
            <IconText icon={CalendarClock} muted>
              Not dated
            </IconText>
          );
        },
      },
      {
        id: "assessor",
        header: "Assessor",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.assessorName ? (
            <IconText icon={UserRound}>{row.original.assessorName}</IconText>
          ) : (
            <IconText icon={UserRound} muted>
              Unassigned
            </IconText>
          ),
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => <SiteVisitStatusBadge status={row.original.status} />,
      },
      {
        id: "proposal",
        header: "Proposal",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.proposal ? (
            <IconText icon={FileSignature}>{row.original.proposal.proposalNumber}</IconText>
          ) : (
            <IconText icon={FileSignature} muted>
              None yet
            </IconText>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        cell: ({ row }) => <SiteVisitRowActions visit={row.original} />,
      },
    ],
    [],
  );

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Operations"
        title="Site visits"
        info={<ModuleGuide module="siteVisits" />}
        description="Visit a property, record what needs attention and which services to recommend, then start an AMC proposal from it."
        actions={
          <>
            <Button onClick={() => setStarting(true)}>
              <Plus className="size-4" />
              New site visit
            </Button>
          </>
        }
      />

      {error ? <ErrorState title="Could not load site visits" message={error} onRetry={refresh} retrying={refreshing} /> : null}

      <Card className="py-0">
        <DataTable
          data={data?.assessments ?? []}
          columns={columns}
          loading={loading}
          rowCount={data?.total ?? 0}
          pageSize={pageSize}
          currentPage={page}
          isPagination
          onPageChange={setPage}
          onPageSizeChange={resetPage(setPageSize)}
          onGlobalFilterChange={resetPage(setQ)}
          handleRowClick={(a) => router.push(visitHref(a.id))}
          toolbar={
            <ListToolbar
              search={q}
              onSearchChange={resetPage(setQ)}
              searchPlaceholder="Search by client, property or number…"
              searchLabel="Search site visits"
              loading={loading || refreshing}
              pageSize={pageSize}
              onPageSizeChange={resetPage(setPageSize)}
              onRefresh={refresh}
              filters={<StatusSelect options={STATUS_FILTERS} value={status} onChange={(v) => resetPage(setStatus)(v as typeof status)} />}
            />
          }
          emptyState={
            error ? (
              <EmptyState icon={<ClipboardCheck className="size-5" />} title="Site visits could not be loaded" description="Try again once the connection is back." />
            ) : filtered ? (
              <EmptyState
                icon={<ClipboardCheck className="size-5" />}
                title="No site visits match"
                description="Nothing matches this status or that search."
                action={{
                  label: "Show all site visits",
                  onClick: () => {
                    setStatus("all");
                    setQ("");
                    setPage(0);
                  },
                  variant: "outline",
                }}
              />
            ) : (
              <EmptyState
                icon={<ClipboardCheck className="size-5" />}
                title="No site visits yet"
                description="Start one here, or book one from an enquiry."
                action={{
                  label: "New site visit",
                  onClick: () => setStarting(true),
                }}
              />
            )
          }
        />
      </Card>

      <NewSiteVisitDialog open={starting} onOpenChange={setStarting} />
    </div>
  );
}

/** The row's kebab: the visit, its client, its enquiry and its proposal. Clicks stay out of the row's own click. */
function SiteVisitRowActions({ visit }: { visit: AssessmentRecord }) {
  const router = useRouter();
  return (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${visit.assessmentNumber}`}>
            <EllipsisVerticalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max">
          <DropdownMenuItem onClick={() => router.push(visitHref(visit.id))}>
            <ClipboardCheck className="mr-2 size-4" />
            Open site visit
          </DropdownMenuItem>
          {visit.customer ? (
            <DropdownMenuItem onClick={() => router.push(`/extensions/amc-contracts/customers/${visit.customer!.id}`)}>
              <UserRound className="mr-2 size-4" />
              Open client
            </DropdownMenuItem>
          ) : null}
          {visit.enquiryId ? (
            <DropdownMenuItem onClick={() => router.push(`/extensions/amc-contracts/enquiries/${visit.enquiryId}`)}>
              <Inbox className="mr-2 size-4" />
              Open enquiry
            </DropdownMenuItem>
          ) : null}
          {visit.proposal ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push(`/extensions/amc/${visit.proposal!.id}`)}>
                <FileSignature className="mr-2 size-4" />
                Proposal {visit.proposal.proposalNumber}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Always mounted and controlled; the form renders inside the content, so it starts fresh on each open. */
function NewSiteVisitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [working, setWorking] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionDialogContent busy={working} className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <NewSiteVisitForm working={working} setWorking={setWorking} onOpenChange={onOpenChange} />
      </ActionDialogContent>
    </Dialog>
  );
}

function NewSiteVisitForm({ working, setWorking, onOpenChange }: { working: boolean; setWorking: (busy: boolean) => void; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);

  const start = async () => {
    setWorking(true);
    try {
      const { assessment } = await amcContractsService.createAssessment({
        customerId: customer?.id ?? null,
        propertyId,
      });
      toast.success(`Site visit ${assessment.assessmentNumber} started`);
      router.push(visitHref(assessment.id));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the site visit.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>New site visit</DialogTitle>
        <DialogDescription>Starts a draft site visit for the client&apos;s property; add them under Clients first if they are new.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label>Client</Label>
          <CustomerSearch
            selectedId={customer?.id}
            onPick={(c) => {
              setCustomer(c);
              setPropertyId(null);
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label>Property</Label>
          {customer ? (
            <PropertyPickerField clientId={customer.id} clientName={customer.name} requireComplete propertyId={propertyId} onChange={(id) => setPropertyId(id)} />
          ) : (
            <p className="text-muted-foreground text-sm">Choose the client first.</p>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
          Cancel
        </Button>
        <SubmitButton onClick={() => void start()} disabled={!customer} pending={working} pendingLabel="Starting…" icon={<Plus className="size-4" />}>
          Start site visit
        </SubmitButton>
      </DialogFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One site visit                                                       */
/* ------------------------------------------------------------------ */

type Draft = Omit<AssessmentRecord, "customer" | "property" | "proposal"> & {
  customerId: string | null;
  propertyId: string | null;
};

/** The day a visit took place, as YYYY-MM-DD: the booked day once it has passed, today otherwise. */
function visitDay(scheduledAt: string | null): string {
  const booked = scheduledAt ? new Date(scheduledAt) : null;
  const d = booked && !Number.isNaN(booked.getTime()) && booked.getTime() <= Date.now() ? booked : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDraft(a: AssessmentRecord): Draft {
  return {
    ...a,
    customerId: a.customer?.id ?? null,
    propertyId: a.property?.id ?? null,
  };
}

const TABS = ["details", "checklist", "findings", "photos"] as const;

export function AssessmentDetail({ id }: { id: string }) {
  const router = useRouter();
  /* Set by Refresh and cleared when the answer lands; the page stays on screen meanwhile. */
  const [refreshing, setRefreshing] = useState(false);
  /* When the visit was read, for "Updated" beside Refresh. */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const { data, error, loading, reload } = useAmcData(
    () =>
      amcContractsService
        .assessment(id)
        .then((result) => {
          setFetchedAt(Date.now());
          return result;
        })
        .finally(() => setRefreshing(false)),
    id,
  );
  const catalogue = useAmcData(() => amcContractsService.coverageCatalogue(), "catalogue");
  /* Who can be the assessor: only for someone who can edit the visit, and from the shared (cached) list. */
  const assessors = useAmcData(() => (data?.canEdit ? amcContractsService.siteVisitPeople() : Promise.resolve({ people: [], me: "" })), data?.canEdit ? "assessors" : "no-assessors");
  useBreadcrumbLabel("assessments", "Site visits");
  useBreadcrumbLabel(id, data?.assessment.assessmentNumber ?? "Site visit");
  const { confirm, dialog } = useConfirm();
  const { tab, setTab, isOpened } = useUrlTab(TABS, "details");
  const addressForm = useAddressFormAccess();
  const [addingAddress, setAddingAddress] = useState(false);
  /* The shared client or address record, edited in place as on the job's Setup tab. */
  const [editingRecord, setEditingRecord] = useState<"client" | "property" | null>(null);
  /* The section being edited in its dialog. */
  const [section, setSection] = useState<"visit" | "checklist" | "services" | "findings" | null>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<"save" | "proposal" | "attendance" | null>(null);
  const [baseVersion, setBaseVersion] = useState<string | null>(null);

  /* Take the loaded record as the editable draft (again after each save). */
  const loadedKey = data
    ? `${data.assessment.id}|${data.assessment.status}|${data.assessment.createdAt}|${data.assessment.property?.id ?? ""}|${JSON.stringify(data.assessment.items.map((i) => i.result))}|${data.assessment.attendance}|${data.assessment.scheduledAt}|${JSON.stringify(data.assessment.assetCounts)}`
    : null;
  if (data && loadedKey !== baseVersion) {
    setBaseVersion(loadedKey);
    setDraft(toDraft(data.assessment));
  }

  const summary = useMemo(() => (draft ? assessmentSummary(draft.items) : null), [draft]);

  const refresh = () => {
    setRefreshing(true);
    reload();
  };

  if (error && /not found/i.test(error)) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <BackToSiteVisits />
        <Card className="p-0">
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="This site visit could not be found"
            description="It may have been deleted as a draft, or the link may be out of date."
            action={{
              label: "Back to site visits",
              onClick: () => router.push("/extensions/amc-contracts/assessments"),
              variant: "outline",
            }}
          />
        </Card>
      </div>
    );
  }

  const a = data?.assessment ?? null;
  const ready = Boolean(a && draft && summary) && !error;
  const editable = Boolean(data?.canEdit);
  const busy = pending !== null;
  const completion =
    a && draft
      ? checkAssessmentCompletion({
          status: a.status,
          assessedOn: draft.assessedOn,
          propertyId: draft.propertyId,
          items: draft.items,
          attendance: draft.attendance,
        })
      : { ok: false, errors: [] as string[] };

  /* A draft as the server takes it; throws on failure. */
  const persistDraft = (draft: Draft) =>
    amcContractsService.updateAssessment(id, {
      /* Changed in the visit's dialog: the assessor (a portal user, whose name the server fills in). */
      ...(draft.assessorId !== (data?.assessment.assessorId ?? null) && draft.assessorId ? { assessorId: draft.assessorId } : {}),
      assessedOn: draft.assessedOn,
      assessorName: draft.assessorName,
      propertyCategory: draft.propertyCategory,
      unitType: draft.unitType,
      bedrooms: draft.bedrooms,
      sizeSqft: draft.sizeSqft,
      occupancy: draft.occupancy,
      summary: draft.summary,
      findings: draft.findings,
      notes: draft.notes,
      recommendedServiceIds: draft.recommendedServiceIds,
      scheduledAt: draft.scheduledAt,
      attendance: draft.attendance,
      assetCounts: draft.assetCounts,
      accessNotes: draft.accessNotes,
      exclusions: draft.exclusions,
      items: draft.items.map((i) => ({
        itemKey: i.itemKey,
        result: i.result,
        notes: i.notes,
      })),
    });
  const persist = () => (draft ? persistDraft(draft) : Promise.resolve());
  /* A section's dialog saves the visit with its changes straight away; the page shows what is saved. */
  const saveSection = async (next: Draft) => {
    await persistDraft(next);
    setDraft(next);
    toast.success("Site visit saved");
    reload();
  };
  /* Saves first, then completes, while the confirmation stays open. */
  const complete = () =>
    void confirm({
      title: "Complete this site visit?",
      description: "It becomes history: its answers cannot be changed afterwards.",
      confirmText: "Complete",
      action: async () => {
        await persist();
        await amcContractsService.completeAssessment(id);
        toast.success("Site visit completed");
        reload();
      },
    });
  const createProposal = async () => {
    setPending("proposal");
    try {
      const result = await amcContractsService.proposalFromAssessment(id);
      if (result.droppedServiceIds.length) toast.warning(`Not offered on this unit type, left out: ${result.droppedServiceIds.join(", ")}.`);
      else toast.success(`Proposal ${result.proposalNumber} started as a draft. Enter the prices in the wizard.`);
      router.push(`/extensions/amc/${result.submissionId}/edit`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the proposal.");
      setPending(null);
    }
  };
  const remove = () =>
    void confirm({
      title: "Delete this draft?",
      description: "Drafts can be deleted; completed site visits are kept.",
      confirmText: "Delete",
      variant: "destructive",
      action: async () => {
        await amcContractsService.deleteAssessment(id);
        toast.success("Draft deleted");
        router.push("/extensions/amc-contracts/assessments");
      },
    });
  /*
   * Attendance from the header or the banner, saved straight away. Attended
   * also fills in "Visited on" when it is empty (the booked day once it has
   * passed, today otherwise), so the visit can be completed.
   */
  const recordAttendance = async (attendance: SiteVisitAttendance) => {
    if (!draft || pending) return;
    const visitedOn = attendance === "attended" && !draft.assessedOn ? visitDay(draft.scheduledAt) : null;
    setPending("attendance");
    try {
      await amcContractsService.updateAssessment(id, {
        attendance,
        ...(visitedOn ? { assessedOn: visitedOn } : {}),
      });
      setDraft({
        ...draft,
        attendance,
        ...(visitedOn ? { assessedOn: visitedOn } : {}),
      });
      toast.success(`Attendance recorded: ${ATTENDANCE_LABELS[attendance].toLowerCase()}`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the attendance.");
    } finally {
      setPending(null);
    }
  };
  const notAttended = Boolean(draft?.attendance && draft.attendance !== "attended");

  /* The property picked (or just added): saved on the visit straight away, as it is not part of the draft's form. */
  const linkProperty = async (propertyId: string | null) => {
    if (!draft || !propertyId) return;
    setDraft({ ...draft, propertyId });
    try {
      await amcContractsService.updateAssessment(id, { propertyId });
      toast.success("Property linked to the site visit");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not link the property.");
    }
  };

  const people = assessors.data?.people ?? [];
  const categories = draft ? [...new Map(draft.items.map((i) => [i.categoryKey, i.categoryLabel])).entries()] : [];
  const services = catalogue.data?.catalogue ?? [];
  const answered = summary ? summary.total - summary.unanswered : 0;
  const panel = (value: (typeof TABS)[number], children: React.ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-4 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;
  const unitLabel = (v: string | null | undefined) => (v ? (UNIT_TYPE_LABELS[v as keyof typeof UNIT_TYPE_LABELS] ?? v) : null);

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {dialog}
      {/* As the client page: the way back and Refresh, then the visit's card with what it can do. */}
      <DetailToolbar backHref="/extensions/amc-contracts/assessments" backLabel="Site visits" fetchedAt={fetchedAt} refreshing={refreshing || loading} onRefresh={refresh} />

      {!ready || !a ? (
        error ? null : (
          <DetailHeaderSkeleton />
        )
      ) : (
        <DetailHeaderCard
          badges={
            <>
              <Badge variant="outline">Site visit</Badge>
              <Badge variant="outline" className="tabular-nums">
                {a.assessmentNumber}
              </Badge>
              {a.enquiryId ? <Badge variant="outline">From an enquiry</Badge> : null}
            </>
          }
          title={a.customer?.name || "Site visit"}
          status={<SiteVisitStatusBadge status={a.status} />}
          subline={[
            a.property?.label ?? "No property linked yet",
            a.scheduledAt ? `booked for ${formatDateTime(a.scheduledAt)}` : "not booked for a time",
            a.assessorName ? `assessor ${a.assessorName}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          actions={
            <>
              {ready && a ? (
                <>
                  {a.enquiryId ? (
                    <Button asChild variant="outline">
                      <Link href={`/extensions/amc-contracts/enquiries/${a.enquiryId}`}>
                        <Inbox className="size-4" />
                        Open the enquiry
                      </Link>
                    </Button>
                  ) : null}
                  {a.proposal ? (
                    <Button asChild variant="outline">
                      <Link href={`/extensions/amc/${a.proposal.id}`}>
                        <FileSignature className="size-4" />
                        Proposal {a.proposal.proposalNumber}
                      </Link>
                    </Button>
                  ) : null}
                  {editable && draft ? (
                    <>
                      {/* Attendance in one click; the visit's full edit is at the foot of the menu. */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" disabled={busy}>
                            <CalendarCheck className="size-4" />
                            {draft.attendance ? (ATTENDANCE_LABELS[draft.attendance as SiteVisitAttendance] ?? draft.attendance) : "Record attendance"}
                            <ChevronDown className="size-4 opacity-60" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-52">
                          {SITE_VISIT_ATTENDANCE.map((v) => (
                            <DropdownMenuItem key={v} onClick={() => void recordAttendance(v)} disabled={draft.attendance === v}>
                              <Check className={cn("size-4", draft.attendance === v ? "opacity-100" : "opacity-0")} />
                              {ATTENDANCE_LABELS[v]}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setSection("visit")}>
                            <Pencil className="size-4" />
                            Edit the visit…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button variant="outline" onClick={remove} disabled={busy} className="text-destructive hover:text-destructive">
                        <Trash2 className="size-4" />
                        Delete draft
                      </Button>
                      <Button onClick={complete} disabled={busy || !completion.ok}>
                        <CheckCircle2 className="size-4" />
                        Complete
                      </Button>
                    </>
                  ) : null}
                  {a.status === "completed" && !a.proposal ? (
                    <SubmitButton onClick={() => void createProposal()} pending={pending === "proposal"} pendingLabel="Creating…" icon={<FileSignature className="size-4" />}>
                      Create AMC proposal
                    </SubmitButton>
                  ) : null}
                </>
              ) : null}
            </>
          }
        />
      )}

      {error ? (
        <ErrorState title="Could not load this site visit" message={error} onRetry={refresh} retrying={refreshing} />
      ) : !ready || !a || !draft || !summary ? (
        <SiteVisitBodySkeleton tab={tab} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* What is still needed, as a quotation shows what is holding it up. */}
          {editable && !completion.ok ? (
            <Alert>
              <TriangleAlert />
              <AlertTitle>To complete this site visit</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <span>{completion.errors.join(" ")}</span>
                {notAttended ? (
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton size="sm" onClick={() => void recordAttendance("attended")} pending={pending === "attendance"} pendingLabel="Saving…" icon={<CalendarCheck className="size-4" />}>
                      Mark as attended
                    </SubmitButton>
                    <Button size="sm" variant="outline" onClick={() => setSection("visit")} disabled={busy}>
                      <Pencil className="size-4" />
                      Edit the visit
                    </Button>
                  </div>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {a.status === "completed" && !a.proposal ? (
            <Alert>
              <CheckCircle2 />
              <AlertTitle>The site visit is complete</AlertTitle>
              {/* Create AMC proposal is in the header; the banner only says what it does. */}
              <AlertDescription>Use Create AMC proposal above: the recommended services are ticked, with the units counted on site.</AlertDescription>
            </Alert>
          ) : null}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="checklist">Checklist</TabsTrigger>
              <TabsTrigger value="findings">Findings and services</TabsTrigger>
              <TabsTrigger value="photos">Photos</TabsTrigger>
            </TabsList>

            {panel(
              "details",
              <>
                {/* The four answers somebody opens a site visit for. */}
                <StatCardGrid columns={4}>
                  <StatCard
                    label="Status"
                    value={a.status === "completed" ? "Completed" : "Draft"}
                    headline={`Site visit ${a.assessmentNumber}${a.enquiryId ? " · from an enquiry" : ""}`}
                    caption={draft.scheduledAt ? `Booked for ${formatDateTime(draft.scheduledAt)}` : "Not booked for a time"}
                    tone={a.status === "completed" ? "good" : "progress"}
                  />
                  <StatCard
                    label="Checklist"
                    value={`${answered}/${summary.total}`}
                    tone={summary.total > 0 && summary.unanswered === 0 ? "good" : "neutral"}
                    headline={summary.unanswered ? `${summary.unanswered} unanswered` : "Every item answered"}
                    caption={`${summary.ok} OK · ${summary.notApplicable} not applicable`}
                    onSelect={() => setTab("checklist")}
                    selectLabel="Open the checklist"
                  />
                  <StatCard
                    label="Needs attention"
                    value={summary.attention}
                    tone={summary.attention ? "progress" : "neutral"}
                    headline={summary.attention ? "Items to put right" : "Nothing flagged"}
                    caption="From the checklist"
                    onSelect={() => setTab("findings")}
                    selectLabel="Open the findings"
                  />
                  <StatCard
                    label="Recommended services"
                    value={draft.recommendedServiceIds.length}
                    headline="Ticked on the proposal it starts"
                    caption="Prices are entered in the proposal"
                    onSelect={() => setTab("findings")}
                    selectLabel="Open the recommended services"
                  />
                </StatCardGrid>

                <SectionCard title="Client & property" icon={<Building2 />} description="Who the visit is for and the property being assessed." bodyClassName="px-5 pb-5">
                  {/* As the enquiry and the job's Setup tab: the lists stacked on the left, the map filling the right. */}
                  <div className="grid items-stretch gap-6 lg:grid-cols-2">
                    <div className="min-w-0 space-y-6">
                      <div className="space-y-3">
                        <SubHeading>
                          <HeadingWithActions label="Client">
                            {a.customer ? <HeadingIconButton label="Edit client" icon={<Pencil />} onClick={() => setEditingRecord("client")} /> : null}
                          </HeadingWithActions>
                        </SubHeading>
                        {/* As the job's Setup tab: who the client is and how to reach them. The enquiry and the proposal are in the card above. */}
                        <DetailList
                          rows={clientRows({
                            name: a.customer ? (
                              <Link href={`/extensions/amc-contracts/customers/${a.customer.id}`} className="hover:text-brand underline underline-offset-2">
                                {a.customer.name}
                              </Link>
                            ) : null,
                            customerRef: a.customer?.customerRef,
                            email: a.customer?.email,
                            phone: a.customer?.phone,
                            linkClassName: "hover:text-brand underline underline-offset-2",
                          })}
                        />
                      </div>
                      <div className="space-y-3">
                        <SubHeading
                          action={
                            a.property ? (
                              <Button asChild variant="ghost" size="sm">
                                <Link href={`/extensions/amc-contracts/properties/${a.property.id}?tab=assets&view=scope`}>
                                  <Boxes className="size-3.5" />
                                  Assets and scope
                                </Link>
                              </Button>
                            ) : null
                          }
                        >
                          <HeadingWithActions label="Property">
                            {a.property && addressForm && a.customer ? <HeadingIconButton label="Edit property" icon={<Pencil />} onClick={() => setEditingRecord("property")} /> : null}
                          </HeadingWithActions>
                        </SubHeading>
                        {a.property ? (
                          <DetailList
                            rows={propertyRows({
                              unit: (
                                <Link href={`/extensions/amc-contracts/properties/${a.property.id}`} className="hover:text-brand underline underline-offset-2">
                                  {a.property.label}
                                </Link>
                              ),
                              place: a.property,
                              typeLabel: unitLabel(draft.unitType),
                              category: draft.propertyCategory ? capitalise(draft.propertyCategory) : null,
                            })}
                          />
                        ) : editable && a.customer ? (
                          <div className="grid gap-2">
                            <EnquiryPropertySelect
                              customerId={a.customer.id}
                              clientName={a.customer.name}
                              requireComplete
                              value={draft.propertyId}
                              onChange={(pid) => void linkProperty(pid)}
                              onAddNew={addressForm ? () => setAddingAddress(true) : undefined}
                            />
                            <p className="text-muted-foreground text-xs">The property is needed to complete the visit. Pick one of the client&apos;s addresses, or add a new one.</p>
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-sm">No property linked.</p>
                        )}
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-col space-y-3">
                      <SubHeading>Location</SubHeading>
                      {a.property?.lat != null && a.property?.lng != null ? (
                        hasGoogleMapsKey() ? (
                          <GoogleLocationMap className="min-h-64 flex-1" lat={a.property.lat} lng={a.property.lng} label={a.property.label || null} />
                        ) : (
                          <LocationMap className="min-h-64 flex-1" lat={a.property.lat} lng={a.property.lng} label={a.property.label || null} />
                        )
                      ) : (
                        <div className="text-muted-foreground flex min-h-48 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center text-sm">
                          {a.property ? (
                            <>
                              <p>No location pinned on the property record.</p>
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/extensions/amc-contracts/properties/${a.property.id}`}>
                                  <MapPin className="size-3.5" />
                                  Open the property
                                </Link>
                              </Button>
                            </>
                          ) : (
                            <p>Link the property to see where it is.</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  title="Visit"
                  icon={<CalendarClock />}
                  description={
                    a.enquiryId
                      ? "Booked from an enquiry: whether it took place, what the unit is, how to get in and what is left out."
                      : "When the visit is, whether it took place, what the unit is, how to get in and what is left out."
                  }
                  bodyClassName="px-5 pb-5"
                  action={
                    editable ? (
                      <Button variant="outline" size="sm" onClick={() => setSection("visit")}>
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                    ) : null
                  }
                >
                  {/* Read as the job's Setup tab reads; Edit opens the fields in a dialog. */}
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="min-w-0 space-y-3">
                      <SubHeading>When and who</SubHeading>
                      <DetailList
                        rows={[
                          {
                            label: "Visit date and time",
                            value: draft.scheduledAt ? formatDateTime(draft.scheduledAt) : null,
                          },
                          {
                            label: "Attendance",
                            value: draft.attendance ? (ATTENDANCE_LABELS[draft.attendance as keyof typeof ATTENDANCE_LABELS] ?? draft.attendance) : null,
                          },
                          {
                            label: "Visited on",
                            value: draft.assessedOn ? formatContractDate(draft.assessedOn) : null,
                          },
                          { label: "Assessor", value: draft.assessorName },
                        ]}
                      />
                    </div>
                    <div className="min-w-0 space-y-3">
                      <SubHeading>The unit on the day</SubHeading>
                      <DetailList
                        rows={[
                          {
                            label: "Unit type",
                            value: unitLabel(draft.unitType),
                          },
                          {
                            label: "Occupancy",
                            value: draft.occupancy ? (OCCUPANCY_LABELS[draft.occupancy] ?? draft.occupancy) : null,
                          },
                          ...(isCommercial(draft)
                            ? []
                            : [
                                {
                                  label: "Bedrooms",
                                  value: draft.bedrooms != null ? String(draft.bedrooms) : null,
                                },
                              ]),
                          {
                            label: "Size",
                            value: draft.sizeSqft ? `${draft.sizeSqft.toLocaleString("en-US")} sq ft` : null,
                          },
                        ]}
                      />
                    </div>
                    <div className="flex min-w-0 flex-col space-y-3">
                      <SubHeading>Access notes</SubHeading>
                      <TextBlock empty="No access notes.">{draft.accessNotes}</TextBlock>
                    </div>
                    <div className="flex min-w-0 flex-col space-y-3">
                      <SubHeading>Exclusions</SubHeading>
                      <TextBlock empty="Nothing left out.">{draft.exclusions}</TextBlock>
                    </div>
                  </div>
                </SectionCard>
              </>,
            )}

            {panel(
              "checklist",
              <SectionCard
                title="Checklist"
                description={`${summary.ok} OK · ${summary.attention} attention · ${summary.notApplicable} n/a · ${summary.unanswered} unanswered`}
                icon={<CheckCircle2 />}
                bodyClassName={draft.items.length === 0 ? "border-t" : "px-5 pb-5 space-y-5"}
                action={
                  draft.items.length ? (
                    editable ? (
                      <Button variant="outline" size="sm" onClick={() => setSection("checklist")}>
                        <Pencil className="size-4" />
                        Answer
                      </Button>
                    ) : null
                  ) : null
                }
              >
                {draft.items.length === 0 ? <EmptyState icon={<CheckCircle2 className="size-5" />} title="The checklist is empty" description="An approver can add items in Settings." /> : null}
                {categories.map(([key, label]) => (
                  <div key={key} className="space-y-2">
                    <SubHeading>{label}</SubHeading>
                    <ul className="divide-y rounded-lg border">
                      {draft.items
                        .filter((i) => i.categoryKey === key)
                        .map((i) => (
                          <li key={i.itemKey} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                            <div className="text-sm">{i.label}</div>
                            <Badge variant="secondary" className={cn("h-fit w-fit border-0 font-medium", i.result ? RESULT_TONES[i.result] : "bg-mist text-ink-soft")}>
                              {i.result ? RESULT_LABELS[i.result] : "Not answered"}
                            </Badge>
                            {i.notes ? <p className="text-muted-foreground text-xs sm:col-span-2">{i.notes}</p> : null}
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </SectionCard>,
            )}

            {panel(
              "findings",
              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard
                  title="Recommended services"
                  description="Ticked on the proposal it starts, with the units counted on site. Prices are entered in the proposal."
                  icon={<FileSignature />}
                  bodyClassName="px-5 pb-5"
                  /* With nothing ticked, the empty state's own button is the way in. */
                  action={
                    editable && draft.recommendedServiceIds.length > 0 ? (
                      <Button variant="outline" size="sm" onClick={() => setSection("services")}>
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                    ) : null
                  }
                >
                  {services.length === 0 ? (
                    <ListSkeleton rows={3} />
                  ) : draft.recommendedServiceIds.length === 0 ? (
                    /* The same empty state as the other cards, in a dashed box under the heading. */
                    <div className="rounded-lg border border-dashed">
                      <EmptyState
                        icon={<FileSignature className="size-5" />}
                        title="No services recommended yet"
                        description={editable ? "Tick the services to offer and the units counted on site. They are ticked on the proposal this visit starts." : "None were ticked on this visit."}
                        action={
                          editable
                            ? {
                                label: "Recommend services",
                                onClick: () => setSection("services"),
                                variant: "outline",
                              }
                            : undefined
                        }
                      />
                    </div>
                  ) : (
                    <DetailList
                      rows={draft.recommendedServiceIds.map((sid) => ({
                        label: services.find((s) => s.id === sid)?.label ?? sid,
                        value: `${draft.assetCounts[sid] ?? 1} unit${(draft.assetCounts[sid] ?? 1) === 1 ? "" : "s"}`,
                      }))}
                    />
                  )}
                </SectionCard>
                <SectionCard
                  title="Summary and findings"
                  icon={<ClipboardCheck />}
                  bodyClassName="px-5 pb-5 grid gap-5"
                  action={
                    editable ? (
                      <Button variant="outline" size="sm" onClick={() => setSection("findings")}>
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                    ) : null
                  }
                >
                  <div className="space-y-3">
                    <SubHeading>Summary</SubHeading>
                    <TextBlock empty="No summary yet.">{draft.summary}</TextBlock>
                  </div>
                  <div className="space-y-3">
                    <SubHeading>Findings</SubHeading>
                    <TextBlock empty="No findings recorded.">{draft.findings}</TextBlock>
                  </div>
                  <div className="space-y-3">
                    <SubHeading>Notes</SubHeading>
                    <TextBlock empty="No notes.">{draft.notes}</TextBlock>
                  </div>
                  {summary.attentionItems.length ? (
                    <div className="border-warning/30 bg-warning/5 rounded-md border px-3 py-2 text-sm">
                      <div className="font-medium">Needs attention</div>
                      <ul className="text-muted-foreground list-disc pl-5">
                        {summary.attentionItems.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </SectionCard>
              </div>,
            )}

            {panel("photos", <AssessmentPhotos assessmentId={a.id} editable={editable} completed={a.status === "completed"} />)}
          </Tabs>
        </div>
      )}

      {draft ? (
        <>
          <SectionDialog
            open={section === "visit"}
            onOpenChange={(open) => !open && setSection(null)}
            title="Edit the visit"
            description="When it is, whether it took place, the unit as found, how to get in and what is left out."
            initial={draft}
            onSave={saveSection}
          >
            {(d, set) => (
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid min-w-0 content-start gap-2 sm:col-span-2">
                    <Label htmlFor="as-visit-at">Visit date and time</Label>
                    <DateTimeSelect id="as-visit-at" value={toLocalInput(d.scheduledAt)} onChange={(value) => set({ ...d, scheduledAt: fromLocalInput(value) })} />
                  </div>
                  <SelectField label="Attendance" editable value={d.attendance} options={SITE_VISIT_ATTENDANCE.map((v) => [v, ATTENDANCE_LABELS[v]])} onChange={(v) => set({ ...d, attendance: v })} />
                  <div className="grid min-w-0 content-start gap-2">
                    <Label htmlFor="as-date">Visited on</Label>
                    <DatePickerField id="as-date" value={d.assessedOn ?? ""} onChange={(v) => set({ ...d, assessedOn: v || null })} />
                  </div>
                  {/* Always the list, as on Book site visit; the visit's assessor shows even if no longer in it. */}
                  <div className="grid min-w-0 content-start gap-2">
                    <Label>Assessor</Label>
                    <PersonSelect
                      label="Assessor"
                      people={people}
                      value={d.assessorId}
                      placeholder={d.assessorName ?? "Choose the assessor"}
                      onChange={(pid) =>
                        set({
                          ...d,
                          assessorId: pid,
                          assessorName: people.find((p) => p.id === pid)?.name ?? d.assessorName,
                        })
                      }
                    />
                  </div>
                  <SelectField label="Unit type" editable value={d.unitType} options={Object.entries(UNIT_TYPE_LABELS)} onChange={(v) => set({ ...d, unitType: v })} />
                  <SelectField label="Occupancy on the day" editable value={d.occupancy} options={Object.entries(OCCUPANCY_LABELS)} onChange={(v) => set({ ...d, occupancy: v })} />
                  {/* Bedrooms describe a home; a shop or office is sized by its area. */}
                  {!isCommercial(d) ? (
                    <Field label="Bedrooms" type="number" editable value={d.bedrooms?.toString() ?? ""} onChange={(v) => set({ ...d, bedrooms: v === "" ? null : Number(v) })} />
                  ) : null}
                  <Field label="Size (sq ft)" type="number" editable value={d.sizeSqft?.toString() ?? ""} onChange={(v) => set({ ...d, sizeSqft: v === "" ? null : Number(v) })} />
                </div>
                <Area label="Access notes" editable value={d.accessNotes ?? ""} onChange={(v) => set({ ...d, accessNotes: v })} rows={2} />
                <Area label="Exclusions" editable value={d.exclusions ?? ""} onChange={(v) => set({ ...d, exclusions: v })} rows={2} />
              </div>
            )}
          </SectionDialog>

          <SectionDialog
            open={section === "checklist"}
            onOpenChange={(open) => !open && setSection(null)}
            title="Answer the checklist"
            description="Tap an answer for each item; tap it again to clear it. Add a note where it helps."
            initial={draft}
            onSave={saveSection}
            wide
          >
            {(d, set) => (
              <div className="space-y-5">
                {categories.map(([key, label]) => (
                  <div key={key} className="space-y-2">
                    <SubHeading>{label}</SubHeading>
                    <ul className="divide-y rounded-lg border">
                      {d.items
                        .filter((i) => i.categoryKey === key)
                        .map((i) => {
                          const patch = (next: Partial<Draft["items"][number]>) =>
                            set({
                              ...d,
                              items: d.items.map((x) => (x.itemKey === i.itemKey ? { ...x, ...next } : x)),
                            });
                          return (
                            <li key={i.itemKey} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                              <div className="text-sm">{i.label}</div>
                              <div className="flex flex-wrap gap-1">
                                {(Object.keys(RESULT_LABELS) as AssessmentResult[]).map((r) => (
                                  <Button
                                    key={r}
                                    size="sm"
                                    variant={i.result === r ? "default" : "outline"}
                                    className="h-7 px-2 text-xs"
                                    aria-pressed={i.result === r}
                                    onClick={() =>
                                      patch({
                                        result: i.result === r ? null : r,
                                      })
                                    }
                                  >
                                    {RESULT_LABELS[r]}
                                  </Button>
                                ))}
                              </div>
                              <Input
                                className="h-8 sm:col-span-2"
                                placeholder="Notes"
                                value={i.notes ?? ""}
                                maxLength={1000}
                                onChange={(e) => patch({ notes: e.target.value })}
                                aria-label={`Notes for ${i.label}`}
                              />
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </SectionDialog>

          <SectionDialog
            open={section === "services"}
            onOpenChange={(open) => !open && setSection(null)}
            title="Recommended services"
            description="Tick the services to offer and the units counted on site. They are ticked on the proposal the visit starts."
            initial={draft}
            onSave={saveSection}
            wide
          >
            {(d, set) => (
              <ul className="grid gap-2 sm:grid-cols-2">
                {services.map((s) => (
                  <li key={s.id} className="flex min-h-8 items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={d.recommendedServiceIds.includes(s.id)}
                        onCheckedChange={(v) =>
                          set({
                            ...d,
                            recommendedServiceIds: v === true ? [...d.recommendedServiceIds, s.id] : d.recommendedServiceIds.filter((x) => x !== s.id),
                          })
                        }
                        aria-label={s.label}
                      />
                      {s.label}
                    </label>
                    {d.recommendedServiceIds.includes(s.id) ? (
                      <Input
                        type="number"
                        min={1}
                        max={10000}
                        className="h-7 w-20"
                        placeholder="Units"
                        value={d.assetCounts[s.id] ?? ""}
                        onChange={(e) => {
                          const next = { ...d.assetCounts };
                          const n = Math.trunc(Number(e.target.value));
                          if (e.target.value === "" || !Number.isFinite(n) || n < 1) delete next[s.id];
                          else next[s.id] = Math.min(n, 10000);
                          set({ ...d, assetCounts: next });
                        }}
                        aria-label={`Units counted for ${s.label}`}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </SectionDialog>

          <SectionDialog
            open={section === "findings"}
            onOpenChange={(open) => !open && setSection(null)}
            title="Summary and findings"
            description="What the visit found, in words the proposal and the client can use."
            initial={draft}
            onSave={saveSection}
          >
            {(d, set) => (
              <div className="grid gap-4">
                <Area label="Summary" editable value={d.summary ?? ""} onChange={(v) => set({ ...d, summary: v })} rows={2} />
                <Area label="Findings" editable value={d.findings ?? ""} onChange={(v) => set({ ...d, findings: v })} rows={4} />
                <Area label="Notes" editable value={d.notes ?? ""} onChange={(v) => set({ ...d, notes: v })} rows={2} />
              </div>
            )}
          </SectionDialog>
        </>
      ) : null}

      {a?.customer ? <EditClientDialog open={editingRecord === "client"} onOpenChange={(open) => !open && setEditingRecord(null)} customerId={a.customer.id} onSaved={reload} /> : null}
      {a?.customer && a.property && addressForm ? (
        <AddressDialog
          open={editingRecord === "property"}
          onOpenChange={(open) => !open && setEditingRecord(null)}
          clientId={a.customer.id}
          clientName={a.customer.name}
          propertyId={a.property.id}
          editing
          onSaved={() => {
            setEditingRecord(null);
            toast.success("Property saved");
            reload();
          }}
        />
      ) : null}

      {/* A new address on the Clients page's form, with its pin on the map; linked to the visit once saved. */}
      {a?.customer && addressForm ? (
        <AddressDialog
          open={addingAddress}
          onOpenChange={setAddingAddress}
          clientId={a.customer.id}
          clientName={a.customer.name}
          defaults={{
            unitType: draft?.unitType,
            propertyCategory: draft?.propertyCategory,
          }}
          onSaved={(propertyId) => {
            setAddingAddress(false);
            void linkProperty(propertyId);
          }}
        />
      ) : null}
    </div>
  );
}

/** The loading shape of the tab being opened, so the page does not jump when it lands. */
function SiteVisitBodySkeleton({ tab }: { tab: (typeof TABS)[number] }) {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading the site visit">
      <Skeleton className="h-9 w-full rounded-lg" />
      {tab === "details" ? (
        <>
          <StatGridSkeleton count={4} />
          <SectionSkeleton />
          <SectionSkeleton />
        </>
      ) : (
        <SectionSkeleton />
      )}
    </div>
  );
}

const capitalise = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

function BackToSiteVisits() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
      <Link href="/extensions/amc-contracts/assessments">
        <ArrowLeft className="size-4" />
        Site visits
      </Link>
    </Button>
  );
}

const OCCUPANCY_LABELS: Record<string, string> = {
  occupied: "Occupied",
  vacant: "Vacant",
  unknown: "Unknown",
};

/** Whether the unit is a shop, office or the like: sized by area, with no bedrooms. */
const isCommercial = (d: Pick<Draft, "unitType" | "propertyCategory">) => (UNIT_TYPE_CATEGORY[d.unitType as keyof typeof UNIT_TYPE_CATEGORY] ?? d.propertyCategory) === "commercial";

/** A paragraph the visit recorded, in a box the height of its column, as the enquiry shows what the client needs. */
function TextBlock({ children, empty }: { children: string | null | undefined; empty: string }) {
  return children?.trim() ? (
    <p className="bg-muted/30 flex-1 rounded-lg border p-4 text-sm leading-relaxed whitespace-pre-wrap">{children}</p>
  ) : (
    <p className="text-muted-foreground flex-1 rounded-lg border border-dashed p-4 text-sm">{empty}</p>
  );
}

/**
 * One section of the visit edited in a dialog: a copy of the visit is taken
 * when it opens, the section's fields change the copy, and Save writes it.
 * Cancel leaves the page as it was.
 */
function SectionDialog({
  open,
  onOpenChange,
  title,
  description,
  initial,
  onSave,
  wide = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initial: Draft;
  onSave: (draft: Draft) => Promise<void>;
  wide?: boolean;
  children: (draft: Draft, set: (next: Draft | ((current: Draft) => Draft)) => void) => React.ReactNode;
}) {
  const [local, setLocal] = useState(initial);
  const [busy, setBusy] = useState(false);
  /* A fresh copy each time it opens, taken during render, so a cancelled edit never shows again. */
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setLocal(initial);
  }
  const save = async () => {
    setBusy(true);
    try {
      await onSave(local);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the site visit.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className={cn("flex max-h-[90dvh] flex-col", wide ? "sm:max-w-3xl" : "sm:max-w-2xl")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 py-1">{children(local, setLocal)}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton onClick={() => void save()} pending={busy} pendingLabel="Saving…">
            Save
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/** A read-only value under its label: an em dash when empty. */
function ReadValue({ children, multiline = false }: { children: React.ReactNode; multiline?: boolean }) {
  return children === null || children === undefined || children === "" ? (
    <p className="text-muted-foreground text-sm">—</p>
  ) : (
    <p className={cn("text-sm font-medium", multiline && "whitespace-pre-wrap")}>{children}</p>
  );
}

function Field({ label, value, onChange, editable, type = "text" }: { label: string; value: string; onChange: (v: string) => void; editable: boolean; type?: string }) {
  return (
    <div className="grid min-w-0 content-start gap-2">
      <Label>{label}</Label>
      {editable ? <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} /> : <ReadValue>{value}</ReadValue>}
    </div>
  );
}

function Area({ label, value, onChange, editable, rows, className }: { label: string; value: string; onChange: (v: string) => void; editable: boolean; rows: number; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label>{label}</Label>
      {editable ? <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} maxLength={5000} /> : <ReadValue multiline>{value}</ReadValue>}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  editable,
}: {
  label: string;
  value: string | null;
  options: Array<[string, string]>;
  onChange: (v: string | null) => void;
  editable: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {editable ? (
        <Select value={value ?? ""} onValueChange={(v) => onChange(v || null)}>
          <SelectTrigger className="w-full" aria-label={label}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {options.map(([k, l]) => (
              <SelectItem key={k} value={k}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <ReadValue>{options.find(([k]) => k === value)?.[1]}</ReadValue>
      )}
    </div>
  );
}
