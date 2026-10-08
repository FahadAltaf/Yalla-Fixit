"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Combine,
  Database,
  EllipsisVertical,
  History,
  MoreHorizontal,
  RefreshCw,
  Settings2,
  Split,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ListPager, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, SectionSkeleton, StatGridSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { todayInDubai } from "@/lib/amc/contracts";
import {
  PLANNABLE_STATUSES,
  VISIT_CHANGE_LABELS,
  VISIT_STATUS_LABELS,
  classifyMove,
  clubbingGroups,
  windowsOverlap,
  type VisitStatus,
} from "@/lib/amc/ppm";
import {
  scheduleService,
  type ContractScheduleResponse,
  type ScheduleActionInput,
  type ScheduleRules,
  type SchedulableLine,
  type VisitChangeRecord,
  type VisitRecord,
} from "@/modules/amc-contracts/schedule-service";

import { formatContractDate, formatDateTime } from "./contract-status";

/**
 * A contract's PPM schedule (Phase 8), loaded by the contract page itself
 * so the Schedule tab's count and the tab read the same figures. A failed
 * refresh keeps what is on screen; only a first load shows the error.
 */
export function useContractSchedule(contractId: string) {
  const [data, setData] = useState<ContractScheduleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ticket = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    try {
      const next = await scheduleService.contractSchedule(contractId);
      if (mine !== ticket.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the schedule.");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

export type ContractScheduleState = ReturnType<typeof useContractSchedule>;

const isPlannable = (v: VisitRecord) => PLANNABLE_STATUSES.includes(v.status);

/* Theme tokens only: tentative is muted, planned is brand, attention is amber, done is green. */
function visitStatusTone(status: VisitStatus): string {
  switch (status) {
    case "scheduled":
      return "bg-brand-50 text-brand";
    case "confirmed":
      return "bg-brand-100 text-brand";
    case "in_progress":
    case "submitted":
      return "bg-brand-50 text-brand";
    case "completed":
    case "completed_with_additional_work":
      return "bg-success/10 text-success";
    case "rescheduled":
    case "pending_access":
    case "partially_completed":
      return "bg-warning/10 text-warning";
    case "not_completed":
      return "bg-danger/10 text-danger";
    case "cancelled":
      return "bg-mist text-ink-soft line-through";
    case "not_scheduled":
    default:
      return "bg-mist text-ink-soft";
  }
}

const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);
/** "4 Nov", for windows inside a month heading that already says the year. */
const dayMonth = (iso: string) => format(toDate(iso), "d MMM");
const windowLabel = (v: { windowStart: string; windowEnd: string }) =>
  v.windowStart === v.windowEnd ? dayMonth(v.windowStart) : `${dayMonth(v.windowStart)} – ${dayMonth(v.windowEnd)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sharesService = (a: VisitRecord, b: VisitRecord) => a.lines.some((l) => b.lines.some((m) => m.entitlementId === l.entitlementId));

const CHANNELS = ["whatsapp", "call", "sms", "email"] as const;
type Channel = (typeof CHANNELS)[number];
const CHANNEL_LABELS: Record<Channel, string> = { whatsapp: "WhatsApp", call: "Call", sms: "SMS", email: "Email" };

type DialogKind = "move" | "add" | "remove" | "club" | "rules";

export function ContractSchedulePanel({ contractId, schedule }: { contractId: string; schedule: ContractScheduleState }) {
  const { data, error, loading, reload } = schedule;
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [showCancelled, setShowCancelled] = useState(false);
  /* The visit is kept after a dialog closes, so it animates out with its content. */
  const [target, setTarget] = useState<VisitRecord | null>(null);
  const [openKind, setOpenKind] = useState<DialogKind | null>(null);
  const [historyPage, setHistoryPage] = useState(0);

  const visits = useMemo(() => data?.visits ?? [], [data]);
  const plannable = useMemo(() => visits.filter(isPlannable), [visits]);
  /* What "Club overlapping visits" would do; nothing to offer when it finds no group. */
  const overlapGroups = useMemo(
    () =>
      clubbingGroups(
        plannable.map((v) => ({ id: v.id, windowStart: v.windowStart, windowEnd: v.windowEnd, lineIds: v.lines.map((l) => l.entitlementId) })),
      ),
    [plannable],
  );

  if (!data && loading) {
    return (
      <>
        <StatGridSkeleton count={4} />
        <SectionSkeleton />
      </>
    );
  }
  if (!data) {
    return <ErrorState title="Could not load the schedule" message={error} onRetry={() => void reload()} retrying={loading} />;
  }
  if (!data.migrated) {
    return (
      <Alert className="border-warning/30 bg-warning/5 items-start p-4">
        <Database className="text-warning" />
        <AlertTitle>The schedule needs a database update</AlertTitle>
        <AlertDescription>
          The PPM schedule tables are not on this database yet (migration 20261008110000). Ask an admin to apply it; until then no visits are
          planned.
        </AlertDescription>
      </Alert>
    );
  }

  const { progress, confirmed, lines, rules, changes } = data;
  /* The route lets the contract's operators change it; only while the contract is active or on hold. */
  const canEdit = data.permissions.canEdit && data.open;

  const post = async (action: ScheduleActionInput) => {
    const result = await scheduleService.scheduleAction(contractId, action);
    await reload();
    return result;
  };

  const openDialog = (kind: DialogKind, visit: VisitRecord | null = null) => {
    setTarget(visit);
    setOpenKind(kind);
  };
  const closeDialog = (next: boolean) => !next && setOpenKind(null);
  /* The dialog keeps its own pending state and shows a failure as a toast; this posts, reloads and closes. */
  const submit = async (action: ScheduleActionInput, success: string) => {
    await post(action);
    toast.success(success);
    setOpenKind(null);
  };

  const makeSchedule = (again: boolean) =>
    void confirm({
      title: again ? "Make the schedule again?" : "Make the schedule?",
      description: again
        ? "The tentative visits are replaced by a fresh plan from the contract's PPM services, term and rules."
        : "One visit for each PPM service occurrence over the term, each with its service window. It starts tentative.",
      confirmText: again ? "Make again" : "Make schedule",
      action: async () => {
        /* Refused (409) once a visit was adjusted: say so and close, there is nothing to retry. */
        try {
          const result = await post({ action: "generate", replace: again });
          toast.success(result.changed ? `Schedule made: ${plural(result.changed, "visit")}` : "Schedule made");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not make the schedule.");
        }
      },
    });

  const confirmSchedule = () =>
    void confirm({
      title: "Confirm the schedule?",
      description:
        "It becomes the plan of record: visits not yet scheduled become Scheduled. After this, moving a visit outside its window needs a reason and keeps the original date.",
      confirmText: "Confirm schedule",
      action: async () => {
        await post({ action: "confirm" });
        toast.success("Schedule confirmed");
      },
    });

  const clubOverlapping = () =>
    void confirm({
      title: "Club overlapping visits?",
      description: `${plural(overlapGroups.length, "group")} of visits for different services share a window. Each group becomes one visit; a trade can be separated again later.`,
      confirmText: "Club visits",
      action: async () => {
        const result = await post({ action: "club_overlapping" });
        if (result.changed) toast.success(`${plural(result.changed, "group")} clubbed`);
        else toast.info("No visits to club");
      },
    });

  const separate = (visit: VisitRecord, line: VisitRecord["lines"][number]) =>
    void confirm({
      title: `Separate ${line.serviceLabel}?`,
      description: `${line.serviceLabel} leaves visit ${visit.visitNo} and goes back to its own visit, on its original date.`,
      confirmText: "Separate",
      action: async () => {
        await post({ action: "separate", lineId: line.id });
        toast.success(`${line.serviceLabel} separated`);
      },
    });

  /* No schedule yet: why, and the way to make one. */
  if (visits.length === 0) {
    const canMake = canEdit && lines.length > 0;
    return (
      <>
        <Card className="p-0">
          <EmptyState
            icon={<CalendarDays className="size-5" />}
            title="No schedule yet"
            description={
              !data.open
                ? "The schedule is made once the contract is active, after its first payment."
                : lines.length === 0
                  ? "This contract has no PPM services, so there is nothing to schedule."
                  : canEdit
                    ? "This contract was activated before PPM scheduling. Make its tentative schedule from its PPM services and term."
                    : "This contract has no schedule yet. Its owner or AMC Operations can make one."
            }
            action={canMake ? { label: "Make schedule", onClick: () => makeSchedule(false) } : undefined}
          />
        </Card>
        {confirmDialog}
      </>
    );
  }

  const shown = showCancelled ? visits : visits.filter((v) => v.status !== "cancelled");
  const months = groupByMonth(shown);
  const next = progress.nextVisit ? visits.find((v) => v.id === progress.nextVisit?.id) : null;
  const visitNo = new Map(visits.map((v) => [v.id, v.visitNo]));

  /* Visits that could share a trip with this one: still to plan, windows meet, no service in common. */
  const clubCandidates = (visit: VisitRecord) =>
    plannable.filter((other) => other.id !== visit.id && windowsOverlap(visit, other) && !sharesService(visit, other));

  return (
    <>
      <StatCardGrid columns={4}>
        <StatCard
          label="Completed"
          value={<span className="text-xl tabular-nums">{progress.completed}</span>}
          headline={`of ${plural(progress.total, "visit")}`}
          tone={progress.total > 0 && progress.completed >= progress.total ? "good" : "neutral"}
        />
        <StatCard
          label="Remaining"
          value={<span className="text-xl tabular-nums">{progress.remaining}</span>}
          headline={progress.remaining ? "Still to be done" : "Nothing left to do"}
        />
        <StatCard
          label="Overdue"
          value={<span className="text-xl tabular-nums">{progress.overdue}</span>}
          headline={progress.overdue ? "Window passed, not done" : "Nothing overdue"}
          tone={progress.overdue ? "bad" : "neutral"}
        />
        <StatCard
          label="Next visit"
          value={<span className="text-xl tabular-nums">{progress.nextVisit ? formatContractDate(progress.nextVisit.targetDate) : "—"}</span>}
          headline={next ? `Visit ${next.visitNo}${next.lines.length ? ` · ${next.lines.map((l) => l.serviceLabel).join(", ")}` : ""}` : "No visit coming up"}
        />
      </StatCardGrid>

      {/* The plan's state, and what can be done to the whole of it. */}
      <div
        className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4 ${
          confirmed ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"
        }`}
      >
        <div className="min-w-0">
          <p className={`text-sm font-medium ${confirmed ? "text-success" : "text-warning"}`}>
            {confirmed
              ? `Confirmed${confirmed.by ? ` by ${confirmed.by}` : ""} on ${formatContractDate(confirmed.at)}`
              : "Tentative — not yet confirmed"}
          </p>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {confirmed
              ? "Moving a visit inside its window is fine. Outside it, say why: the original date is kept."
              : "Dates can still be adjusted freely. Confirm to make this the plan of record."}
            {` Window: ${plural(rules.windowDays, "day")} from each cycle's start.`}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => openDialog("add")} disabled={lines.length === 0}>
              <CalendarPlus className="size-4" />
              Add visit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More schedule actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={clubOverlapping} disabled={overlapGroups.length === 0}>
                  <Combine className="size-4" />
                  Club overlapping visits
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openDialog("rules")}>
                  <Settings2 className="size-4" />
                  Schedule rules
                </DropdownMenuItem>
                {confirmed ? null : (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => makeSchedule(true)}>
                      <RefreshCw className="size-4" />
                      Make schedule again
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {confirmed ? null : (
              <Button onClick={confirmSchedule}>
                <CalendarCheck className="size-4" />
                Confirm schedule
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <SectionCard
        title="Visits"
        description={
          data.open
            ? "Each visit has a service window and a target date. Clubbed visits cover several services in one trip."
            : "The contract is no longer active, so the schedule can't be changed."
        }
        icon={<CalendarClock />}
        bodyClassName="pb-2"
        action={
          progress.cancelled > 0 ? (
            <div className="flex items-center gap-2">
              <Switch id="ppm-show-cancelled" checked={showCancelled} onCheckedChange={setShowCancelled} />
              <Label htmlFor="ppm-show-cancelled" className="text-sm font-normal">
                Show removed and clubbed ({progress.cancelled})
              </Label>
            </div>
          ) : null
        }
      >
        {months.map(([month, rows]) => (
          <div key={month}>
            <div className="bg-muted/40 text-muted-foreground border-y px-5 py-1.5 text-xs font-medium">{month}</div>
            <ul className="divide-y">
              {rows.map((v) => (
                <VisitRow
                  key={v.id}
                  visit={v}
                  actions={
                    canEdit && isPlannable(v) ? (
                      <VisitMenu
                        visit={v}
                        canClub={clubCandidates(v).length > 0}
                        onMove={() => openDialog("move", v)}
                        onClub={() => openDialog("club", v)}
                        onSeparate={(line) => separate(v, line)}
                        onRemove={() => openDialog("remove", v)}
                      />
                    ) : null
                  }
                />
              ))}
            </ul>
          </div>
        ))}
      </SectionCard>

      <ScheduleHistory changes={changes} visitNo={visitNo} page={historyPage} onPageChange={setHistoryPage} />

      <MoveDialog open={openKind === "move"} onOpenChange={closeDialog} visit={target} confirmed={Boolean(confirmed)} submit={submit} />
      <AddVisitDialog open={openKind === "add"} onOpenChange={closeDialog} lines={lines} windowDays={rules.windowDays} submit={submit} />
      <RemoveDialog open={openKind === "remove"} onOpenChange={closeDialog} visit={target} submit={submit} />
      <ClubDialog
        open={openKind === "club"}
        onOpenChange={closeDialog}
        visit={target}
        candidates={target ? clubCandidates(target) : []}
        submit={submit}
      />
      <RulesDialog open={openKind === "rules"} onOpenChange={closeDialog} rules={rules} submit={submit} />
      {confirmDialog}
    </>
  );
}

/** Visits under "Nov 2026" headings, by target date. */
function groupByMonth(visits: VisitRecord[]): Array<[string, VisitRecord[]]> {
  const sorted = [...visits].sort((a, b) => (a.targetDate === b.targetDate ? a.visitNo - b.visitNo : a.targetDate < b.targetDate ? -1 : 1));
  const groups = new Map<string, VisitRecord[]>();
  for (const v of sorted) {
    const key = format(toDate(v.targetDate), "MMM yyyy");
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  return [...groups.entries()];
}

function VisitRow({ visit, actions }: { visit: VisitRecord; actions: ReactNode }) {
  const cancelled = visit.status === "cancelled";
  const struck = cancelled ? "text-muted-foreground line-through" : "";
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <div className={`w-16 shrink-0 text-sm font-medium tabular-nums ${struck}`}>Visit {visit.visitNo}</div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {visit.lines.map((l) => (
            <Badge key={l.id} variant="outline" className={`font-normal ${struck}`}>
              {l.serviceLabel}
            </Badge>
          ))}
          {visit.lines.length > 1 ? (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <Combine className="size-3" />
              Clubbed
            </span>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {[`Window ${windowLabel(visit)}`, visit.source === "added" ? "Added" : null, visit.statusReason].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="text-right">
        <div className={`text-sm font-semibold tabular-nums ${struck}`}>{formatContractDate(visit.targetDate)}</div>
        {visit.originalTargetDate && visit.originalTargetDate !== visit.targetDate ? (
          <div className="text-muted-foreground text-xs tabular-nums">
            <span className="sr-only">Originally </span>
            <s>{formatContractDate(visit.originalTargetDate)}</s>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Badge variant="secondary" className={`border-0 font-medium ${visitStatusTone(visit.status)}`}>
          {VISIT_STATUS_LABELS[visit.status] ?? visit.status}
        </Badge>
        {visit.overdue ? (
          <Badge variant="secondary" className="bg-danger/10 text-danger border-0 font-medium">
            Overdue
          </Badge>
        ) : null}
      </div>
      <div className="flex w-8 justify-end">{actions}</div>
    </li>
  );
}

function VisitMenu({
  visit,
  canClub,
  onMove,
  onClub,
  onSeparate,
  onRemove,
}: {
  visit: VisitRecord;
  canClub: boolean;
  onMove: () => void;
  onClub: () => void;
  onSeparate: (line: VisitRecord["lines"][number]) => void;
  onRemove: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <EllipsisVertical className="size-4" />
          <span className="sr-only">Actions for visit {visit.visitNo}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={onMove}>
          <CalendarDays className="size-4" />
          Move date
        </DropdownMenuItem>
        {canClub ? (
          <DropdownMenuItem onClick={onClub}>
            <Combine className="size-4" />
            Club with…
          </DropdownMenuItem>
        ) : null}
        {visit.lines.length > 1
          ? visit.lines.map((l) => (
              <DropdownMenuItem key={l.id} onClick={() => onSeparate(l)}>
                <Split className="size-4" />
                Separate {l.serviceLabel}
              </DropdownMenuItem>
            ))
          : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onRemove}>
          <Trash2 className="size-4" />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

const HISTORY_PAGE = 10;

/** The extra a change carries in its detail, in words: which visits were clubbed, which trade left which visit. */
function changeDetail(c: VisitChangeRecord): string | null {
  const d = c.detail as Record<string, unknown>;
  switch (c.changeType) {
    case "clubbed":
      return Array.isArray(d.from) && d.into ? `Visit ${(d.from as number[]).join(", ")} into visit ${String(d.into)}` : null;
    case "separated":
      return d.service ? `${String(d.service)}${d.from ? ` from visit ${String(d.from)}` : ""}` : null;
    case "added":
      return d.service ? String(d.service) : null;
    case "confirmed":
      return typeof d.visits === "number" ? plural(d.visits, "visit") : null;
    default:
      return null;
  }
}

function ScheduleHistory({
  changes,
  visitNo,
  page,
  onPageChange,
}: {
  changes: VisitChangeRecord[];
  visitNo: Map<string, number>;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const rows = changes.slice(page * HISTORY_PAGE, (page + 1) * HISTORY_PAGE);
  return (
    <SectionCard
      title="Schedule history"
      description="Every change to the schedule, newest first."
      icon={<History />}
      bodyClassName={changes.length ? "pb-2" : "px-5 pb-5"}
    >
      {changes.length === 0 ? (
        <p className="text-muted-foreground text-sm">No changes yet.</p>
      ) : (
        <>
          <ol className="divide-y">
            {rows.map((c) => {
              const no = c.visitId ? visitNo.get(c.visitId) : undefined;
              const dates =
                c.fromDate && c.toDate
                  ? `${formatContractDate(c.fromDate)} → ${formatContractDate(c.toDate)}`
                  : c.toDate
                    ? formatContractDate(c.toDate)
                    : c.fromDate
                      ? `was ${formatContractDate(c.fromDate)}`
                      : null;
              return (
                <li key={c.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-sm font-medium">
                      {no ? `Visit ${no}: ` : ""}
                      {VISIT_CHANGE_LABELS[c.changeType] ?? c.changeType.replace(/_/g, " ")}
                    </span>
                    <span className="text-muted-foreground text-xs">{formatDateTime(c.createdAt)}</span>
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {[dates, changeDetail(c), c.reason ? `Reason: ${c.reason}` : null, c.actorLabel ?? "System"].filter(Boolean).join(" · ")}
                  </div>
                </li>
              );
            })}
          </ol>
          <ListPager page={page} pageSize={HISTORY_PAGE} total={changes.length} onPageChange={onPageChange} noun="changes" />
        </>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

type Submit = (action: ScheduleActionInput, success: string) => Promise<void>;
type BaseProps = { open: boolean; onOpenChange: (open: boolean) => void; submit: Submit };

function useResetOnOpen(open: boolean, reset: () => void) {
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) reset();
  }
}

/* One submit at a time: success closes (in submit), a failure is a toast and the dialog stays. */
function useSubmitting() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the schedule.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function Shell({
  open,
  onOpenChange,
  busy,
  title,
  description,
  footer,
  wide = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  title: string;
  description: string;
  footer: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className={wide ? "max-h-[88vh] overflow-y-auto sm:max-w-lg" : "sm:max-w-md"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {footer}
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
    </div>
  );
}

const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function MoveDialog({ open, onOpenChange, visit, confirmed, submit }: BaseProps & { visit: VisitRecord | null; confirmed: boolean }) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const { busy, run } = useSubmitting();
  useResetOnOpen(open, () => {
    setDate(visit?.targetDate ?? "");
    setReason("");
  });

  const valid = isIsoDate(date);
  const unchanged = visit !== null && date === visit.targetDate;
  const move = visit && valid ? classifyMove(visit, date, confirmed) : null;
  const text = reason.trim();
  /* The live answer to "is this a reschedule?", from the same rule the server applies. */
  const hint =
    !visit || !move || unchanged ? null : move.kind === "in_window" ? (
      <span className="text-success">Inside the service window ({windowLabel(visit)}).</span>
    ) : move.needsReason ? (
      <span className="text-warning">Outside the window: this is a reschedule, say why. The original date is kept.</span>
    ) : (
      <span>Outside the window: the plan is still tentative, so the visit takes a new window from this date.</span>
    );

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={visit ? `Move visit ${visit.visitNo}` : "Move visit"}
      description={visit ? `Its window is ${windowLabel(visit)}; the target is ${formatContractDate(visit.targetDate)}.` : "Pick the new date."}
      footer={
        <SubmitButton
          pending={busy}
          pendingLabel="Saving…"
          icon={<CalendarDays className="size-4" />}
          disabled={!visit || !valid || unchanged || (move?.needsReason === true && text.length < 3)}
          onClick={() =>
            visit && void run(() => submit({ action: "move", visitId: visit.id, date, reason: text || null }, `Visit ${visit.visitNo} moved`))
          }
        >
          Move
        </SubmitButton>
      }
    >
      <Field id="ppm-move-date" label="New date" hint={hint}>
        <Input id="ppm-move-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field id="ppm-move-reason" label={move?.needsReason ? "Reason" : "Reason (optional)"}>
        <Textarea id="ppm-move-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
    </Shell>
  );
}

function AddVisitDialog({ open, onOpenChange, lines, windowDays, submit }: BaseProps & { lines: SchedulableLine[]; windowDays: number }) {
  const [entitlementId, setEntitlementId] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const { busy, run } = useSubmitting();
  useResetOnOpen(open, () => {
    setEntitlementId(lines.length === 1 ? lines[0].entitlementId : "");
    setDate(todayInDubai());
    setReason("");
  });
  const text = reason.trim();

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title="Add visit"
      description="An extra visit for one service, on top of the plan."
      footer={
        <SubmitButton
          pending={busy}
          pendingLabel="Saving…"
          icon={<CalendarPlus className="size-4" />}
          disabled={!entitlementId || !isIsoDate(date) || text.length < 3}
          onClick={() => void run(() => submit({ action: "add", entitlementId, date, reason: text }, "Visit added"))}
        >
          Add visit
        </SubmitButton>
      }
    >
      <Field id="ppm-add-service" label="Service">
        <Select value={entitlementId} onValueChange={setEntitlementId}>
          <SelectTrigger id="ppm-add-service" className="w-full">
            <SelectValue placeholder="Choose a service" />
          </SelectTrigger>
          <SelectContent>
            {lines.map((l) => (
              <SelectItem key={l.entitlementId} value={l.entitlementId}>
                {l.label} ({l.planned} planned, {l.frequencyPerYear} a year)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id="ppm-add-date" label="Date" hint={`The visit gets a ${plural(windowDays, "day")} window from this date.`}>
        <Input id="ppm-add-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field id="ppm-add-reason" label="Reason">
        <Textarea id="ppm-add-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
    </Shell>
  );
}

function RemoveDialog({ open, onOpenChange, visit, submit }: BaseProps & { visit: VisitRecord | null }) {
  const [reason, setReason] = useState("");
  const { busy, run } = useSubmitting();
  useResetOnOpen(open, () => setReason(""));
  const text = reason.trim();

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={visit ? `Remove visit ${visit.visitNo}` : "Remove visit"}
      description="The visit is cancelled and kept on record with your reason."
      footer={
        <SubmitButton
          variant="destructive"
          pending={busy}
          pendingLabel="Removing…"
          icon={<Trash2 className="size-4" />}
          disabled={!visit || text.length < 3}
          onClick={() => visit && void run(() => submit({ action: "remove", visitId: visit.id, reason: text }, `Visit ${visit.visitNo} removed`))}
        >
          Remove visit
        </SubmitButton>
      }
    >
      {visit ? (
        <p className="text-muted-foreground text-sm">
          {[visit.lines.map((l) => l.serviceLabel).join(", "), formatContractDate(visit.targetDate)].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <Field id="ppm-remove-reason" label="Reason">
        <Textarea id="ppm-remove-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
    </Shell>
  );
}

function ClubDialog({ open, onOpenChange, visit, candidates, submit }: BaseProps & { visit: VisitRecord | null; candidates: VisitRecord[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const { busy, run } = useSubmitting();
  useResetOnOpen(open, () => setPicked([]));

  const chosen = candidates.filter((c) => picked.includes(c.id));
  /* Every visit in a club must meet every other and bring a different service. */
  const fits = (c: VisitRecord) => chosen.every((p) => p.id === c.id || (windowsOverlap(p, c) && !sharesService(p, c)));

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      wide
      title={visit ? `Club visit ${visit.visitNo}` : "Club visits"}
      description="The chosen visits join into one trip on the earliest target inside the shared window. The others show as clubbed."
      footer={
        <SubmitButton
          pending={busy}
          pendingLabel="Saving…"
          icon={<Combine className="size-4" />}
          disabled={!visit || picked.length === 0 || picked.length > 9}
          onClick={() => visit && void run(() => submit({ action: "club", visitIds: [visit.id, ...picked] }, "Visits clubbed"))}
        >
          Club visits
        </SubmitButton>
      }
    >
      {candidates.length === 0 ? (
        <p className="text-muted-foreground text-sm">No other visit for a different service shares this window.</p>
      ) : (
        <div className="grid gap-2">
          {candidates.map((c) => {
            const checked = picked.includes(c.id);
            const disabled = !checked && !fits(c);
            return (
              <label
                key={c.id}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${disabled ? "opacity-50" : "hover:bg-muted/40 cursor-pointer"}`}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  className="mt-0.5"
                  onCheckedChange={(v) => setPicked((cur) => (v === true ? [...cur, c.id] : cur.filter((id) => id !== c.id)))}
                />
                <span className="min-w-0">
                  <span className="font-medium">Visit {c.visitNo}</span>
                  <span className="text-muted-foreground"> · {c.lines.map((l) => l.serviceLabel).join(", ")}</span>
                  <span className="text-muted-foreground block text-xs">
                    Window {windowLabel(c)} · target {formatContractDate(c.targetDate)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

function RulesDialog({ open, onOpenChange, rules, submit }: BaseProps & { rules: ScheduleRules }) {
  const [windowDefault, setWindowDefault] = useState(true);
  const [windowDays, setWindowDays] = useState("");
  const [attemptsDefault, setAttemptsDefault] = useState(true);
  const [attemptCount, setAttemptCount] = useState("");
  const [intervalDays, setIntervalDays] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const { busy, run } = useSubmitting();
  useResetOnOpen(open, () => {
    setWindowDefault(!rules.own.windowDays);
    setWindowDays(String(rules.windowDays));
    setAttemptsDefault(!rules.own.attempts);
    setAttemptCount(String(rules.attemptCount));
    setIntervalDays(String(rules.attemptIntervalDays));
    setChannels(rules.attemptChannels.filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c)));
  });

  const whole = (v: string, min: number, max: number) => /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max;
  const windowOk = windowDefault || whole(windowDays, 1, 120);
  const attemptsOk = attemptsDefault || (whole(attemptCount, 1, 10) && whole(intervalDays, 0, 30) && channels.length > 0);
  /* The configuration's values are only known while the contract has none of its own. */
  const windowHint = rules.own.windowDays ? "" : ` (${plural(rules.windowDays, "day")})`;
  const attemptsHint = rules.own.attempts
    ? ""
    : ` (${plural(rules.attemptCount, "attempt")}, ${plural(rules.attemptIntervalDays, "day")} apart, by ${rules.attemptChannels
        .map((c) => CHANNEL_LABELS[c as Channel] ?? c)
        .join(", ")})`;

  const action = (): ScheduleActionInput => ({
    action: "rules",
    windowDays: windowDefault ? null : Number(windowDays),
    attemptCount: attemptsDefault ? null : Number(attemptCount),
    attemptIntervalDays: attemptsDefault ? null : Number(intervalDays),
    attemptChannels: attemptsDefault ? null : channels,
    /* No picker here yet: whoever is set stays set. */
    escalationUserId: rules.escalationUserId,
  });

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      wide
      title="Schedule rules"
      description="The service window and the appointment attempt rule for this contract. Visits already planned keep their windows."
      footer={
        <SubmitButton
          pending={busy}
          pendingLabel="Saving…"
          icon={<Settings2 className="size-4" />}
          disabled={!windowOk || !attemptsOk}
          onClick={() => void run(() => submit(action(), "Schedule rules saved"))}
        >
          Save rules
        </SubmitButton>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm font-medium">Service window</p>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={windowDefault} onCheckedChange={(v) => setWindowDefault(v === true)} />
          Use the AMC configuration default{windowHint}
        </label>
        <Field id="ppm-window-days" label="Window length (days)" hint="Counted from the start of each cycle; weekends and holidays are skipped for the target.">
          <Input
            id="ppm-window-days"
            type="number"
            min={1}
            max={120}
            value={windowDays}
            disabled={windowDefault}
            onChange={(e) => setWindowDays(e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-3 border-t pt-4">
        <p className="text-sm font-medium">Appointment attempts</p>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={attemptsDefault} onCheckedChange={(v) => setAttemptsDefault(v === true)} className="mt-0.5" />
          <span>Use the AMC configuration default{attemptsHint}</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ppm-attempts" label="Attempts">
            <Input
              id="ppm-attempts"
              type="number"
              min={1}
              max={10}
              value={attemptCount}
              disabled={attemptsDefault}
              onChange={(e) => setAttemptCount(e.target.value)}
            />
          </Field>
          <Field id="ppm-interval" label="Days between attempts">
            <Input
              id="ppm-interval"
              type="number"
              min={0}
              max={30}
              value={intervalDays}
              disabled={attemptsDefault}
              onChange={(e) => setIntervalDays(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-medium">Channels</span>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            {CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap-2">
                <Checkbox
                  checked={channels.includes(c)}
                  disabled={attemptsDefault}
                  onCheckedChange={(v) => setChannels((cur) => (v === true ? [...cur, c] : cur.filter((x) => x !== c)))}
                />
                {CHANNEL_LABELS[c]}
              </label>
            ))}
          </div>
          {!attemptsDefault && channels.length === 0 ? <p className="text-warning text-xs">Choose at least one channel.</p> : null}
        </div>
      </div>
    </Shell>
  );
}
