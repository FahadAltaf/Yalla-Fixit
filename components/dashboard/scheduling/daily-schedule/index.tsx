"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import {
  scheduleService,
  leaveService,
  tagsService,
  rolesService,
  serviceTypesService,
  type ScheduleEntry,
  type ScheduleVersion,
  type SchedulingAccess,
  type SchedulingConfig,
  type ShiftType,
  type TechnicianReference,
} from "@/modules/scheduling";
import type { LeaveRecord, TechnicianTag, TechnicianRole, TechnicianServiceType } from "@/types/types";
import { orderTechnicians, computeDriverIds, type SortMode } from "./technician-order";
import { exportSchedulePdf, type PdfSection } from "@/lib/scheduling/export-pdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatusBadge from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Clock,
  Eraser,
  Eye,
  Layers,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  SlidersHorizontal,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import SchedulingNav from "../scheduling-nav";
import AddEntryDialog from "./add-entry-dialog";
import SubmitDialog from "./submit-dialog";
import EntryDetailDialog from "./entry-detail-dialog";
import RejectDialog from "./reject-dialog";
import HistoryDialog from "./history-dialog";
import { formatTimeAmPm } from "./time-select";

type Props = {
  technicians: TechnicianReference[];
};

// Local-date helpers. Using toISOString() here would shift the date by the
// UTC offset (Gulf Standard Time is +4), which made the "next day" button
// appear stuck — so we build/read the YYYY-MM-DD string from local parts.
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysIso(dateStr: string, delta: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function shiftToMinutes(hhmmss: string) {
  const [h, m] = hhmmss.split(":").map(Number);
  return h * 60 + m;
}

function timeOfDayMinutes(iso: string) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function minutesToHhmm(minutes: number) {
  // A slot that ends exactly at midnight is expressed as 23:59 rather than
  // wrapping to 00:00, which would read as an end before its own start.
  const clamped = minutes >= 1440 ? 1439 : minutes;
  const wrapped = ((clamped % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function formatHourLabel(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

function formatRange(startMin: number, endMin: number) {
  return `${formatTimeAmPm(minutesToHhmm(startMin))} – ${formatTimeAmPm(minutesToHhmm(endMin))}`;
}

// A leave record overlaps the selected day if it touches any moment of it.
function leaveOverlapsDate(record: LeaveRecord, dateStr: string) {
  if (record.status !== "active") return false;
  const dayStart = new Date(`${dateStr}T00:00:00`).getTime();
  const dayEnd = new Date(`${dateStr}T23:59:59.999`).getTime();
  return new Date(record.start_at).getTime() <= dayEnd && new Date(record.end_at).getTime() >= dayStart;
}

function entryOverlapsLeave(entry: ScheduleEntry, record: LeaveRecord) {
  return (
    new Date(entry.start_at).getTime() < new Date(record.end_at).getTime() &&
    new Date(entry.end_at).getTime() > new Date(record.start_at).getTime()
  );
}

// Grid label: the FSM display names (WO2361 / AP1043), never the raw
// record ids — YFI flagged the ids as unreadable on the schedule table.
export function entryLabel(entry: ScheduleEntry) {
  if (entry.entry_type === "free_text") return entry.title || "Untitled";
  const wo = entry.fsm_work_order_name || entry.fsm_work_order_id || "Work Order";
  const ap =
    entry.fsm_appointment_name ||
    (entry.fsm_appointment_id ? "Appointment" : "Pending appointment");
  return `${wo} · ${ap}`;
}

// Turns FSM sync failures into a specific, readable line: which appointment
// failed and Zoho FSM's actual reason — so the scheduler can see the cause,
// not just a count.
function describeSyncFailures(
  results: Array<{ status: string; error?: string; label?: string }>,
  max = 3,
): string {
  const failed = results.filter((r) => r.status === "failed");
  if (failed.length === 0) return "";
  const shown = failed
    .slice(0, max)
    .map((r) => `${r.label || "An entry"} — ${r.error || "Zoho FSM rejected the change"}`);
  const more = failed.length > max ? ` (+${failed.length - max} more)` : "";
  return shown.join("; ") + more;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  draft_revision: "Draft Revision",
  pending_approval: "Pending Approval",
  rejected: "Rejected",
  approved_syncing: "Approving...",
  published: "Published",
  sync_failed: "Sync Failed",
  partially_synced: "Partially Synced",
  published_fsm_changed: "Published",
};

// Sub-100% steps let a whole shift be seen at once (YFI v1.5); 100% is the
// default and the neutral reference.
const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];
const ZOOM_DEFAULT_INDEX = ZOOM_STEPS.indexOf(1);
const ZOOM_STORAGE_KEY = "yfi.scheduling.zoom";

// E3: which row fields are shown. Default = the "simple" view (name + address).
type FieldVis = { tags: boolean; roles: boolean; ids: boolean; address: boolean };
const FIELD_DEFAULT: FieldVis = { tags: false, roles: false, ids: false, address: true };
const FIELD_STORAGE_KEY = "yfi.scheduling.fields";
const FILTERS_STORAGE_KEY = "yfi.scheduling.filtersOpen";
const HIDDEN_TECH_STORAGE_KEY = "yfi.scheduling.hiddenTechs";
type ExportShift = "both" | "day" | "night";

export default function DailyScheduleDashboard({ technicians }: Props) {
  const [date, setDate] = useState(todayIso());
  const [config, setConfig] = useState<SchedulingConfig | null>(null);
  const [access, setAccess] = useState<SchedulingAccess | null>(null);
  const [version, setVersion] = useState<ScheduleVersion | null>(null);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [dailyScheduleId, setDailyScheduleId] = useState<string | null>(null);
  const [tags, setTags] = useState<TechnicianTag[]>([]);
  const [roles, setRoles] = useState<TechnicianRole[]>([]);
  const [services, setServices] = useState<TechnicianServiceType[]>([]);
  const [assignments, setAssignments] = useState<Record<string, TechnicianTag[]>>({});
  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [roleFilters, setRoleFilters] = useState<string[]>([]);
  const [serviceFilters, setServiceFilters] = useState<string[]>([]);
  const [inverseFilter, setInverseFilter] = useState(false);
  const [hideOnLeave, setHideOnLeave] = useState(false);
  const [onlyUnscheduled, setOnlyUnscheduled] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [zoomIndex, setZoomIndex] = useState(ZOOM_DEFAULT_INDEX);
  const [fieldVis, setFieldVis] = useState<FieldVis>(FIELD_DEFAULT);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [hiddenTechIds, setHiddenTechIds] = useState<Set<string>>(new Set());

  const [addEntryFor, setAddEntryFor] = useState<{
    shift: ShiftType;
    technicianFsmId?: string;
    startTime?: string;
    endTime?: string;
  } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ScheduleEntry | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    scheduleService.getConfig().then(setConfig).catch(() => toast.error("Failed to load shift configuration"));
    scheduleService.getMe().then(setAccess).catch(() => toast.error("Failed to load your scheduling access"));
    Promise.all([
      tagsService.listTags(),
      tagsService.listAssignmentsByTechnician(),
      rolesService.list(),
      serviceTypesService.list(),
    ])
      .then(([t, a, r, s]) => {
        setTags(t);
        setAssignments(a);
        setRoles(r);
        setServices(s);
      })
      .catch(() => toast.error("Failed to load technician attributes"));

    const stored = Number(window.localStorage.getItem(ZOOM_STORAGE_KEY));
    if (Number.isInteger(stored) && stored >= 0 && stored < ZOOM_STEPS.length) setZoomIndex(stored);

    try {
      const f = JSON.parse(window.localStorage.getItem(FIELD_STORAGE_KEY) || "null");
      if (f && typeof f === "object") setFieldVis({ ...FIELD_DEFAULT, ...f });
    } catch {
      /* keep defaults */
    }
    if (window.localStorage.getItem(FILTERS_STORAGE_KEY) === "closed") setFiltersOpen(false);
    try {
      const h = JSON.parse(window.localStorage.getItem(HIDDEN_TECH_STORAGE_KEY) || "[]");
      if (Array.isArray(h)) setHiddenTechIds(new Set(h));
    } catch {
      /* none hidden */
    }
  }, []);

  const toggleHiddenTech = (id: string) => {
    setHiddenTechIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      window.localStorage.setItem(HIDDEN_TECH_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };
  // S1: bulk show/hide (Select all / Deselect all) for a shift's technicians.
  const setTechsHidden = (ids: string[], hidden: boolean) => {
    setHiddenTechIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (hidden ? next.add(id) : next.delete(id)));
      window.localStorage.setItem(HIDDEN_TECH_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const setField = (key: keyof FieldVis, value: boolean) => {
    setFieldVis((prev) => {
      const next = { ...prev, [key]: value };
      window.localStorage.setItem(FIELD_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };
  const toggleFilters = () => {
    setFiltersOpen((prev) => {
      window.localStorage.setItem(FILTERS_STORAGE_KEY, prev ? "closed" : "open");
      return !prev;
    });
  };

  // `reset` is used when the operating date changes: the previous day's
  // version and entries must not linger, or a "Rejected"/"Published" badge
  // from yesterday reads as though it belongs to the new date (D-04).
  const loadDay = useCallback(async (targetDate: string, options?: { reset?: boolean }) => {
    setLoading(true);
    if (options?.reset) {
      setVersion(null);
      setEntries([]);
      setDailyScheduleId(null);
    }
    try {
      const [result, leave] = await Promise.all([
        scheduleService.getDay(targetDate),
        leaveService.listLeave({ status: "active" }),
      ]);
      setVersion(result.version);
      setEntries(result.entries);
      setDailyScheduleId(result.dailySchedule?.id ?? null);
      setLeaveRecords(leave);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDay(date, { reset: true });
  }, [date, loadDay]);

  const changeZoom = (delta: number) => {
    setZoomIndex((prev) => {
      const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, prev + delta));
      window.localStorage.setItem(ZOOM_STORAGE_KEY, String(next));
      return next;
    });
  };

  const zoom = ZOOM_STEPS[zoomIndex];

  const shiftBounds = useMemo(() => {
    if (!config) return null;
    return {
      night: { start: shiftToMinutes(config.night_shift_start), end: shiftToMinutes(config.night_shift_end) },
      day: { start: shiftToMinutes(config.day_shift_start), end: shiftToMinutes(config.day_shift_end) },
    };
  }, [config]);

  // Leave affecting the currently-selected date, keyed by technician.
  const leaveByTechnician = useMemo(() => {
    const map = new Map<string, LeaveRecord>();
    leaveRecords.forEach((record) => {
      if (leaveOverlapsDate(record, date)) map.set(record.technician_fsm_id, record);
    });
    return map;
  }, [leaveRecords, date]);

  const entriesByTechnician = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    entries.forEach((entry) => {
      (entry.schedule_entry_assignments ?? []).forEach((a) => {
        const list = map.get(a.technician_fsm_id) ?? [];
        list.push(entry);
        map.set(a.technician_fsm_id, list);
      });
    });
    return map;
  }, [entries]);

  const driverIds = useMemo(() => computeDriverIds(technicians), [technicians]);

  const anyCategoryFilter = tagFilters.length > 0 || roleFilters.length > 0 || serviceFilters.length > 0;

  const visibleTechnicians = useMemo(() => {
    let list = technicians.filter((t) => t.is_active);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.display_name.toLowerCase().includes(q) ||
          entries.some(
            (e) =>
              e.schedule_entry_assignments?.some((a) => a.technician_fsm_id === t.fsm_resource_id) &&
              [e.title, e.fsm_work_order_name, e.fsm_appointment_name, e.client_name, e.address]
                .filter(Boolean)
                .some((v) => v!.toLowerCase().includes(q)),
          ),
      );
    }

    // Role / Service / Tag filters (#8). A technician "matches" when they pass
    // every active category (OR within a category). The inverse toggle (#1)
    // flips it to show everyone who does NOT match.
    if (anyCategoryFilter) {
      const matches = (t: TechnicianReference) => {
        const roleOk = roleFilters.length === 0 || (t.role_id ? roleFilters.includes(t.role_id) : false);
        const serviceOk =
          serviceFilters.length === 0 || (t.service_type_id ? serviceFilters.includes(t.service_type_id) : false);
        const tagOk =
          tagFilters.length === 0 ||
          (assignments[t.fsm_resource_id] ?? []).some((tag) => tagFilters.includes(tag.id));
        return roleOk && serviceOk && tagOk;
      };
      list = list.filter((t) => matches(t) !== inverseFilter);
    }

    // Hide technicians on leave for this date (#7).
    if (hideOnLeave) list = list.filter((t) => !leaveByTechnician.has(t.fsm_resource_id));

    // Only technicians with no scheduled work this day (#6).
    if (onlyUnscheduled) list = list.filter((t) => (entriesByTechnician.get(t.fsm_resource_id) ?? []).length === 0);

    // S1: individually hidden technicians never appear on the board (or PDF).
    if (hiddenTechIds.size > 0) list = list.filter((t) => !hiddenTechIds.has(t.fsm_resource_id));

    return orderTechnicians(list, sortMode, roles, services);
  }, [
    technicians,
    search,
    entries,
    anyCategoryFilter,
    roleFilters,
    serviceFilters,
    tagFilters,
    inverseFilter,
    assignments,
    hideOnLeave,
    leaveByTechnician,
    onlyUnscheduled,
    entriesByTechnician,
    hiddenTechIds,
    sortMode,
    roles,
    services,
  ]);

  const isEditable = version?.status === "draft" || version?.status === "draft_revision";

  const toggleTagFilter = (tagId: string) => {
    setTagFilters((prev) => (prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]));
  };
  const toggleRoleFilter = (id: string) =>
    setRoleFilters((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleServiceFilter = (id: string) =>
    setServiceFilters((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // "Return to the default view" (#14): clear every filter and sort.
  const resetView = () => {
    setSearch("");
    setTagFilters([]);
    setRoleFilters([]);
    setServiceFilters([]);
    setInverseFilter(false);
    setHideOnLeave(false);
    setOnlyUnscheduled(false);
    setSortMode("default");
  };
  const viewCustomised =
    search.trim() !== "" ||
    anyCategoryFilter ||
    inverseFilter ||
    hideOnLeave ||
    onlyUnscheduled ||
    sortMode !== "default";

  const handleRefresh = async () => {
    try {
      // Reconcile still runs (it refreshes snapshots and flags genuine
      // external edits), but we don't announce "updated in FSM" -- Zoho's
      // automation bumps every appointment, so that message was just noise.
      await scheduleService.reconcile();
    } catch {
      // Non-fatal: still reload the local view even if reconciliation fails.
    }
    loadDay(date);
  };

  // E1: submitting opens a dialog to choose an approver or publish now.
  const handleSubmitted = () => {
    setSubmitOpen(false);
    loadDay(date);
  };

  const handleApprove = async () => {
    if (!version) return;
    setSubmitting(true);
    try {
      const { version: updated, results } = await scheduleService.approve(version.id);
      setVersion(updated);
      const failed = results.filter((r) => r.status === "failed").length;
      if (failed > 0) {
        toast.warning(
          `Approved, but ${failed} entr${failed === 1 ? "y" : "ies"} failed to sync: ${describeSyncFailures(results)}`,
          { duration: 12000 },
        );
      } else {
        toast.success("Schedule approved and published to FSM");
      }
      loadDay(date);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetrySync = async () => {
    if (!version) return;
    setSubmitting(true);
    try {
      const { version: updated, results } = await scheduleService.retrySync(version.id);
      setVersion(updated);
      const failed = results.filter((r) => r.status === "failed").length;
      if (failed > 0)
        toast.warning(
          `${failed} entr${failed === 1 ? "y" : "ies"} still failing: ${describeSyncFailures(results)}`,
          { duration: 12000 },
        );
      else toast.success("All entries synced to Zoho FSM");
      loadDay(date);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to retry sync");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async (reason: string) => {
    if (!version) return;
    setSubmitting(true);
    try {
      const updated = await scheduleService.reject(version.id, reason);
      setVersion(updated);
      setRejectOpen(false);
      toast.success("Schedule rejected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reject");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = async () => {
    if (!version) return;
    setSubmitting(true);
    try {
      const { removed } = await scheduleService.clearDay(version.id);
      toast.success(removed === 0 ? "The schedule was already empty" : `Cleared ${removed} entr${removed === 1 ? "y" : "ies"}`);
      setClearOpen(false);
      loadDay(date);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to clear the schedule");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async () => {
    if (!version) return;
    setSubmitting(true);
    try {
      const updated = await scheduleService.reopen(version.id);
      setVersion(updated);
      toast.success("Reopened for editing — make your changes and submit again");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reopen");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateRevision = async () => {
    if (!dailyScheduleId) return;
    setSubmitting(true);
    try {
      const revision = await scheduleService.createRevision(dailyScheduleId);
      setVersion(revision);
      toast.success("Draft revision created -- add new work, then submit for approval");
      loadDay(date);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create revision");
    } finally {
      setSubmitting(false);
    }
  };

  // E4: build a real, sheet-style PDF (not a webpage screenshot) from the
  // currently visible technicians and their appointments, honouring the
  // filters, field choices, and hidden technicians, then download it.
  const handleExport = (which: ExportShift) => {
    if (!shiftBounds) return;
    const buildSection = (
      entryShift: ShiftType,
      techShiftKey: "night" | "morning",
      title: string,
    ): PdfSection => {
      const techs = visibleTechnicians.filter((t) => t.shift === techShiftKey || !t.shift);
      const rows = techs.map((t) => {
        const appointments = (entriesByTechnician.get(t.fsm_resource_id) ?? [])
          .filter((e) => e.shift === entryShift)
          .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
          .map((e) => ({
            time:
              e.fsm_schedule_type === "All Day"
                ? "All Day"
                : formatRange(timeOfDayMinutes(e.start_at), timeOfDayMinutes(e.end_at)),
            label: entryLabel(e),
            address: e.address || e.client_name || "",
            freeText: e.entry_type === "free_text",
          }));
        return {
          technician: t.display_name,
          sub: [t.role_name, t.service_type_name].filter(Boolean).join(" · "),
          tags: (assignments[t.fsm_resource_id] ?? []).map((x) => x.name).join(", "),
          appointments,
        };
      });
      return { title, rows };
    };

    const sections: PdfSection[] = [];
    if (which === "both" || which === "night")
      sections.push(
        buildSection("night", "night", `Night Shift · ${formatRange(shiftBounds.night.start, shiftBounds.night.end)}`),
      );
    if (which === "both" || which === "day")
      sections.push(
        buildSection("day", "morning", `Morning Shift · ${formatRange(shiftBounds.day.start, shiftBounds.day.end)}`),
      );

    exportSchedulePdf({ date, sections, fieldVis });
    setExportOpen(false);
  };

  return (
    <>
      <div className="print:hidden">
        <SchedulingNav />
      </div>
      <div className="flex flex-col gap-4 p-4 md:p-6 print:gap-2 print:p-0">
        <div className="print:hidden">
          <p className="eyebrow">Scheduling</p>
          <h1 className="mt-1.5 text-3xl">Daily schedule</h1>
          <p className="text-muted-foreground mt-1 text-[0.9375rem]">
            Day and night shifts, synced with Zoho FSM and versioned through approval.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" onClick={() => setDate(addDaysIso(date, -1))} title="Previous day">
              <ChevronLeft className="size-4" />
            </Button>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
            <Button size="icon" variant="outline" onClick={() => setDate(addDaysIso(date, 1))} title="Next day">
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDate(todayIso())}>
              Today
            </Button>
            <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh from FSM">
              <RefreshCw className="size-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {/* Zoom widens the time track so entry text stops being clipped. */}
            <div className="flex items-center gap-0.5 rounded-md border px-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => changeZoom(-1)}
                disabled={zoomIndex === 0}
                title="Zoom out"
              >
                <ZoomOut className="size-4" />
              </Button>
              <span className="text-muted-foreground w-11 text-center text-xs tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => changeZoom(1)}
                disabled={zoomIndex === ZOOM_STEPS.length - 1}
                title="Zoom in"
              >
                <ZoomIn className="size-4" />
              </Button>
            </div>
            {/* E3: eye menu — show/hide row fields on the board (and in PDF). */}
            <div className="relative">
              <Button variant="outline" size="sm" onClick={() => setFieldMenuOpen((v) => !v)} title="Show / hide fields">
                <Eye className="size-4" />
                Fields
              </Button>
              {fieldMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setFieldMenuOpen(false)} />
                  <div className="bg-popover absolute right-0 z-50 mt-1 w-52 rounded-md border p-2 shadow-md">
                    <p className="text-muted-foreground mb-1 px-1 text-[11px]">Show on each row</p>
                    {([
                      ["address", "Address"],
                      ["ids", "Work order / appointment IDs"],
                      ["tags", "Technician tags"],
                      ["roles", "Role & service"],
                    ] as [keyof FieldVis, string][]).map(([key, label]) => (
                      <label key={key} className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm">
                        <input type="checkbox" checked={fieldVis[key]} onChange={(e) => setField(key, e.target.checked)} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* E4: export the current view as a PDF. */}
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)} title="Export as PDF">
              <Printer className="size-4" />
              Export
            </Button>

            {version && <StatusBadge status={STATUS_LABELS[version.status] ?? version.status} />}
            {version && <span className="text-muted-foreground text-xs">v{version.version_number}</span>}
            <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
              History
            </Button>
          </div>
        </div>

        {/* E5: the whole search + filter area collapses; the action buttons
            below stay put. */}
        <div className="print:hidden">
          <button
            type="button"
            onClick={toggleFilters}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-medium"
          >
            <SlidersHorizontal className="size-3.5" />
            Search &amp; filters
            {filtersOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
        <div className={`flex flex-col gap-2 print:hidden ${filtersOpen ? "" : "hidden"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search technician, WO, AP, client, address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />

            {/* Inverse toggle (#1): flips the role/service/tag filters to show
                everyone who does NOT match. */}
            <Button
              size="sm"
              variant={inverseFilter ? "default" : "outline"}
              onClick={() => setInverseFilter((v) => !v)}
              disabled={!anyCategoryFilter}
              title="Show technicians who do NOT match the selected filters"
            >
              {inverseFilter ? "Excluding matches" : "Invert filter"}
            </Button>

            <Button
              size="sm"
              variant={hideOnLeave ? "default" : "outline"}
              onClick={() => setHideOnLeave((v) => !v)}
            >
              Hide on-leave
            </Button>
            <Button
              size="sm"
              variant={onlyUnscheduled ? "default" : "outline"}
              onClick={() => setOnlyUnscheduled((v) => !v)}
              title="Show only technicians with no scheduled work today"
            >
              No scheduled work
            </Button>

            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs">Sort:</span>
              {(["default", "name", "role", "service"] as SortMode[]).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={sortMode === m ? "default" : "outline"}
                  onClick={() => setSortMode(m)}
                >
                  {m === "default" ? "Default" : m[0].toUpperCase() + m.slice(1)}
                </Button>
              ))}
              {viewCustomised && (
                <Button size="sm" variant="ghost" onClick={resetView} title="Return to the default view">
                  Reset view
                </Button>
              )}
            </div>
          </div>

          {/* Filter chips: Role, Service, Tag (#8). */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {roles.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground text-xs">Role:</span>
                {roles.map((r) => (
                  <Button
                    key={r.id}
                    size="sm"
                    variant={roleFilters.includes(r.id) ? "default" : "outline"}
                    onClick={() => toggleRoleFilter(r.id)}
                  >
                    {r.name}
                  </Button>
                ))}
              </div>
            )}
            {services.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground text-xs">Service:</span>
                {services.map((s) => (
                  <Button
                    key={s.id}
                    size="sm"
                    variant={serviceFilters.includes(s.id) ? "default" : "outline"}
                    onClick={() => toggleServiceFilter(s.id)}
                  >
                    {s.name}
                  </Button>
                ))}
              </div>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground text-xs">Tags:</span>
                {tags.map((tag) => (
                  <Button
                    key={tag.id}
                    size="sm"
                    variant={tagFilters.includes(tag.id) ? "default" : "outline"}
                    onClick={() => toggleTagFilter(tag.id)}
                  >
                    {tag.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Primary actions sit at the top (YFI v1.5) so Approve / Reject are
            reachable without scrolling past the whole schedule. */}
        <div className="flex flex-wrap items-center gap-2 border-b pb-3 print:hidden">
          {isEditable && (
            <>
              <Button variant="outline" onClick={() => setAddEntryFor({ shift: "day" })}>
                <Plus className="size-4" />
                Add Entry
              </Button>
              <Button
                variant="outline"
                onClick={() => setClearOpen(true)}
                disabled={submitting || entries.length === 0}
              >
                <Eraser className="size-4" />
                Clear Schedule
              </Button>
              <Button onClick={() => setSubmitOpen(true)} disabled={submitting || entries.length === 0}>
                Submit Whole Day
              </Button>
            </>
          )}
          {version?.status === "pending_approval" && access?.isApprover && (
            <>
              <Button onClick={handleApprove} disabled={submitting}>
                Approve
              </Button>
              <Button variant="destructive" onClick={() => setRejectOpen(true)} disabled={submitting}>
                Reject
              </Button>
            </>
          )}
          {version?.status === "pending_approval" && !access?.isApprover && (
            <span className="text-muted-foreground text-sm">Awaiting approval from the schedule approver.</span>
          )}
          {version?.status === "rejected" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-destructive text-sm">
                Rejected{version.decision_comment ? `: ${version.decision_comment}` : ""}.
              </span>
              <Button variant="outline" onClick={handleReopen} disabled={submitting}>
                Reopen for Editing
              </Button>
            </div>
          )}
          {(version?.status === "published" ||
            version?.status === "published_fsm_changed" ||
            version?.status === "partially_synced") && (
            <Button variant="outline" onClick={handleCreateRevision} disabled={submitting}>
              Add Work (Create Revision)
            </Button>
          )}
          {(version?.status === "sync_failed" || version?.status === "partially_synced") && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={version.status === "sync_failed" ? "text-destructive text-sm" : "text-warning text-sm"}>
                {version.status === "sync_failed"
                  ? "Sync failed — no appointments were written."
                  : "Partially synced — some appointments failed."}{" "}
                Open a red entry to see why.
              </span>
              {access?.isApprover && (
                <Button variant="outline" onClick={handleRetrySync} disabled={submitting}>
                  <RefreshCw className="size-4" />
                  Retry Failed Sync
                </Button>
              )}
            </div>
          )}
        </div>

        {loading || !shiftBounds ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <ShiftSection
              title="Night Shift"
              shift="night"
              bounds={shiftBounds.night}
              zoom={zoom}
              fieldVis={fieldVis}
              // #10: only night-shift technicians (plus those with no shift set).
              technicians={visibleTechnicians.filter((t) => t.shift === "night" || !t.shift)}
              pickTechnicians={technicians.filter((t) => t.is_active && (t.shift === "night" || !t.shift))}
              hiddenTechIds={hiddenTechIds}
              onToggleHidden={toggleHiddenTech}
              onSetTechsHidden={setTechsHidden}
              driverIds={driverIds}
              tagsByTechnician={assignments}
              entriesByTechnician={entriesByTechnician}
              leaveByTechnician={leaveByTechnician}
              isEditable={isEditable}
              onAddEntry={(technicianFsmId, slot) =>
                setAddEntryFor({ shift: "night", technicianFsmId, ...slot })
              }
              onEntryClick={setSelectedEntry}
              onEntryMoved={() => loadDay(date)}
            />
            <ShiftSection
              title="Morning Shift"
              shift="day"
              bounds={shiftBounds.day}
              zoom={zoom}
              fieldVis={fieldVis}
              technicians={visibleTechnicians.filter((t) => t.shift === "morning" || !t.shift)}
              pickTechnicians={technicians.filter((t) => t.is_active && (t.shift === "morning" || !t.shift))}
              hiddenTechIds={hiddenTechIds}
              onToggleHidden={toggleHiddenTech}
              onSetTechsHidden={setTechsHidden}
              driverIds={driverIds}
              tagsByTechnician={assignments}
              entriesByTechnician={entriesByTechnician}
              leaveByTechnician={leaveByTechnician}
              isEditable={isEditable}
              onAddEntry={(technicianFsmId, slot) => setAddEntryFor({ shift: "day", technicianFsmId, ...slot })}
              onEntryClick={setSelectedEntry}
              onEntryMoved={() => loadDay(date)}
            />
          </>
        )}
      </div>

      {addEntryFor && version && config && (
        <AddEntryDialog
          scheduleVersionId={version.id}
          date={date}
          shift={addEntryFor.shift}
          config={config}
          defaultStartTime={addEntryFor.startTime}
          defaultEndTime={addEntryFor.endTime}
          defaultTechnicianFsmId={addEntryFor.technicianFsmId}
          technicians={technicians.filter((t) => t.is_active)}
          tags={tags}
          assignmentsByTechnician={assignments}
          leaveRecords={leaveRecords}
          onOpenChange={(open) => !open && setAddEntryFor(null)}
          onAdded={() => {
            setAddEntryFor(null);
            loadDay(date);
          }}
        />
      )}

      {selectedEntry && config && (
        <EntryDetailDialog
          entry={selectedEntry}
          isEditable={isEditable}
          versionStatus={version?.status ?? null}
          isApprover={Boolean(access?.isApprover)}
          config={config}
          technicians={technicians}
          leaveRecords={leaveRecords}
          scheduleVersionId={version?.id ?? null}
          onOpenChange={(open) => !open && setSelectedEntry(null)}
          onChanged={() => {
            setSelectedEntry(null);
            loadDay(date);
          }}
        />
      )}

      {exportOpen && (
        <Dialog open onOpenChange={(o) => !o && setExportOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Export as PDF</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground text-sm">
              Which shifts to include? A PDF is generated from your current filters, field choices, and visible
              technicians, then downloaded.
            </p>
            <div className="flex flex-col gap-2">
              {([
                ["both", "Both shifts"],
                ["day", "Morning shift only"],
                ["night", "Night shift only"],
              ] as [ExportShift, string][]).map(([val, label]) => (
                <Button
                  key={val}
                  variant="outline"
                  className="justify-start"
                  onClick={() => handleExport(val)}
                >
                  <Printer className="size-4" />
                  {label}
                </Button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {submitOpen && version && (
        <SubmitDialog
          scheduleVersionId={version.id}
          date={date}
          onOpenChange={(open) => !open && setSubmitOpen(false)}
          onSubmitted={handleSubmitted}
        />
      )}

      <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} onConfirm={handleReject} loading={submitting} />

      <ConfirmationAlertDialog
        isOpen={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear the whole day?"
        description={`This removes all ${entries.length} entr${entries.length === 1 ? "y" : "ies"} from this draft for ${date}. Nothing has been sent to FSM yet, so FSM is unaffected. This cannot be undone.`}
        confirmText="Clear schedule"
        variant="destructive"
        loading={submitting}
        onConfirm={handleClear}
      />

      {historyOpen && <HistoryDialog date={date} onOpenChange={setHistoryOpen} />}
    </>
  );
}

const TECH_COL_WIDTH = 208; // px — sticky first column, so it needs a fixed width

type HourCell = { start: number; end: number; leftPct: number; widthPct: number };

type SlotSelection = { startTime: string; endTime: string };

function ShiftSection({
  title,
  shift,
  bounds,
  zoom,
  fieldVis,
  technicians,
  pickTechnicians,
  hiddenTechIds,
  onToggleHidden,
  onSetTechsHidden,
  driverIds,
  tagsByTechnician,
  entriesByTechnician,
  leaveByTechnician,
  isEditable,
  onAddEntry,
  onEntryClick,
  onEntryMoved,
}: {
  title: string;
  shift: ShiftType;
  bounds: { start: number; end: number };
  zoom: number;
  fieldVis: FieldVis;
  technicians: TechnicianReference[];
  // Every active technician for this shift (incl. hidden) — the picker list.
  pickTechnicians: TechnicianReference[];
  hiddenTechIds: Set<string>;
  onToggleHidden: (id: string) => void;
  onSetTechsHidden: (ids: string[], hidden: boolean) => void;
  driverIds: Set<string>;
  tagsByTechnician: Record<string, TechnicianTag[]>;
  entriesByTechnician: Map<string, ScheduleEntry[]>;
  leaveByTechnician: Map<string, LeaveRecord>;
  isEditable: boolean;
  onAddEntry: (technicianFsmId: string, slot?: SlotSelection) => void;
  onEntryClick: (entry: ScheduleEntry) => void;
  onEntryMoved: () => void;
}) {
  const span = bounds.end - bounds.start || 1;

  // Drag-to-reschedule (Google-Calendar style): while a bar is being dragged
  // we hold its live snapped start here so it follows the pointer; on release
  // we push the new time to FSM-backed storage via updateEntry.
  const [drag, setDrag] = useState<{ id: string; newStartMin: number } | null>(null);

  // S1: per-shift show/hide picker, anchored to the button in the Technician
  // column header. Positioned as `fixed` (measured from the button) so the
  // scroll pane's overflow can't clip it.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerPos, setPickerPos] = useState<{ left: number; top: number } | null>(null);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);
  const hiddenHere = pickTechnicians.filter((t) => hiddenTechIds.has(t.fsm_resource_id)).length;
  const allIds = pickTechnicians.map((t) => t.fsm_resource_id);
  const openPicker = () => {
    const r = pickerBtnRef.current?.getBoundingClientRect();
    setPickerPos(r ? { left: r.left, top: r.bottom + 4 } : null);
    setPickerOpen((v) => !v);
  };

  // Explicit percentage widths (rather than flex-1) so the frozen header
  // cells and the body gridlines stay aligned even when the shift window
  // is not a whole number of hours.
  const hourCells: HourCell[] = useMemo(() => {
    const cells: HourCell[] = [];
    for (let m = Math.floor(bounds.start / 60) * 60; m < bounds.end; m += 60) {
      const start = Math.max(m, bounds.start);
      const end = Math.min(m + 60, bounds.end);
      cells.push({
        start,
        end,
        leftPct: ((start - bounds.start) / span) * 100,
        widthPct: ((end - start) / span) * 100,
      });
    }
    return cells;
  }, [bounds, span]);

  // Zoom above 100% stretches the time track horizontally and grows the
  // lanes; below 100% the track stays full-width but lanes get compact, so a
  // whole shift fits with less scrolling (YFI v1.5).
  const trackWidthPct = zoom < 1 ? 100 : 100 * zoom;
  // Give each hour column a comfortable minimum width so entry text and the
  // address line fit, scrolling horizontally when the shift is wider than the
  // pane (YFI: wider time columns). Scales with zoom.
  const MIN_HOUR_PX = 120;
  const trackMinPx = TECH_COL_WIDTH + hourCells.length * MIN_HOUR_PX * zoom;
  const laneHeight = Math.round((zoom < 1 ? 40 : 52) * (zoom < 1 ? zoom + 0.35 : 1 + (zoom - 1) * 0.3));

  // Assign each of a technician's entries to a vertical lane so overlapping
  // appointments stack under one another and are all visible (YFI v1.5 on
  // N-7), instead of one hiding another.
  const laneLayout = (rowEntries: ScheduleEntry[]) => {
    const sorted = [...rowEntries].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const e of sorted) {
      const s = new Date(e.start_at).getTime();
      const en = new Date(e.end_at).getTime();
      let lane = laneEnds.findIndex((end) => end <= s);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(en);
      } else {
        laneEnds[lane] = en;
      }
      laneOf.set(e.id, lane);
    }
    return { laneOf, laneCount: Math.max(1, laneEnds.length) };
  };

  // An entry whose window does not intersect this shift at all used to be
  // positioned past 100% and disappeared off the right edge (D-01). Now it
  // is clamped to the nearest edge and flagged instead.
  const placeEntry = (entry: ScheduleEntry) => {
    const startMin = timeOfDayMinutes(entry.start_at);
    let endMin = timeOfDayMinutes(entry.end_at);
    if (endMin <= startMin) endMin += 1440; // crosses midnight

    // All-Day appointments have no time — they span the whole shift row.
    if (entry.fsm_schedule_type === "All Day") {
      return { startMin, endMin, outside: false, allDay: true, leftPct: 0, widthPct: 100 };
    }

    const visibleStart = Math.max(startMin, bounds.start);
    const visibleEnd = Math.min(endMin, bounds.end);
    const outside = visibleEnd <= visibleStart;

    if (outside) {
      const pinRight = startMin >= bounds.end;
      return {
        startMin,
        endMin,
        outside,
        leftPct: pinRight ? 100 - 14 : 0,
        widthPct: 14,
      };
    }

    const leftPct = ((visibleStart - bounds.start) / span) * 100;
    const rawWidth = ((visibleEnd - visibleStart) / span) * 100;
    // Never let a bar run off the right edge, and keep a clickable minimum.
    const widthPct = Math.max(Math.min(rawWidth, 100 - leftPct), Math.min(6, 100 - leftPct));
    return { startMin, endMin, outside, leftPct, widthPct };
  };

  const outOfWindow = useMemo(() => {
    const seen = new Map<string, ScheduleEntry>();
    technicians.forEach((t) => {
      (entriesByTechnician.get(t.fsm_resource_id) ?? [])
        .filter((e) => e.shift === shift)
        .forEach((e) => {
          if (placeEntry(e).outside) seen.set(e.id, e);
        });
    });
    return [...seen.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technicians, entriesByTechnician, shift, bounds.start, bounds.end]);

  // Start a pointer-drag on an entry bar. A tiny movement is treated as a
  // click (opens the detail dialog); a real drag snaps the start to the
  // nearest 30 minutes, clamped inside the shift window, and on release
  // persists the new time (keeping the appointment's duration). Editable days
  // only; All-Day and out-of-window bars are not draggable but still clickable.
  const startDrag = (
    e: ReactPointerEvent,
    entry: ScheduleEntry,
    placed: { startMin: number; endMin: number; outside: boolean; allDay?: boolean },
  ) => {
    const canDrag = isEditable && !placed.allDay && !placed.outside;
    const container = (e.currentTarget as HTMLElement).parentElement;
    const trackPx = container?.clientWidth || 1;
    const minPerPx = span / trackPx;
    const startMin = placed.startMin;
    const durationMin = Math.max(1, placed.endMin - placed.startMin);
    const startX = e.clientX;
    let moved = false;
    let finalStartMin = startMin;

    const move = (ev: PointerEvent) => {
      if (!canDrag) return;
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      let ns = startMin + Math.round((dx * minPerPx) / 30) * 30;
      ns = Math.max(bounds.start, Math.min(ns, bounds.end - durationMin));
      finalStartMin = ns;
      setDrag({ id: entry.id, newStartMin: ns });
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!canDrag || !moved || finalStartMin === startMin) {
        onEntryClick(entry); // barely moved → treat as a click
        return;
      }
      const startDate = new Date(entry.start_at);
      const durationMs = new Date(entry.end_at).getTime() - startDate.getTime();
      const newStart = new Date(startDate);
      newStart.setHours(Math.floor(finalStartMin / 60), finalStartMin % 60, 0, 0);
      const newEnd = new Date(newStart.getTime() + durationMs);
      try {
        await scheduleService.updateEntry({
          id: entry.id,
          startAt: newStart.toISOString(),
          endAt: newEnd.toISOString(),
        });
        toast.success(`Moved to ${formatRange(finalStartMin, finalStartMin + durationMin)}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to move appointment");
      } finally {
        onEntryMoved(); // reload either way, so the bar snaps back on failure
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="rounded-md border">
      <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-t-md border-b px-3 py-1.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatRange(bounds.start, bounds.end)}
        </span>
      </div>

      {outOfWindow.length > 0 && (
        <div className="flex items-start gap-2 border-b bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {outOfWindow.length} entr{outOfWindow.length === 1 ? "y is" : "ies are"} outside the{" "}
            {title.toLowerCase()} window ({formatRange(bounds.start, bounds.end)}):{" "}
            {outOfWindow
              .map((e) => `${entryLabel(e)} at ${formatRange(timeOfDayMinutes(e.start_at), timeOfDayMinutes(e.end_at))}`)
              .join("; ")}
            . They are pinned to the edge below — open one to correct its time or move it to the other shift.
          </span>
        </div>
      )}

      {/* Scroll pane: the hour row is frozen at the top (Excel-style) and the
          technician column is frozen at the left, both inside this pane. */}
      <div className="max-h-[65vh] overflow-auto print:overflow-visible">
        <div style={{ width: `${trackWidthPct}%`, minWidth: `max(100%, ${Math.round(trackMinPx)}px)` }}>
          <div className="bg-background sticky top-0 z-40 flex border-b">
            <div
              className="bg-background sticky left-0 z-50 flex shrink-0 items-center justify-between gap-1 border-r px-2 py-1.5"
              style={{ width: TECH_COL_WIDTH }}
            >
              <span className="text-muted-foreground text-xs font-medium">Technician</span>
              {/* S1: show / hide this shift's technicians. */}
              <button
                ref={pickerBtnRef}
                type="button"
                onClick={openPicker}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium"
                title="Show / hide technicians"
              >
                <Users className="size-3.5" />
                {hiddenHere > 0 ? `${hiddenHere} hidden` : "All"}
              </button>
            </div>
            <div className="relative min-w-0 flex-1">
              {hourCells.map((cell) => (
                <div
                  key={cell.start}
                  className="text-muted-foreground absolute top-0 border-l px-1.5 py-1.5 text-[11px] tabular-nums"
                  style={{ left: `${cell.leftPct}%`, width: `${cell.widthPct}%` }}
                >
                  {formatHourLabel(cell.start)}
                </div>
              ))}
              {/* Spacer giving the absolutely-positioned labels their height. */}
              <div className="py-1.5 text-[11px] leading-none">&nbsp;</div>
            </div>
          </div>

          {technicians.length === 0 ? (
            <div className="text-muted-foreground p-4 text-center text-sm">
              No technicians match the current filters.
            </div>
          ) : (
            technicians.map((technician) => {
              const rowEntries = (entriesByTechnician.get(technician.fsm_resource_id) ?? []).filter(
                (e) => e.shift === shift,
              );
              const leave = leaveByTechnician.get(technician.fsm_resource_id);
              const techTags = tagsByTechnician[technician.fsm_resource_id] ?? [];

              // L-2: flag entries that overlap another appointment for the
              // same technician (allowed, but shown so it's never silent).
              const overlappingIds = new Set<string>();
              for (let i = 0; i < rowEntries.length; i += 1) {
                for (let j = i + 1; j < rowEntries.length; j += 1) {
                  const a = rowEntries[i];
                  const b = rowEntries[j];
                  if (
                    new Date(a.start_at).getTime() < new Date(b.end_at).getTime() &&
                    new Date(a.end_at).getTime() > new Date(b.start_at).getTime()
                  ) {
                    overlappingIds.add(a.id);
                    overlappingIds.add(b.id);
                  }
                }
              }

              // Stack overlapping entries in separate lanes so both are
              // visible; the row grows to fit the busiest moment (YFI v1.5).
              const { laneOf, laneCount } = laneLayout(rowEntries);
              const rowHeight = laneCount * laneHeight + 6;

              // Highlighting: DRIVERS get their own colour and head their
              // group; the technicians assigned to a driver sit underneath.
              const isDriver = driverIds.has(technician.fsm_resource_id);
              const roleLabel = technician.role_name;
              const rowTint = isDriver ? "bg-brand-50" : "";
              const nameColor = isDriver ? "font-semibold text-brand" : "";

              return (
                <div
                  key={technician.fsm_resource_id}
                  className={`flex items-stretch border-b last:border-0 ${rowTint}`}
                >
                  <div
                    className={`sticky left-0 z-30 flex shrink-0 flex-col justify-center gap-0.5 border-r px-2 py-2 ${
                      rowTint || "bg-background"
                    }`}
                    style={{ width: TECH_COL_WIDTH }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`truncate text-sm font-medium ${nameColor}`}>{technician.display_name}</span>
                      {isDriver && (
                        <span className="rounded bg-brand-100 px-1 py-0.5 text-[9px] font-semibold tracking-wide text-brand uppercase">
                          Driver
                        </span>
                      )}
                      {leave && (
                        <span className="rounded bg-warning/15 px-1 py-0.5 text-[10px] font-medium text-warning">
                          Unavailable
                        </span>
                      )}
                    </div>
                    {fieldVis.roles && (roleLabel || technician.service_type_name) && (
                      <span className="text-muted-foreground truncate text-[10px]">
                        {[roleLabel, technician.service_type_name].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {fieldVis.tags && techTags.length > 0 && (
                      <div className="flex flex-wrap gap-0.5">
                        {techTags.map((tag) => (
                          <Badge key={tag.id} variant="secondary" className="px-1 py-0 text-[10px]">
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div
                    className={`relative min-w-0 flex-1 ${leave ? "bg-warning/10" : ""}`}
                    style={{ height: rowHeight }}
                  >
                    {/* One clickable cell per hour: clicking 5–6 AM opens the
                        add dialog with 5:00 AM–6:00 AM already selected. */}
                    {hourCells.map((cell) => (
                      <button
                        key={cell.start}
                        type="button"
                        disabled={!isEditable || !!leave}
                        onClick={() =>
                          onAddEntry(technician.fsm_resource_id, {
                            startTime: minutesToHhmm(cell.start),
                            endTime: minutesToHhmm(cell.end),
                          })
                        }
                        className={`border-border/40 absolute top-0 bottom-0 border-l ${
                          isEditable && !leave ? "hover:bg-primary/5 cursor-pointer" : "cursor-default"
                        }`}
                        style={{ left: `${cell.leftPct}%`, width: `${cell.widthPct}%` }}
                        title={
                          leave
                            ? "On leave — unavailable"
                            : isEditable
                              ? `Add ${formatRange(cell.start, cell.end)} for ${technician.display_name}`
                              : undefined
                        }
                      />
                    ))}

                    {leave && (
                      <span className="pointer-events-none absolute top-1 left-2 z-10 text-[11px] font-medium text-warning">
                        On Leave: {leave.leave_type} ({new Date(leave.start_at).toLocaleDateString()}–
                        {new Date(leave.end_at).toLocaleDateString()})
                      </span>
                    )}

                    {rowEntries.map((entry) => {
                      const placed = placeEntry(entry);
                      const { startMin, endMin, outside, leftPct, widthPct } = placed;
                      const allDay = "allDay" in placed && placed.allDay;
                      const isFreeText = entry.entry_type === "free_text";
                      const conflictsWithLeave = leave ? entryOverlapsLeave(entry, leave) : false;
                      const label = entryLabel(entry);
                      const timeLabel = allDay ? "All Day" : formatRange(startMin, endMin);

                      const syncFailed = entry.sync_status === "failed";
                      const overlaps = overlappingIds.has(entry.id);

                      // N4: a failed entry is a solid red box (clearer than a
                      // red ring on a coloured box). Free-text stays slate,
                      // everything else is the brand colour.
                      const boxColour = syncFailed
                        ? "bg-danger text-white"
                        : isFreeText
                          ? "border border-dashed border-border bg-ink/40 text-white"
                          : "bg-primary text-white";

                      // Rings only mark real, actionable states: an out-of-window
                      // time, or a leave conflict. (The "changed in FSM" review
                      // flag was dropped — the board just stays synced.)
                      let ring = "";
                      if (outside) ring = "ring-2 ring-warning ring-offset-1";
                      else if (conflictsWithLeave) ring = "ring-2 ring-destructive";

                      const tooltip = syncFailed
                        ? `Sync failed: ${entry.last_sync_error || "Zoho FSM rejected the change"}. Open to retry.`
                        : allDay
                          ? `${label} — All Day`
                          : outside
                            ? `Outside the ${title} window — scheduled ${timeLabel}. Open to change the time or move it to the other shift.`
                            : conflictsWithLeave
                              ? `Conflict: ${technician.display_name} is on leave during this appointment (${timeLabel})`
                              : `${label} — ${timeLabel}${
                                    !isFreeText && entry.fsm_appointment_id && entry.sync_status === "synced"
                                      ? " · Synced to Zoho FSM"
                                      : entry.entry_type === "new_appointment" && !entry.fsm_appointment_id
                                        ? " · Will be created in FSM on approval"
                                        : ""
                                  }${overlaps ? " · Overlaps another appointment for this technician" : ""}`;

                      // N1: sync-status icon (replaces the changed-in-FSM flag).
                      const synced = !isFreeText && Boolean(entry.fsm_appointment_id) && entry.sync_status === "synced";
                      const pendingCreate =
                        entry.entry_type === "new_appointment" && !entry.fsm_appointment_id && !syncFailed;

                      // Vertical lane so overlapping entries stack (YFI v1.5).
                      // Small 2px inset keeps stacked bars apart while letting
                      // each bar fill most of its lane height (flexes with zoom).
                      const lane = laneOf.get(entry.id) ?? 0;
                      const laneTop = lane * laneHeight + 2;
                      const laneBoxHeight = laneHeight - 4;

                      // While this bar is being dragged, follow the snapped
                      // start; otherwise sit at its scheduled position.
                      const isDragging = drag?.id === entry.id;
                      const dispLeftPct = isDragging
                        ? ((drag!.newStartMin - bounds.start) / span) * 100
                        : leftPct;
                      const draggable = isEditable && !allDay && !outside;

                      // E3: which text lines to show, driven by the eye menu.
                      const addr = entry.address || entry.client_name || "";
                      let primaryText = label;
                      let secondaryText = "";
                      if (!isFreeText) {
                        const parts: string[] = [];
                        if (fieldVis.ids) parts.push(label);
                        if (fieldVis.address && addr) parts.push(addr);
                        if (allDay && parts.length < 2) parts.push("All Day");
                        if (parts.length === 0) parts.push(label);
                        primaryText = parts[0];
                        secondaryText = parts[1] ?? "";
                      }

                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onPointerDown={(e) => startDrag(e, entry, placed)}
                          // Pointer clicks are handled on pointer-up (so a drag
                          // isn't also a click); this only catches keyboard
                          // activation (Enter/Space give a click with detail 0).
                          onClick={(e) => {
                            if (e.detail === 0) onEntryClick(entry);
                          }}
                          className={`absolute flex flex-col justify-center gap-0.5 overflow-hidden rounded border-r border-black/15 px-2 text-left shadow-sm select-none ${boxColour} ${
                            isDragging ? "z-20 opacity-90 ring-2 ring-primary" : `z-10 ${ring}`
                          } ${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                          style={{
                            // Fill the full time span (flexes with zoom). The
                            // thin ring separates back-to-back bars without
                            // leaving a gap that reads as "not filled".
                            left: `${dispLeftPct}%`,
                            width: `${widthPct}%`,
                            top: laneTop,
                            height: laneBoxHeight,
                            touchAction: "none",
                          }}
                          title={tooltip}
                        >
                          <span className="flex items-center gap-1 truncate text-[11px] leading-tight font-medium">
                            {(outside || syncFailed) && <AlertTriangle className="size-3.5 shrink-0" />}
                            {synced && <CircleCheck className="size-3.5 shrink-0" aria-label="Synced to FSM" />}
                            {pendingCreate && (
                              <Clock className="size-3.5 shrink-0" aria-label="Pending creation in FSM" />
                            )}
                            {overlaps && <Layers className="size-3.5 shrink-0" aria-label="Overlaps another appointment" />}
                            <span className="truncate">{primaryText}</span>
                          </span>
                          {/* Second line follows the eye-menu field choices (E3);
                              the time is read off the top hour bar. */}
                          {secondaryText && (
                            <span className="truncate text-[10px] leading-tight opacity-85">{secondaryText}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* S1 picker — fixed position (measured off the header button) so the
          scroll pane can't clip it. Lists only this shift's technicians. */}
      {pickerOpen && pickerPos && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setPickerOpen(false)} />
          <div
            className="bg-popover fixed z-[61] w-64 rounded-md border p-2 shadow-md"
            style={{ left: pickerPos.left, top: pickerPos.top }}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-[11px]">{title} · show on the board</span>
            </div>
            <div className="mb-2 flex items-center gap-3">
              <button
                type="button"
                className="text-primary text-[11px] hover:underline"
                onClick={() => onSetTechsHidden(allIds, false)}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-primary text-[11px] hover:underline"
                onClick={() => onSetTechsHidden(allIds, true)}
              >
                Deselect all
              </button>
            </div>
            <Input
              placeholder="Filter…"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              className="mb-2 h-8"
            />
            <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {pickTechnicians
                .filter((t) => t.display_name.toLowerCase().includes(pickerSearch.toLowerCase()))
                .sort((a, b) => a.display_name.localeCompare(b.display_name))
                .map((t) => (
                  <label
                    key={t.fsm_resource_id}
                    className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenTechIds.has(t.fsm_resource_id)}
                      onChange={() => onToggleHidden(t.fsm_resource_id)}
                    />
                    <span className="truncate">{t.display_name}</span>
                  </label>
                ))}
              {pickTechnicians.length === 0 && (
                <span className="text-muted-foreground px-1 py-2 text-xs">No technicians in this shift.</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
