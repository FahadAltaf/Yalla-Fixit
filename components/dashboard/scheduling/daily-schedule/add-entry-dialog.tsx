"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  scheduleService,
  fsmLookupService,
  type FsmWorkOrderLookup,
  type FsmWorkOrderLines,
  type FsmWorkOrderSearchResult,
  type SchedulingConfig,
  type ShiftType,
  type TechnicianReference,
} from "@/modules/scheduling";
import type { LeaveRecord, TechnicianTag } from "@/types/types";
import { AmcWorkOrderNotice } from "@/components/dashboard/extensions/amc-contracts/amc-work-order-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Hint } from "@/components/ui/hint";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, ArrowRight, CalendarClock, CalendarPlus, Loader2, Search, ShieldCheck, StickyNote, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CallOutBooking } from "@/components/dashboard/extensions/amc-contracts/log-call-out-dialog";
import { NeedsLoginBadge, cannotRegister, useTechnicianLogins } from "@/components/dashboard/shared/technician-login";
import { technicianAccountsService } from "@/modules/users/services/technician-accounts-service";
import TimeSelect, { formatTimeAmPm } from "@/components/ui/time-select";
import { APPOINTMENT_STATE_LABELS, APPOINTMENT_STATE_STYLES } from "@/lib/scheduling/appointment-status";
import {
  formatZonedDate,
  zonedTimeToUtc,
} from "@/lib/scheduling/org-time";
import {
  reachesOutsideUsualHours,
  shiftWindowLabel,
  shiftBoundsFor,
  APPOINTMENT_TYPES,
  type ScheduleTypeValue,
} from "./shift-utils";

type Props = {
  scheduleVersionId: string;
  date: string;
  shift: ShiftType;
  config: SchedulingConfig;
  defaultStartTime?: string;
  defaultEndTime?: string;
  defaultTechnicianFsmId?: string;
  technicians: TechnicianReference[];
  tags: TechnicianTag[];
  assignmentsByTechnician: Record<string, TechnicianTag[]>;
  leaveRecords: LeaveRecord[];
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
  /** DEV-489: book an AMC call out, handyman job or inspection on this slot and crew (logged in AMC next). */
  onBookAmc?: (booking: CallOutBooking) => void;
};

type Mode = "fsm" | "free_text" | "amc";
/* A call out is booked for up to 12 hours (AMC's schedule step). */
const AMC_MAX_MINUTES = 720;
const NEW_APPOINTMENT = "__new__";

function minutesToHhmm(m: number) {
  const c = m >= 1440 ? 1439 : m;
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
}

