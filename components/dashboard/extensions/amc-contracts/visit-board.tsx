"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck, CalendarClock, CalendarDays, Database, Inbox, Lock, Search, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";

import DateNav from "@/components/dashboard/scheduling/daily-schedule/date-nav";
import { PageHeading, TabCount } from "@/components/dashboard/shared/kaizen";
import { ErrorState, HeadingSkeleton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { todayInDubai } from "@/lib/amc/contracts";
import { visitsService, type BoardVisit } from "@/modules/amc-contracts/visits-service";

import { AmcNotificationsBell } from "./amc-notifications-bell";
import { useAmcData } from "./use-amc-data";
import { ConfirmChangeDialog, CrewDialog, MoveDialog, PlaceDialog, type ChangeRequest, type PlaceRequest } from "./visit-board-dialogs";
import { VisitBoardGrid } from "./visit-board-grid";
import {
  DEFAULT_DURATION,
  ToPlaceCard,
  addDays,
  formatTime,
  hhmm,
  longDate,
  minutesInDay,
  type DragPayload,
} from "./visit-board-shared";

/**
 * AMC -> Visit board (Phase 9: DEV-392, 393, 394). A day of technicians as
 * an AMC overlay: the PPM visits placed that day (these move), the live
 * jobs and leave (read only, to show who is busy), and the visits still to
 * place. Placing asks for the suggested crew; the server blocks a missing
 * skill, access permission, leave or double booking and asks for a reason
 * when a day leaves the service window or the crew is not the suggested one.
 */

const isIsoDate = (v: string | null): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* Where each visit's window sits against the board's day. */
const GROUPS = [
  { key: "open", label: "Window open on this day" },
  { key: "later", label: "Window opens later" },
  { key: "closed", label: "Window closed before this day" },
] as const;

type DialogKind = "place" | "move" | "crew" | "change";

export function VisitBoard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const asked = searchParams.get("date");
  const today = todayInDubai();
  const date = isIsoDate(asked) ? asked : today;

  /* The day lives in ?date= so a link or a refresh lands on it. */
  const setDate = useCallback((next: string) => router.replace(`${pathname}?date=${next}`, { scroll: false }), [router, pathname]);

  const { data, error, loading, reload } = useAmcData(() => visitsService.board(date), date);
  const forbidden = Boolean(error && /AMC Visits \(View\)|^Forbidden$/i.test(error));
  const canEdit = Boolean(data?.canEdit);

  const names = useMemo(() => new Map((data?.technicians ?? []).map((t) => [t.fsmId, t.name])), [data]);
  const technicianName = useCallback((id: string) => names.get(id) ?? id, [names]);

  /* Selection belongs to the day it was made on. */
  const [selection, setSelection] = useState<{ date: string; ids: Set<string> }>({ date, ids: new Set() });
  const selected = selection.date === date ? selection.ids : new Set<string>();
  const toggleSelect = useCallback(
    (id: string) =>
      setSelection((cur) => {
        const ids = new Set(cur.date === date ? cur.ids : []);
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        return { date, ids };
      }),
    [date],
  );
  const clearSelection = () => setSelection({ date, ids: new Set() });
  const selectedVisits = (data?.placed ?? []).filter((v) => selected.has(v.id));

  const dragRef = useRef<DragPayload | null>(null);
  const [openKind, setOpenKind] = useState<DialogKind | null>(null);
  const [placeRequest, setPlaceRequest] = useState<PlaceRequest | null>(null);
  const [targets, setTargets] = useState<BoardVisit[]>([]);
  const [change, setChange] = useState<ChangeRequest | null>(null);
  const closeDialog = (open: boolean) => !open && setOpenKind(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const onDone = (message: string) => {
    toast.success(message);
    clearSelection();
    reload();
  };

  const openPlace = (visit: BoardVisit, technicianId: string | null = null, startMinutes: number | null = null) => {
    setPlaceRequest({ visit, date, startTime: startMinutes === null ? "09:00" : hhmm(startMinutes), technicianId });
    setOpenKind("place");
  };
  const openFor = (kind: "move" | "crew", visits: BoardVisit[]) => {
    setTargets(visits);
    setOpenKind(kind);
  };

  const remove = (visits: BoardVisit[]) => {
    const single = visits.length === 1 ? visits[0] : null;
    void confirm({
      title: single ? `Remove visit ${single.visitNo} from the board?` : `Remove ${plural(visits.length, "visit")} from the board?`,
      description: "Their time and crew are cleared and they go back to To place. The visits themselves stay on the contract.",
      confirmText: "Remove",
      variant: "destructive",
      action: async () => {
        for (const v of visits) await visitsService.boardAction({ action: "unplace", visitId: v.id });
        onDone(single ? `Visit ${single.visitNo} removed from the board` : `${plural(visits.length, "visit")} removed from the board`);
      },
    });
  };

  /* A block dropped on another row changes the crew; on another time, the time; both, both. */
  const onDropPlaced = (visitId: string, from: string, to: string, startMinutes: number) => {
    const v = data?.placed.find((p) => p.id === visitId);
    if (!v?.scheduledStart || !v.scheduledEnd) return;
    const timeChanged = startMinutes !== Math.round(minutesInDay(v.scheduledStart, date));
    const swapped = [...new Set(v.technicianIds.map((id) => (id === from ? to : id)))];
    const crewChanged = from !== to && !(swapped.length === v.technicianIds.length && swapped.every((id) => v.technicianIds.includes(id)));
    if (!timeChanged && !crewChanged) return;
    const actions: ChangeRequest["actions"] = [];
    if (crewChanged) actions.push({ action: "reassign", visitIds: [v.id], technicianIds: swapped });
    if (timeChanged) actions.push({ action: "move", visitIds: [v.id], date, startTime: hhmm(startMinutes) });
    const was = `${formatTime(v.scheduledStart)}–${formatTime(v.scheduledEnd)}`;
    const parts = [
      crewChanged ? `Crew: ${swapped.map(technicianName).join(", ")} (was ${v.technicianIds.map(technicianName).join(", ")}).` : null,
      timeChanged ? `Starts ${hhmm(startMinutes)} on ${longDate(date)} (was ${was}).` : `Time stays ${was}.`,
    ];
    setChange({
      title: crewChanged
        ? `Give visit ${v.visitNo} to ${technicianName(to)}${timeChanged ? ` at ${hhmm(startMinutes)}` : ""}?`
        : `Move visit ${v.visitNo} to ${hhmm(startMinutes)}?`,
      description: `${v.customerName} · ${v.contractNumber}. ${parts.filter(Boolean).join(" ")}`,
      actions,
      success: crewChanged ? `Visit ${v.visitNo} given to ${technicianName(to)}` : `Visit ${v.visitNo} moved to ${hhmm(startMinutes)}`,
      label: crewChanged ? "Change crew" : "Move",
    });
    setOpenKind("change");
  };

  const heading = (
    <PageHeading
      eyebrow="Operations"
      title="Visit board"
      description="Place PPM visits, move them inside their window and change the crew. Live jobs and leave show who is busy."
      actions={
        <>
          <AmcNotificationsBell />
          <DateNav date={date} onChange={setDate} onStep={(d) => setDate(addDays(date, d))} onToday={() => setDate(today)} isToday={date === today} />
        </>
      }
    />
  );

  if (forbidden) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        {heading}
        <Card className="p-0">
          <EmptyState
            icon={<Lock className="size-5" />}
            title="You don't have access to the visit board"
            description="The visit board needs AMC Visits (View). Ask an admin to add it to your role."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {heading}

      {error ? <ErrorState title="Could not load the board" message={error} onRetry={reload} /> : null}

      {loading ? <VisitBoardBodySkeleton /> : null}

      {data && !data.migrated ? (
        <Alert className="border-warning/30 bg-warning/5 items-start p-4">
          <Database className="text-warning" />
          <AlertTitle>The visit board needs a database update</AlertTitle>
          <AlertDescription>
            The technician and visit assignment tables are not on this database yet (migration 20261008120000). Ask an admin to apply it.
          </AlertDescription>
        </Alert>
      ) : null}

      {data && data.migrated ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <ToPlacePanel
            visits={data.toPlace}
            date={date}
            canEdit={canEdit}
            onPlace={(v) => openPlace(v)}
            onDragStart={(v) => {
              dragRef.current = { kind: "toPlace", visitId: v.id, grabOffset: 0, durationMinutes: DEFAULT_DURATION };
            }}
            onDragEnd={() => {
              dragRef.current = null;
            }}
          />

          <Card className="min-w-0 gap-0 overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-lg">
                  <CalendarDays className="text-brand size-[1.125rem] shrink-0" />
                  {longDate(date)}
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">{daySummary(data)}</p>
              </div>
              <Legend />
            </div>

            {canEdit && selected.size > 0 ? (
              <div className="border-brand/30 bg-brand-50 flex flex-wrap items-center gap-2 border-t px-5 py-2.5">
                <span className="text-brand mr-auto text-sm font-medium">{plural(selected.size, "visit")} selected</span>
                <Button variant="outline" size="sm" onClick={() => openFor("move", selectedVisits)}>
                  <CalendarClock className="size-4" />
                  Move to…
                </Button>
                <Button variant="outline" size="sm" onClick={() => openFor("crew", selectedVisits)}>
                  <Users className="size-4" />
                  Change crew…
                </Button>
                <Button variant="outline" size="sm" className="text-danger hover:text-danger" onClick={() => remove(selectedVisits)}>
                  <Trash2 className="size-4" />
                  Remove from board
                </Button>
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  <X className="size-4" />
                  Clear
                </Button>
              </div>
            ) : canEdit && data.technicians.length ? (
              <p className="text-muted-foreground border-t px-5 py-2 text-xs">
                Drag a visit from To place onto a technician, or drag a block to another time or technician. Shift-click blocks to select several.
              </p>
            ) : null}

            <div className="border-t">
              {data.technicians.length || data.placed.length ? (
                <VisitBoardGrid
                  date={date}
                  technicians={data.technicians}
                  placed={data.placed}
                  busy={data.busy}
                  canEdit={canEdit}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                  dragRef={dragRef}
                  onDropNew={(visitId, technicianId, start) => {
                    const v = data.toPlace.find((p) => p.id === visitId);
                    if (v) openPlace(v, technicianId, start);
                  }}
                  onDropPlaced={onDropPlaced}
                  onMove={(v) => openFor("move", [v])}
                  onChangeCrew={(v) => openFor("crew", [v])}
                  onRemove={(v) => remove([v])}
                  technicianName={technicianName}
                />
              ) : (
                <EmptyState
                  icon={<Users className="size-5" />}
                  title="No technicians on the roster"
                  description="Technicians come from the FSM roster. Once they are there with their AMC skills, visits can be placed on them."
                />
              )}
            </div>
          </Card>
        </div>
      ) : null}

      <PlaceDialog open={openKind === "place"} onOpenChange={closeDialog} onDone={onDone} reload={reload} request={placeRequest} technicianName={technicianName} />
      <MoveDialog open={openKind === "move"} onOpenChange={closeDialog} onDone={onDone} reload={reload} visits={targets} date={date} />
      <CrewDialog open={openKind === "crew"} onOpenChange={closeDialog} onDone={onDone} reload={reload} visits={targets} technicians={data?.technicians ?? []} />
      <ConfirmChangeDialog open={openKind === "change"} onOpenChange={closeDialog} onDone={onDone} reload={reload} request={change} />
      {confirmDialog}
    </div>
  );
}

