"use client";

import { useMemo, useState } from "react";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import TimeSelect, { formatTimeAmPm } from "./time-select";
import {
  resolveShift,
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
};

type Mode = "fsm" | "free_text";
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

  const creatingNew = mode === "fsm" && appointmentChoice === NEW_APPOINTMENT;
  const isAllDay = creatingNew && scheduleType === "All Day";

  // Time-bound entries derive their shift from the start time (D-01). All-Day
  // entries have no start time, so they stay on the shift being added to.
  const resolvedShift = useMemo(() => resolveShift(startTime, config), [startTime, config]);
  const effectiveShift: ShiftType = isAllDay ? shift : (resolvedShift ?? shift);
  const shiftMoved = !isAllDay && resolvedShift !== null && resolvedShift !== shift;

  const onLeaveByTechnician = useMemo(() => {
    const startAt = new Date(`${date}T${startTime}:00`).getTime();
    const endAt = new Date(`${date}T${endTime}:00`).getTime();
    const map = new Map<string, LeaveRecord>();
    leaveRecords.forEach((r) => {
      if (r.status !== "active") return;
      if (new Date(r.start_at).getTime() < endAt && new Date(r.end_at).getTime() > startAt) {
        map.set(r.technician_fsm_id, r);
      }
    });
    return map;
  }, [leaveRecords, date, startTime, endTime]);

  const loadWorkOrderLines = async (workOrderId: string) => {
    setLinesLoading(true);
    setWoLines(null);
    try {
      const lines = await fsmLookupService.getWorkOrderLines(workOrderId);
      setWoLines(lines);
      // Default: all UNSCHEDULED lines selected (YFI: all lines by default).
      setSelectedLineIds((lines?.serviceLineItems ?? []).filter((l) => !l.scheduled).map((l) => l.id));
    } catch {
      setWoLines(null);
    } finally {
      setLinesLoading(false);
    }
  };

  // Hydrate the full work order (with appointments) once one is picked, and
  // pre-select the obvious appointment choice.
  const selectWorkOrder = async (name: string) => {
    setSearching(true);
    setWorkOrder(null);
    setAppointmentChoice("");
    setWoLines(null);
    try {
      const result = await fsmLookupService.findWorkOrder(name.trim());
      if (!result) {
        toast.error("Couldn't load that work order from Zoho FSM");
        return;
      }
      setSearchResults(null);
      setWorkOrder(result);
      setTitle(result.summary || result.name);
      if (result.appointments.length === 1) setAppointmentChoice(result.appointments[0].id);
      else if (result.appointments.length === 0) {
        setAppointmentChoice(NEW_APPOINTMENT);
        loadWorkOrderLines(result.id);
      }
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
        await selectWorkOrder(results[0].name ?? woQuery.trim());
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
    if (value === NEW_APPOINTMENT && workOrder && !woLines) loadWorkOrderLines(workOrder.id);
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
    setSelectedTechnicianIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const toggleLine = (id: string) =>
    setSelectedLineIds((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));

  const selectableLines = (woLines?.serviceLineItems ?? []).filter((l) => !l.scheduled);

  const handleSave = async () => {
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
      const startAt = new Date(`${date}T${startHhmm}:00`).toISOString();
      const endAt = new Date(`${date}T${endHhmm}:00`).toISOString();

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
      toast.success(
        shiftMoved
          ? `Entry added to the ${effectiveShift === "night" ? "Night" : "Morning"} shift (based on its start time)`
          : "Entry added to the draft",
      );
      onAdded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add entry");
    } finally {
      setSaving(false);
    }
  };

  const colHeader = "text-muted-foreground text-xs font-semibold tracking-wide uppercase";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-2rem)] sm:max-w-3xl lg:max-w-6xl overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin]">
        <DialogHeader>
          <DialogTitle>Add Schedule Entry — {effectiveShift === "night" ? "Night" : "Morning"} Shift</DialogTitle>
          <DialogDescription>
            Attach an existing Zoho FSM work order or appointment, or drop a free-text note on the board.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button size="sm" variant={mode === "fsm" ? "default" : "outline"} onClick={() => setMode("fsm")}>
            Work Order / Appointment
          </Button>
          <Button size="sm" variant={mode === "free_text" ? "default" : "outline"} onClick={() => setMode("free_text")}>
            Free Text
          </Button>
        </div>

        {/* #12: one wide view in three columns — Work order | Appointment
            details | Technicians — so the whole entry is visible without
            scrolling. Stacks on narrow screens. */}
        <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr_0.95fr]">
          {/* Column 1 — work order (or the free-text title). */}
          <div className="flex min-w-0 flex-col gap-3">
            <span className={colHeader}>{mode === "fsm" ? "Work order" : "Text entry"}</span>

            {mode === "fsm" ? (
              <>
                <div className="flex gap-1.5">
                  <Button size="sm" variant={searchMode === "number" ? "secondary" : "ghost"} onClick={() => setSearchMode("number")}>
                    By WO Name
                  </Button>
                  <Button size="sm" variant={searchMode === "details" ? "secondary" : "ghost"} onClick={() => setSearchMode("details")}>
                    By client / details
                  </Button>
                </div>

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
                          onClick={() => r.name && selectWorkOrder(r.name)}
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
                    <div className="mt-1 flex flex-col gap-1">
                      <span className="text-muted-foreground text-xs font-medium">Appointment</span>
                      <RadioGroup
                        value={appointmentChoice}
                        onValueChange={chooseAppointment}
                        className="gap-1"
                      >
                        {workOrder.appointments.map((a) => (
                          <Label
                            key={a.id}
                            htmlFor={`appointment-${a.id}`}
                            className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 font-normal"
                          >
                            <RadioGroupItem id={`appointment-${a.id}`} value={a.id} />
                            <span>
                              Use existing appointment <b>{a.name}</b>
                            </span>
                          </Label>
                        ))}
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
              </>
            ) : (
              <Input placeholder="Title / description" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            )}
          </div>

          {/* Column 2 — appointment details (service lines / type / schedule) + time. */}
          <div className="flex min-w-0 flex-col gap-3">
            <span className={colHeader}>Appointment details</span>

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
                      Every service line on this work order already has an appointment. Use the existing appointment
                      instead.
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

            {mode === "fsm" && !creatingNew && (
              <p className="text-muted-foreground text-xs">
                Pick a work order and appointment on the left. An existing appointment is rescheduled to the time and
                technicians you set here.
              </p>
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

            {shiftMoved && (
              <div className="flex items-start gap-2 rounded-md border border-brand/40 bg-brand-50 px-3 py-2 text-xs text-brand">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {formatTimeAmPm(startTime)} falls in the{" "}
                  <b>{effectiveShift === "night" ? "Night" : "Morning"} shift</b> ({shiftWindowLabel(effectiveShift, config)}
                  ), so this entry will be placed there.
                </span>
              </div>
            )}

            {!isAllDay && resolvedShift === null && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {formatTimeAmPm(startTime)} is outside both shift windows (Night {shiftWindowLabel("night", config)},
                  Morning {shiftWindowLabel("day", config)}). It will be saved under the{" "}
                  {shift === "night" ? "Night" : "Morning"} shift and flagged on the grid as out of window.
                </span>
              </div>
            )}
          </div>

          {/* Column 3 — technicians. */}
          <div className="flex min-w-0 flex-col gap-2">
            <span className={colHeader}>
              Technicians{selectedTechnicianIds.length > 0 ? ` · ${selectedTechnicianIds.length} selected` : ""}
            </span>
            <Input
              placeholder="Filter technicians..."
              value={technicianFilter}
              onChange={(e) => setTechnicianFilter(e.target.value)}
            />
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
            <div className="flex max-h-[46vh] flex-col gap-0.5 overflow-y-auto rounded-md border p-2">
              {filteredTechnicians.map((t) => {
                const leave = onLeaveByTechnician.get(t.fsm_resource_id);
                return (
                  <label
                    key={t.fsm_resource_id}
                    className={`flex items-center gap-2 rounded px-1 py-1 text-sm ${
                      leave ? "cursor-not-allowed opacity-55" : "hover:bg-muted/50 cursor-pointer"
                    }`}
                    title={leave ? `On leave: ${leave.leave_type}` : undefined}
                  >
                    <Checkbox
                      checked={selectedTechnicianIds.includes(t.fsm_resource_id)}
                      disabled={!!leave}
                      onCheckedChange={() => toggleTechnician(t.fsm_resource_id)}
                    />
                    <span className="flex-1">{t.display_name}</span>
                    {leave && (
                      <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                        On leave: {leave.leave_type}
                      </span>
                    )}
                  </label>
                );
              })}
              {filteredTechnicians.length === 0 && (
                <span className="text-muted-foreground px-1 py-2 text-xs">No technicians match.</span>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Add to Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