export default function AddEntryDialog({
  scheduleVersionId,
  date,
  shift,
  config,
  defaultStartTime,
  defaultEndTime,
  defaultTechnicianFsmId,
  technicians,
  tags,
  assignmentsByTechnician,
  leaveRecords,
  onOpenChange,
  onAdded,
  onBookAmc,
}: Props) {
  const [mode, setMode] = useState<Mode>("fsm");
  const [woQuery, setWoQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [workOrder, setWorkOrder] = useState<FsmWorkOrderLookup | null>(null);
  const [appointmentChoice, setAppointmentChoice] = useState<string>("");

  // Work order search (O-4): by number, or by client / company / address / date.
  const [searchMode, setSearchMode] = useState<"number" | "details">("number");
  const [detailQuery, setDetailQuery] = useState({ contact: "", company: "", address: "", dateFrom: "", dateTo: "" });
  const [searchResults, setSearchResults] = useState<FsmWorkOrderSearchResult[] | null>(null);
  const [searchScope, setSearchScope] = useState<string>("");

  // Create-new-appointment inputs (FSM Create Service Appointment).
  const [woLines, setWoLines] = useState<FsmWorkOrderLines | null>(null);
  const [linesLoading, setLinesLoading] = useState(false);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [appointmentType, setAppointmentType] = useState<string>("-None-");
  const [scheduleType, setScheduleType] = useState<ScheduleTypeValue>("Time-bound");

  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState(defaultStartTime ?? (shift === "night" ? "00:00" : "09:00"));
  const [endTime, setEndTime] = useState(defaultEndTime ?? (shift === "night" ? "01:00" : "10:00"));
  const [technicianFilter, setTechnicianFilter] = useState("");
  const [techTagFilters, setTechTagFilters] = useState<string[]>([]);
  const [selectedTechnicianIds, setSelectedTechnicianIds] = useState<string[]>(
    defaultTechnicianFsmId ? [defaultTechnicianFsmId] : [],
  );
  const [saving, setSaving] = useState(false);

  /*
    AMC work only (25 Nov 2026): a technician sees an AMC job on the YFI
    mobile app through their portal login, so, as in AMC's crew picker, one
    with no login gets it before they are put on the job (their FSM email,
    the Inspector role, the password shown to hand over). Scheduling's own
    entries go to FSM and need no login.
  */
  const { createLogins, dialogs: loginDialogs } = useTechnicianLogins();
  /* fsm id → has a portal account (null until the list loads). */
  const [accounts, setAccounts] = useState<Map<string, { hasLogin: boolean; email: string | null }> | null>(null);
  const [makingLogin, setMakingLogin] = useState(false);
  useEffect(() => {
    if (mode !== "amc" || accounts) return;
    let stale = false;
    technicianAccountsService.list().then(
      (list) => !stale && setAccounts(new Map(list.technicians.map((t) => [t.fsmId, { hasLogin: t.userId !== null, email: t.email }]))),
      () => !stale && setAccounts(new Map()),
    );
    return () => {
      stale = true;
    };
  }, [mode, accounts]);
  const needsLogin = (id: string) => mode === "amc" && accounts !== null && accounts.get(id)?.hasLogin === false;
  /* Makes the logins; true when everyone now has one. */
  const ensureLogins = async (ids: string[]) => {
    const missing = ids.filter(needsLogin);
    if (!missing.length) return true;
    /* No email in FSM: no login can be made, so they can't go on AMC work yet. */
    for (const id of missing) {
      const blocked = cannotRegister({ name: technicians.find((t) => t.fsm_resource_id === id)?.display_name ?? id, email: accounts?.get(id)?.email ?? null });
      if (blocked) {
        toast.error(blocked);
        return false;
      }
    }
    setMakingLogin(true);
    try {
      const made = await createLogins(
        missing.map((id) => ({
          fsmId: id,
          name: technicians.find((t) => t.fsm_resource_id === id)?.display_name ?? id,
          email: accounts?.get(id)?.email ?? null,
        })),
      );
      if (!made) return false;
      setAccounts((prev) => {
        const next = new Map(prev ?? []);
        made.forEach((r) => next.set(r.fsmId, { hasLogin: true, email: next.get(r.fsmId)?.email ?? null }));
        return next;
      });
      return made.length >= missing.length;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the login");
      return false;
    } finally {
      setMakingLogin(false);
    }
  };

  const creatingNew = mode === "fsm" && appointmentChoice === NEW_APPOINTMENT;
  const isAllDay = creatingNew && scheduleType === "All Day";

  // An entry is filed under the shift of the grid it is added from. Where it
  // is drawn depends on its technicians' shifts, not on its time (2 Oct 2026).
  const effectiveShift: ShiftType = shift;
  const outsideUsualHours =
    !isAllDay && endTime > startTime && reachesOutsideUsualHours(startTime, endTime, config);

  const onLeaveByTechnician = useMemo(() => {
    const startAt = zonedTimeToUtc(date, startTime).getTime();
    const endAt = zonedTimeToUtc(date, endTime).getTime();
    const map = new Map<string, LeaveRecord>();
    leaveRecords.forEach((r) => {
      if (r.status !== "active") return;
      if (new Date(r.start_at).getTime() < endAt && new Date(r.end_at).getTime() > startAt) {
        map.set(r.technician_fsm_id, r);
      }
    });
    return map;
  }, [leaveRecords, date, startTime, endTime]);

  // Only the most recent lines request may write state, so a slow response for
  // a previously picked work order can't show (and pre-tick) the wrong lines.
  const linesRequestRef = useRef(0);
  const loadWorkOrderLines = async (workOrderId: string) => {
    const requestId = ++linesRequestRef.current;
    setLinesLoading(true);
    setWoLines(null);
    try {
      const lines = await fsmLookupService.getWorkOrderLines(workOrderId);
      if (requestId !== linesRequestRef.current) return;
      setWoLines(lines);
      // Default: all UNSCHEDULED lines selected (YFI: all lines by default).
      setSelectedLineIds((lines?.serviceLineItems ?? []).filter((l) => !l.scheduled).map((l) => l.id));
    } catch {
      if (requestId === linesRequestRef.current) setWoLines(null);
    } finally {
      if (requestId === linesRequestRef.current) setLinesLoading(false);
    }
  };

  // Hydrate the full work order (with appointments) once one is picked, and
  // pre-select the obvious appointment choice. When the search already gave us
  // the id, the lines/status read starts in parallel instead of waiting.
  const selectWorkOrder = async (name: string, id?: string) => {
    setSearching(true);
    setWorkOrder(null);
    setAppointmentChoice("");
    setWoLines(null);
    if (id) loadWorkOrderLines(id);
    try {
      const result = await fsmLookupService.findWorkOrder(name.trim());
      if (!result) {
        toast.error("Couldn't load that work order from Zoho FSM");
        return;
      }
      setSearchResults(null);
      setWorkOrder(result);
      setTitle(result.summary || result.name);
      // Lines drive each existing appointment's coverage + status badge.
      if (result.id !== id) loadWorkOrderLines(result.id);
      if (result.appointments.length === 1) setAppointmentChoice(result.appointments[0].id);
      else if (result.appointments.length === 0) setAppointmentChoice(NEW_APPOINTMENT);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lookup failed");
    } finally {
      setSearching(false);
    }
  };

  const runWorkOrderLookup = async () => {
    if (!woQuery.trim()) return;
    setSearching(true);
    setSearchResults(null);
    try {
      const { results, scope } = await fsmLookupService.searchWorkOrders({ workOrderName: woQuery.trim() });
      if (results.length === 0) {
        toast.error("No work order found with that number in Zoho FSM");
        setSearchResults([]);
        return;
      }
      if (results.length === 1) {
        await selectWorkOrder(results[0].name ?? woQuery.trim(), results[0].id);
        return;
      }
      setSearchScope(scope);
      setSearchResults(results);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const runDetailSearch = async () => {
    const q = detailQuery;
    if (!q.contact && !q.company && !q.address && !q.dateFrom && !q.dateTo) {
      toast.error("Enter at least one detail to search by");
      return;
    }
    setSearching(true);
    setSearchResults(null);
    try {
      const { results, scope } = await fsmLookupService.searchWorkOrders({
        contact: q.contact || undefined,
        company: q.company || undefined,
        address: q.address || undefined,
        dateFrom: q.dateFrom || undefined,
        dateTo: q.dateTo || undefined,
      });
      setSearchScope(scope);
      setSearchResults(results);
      if (results.length === 0) toast.info("No matching work orders in the recent set");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const chooseAppointment = (value: string) => {
    setAppointmentChoice(value);
    if (value === NEW_APPOINTMENT && workOrder && !woLines && !linesLoading) loadWorkOrderLines(workOrder.id);
  };

  const filteredTechnicians = technicians.filter((t) => {
    if (!t.display_name.toLowerCase().includes(technicianFilter.toLowerCase())) return false;
    // Same tag filter as the main schedule view: show a technician if they
    // carry ANY of the selected tags.
    if (techTagFilters.length > 0) {
      const owned = assignmentsByTechnician[t.fsm_resource_id] ?? [];
      if (!owned.some((tag) => techTagFilters.includes(tag.id))) return false;
    }
    return true;
  });

  const toggleTechTag = (tagId: string) =>
    setTechTagFilters((prev) => (prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]));

  const toggleTechnician = (id: string) => {
    if (onLeaveByTechnician.has(id)) return;
    /* AMC work: no login yet, make it first, then tick them. */
    if (!selectedTechnicianIds.includes(id) && needsLogin(id)) {
      void ensureLogins([id]).then((ok) => ok && setSelectedTechnicianIds((prev) => (prev.includes(id) ? prev : [...prev, id])));
      return;
    }
    setSelectedTechnicianIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const toggleLine = (id: string) =>
    setSelectedLineIds((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));

  const selectableLines = (woLines?.serviceLineItems ?? []).filter((l) => !l.scheduled);

  // When every line is already covered, name the existing appointment(s) so the
  // scheduler knows what to pick above. In FSM these may still be "yet to be
  // scheduled" (an appointment record exists but has no time/technician yet),
  // which is exactly what the scheduler places on the board.
  const coveringAppointmentNames = useMemo(() => {
    const names = new Set<string>();
    (woLines?.serviceLineItems ?? []).forEach((l) => l.appointments.forEach((a) => names.add(a.name)));
    return [...names].sort();
  }, [woLines]);

  // Coverage + FSM status per appointment id, to annotate the existing-
  // appointment options (loaded eagerly with the work order).
  const appointmentInfoById = useMemo(
    () => new Map((woLines?.appointments ?? []).map((a) => [a.id, a] as const)),
    [woLines],
  );

  // A cancelled appointment can't be scheduled onto the board (publish rejects
  // it), so hide it from the "Use existing appointment" list. Until statuses
  // load, nothing is marked cancelled yet, so everything shows.
  const isReleased = (id: string) => {
    const state = appointmentInfoById.get(id)?.state;
    return state === "cancelled" || state === "cannot_complete";
  };
  const visibleAppointments = (workOrder?.appointments ?? []).filter((a) => !isReleased(a.id));
  const hiddenCannotComplete = (workOrder?.appointments ?? []).filter(
    (a) => appointmentInfoById.get(a.id)?.state === "cannot_complete",
  ).length;
  const hiddenCancelledCount = (workOrder?.appointments.length ?? 0) - visibleAppointments.length;

  /* DEV-489: the slot and crew go on to the AMC call out dialog, which checks coverage and logs it. */
  const continueToAmc = async () => {
    if (!onBookAmc) return;
    if (selectedTechnicianIds.length === 0) return void toast.error("Select at least one technician");
    /* Ticked before switching to AMC job (e.g. from the row clicked): their logins too. */
    if (accounts === null) return void toast.info("Checking the technicians' logins, try again in a moment");
    if (!(await ensureLogins(selectedTechnicianIds))) return;
    if (endTime <= startTime) return void toast.error("End time must be after start time");
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const minutes = eh * 60 + em - (sh * 60 + sm);
    if (minutes < 15) return void toast.error("Give the job at least 15 minutes");
    if (minutes > AMC_MAX_MINUTES) return void toast.error("An AMC call out is booked for up to 12 hours");
    const names = selectedTechnicianIds.map((id) => technicians.find((t) => t.fsm_resource_id === id)?.display_name ?? id);
    const day = formatZonedDate(zonedTimeToUtc(date, "12:00"), { weekday: "short", day: "numeric", month: "short" });
    onBookAmc({
      date,
      time: startTime,
      durationMinutes: minutes,
      technicianIds: selectedTechnicianIds,
      summary: `${day}, ${startTime} to ${endTime} · ${names.join(", ")}`,
    });
  };

  const handleSave = async () => {
    if (mode === "amc") return continueToAmc();
    if (mode === "free_text" && !title.trim()) {
      toast.error("Enter a title for the text entry");
      return;
    }
    if (mode === "fsm") {
      if (!workOrder) {
        toast.error("Search for a work order first");
        return;
      }
      if (!appointmentChoice) {
        toast.error("Choose an appointment, or choose to create a new one");
        return;
      }
      if (creatingNew) {
        if (selectableLines.length === 0) {
          toast.error("This work order has no unscheduled service lines to create an appointment for");
          return;
        }
        if (selectedLineIds.length === 0) {
          toast.error("Select at least one service line for the appointment");
          return;
        }
        if (appointmentType === "-None-") {
          toast.error("Choose an appointment type");
          return;
        }
      }
    }
    if (selectedTechnicianIds.length === 0) {
      toast.error("Select at least one technician");
      return;
    }
    if (!isAllDay && endTime <= startTime) {
      toast.error("End time must be after start time");
      return;
    }

    setSaving(true);
    try {
      // All-Day entries occupy the whole shift row locally; FSM gets the date.
      const bounds = shiftBoundsFor(effectiveShift, config);
      const startHhmm = isAllDay ? minutesToHhmm(bounds.start) : startTime;
      const endHhmm = isAllDay ? minutesToHhmm(bounds.end) : endTime;
      const startAt = zonedTimeToUtc(date, startHhmm).toISOString();
      const endAt = zonedTimeToUtc(date, endHhmm).toISOString();

      if (mode === "free_text") {
        await scheduleService.addEntry({
          scheduleVersionId,
          entryType: "free_text",
          shift: effectiveShift,
          operatingDate: date,
          startAt,
          endAt,
          technicianFsmIds: selectedTechnicianIds,
          title: title.trim(),
        });
      } else if (workOrder) {
        const useExisting = appointmentChoice !== NEW_APPOINTMENT;
        const chosen = workOrder.appointments.find((a) => a.id === appointmentChoice);
        const taskIds = (woLines?.serviceTaskLineItems ?? []).map((t) => t.id);
        await scheduleService.addEntry({
          scheduleVersionId,
          entryType: useExisting ? "existing_appointment" : "new_appointment",
          shift: effectiveShift,
          operatingDate: date,
          startAt,
          endAt,
          technicianFsmIds: selectedTechnicianIds,
          title: title.trim() || workOrder.summary,
          fsmWorkOrderId: workOrder.id,
          fsmWorkOrderName: workOrder.name,
          fsmAppointmentId: useExisting ? appointmentChoice : undefined,
          fsmAppointmentName: useExisting ? (chosen?.name ?? null) : null,
          clientName: workOrder.contact_name,
          address: workOrder.address,
          ...(useExisting
            ? {}
            : {
                serviceLineItemIds: selectedLineIds,
                serviceTaskLineItemIds: taskIds.length ? taskIds : undefined,
                appointmentType,
                scheduleType,
              }),
        });
      }
      toast.success("Entry added to the draft");
      onAdded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add entry");
    } finally {
      setSaving(false);
    }
  };

  const dayLabel = formatZonedDate(zonedTimeToUtc(date, "12:00"), { weekday: "long", day: "numeric", month: "long" });
  const chosenTechs = selectedTechnicianIds
    .map((id) => technicians.find((t) => t.fsm_resource_id === id))
    .filter((t): t is TechnicianReference => Boolean(t));
  const MODES: Array<{ key: Mode; label: string; icon: typeof Wrench; hint: string }> = [
    { key: "fsm", label: "Work order", icon: Wrench, hint: "An appointment from Zoho FSM, or a new one on a work order" },
    { key: "free_text", label: "Note", icon: StickyNote, hint: "A note on the board, never sent to FSM" },
    ...(onBookAmc ? [{ key: "amc" as Mode, label: "AMC job", icon: ShieldCheck, hint: "A call out, inspection or handyman job on a contract" }] : []),
  ];
  const summary = [
    dayLabel,
    isAllDay ? "All day" : `${formatTimeAmPm(startTime)} to ${formatTimeAmPm(endTime)}`,
    chosenTechs.length ? `${chosenTechs.length} technician${chosenTechs.length === 1 ? "" : "s"}` : "No technician yet",
  ];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl lg:max-w-6xl">
        {/* 25 Nov 2026 (the user: the popup did not look good): a header with the day and a segmented choice, cards for the entry and its time, a technicians panel, and a footer with a summary and Cancel. */}
        <DialogHeader className="border-b px-6 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <span className="bg-brand-50 text-brand border-brand/20 flex size-10 shrink-0 items-center justify-center rounded-lg border">
              <CalendarPlus className="size-5" />
            </span>
            <div className="min-w-0 space-y-1 text-left">
              <DialogTitle>Add to the {effectiveShift === "night" ? "night" : "morning"} shift</DialogTitle>
              <DialogDescription>
                {dayLabel}: an FSM appointment, a note{onBookAmc ? ", or AMC work for a contract" : ""}.
              </DialogDescription>
            </div>
          </div>
          <div role="tablist" aria-label="What to add" className="bg-muted mt-4 inline-flex w-fit max-w-full flex-wrap items-center gap-1 rounded-full p-1">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={mode === m.key}
                title={m.hint}
                onClick={() => setMode(m.key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                  mode === m.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <m.icon className="size-4" />
                {m.label}
              </button>
            ))}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 [scrollbar-gutter:stable] [scrollbar-width:thin]">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            {/* Left: what it is, then when. */}
            <div className="grid min-w-0 content-start gap-5">
              <EntrySection
                title={mode === "fsm" ? "Work order" : mode === "amc" ? "AMC job" : "Note"}
                description={
                  mode === "fsm"
                    ? "Find the work order, then use one of its appointments or create a new one."
                    : mode === "amc"
                      ? "The contract, the issue and the job type come next, with the coverage check."
                      : "What the note says on the board."
                }
                action={
                  mode === "fsm" ? (
                    <div role="tablist" aria-label="Search by" className="bg-muted inline-flex items-center gap-0.5 rounded-full p-1 text-xs">
                      {(
                        [
                          ["number", "By WO name"],
                          ["details", "By client / details"],
                        ] as const
                      ).map(([k, l]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setSearchMode(k)}
                          role="tab"
                          aria-selected={searchMode === k}
                          className={cn(
                            "rounded-full px-3 py-1 leading-none font-medium whitespace-nowrap transition-colors",
                            searchMode === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  ) : null
                }
              >
                {mode === "fsm" ? (
                  <div className="flex flex-col gap-3">
                    {searchMode === "number" ? (
                      <div className="flex gap-2">
                        <Input
                          placeholder="Work order name (e.g. WO2330)"
                          value={woQuery}
                          onChange={(e) => setWoQuery(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && runWorkOrderLookup()}
                          autoFocus
                        />
                        <Button variant="outline" onClick={runWorkOrderLookup} disabled={searching}>
                          {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                          Search
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 rounded-md border p-3">
                        <div className="grid grid-cols-2 gap-2">
                          <Input placeholder="Client name" value={detailQuery.contact} onChange={(e) => setDetailQuery((q) => ({ ...q, contact: e.target.value }))} />
                          <Input placeholder="Company" value={detailQuery.company} onChange={(e) => setDetailQuery((q) => ({ ...q, company: e.target.value }))} />
                        </div>
                        <Input placeholder="Address contains…" value={detailQuery.address} onChange={(e) => setDetailQuery((q) => ({ ...q, address: e.target.value }))} />
                        <div className="flex items-center gap-2">
                          <label className="text-muted-foreground flex flex-1 flex-col gap-0.5 text-[11px]">
                            Due from
                            <Input type="date" value={detailQuery.dateFrom} onChange={(e) => setDetailQuery((q) => ({ ...q, dateFrom: e.target.value }))} />
                          </label>
                          <label className="text-muted-foreground flex flex-1 flex-col gap-0.5 text-[11px]">
                            Due to
                            <Input type="date" value={detailQuery.dateTo} onChange={(e) => setDetailQuery((q) => ({ ...q, dateTo: e.target.value }))} />
                          </label>
                        </div>
                        <Button variant="outline" onClick={runDetailSearch} disabled={searching} className="self-start">
                          {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                          Search work orders
                        </Button>
                      </div>
                    )}

                    {searchResults && searchResults.length > 0 && (
                      <div className="flex flex-col gap-1 rounded-md border p-2">
                        <span className="text-muted-foreground px-1 text-xs font-medium">
                          {searchResults.length} match{searchResults.length === 1 ? "" : "es"}
                          {searchScope === "recent" ? " (recent work orders)" : ""} — pick one
                        </span>
                        <div className="flex max-h-52 flex-col gap-0.5 overflow-y-auto">
                          {searchResults.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => r.name && selectWorkOrder(r.name, r.id)}
                              className="hover:bg-muted/60 flex flex-col rounded border px-2 py-1.5 text-left text-sm"
                            >
                              <span className="font-medium">
                                {r.name} {r.summary ? <span className="text-muted-foreground">— {r.summary}</span> : null}
                              </span>
                              <span className="text-muted-foreground text-[11px]">
                                {[r.contactName, r.companyName, r.address, r.dueDate ? `Due ${r.dueDate.slice(0, 10)}` : null]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {searchResults && searchResults.length === 0 && (
                      <div className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
                        No matching work orders. By-details search looks within recent work orders — try the work-order
                        number if you have it.
                      </div>
                    )}

                    {workOrder && (
                      <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
                        <div className="font-medium">
                          {workOrder.name} — {workOrder.summary}
                        </div>
                        {(workOrder.contact_name || workOrder.address) && (
                          <div className="text-muted-foreground text-xs">
                            {[workOrder.contact_name, workOrder.address].filter(Boolean).join(" · ")}
                          </div>
                        )}
                        {/* AMC coverage of this work, if its customer has an AMC (read-only). */}
                        <AmcWorkOrderNotice workOrderId={workOrder.id} />
                        <div className="mt-1 flex flex-col gap-1">
                          <span className="text-muted-foreground text-xs font-medium">Appointment</span>
                          <RadioGroup
                            value={appointmentChoice}
                            onValueChange={chooseAppointment}
                            className="gap-1"
                          >
                            {visibleAppointments.map((a) => {
                              const info = appointmentInfoById.get(a.id);
                              const lines = info?.lines ?? [];
                              const label = (
                                <Label
                                  htmlFor={`appointment-${a.id}`}
                                  className="hover:bg-muted/50 flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 font-normal"
                                >
                                  <RadioGroupItem id={`appointment-${a.id}`} value={a.id} className="mt-0.5" />
                                  <span className="flex min-w-0 flex-col gap-0.5">
                                    <span>
                                      Use existing appointment <b>{a.name}</b>
                                    </span>
                                    <span className="flex flex-wrap items-center gap-1.5">
                                      {info && (
                                        <Hint label={info.status ?? undefined}>
                                          <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium">
                                            <span className={`size-1.5 rounded-full ${APPOINTMENT_STATE_STYLES[info.state].dot}`} />
                                            <span className={APPOINTMENT_STATE_STYLES[info.state].text}>
                                              {APPOINTMENT_STATE_LABELS[info.state]}
                                            </span>
                                          </span>
                                        </Hint>
                                      )}
                                      {lines.length > 0 && (
                                        <span className="text-muted-foreground text-[11px]">
                                          covers {lines.map((l) => l.code).join(", ")}
                                        </span>
                                      )}
                                    </span>
                                  </span>
                                </Label>
                              );
                              // Hover tooltip: the covered service line items, with names.
                              if (lines.length > 0) {
                                return (
                                  <Tooltip key={a.id}>
                                    <TooltipTrigger asChild>{label}</TooltipTrigger>
                                    <TooltipContent side="right" className="max-w-xs">
                                      <span className="mb-1 block font-medium">Service lines covered</span>
                                      <span className="flex flex-col gap-0.5">
                                        {lines.map((l) => (
                                          <span key={l.code}>
                                            {l.code}
                                            {l.service ? ` — ${l.service}` : ""}
                                          </span>
                                        ))}
                                      </span>
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              }
                              return <span key={a.id}>{label}</span>;
                            })}
                            {hiddenCancelledCount > 0 && (
                              <span className="text-muted-foreground px-1 text-[11px]">
                                {hiddenCancelledCount}{" "}
                                {hiddenCannotComplete === 0
                                  ? "cancelled"
                                  : hiddenCannotComplete === hiddenCancelledCount
                                    ? "cannot-complete"
                                    : "cancelled or cannot-complete"}{" "}
                                appointment{hiddenCancelledCount > 1 ? "s" : ""} hidden —
                                their service lines are available to schedule below.
                              </span>
                            )}
                            <Label
                              htmlFor="appointment-new"
                              className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 font-normal"
                            >
                              <RadioGroupItem id="appointment-new" value={NEW_APPOINTMENT} />
                              <span>
                                Create a new appointment
                                <span className="text-muted-foreground"> — scheduled &amp; assigned when the day is approved</span>
                              </span>
                            </Label>
                          </RadioGroup>
                        </div>
                      </div>
                    )}
                    {!workOrder && !searchResults && !searching && (
                      <p className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-xs">
                        {searchMode === "number"
                          ? "Type the work order name (for example WO2330) and press Enter."
                          : "Search by client, company, address or due date."}
                      </p>
                    )}
                  </div>
                ) : mode === "amc" ? (
                  <div className="grid gap-3 text-sm">
                    <p>
                      Book a call out, an inspection or minor fix, or a handyman job on a contract. Choose the time and the crew here.
                    </p>
                    <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-xs">
                      <li>Emergency: a complete failure, attended within the SLA at any hour.</li>
                      <li>Non emergency: an inspection or a minor fix of up to 2 hours.</li>
                      <li>Handyman job: on the contract&apos;s free handyman hours; each technician is a team with a helper.</li>
                    </ul>
                    <p className="text-muted-foreground text-xs">
                      Whether it is covered or chargeable, and the allowance left, show before it is logged. It goes on the board as AMC work, is
                      never sent to Zoho FSM, and its history stays on the AMC call out.
                    </p>
                  </div>
                ) : (
                  <Input placeholder="For example: van service, team meeting, standby" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                )}
              </EntrySection>

              <EntrySection
                title={creatingNew ? "Appointment and time" : "When"}
                description={
                  mode === "fsm" && !creatingNew
                    ? "An existing appointment is rescheduled to this time and crew when the day is approved."
                    : `${dayLabel}, ${effectiveShift === "night" ? "night" : "morning"} shift.`
                }
              >
                <div className="flex flex-col gap-4">
                  {creatingNew && (
                    <div className="flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                      <div>
                        <span className="mb-1 block text-xs font-medium">Service lines to cover</span>
                        {linesLoading ? (
                          <div className="text-muted-foreground flex items-center gap-2 py-2 text-xs">
                            <Loader2 className="size-3.5 animate-spin" /> Loading service lines from FSM…
                          </div>
                        ) : selectableLines.length === 0 ? (
                          <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
                            Every service line already has an appointment in FSM
                            {coveringAppointmentNames.length > 0 && <> ({coveringAppointmentNames.join(", ")})</>}. In FSM
                            these may still be <b>unscheduled</b> (&ldquo;yet to be scheduled&rdquo;) — to put them on the
                            board, choose <b>&ldquo;Use existing appointment&rdquo;</b> above instead of creating a new one.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5 rounded-md border p-2">
                            {selectableLines.map((line) => (
                              <label key={line.id} className="hover:bg-muted/50 flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm">
                                <Checkbox checked={selectedLineIds.includes(line.id)} onCheckedChange={() => toggleLine(line.id)} className="mt-0.5" />
                                <span className="flex-1">
                                  <span className="font-medium">{line.name}</span>
                                  {line.serviceName && <span className="text-muted-foreground"> · {line.serviceName}</span>}
                                </span>
                              </label>
                            ))}
                            {woLines && woLines.serviceLineItems.some((l) => l.scheduled) && (
                              <span className="text-muted-foreground px-1 pt-1 text-[10px]">
                                Lines already on another appointment are hidden.
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-1">
                        <Label htmlFor="appointment-type" className="text-xs">
                          Appointment type
                        </Label>
                        <Select value={appointmentType} onValueChange={setAppointmentType}>
                          <SelectTrigger id="appointment-type" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {APPOINTMENT_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <span className="mb-1 block text-xs font-medium">Schedule type</span>
                        <div className="flex gap-2">
                          <Button size="sm" variant={scheduleType === "Time-bound" ? "default" : "outline"} onClick={() => setScheduleType("Time-bound")}>
                            Time-bound
                          </Button>
                          <Button size="sm" variant={scheduleType === "All Day" ? "default" : "outline"} onClick={() => setScheduleType("All Day")}>
                            All Day
                          </Button>
                        </div>
                        {isAllDay && (
                          <p className="text-muted-foreground mt-1.5 text-[11px]">
                            All-Day appointments have no set time — this will span the whole{" "}
                            {effectiveShift === "night" ? "Night" : "Morning"} row on the grid.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {!isAllDay && (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1 text-xs font-medium">
                        Start time
                        <TimeSelect value={startTime} onChange={setStartTime} aria-label="Start time" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium">
                        End time
                        <TimeSelect value={endTime} onChange={setEndTime} aria-label="End time" />
                      </label>
                    </div>
                  )}

                  {outsideUsualHours && (
                    <div className="text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        Part of this is outside the usual {shift === "night" ? "Night" : "Morning"} Shift hours (
                        {shiftWindowLabel(shift, config)}). That is fine: the grid widens to show all of it on this day.
                      </span>
                    </div>
                  )}
                </div>
              </EntrySection>
            </div>

            {/* Right: who goes. */}
            <EntrySection
              title="Technicians"
              description={chosenTechs.length ? `${chosenTechs.length} chosen${chosenTechs.length > 1 ? "; the first leads" : ""}` : "Choose at least one."}
              className="lg:self-start"
            >
              <div className="flex flex-col gap-3">
                {chosenTechs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {chosenTechs.map((t) => (
                      <span key={t.fsm_resource_id} className="bg-primary/10 inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs font-medium">
                        {t.display_name}
                        <button
                          type="button"
                          onClick={() => toggleTechnician(t.fsm_resource_id)}
                          className="hover:bg-primary/15 rounded-full p-0.5"
                          aria-label={`Remove ${t.display_name}`}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input placeholder="Search technicians" className="pl-9" value={technicianFilter} onChange={(e) => setTechnicianFilter(e.target.value)} />
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">Tags:</span>
                    <Button type="button" size="sm" variant={techTagFilters.length === 0 ? "secondary" : "ghost"} onClick={() => setTechTagFilters([])}>
                      All
                    </Button>
                    {tags.map((tag) => (
                      <Button
                        key={tag.id}
                        type="button"
                        size="sm"
                        variant={techTagFilters.includes(tag.id) ? "secondary" : "ghost"}
                        onClick={() => toggleTechTag(tag.id)}
                      >
                        {tag.name}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="flex max-h-[30vh] flex-col overflow-y-auto rounded-lg border p-1">
                  {filteredTechnicians.map((t) => {
                    const leave = onLeaveByTechnician.get(t.fsm_resource_id);
                    return (
                      <Hint key={t.fsm_resource_id} label={leave ? `On leave: ${leave.leave_type}` : undefined}>
                        <label
                          className={cn(
                            "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                            leave ? "cursor-not-allowed opacity-55" : "hover:bg-muted/50 cursor-pointer",
                            selectedTechnicianIds.includes(t.fsm_resource_id) && "bg-primary/5",
                          )}
                        >
                          <Checkbox
                            checked={selectedTechnicianIds.includes(t.fsm_resource_id)}
                            disabled={!!leave}
                            onCheckedChange={() => toggleTechnician(t.fsm_resource_id)}
                          />
                          <span className="min-w-0 flex-1 truncate">{t.display_name}</span>
                          {!leave && needsLogin(t.fsm_resource_id) && <NeedsLoginBadge email={accounts?.get(t.fsm_resource_id)?.email ?? null} />}
                          {leave && (
                            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                              On leave: {leave.leave_type}
                            </span>
                          )}
                        </label>
                      </Hint>
                    );
                  })}
                  {filteredTechnicians.length === 0 && (
                    <span className="text-muted-foreground px-1 py-2 text-xs">No technicians match.</span>
                  )}
                </div>
              </div>
            </EntrySection>
          </div>
        </div>

        {loginDialogs}
        <DialogFooter className="bg-muted/30 flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
            <CalendarClock className="size-4 shrink-0" />
            <span className="truncate">
              {summary.join(" · ")}
              {mode === "amc" ? (accounts === null ? " · checking logins…" : " · done in the YFI app") : ""}
            </span>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || makingLogin}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || makingLogin}>
              {(saving || makingLogin) && <Loader2 className="size-4 animate-spin" />}
              {mode === "amc" ? (
                <>
                  Next: AMC details
                  <ArrowRight className="size-4" />
                </>
              ) : (
                "Add to draft"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A titled card in the dialog. */
function EntrySection({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("bg-card min-w-0 rounded-xl border", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="text-muted-foreground mt-0.5 text-xs">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