function daySummary(data: { placed: BoardVisit[]; busy: Array<{ kind: string; technicianId: string }> }) {
  const jobs = data.busy.filter((b) => b.kind === "job").length;
  const onLeave = new Set(data.busy.filter((b) => b.kind === "leave").map((b) => b.technicianId)).size;
  return [
    data.placed.length ? plural(data.placed.length, "AMC visit") : "No AMC visits yet",
    jobs ? plural(jobs, "live job") : null,
    onLeave ? `${plural(onLeave, "technician")} on leave` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Legend() {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span className="border-brand/30 bg-brand-100 border-l-brand size-3 rounded-sm border border-l-[3px]" />
        AMC visit
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="bg-mist size-3 rounded-sm border" />
        Live job
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="border-danger/30 bg-danger/5 size-3 rounded-sm border"
          style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 2px, color-mix(in oklab, var(--color-danger) 30%, transparent) 2px 4px)" }}
        />
        Leave
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* To place                                                            */
/* ------------------------------------------------------------------ */

function ToPlacePanel({
  visits,
  date,
  canEdit,
  onPlace,
  onDragStart,
  onDragEnd,
}: {
  visits: BoardVisit[];
  date: string;
  canEdit: boolean;
  onPlace: (visit: BoardVisit) => void;
  onDragStart: (visit: BoardVisit) => void;
  onDragEnd: () => void;
}) {
  const [search, setSearch] = useState("");
  const [confirmedOnly, setConfirmedOnly] = useState(false);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const shown = visits.filter(
      (v) =>
        (!confirmedOnly || v.clientConfirmation === "confirmed") &&
        (!q || [v.customerName, v.contractNumber, v.propertyLabel, ...v.services].some((s) => s.toLowerCase().includes(q))),
    );
    const sorted = [...shown].sort((a, b) => a.windowStart.localeCompare(b.windowStart) || a.visitNo - b.visitNo);
    const keyOf = (v: BoardVisit) => (v.windowStart > date ? "later" : v.windowEnd < date ? "closed" : "open");
    return GROUPS.map((g) => ({ ...g, visits: sorted.filter((v) => keyOf(v) === g.key) })).filter((g) => g.visits.length);
  }, [visits, search, confirmedOnly, date]);
  const filtered = Boolean(search.trim()) || confirmedOnly;

  return (
    <Card className="gap-0 overflow-hidden p-0 lg:sticky lg:top-4">
      <div className="space-y-3 px-4 pt-4 pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg">
            <Inbox className="text-brand size-[1.125rem] shrink-0" />
            To place
            <TabCount value={visits.length} />
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">Planned visits whose window is open or coming.</p>
        </div>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input aria-label="Search visits to place" placeholder="Client, contract or service" className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="to-place-confirmed" size="sm" checked={confirmedOnly} onCheckedChange={setConfirmedOnly} />
          <Label htmlFor="to-place-confirmed" className="text-sm font-normal">
            Confirmed by the client only
          </Label>
        </div>
      </div>
      <div className="max-h-[calc(100vh-18rem)] min-h-40 space-y-4 overflow-y-auto border-t p-3">
        {groups.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Search className="size-5" />}
              title="No visits match"
              description="Nothing to place matches this search or filter."
              action={{
                label: "Clear filters",
                variant: "outline",
                onClick: () => {
                  setSearch("");
                  setConfirmedOnly(false);
                },
              }}
            />
          ) : (
            <EmptyState
              icon={<CalendarCheck className="size-5" />}
              title="Nothing to place"
              description="Every visit with an open or coming window is on the board."
            />
          )
        ) : (
          groups.map((g) => (
            <section key={g.key} className="space-y-2">
              <h3 className="text-muted-foreground flex items-center justify-between px-1 text-xs font-medium">
                {g.label}
                <span className="tabular-nums">{g.visits.length}</span>
              </h3>
              {g.visits.map((v) => (
                <ToPlaceCard key={v.id} visit={v} canEdit={canEdit} onPlace={() => onPlace(v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
              ))}
            </section>
          ))
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

/* Fixed offsets so the placeholder reads as a day of bookings and never re-randomises. */
const BARS: Array<Array<[number, number]>> = [[[6, 18], [40, 22]], [[14, 28]], [[0, 12], [30, 16], [64, 18]], [[48, 24]], [[10, 20], [56, 16]]];

/** The board below its heading: the To place panel and the day grid. */
export function VisitBoardBodySkeleton() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]" aria-busy="true" aria-label="Loading the board">
      <Card className="gap-0 overflow-hidden p-0">
        <div className="space-y-3 px-4 pt-4 pb-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="space-y-2 border-t p-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      </Card>
      <Card className="min-w-0 gap-0 overflow-hidden p-0">
        <div className="space-y-2 px-5 pt-5 pb-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-64 max-w-full" />
        </div>
        <div className="border-t">
          {BARS.map((bars, r) => (
            <div key={r} className="flex border-b last:border-b-0">
              <div className="flex w-52 shrink-0 items-center gap-2.5 border-r px-4 py-3">
                <Skeleton className="size-7 shrink-0 rounded-full" />
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-14" />
                </div>
              </div>
              <div className="relative min-w-0 flex-1">
                {bars.map(([left, width], i) => (
                  <Skeleton key={i} className="absolute top-3 h-9 rounded-md" style={{ left: `${left}%`, width: `${width}%` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** The route while it loads: heading, then the board. */
export function VisitBoardSkeleton() {
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <HeadingSkeleton withActions />
      <VisitBoardBodySkeleton />
    </div>
  );
}
