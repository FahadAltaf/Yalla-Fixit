"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  scheduleService,
  leaveService,
  tagsService,
  rolesService,
  serviceTypesService,
  techniciansService,
  type ScheduleEntry,
  type ScheduleVersion,
  type SchedulingAccess,
  type SchedulingConfig,
  type ShiftType,
  type TechnicianReference,
  type UpdateEntryInput,
  type FsmImportSummary,
} from "@/modules/scheduling";
import type { LeaveRecord, TechnicianTag, TechnicianRole, TechnicianServiceType } from "@/types/types";
import { orderTechnicians, type SortMode } from "./technician-order";
import { exportSchedulePdf, type PdfSection } from "@/lib/scheduling/export-pdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatusBadge from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Clock,
  Eraser,
  Eye,
  GripVertical,
  Layers,
  MoveHorizontal,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  SlidersHorizontal,
  UserRound,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/actions/utils";
import {
  APPOINTMENT_STATE_LABELS,
  APPOINTMENT_STATE_ORDER,
  APPOINTMENT_STATE_STYLES,
  HEADLINE_STATES,
  resolveAppointmentState,
  type AppointmentState,
} from "@/lib/scheduling/appointment-status";
import {
  addDaysToDateString,
  formatZonedDate,
  isoAtZonedMinutes,
  setOrgTimeZone,
  todayInZone,
  zonedDateString,
  zonedMinutesOfDay,
  zonedTimeToUtc,
} from "@/lib/scheduling/org-time";
import ScheduleBoardSkeleton from "./board-skeleton";
import DateNav from "./date-nav";
import TechnicianPicker from "./technician-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AddEntryDialog from "./add-entry-dialog";
import SubmitDialog from "./submit-dialog";
import EntryDetailDialog from "./entry-detail-dialog";
import RejectDialog from "./reject-dialog";
import HistoryDialog from "./history-dialog";
import { formatTimeAmPm, TIME_STEP_MINUTES } from "@/components/ui/time-select";

type Props = {
  technicians: TechnicianReference[];
};

// Dates and times are handled in the ORG's timezone (settings.org_timezone),
// never the browser's: a scheduler whose laptop is set to another zone must
// still read and write Gulf times. See lib/scheduling/org-time.ts.
function todayIso() {
  return todayInZone();
}

function addDaysIso(dateStr: string, delta: number) {
  return addDaysToDateString(dateStr, delta);
}

function shiftToMinutes(hhmmss: string) {
  const [h, m] = hhmmss.split(":").map(Number);
  return h * 60 + m;
}

function timeOfDayMinutes(iso: string) {
  return zonedMinutesOfDay(iso);
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
  const dayStart = zonedTimeToUtc(dateStr, "00:00:00").getTime();
  const dayEnd = zonedTimeToUtc(dateStr, "23:59:59.999").getTime();
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
// Radix Select forbids an empty-string item value; this stands in for "no role".
const NO_ROLE_VALUE = "__no_role__";
// FR-3: a failed sync is a portal state, not a job status. Solid red is Cannot complete, so
// failures are red WITH stripes, and neither can be mistaken for the other.
const SYNC_FAILED_STRIPES =
  "repeating-linear-gradient(135deg, transparent 0 5px, rgba(255,255,255,0.22) 5px 10px)";

// FR-4: one line saying what the pull from Zoho FSM did. "Nothing appeared"
// needs a reason as much as "five appeared" does, so this explains the
// skips rather than leaving an empty board unexplained.
function describeFsmImport(summary: FsmImportSummary | null | undefined): string | null {
  if (!summary) return null;
  if (summary.error) return `Couldn’t bring appointments in from Zoho FSM: ${summary.error}`;
  if (summary.imported > 0) {
    return `${summary.imported} appointment${summary.imported === 1 ? "" : "s"} booked in Zoho FSM added to the board`;
  }
  if (summary.scanned === 0) return "No appointments are booked in Zoho FSM for this date.";
  const r = summary.reasons;
  const parts = [
    r.alreadyOnBoard > 0 ? `${r.alreadyOnBoard} already on the board` : null,
    r.noKnownTechnician > 0 ? `${r.noKnownTechnician} assigned to someone not in the technician list` : null,
    r.cancelled > 0 ? `${r.cancelled} cancelled` : null,
    r.noWorkOrder > 0 ? `${r.noWorkOrder} with no work order` : null,
    r.noTimes > 0 ? `${r.noTimes} with no scheduled time` : null,
  ].filter((part): part is string => part !== null);
  return `Zoho FSM has ${summary.scanned} appointment${summary.scanned === 1 ? "" : "s"} for this date; none added (${parts.join(", ")}).`;
}

export default function DailyScheduleDashboard({ technicians: initialTechnicians }: Props) {
  // Kept in state (seeded from the server prop) so an inline role change on the
  // board reflects immediately, without a round-trip to Technicians & Leave.
  const [technicians, setTechnicians] = useState(initialTechnicians);
  useEffect(() => setTechnicians(initialTechnicians), [initialTechnicians]);
  const [date, setDate] = useState(todayIso());
  const [config, setConfig] = useState<SchedulingConfig | null>(null);
  const [access, setAccess] = useState<SchedulingAccess | null>(null);
  const [version, setVersion] = useState<ScheduleVersion | null>(null);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
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
  // Once the team has arranged the rows, the board opens in that order.
  const [sortMode, setSortMode] = useState<SortMode>(() =>
    initialTechnicians.some((t) => t.board_position != null) ? "custom" : "default",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(ZOOM_DEFAULT_INDEX);
  const [fieldVis, setFieldVis] = useState<FieldVis>(FIELD_DEFAULT);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
    scheduleService
      .getConfig()
      .then((cfg) => {
        // Every time on the board is read and written in the org's zone.
        setOrgTimeZone(cfg.org_timezone);
        setConfig(cfg);
      }).catch(() => toast.error("Failed to load shift configuration"));
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
    // Collapsed by default now, so an explicit "open" has to be restored too.
    const storedFilters = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (storedFilters === "open") setFiltersOpen(true);
    else if (storedFilters === "closed") setFiltersOpen(false);
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

  // FR-1: change a technician's role directly from the board. Optimistic — the
  // row updates at once and reverts if the save fails.
  const handleRoleChange = async (fsmId: string, roleId: string | null) => {
    const roleName = roles.find((r) => r.id === roleId)?.name ?? null;
    const before = technicians;
    setTechnicians((list) =>
      list.map((t) => (t.fsm_resource_id === fsmId ? { ...t, role_id: roleId, role_name: roleName } : t)),
    );
    try {
      await techniciansService.updateAttributes([fsmId], { roleId });
      toast.success("Role updated");
    } catch (error) {
      setTechnicians(before);
      toast.error(error instanceof Error ? error.message : "Failed to update role");
    }
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
  // `silent` reloads in place (after an action) without swapping the board
  // for the loading skeleton.
  const dayRequestRef = useRef(0);
  const loadDay = useCallback(async (targetDate: string, options?: { reset?: boolean; silent?: boolean }) => {
    const requestId = ++dayRequestRef.current;
    if (!options?.silent) setLoading(true);
    if (options?.reset) {
      setVersion(null);
      setEntries([]);
    }
    try {
      const [result, leave] = await Promise.all([
        scheduleService.getDay(targetDate),
        leaveService.listLeave({ status: "active" }),
      ]);
      // A newer load (another date, or a later refresh) supersedes this one.
      if (requestId !== dayRequestRef.current) return;
      setVersion(result.version);
      setEntries(result.entries);
      setLeaveRecords(leave);
      // FR-4: appointments booked straight in FSM are pulled in when a day is
      // first opened.
      const fsmMessage = describeFsmImport(result.fsmImport);
      if (fsmMessage) toast.info(fsmMessage, { duration: 8000 });
    } catch (error) {
      if (requestId === dayRequestRef.current) {
        toast.error(error instanceof Error ? error.message : "Failed to load schedule");
      }
    } finally {
      if (requestId === dayRequestRef.current) setLoading(false);
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

  // FR-6: a technician's "site" is the address of their earliest appointment
  // that day; used by the "Site" grouping to cluster same-address crews.
  const siteByTechnician = useMemo(() => {
    const map = new Map<string, string>();
    entriesByTechnician.forEach((list, techId) => {
      const first = list
        .filter((e) => (e.address ?? "").trim())
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())[0];
      if (first?.address) map.set(techId, first.address.trim());
    });
    return map;
  }, [entriesByTechnician]);

  // FR-3: which FSM statuses are on the board today, so the legend lists the
  // usual ones plus anything unusual that is actually present.
  const presentStates = useMemo(() => {
    const set = new Set<AppointmentState>();
    entries.forEach((e) => {
      if (e.entry_type !== "free_text" && e.fsm_appointment_id) set.add(resolveAppointmentState(e.fsm_status));
    });
    return set;
  }, [entries]);

  // FR-2: role id → highlight colour, so each technician's row is tinted by
  // their role (Driver / Technician-Driver = red by default; others as set).
  const roleColorById = useMemo(() => {
    const map = new Map<string, string>();
    roles.forEach((r) => {
      if (r.color) map.set(r.id, r.color);
    });
    return map;
  }, [roles]);

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

    return orderTechnicians(list, sortMode, roles, services, siteByTechnician);
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
    siteByTechnician,
  ]);

  const isEditable = version?.status === "draft" || version?.status === "draft_revision";

  const hasCustomOrder = useMemo(() => technicians.some((t) => t.board_position != null), [technicians]);
  const defaultSortMode: SortMode = hasCustomOrder ? "custom" : "default";

  // Rows dragged into a new order on the board. `sectionIds` is the order the
  // shift section showed; the move is applied to the whole team's list (so
  // technicians filtered out of view keep their place), saved for everyone,
  // and the board switches to the Custom order. Optimistic, reverted on error.
  const handleReorder = async (sectionIds: string[], techId: string, toIndex: number) => {
    const moved = sectionIds.filter((id) => id !== techId);
    moved.splice(toIndex, 0, techId);
    const prevId = moved[toIndex - 1] ?? null;
    const nextId = moved[toIndex + 1] ?? null;

    const order = orderTechnicians(technicians, sortMode, roles, services, siteByTechnician)
      .map((t) => t.fsm_resource_id)
      .filter((id) => id !== techId);
    let insertAt = prevId ? order.indexOf(prevId) + 1 : nextId ? order.indexOf(nextId) : 0;
    if (insertAt < 0) insertAt = order.length;
    order.splice(insertAt, 0, techId);

    const positionById = new Map(order.map((id, i) => [id, i + 1]));
    const beforeTechnicians = technicians;
    const beforeSort = sortMode;
    setTechnicians((list) => list.map((t) => ({ ...t, board_position: positionById.get(t.fsm_resource_id) ?? null })));
    setSortMode("custom");
    try {
      await techniciansService.saveBoardOrder(order);
      if (beforeSort !== "custom") toast.success("Order saved — the board now uses your Custom order");
    } catch (error) {
      setTechnicians(beforeTechnicians);
      setSortMode(beforeSort);
      toast.error(error instanceof Error ? error.message : "Couldn't save the technician order");
    }
  };

  // FR-5: apply a bar's new time / technicians. The board updates at once and
  // the save runs in the background; if it fails, the day reloads from the
  // server so the board never shows a change that didn't happen.
  const saveEntryPlacement = async (
    entry: ScheduleEntry,
    next: { startAt: string; endAt: string; technicianFsmIds: string[] },
    message: string,
    allowUndo: boolean,
  ) => {
    const currentIds = (entry.schedule_entry_assignments ?? []).map((a) => a.technician_fsm_id);
    const techsChanged =
      currentIds.length !== next.technicianFsmIds.length ||
      next.technicianFsmIds.some((id) => !currentIds.includes(id));
    const payload: UpdateEntryInput = { id: entry.id };
    if (next.startAt !== entry.start_at || next.endAt !== entry.end_at) {
      payload.startAt = next.startAt;
      payload.endAt = next.endAt;
    }
    if (techsChanged) payload.technicianFsmIds = next.technicianFsmIds;

    const updated: ScheduleEntry = {
      ...entry,
      start_at: next.startAt,
      end_at: next.endAt,
      schedule_entry_assignments: techsChanged
        ? next.technicianFsmIds.map(
            (techId) =>
              entry.schedule_entry_assignments?.find((a) => a.technician_fsm_id === techId) ?? {
                id: `pending-${techId}`,
                technician_fsm_id: techId,
                technician_reference: {
                  display_name: technicians.find((t) => t.fsm_resource_id === techId)?.display_name ?? techId,
                },
              },
          )
        : entry.schedule_entry_assignments,
    };
    setEntries((list) => list.map((e) => (e.id === entry.id ? updated : e)));

    try {
      await scheduleService.updateEntry(payload);
      if (allowUndo) {
        toast.success(message, {
          duration: 6000,
          action: {
            label: "Undo",
            onClick: () =>
              saveEntryPlacement(
                updated,
                { startAt: entry.start_at, endAt: entry.end_at, technicianFsmIds: currentIds },
                "Change undone",
                false,
              ),
          },
        });
      } else {
        toast.success(message, { duration: 2500 });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save that change");
      loadDay(date, { silent: true });
    }
  };

  const commitEntryChange = (c: EntryDragCommit) => {
    const { entry } = c;
    const currentIds = (entry.schedule_entry_assignments ?? []).map((a) => a.technician_fsm_id);
    // Replace the technician the bar was dragged FROM with the target, keeping
    // any other assignees.
    const technicianFsmIds = c.techChanged
      ? Array.from(new Set([...currentIds.map((id) => (id === c.sourceTech ? c.targetTech : id)), c.targetTech]))
      : currentIds;
    const startAt = c.timeChanged ? isoAtMinutes(entry.start_at, c.startMin) : entry.start_at;
    const endAt = c.timeChanged ? isoAtMinutes(entry.start_at, c.endMin) : entry.end_at;

    const range = formatRange(c.startMin, c.endMin);
    const targetName = technicians.find((t) => t.fsm_resource_id === c.targetTech)?.display_name ?? "technician";
    const resized = c.timeChanged && c.startMin === timeOfDayMinutes(entry.start_at);
    const message = c.techChanged
      ? c.timeChanged
        ? `Reassigned to ${targetName} · ${range}`
        : `Reassigned to ${targetName}`
      : resized
        ? `Now ${range} (${formatDuration(c.endMin - c.startMin)})`
        : `Moved to ${range}`;

    saveEntryPlacement(entry, { startAt, endAt, technicianFsmIds }, message, true);
  };

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
    setSortMode(defaultSortMode);
  };
  const viewCustomised =
    search.trim() !== "" ||
    anyCategoryFilter ||
    inverseFilter ||
    hideOnLeave ||
    onlyUnscheduled ||
    sortMode !== defaultSortMode;

  const handleRefresh = async () => {
    setRefreshing(true);
    let refreshMessage: string | null = null;
    try {
      // Adopt any direct FSM edits for THIS day before reloading. Scoped to
      // the visible date so a refresh costs one FSM read per entry on screen
      // rather than one per entry across every scheduled day.
      //
      // We don't announce "updated in FSM" -- Zoho's automation bumps every
      // appointment, so that message was just noise.
      const reconciled = await scheduleService.reconcile(date);
      refreshMessage = describeFsmImport(reconciled.fsmImport);
    } catch {
      // Non-fatal: still reload the local view even if reconciliation fails.
    }
    await loadDay(date, { silent: true });
    setRefreshing(false);
    if (refreshMessage) toast.info(refreshMessage, { duration: 8000 });
  };

  // E1: submitting opens a dialog to choose an approver or publish now.
  const handleSubmitted = () => {
    setSubmitOpen(false);
    loadDay(date, { silent: true });
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
      loadDay(date, { silent: true });
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
      loadDay(date, { silent: true });
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
      loadDay(date, { silent: true });
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
    setSubmitting(true);
    try {
      // The day is addressed by its operating date now; the server resolves
      // which version is current.
      const revision = await scheduleService.createRevision(date);
      setVersion(revision);
      toast.success("Draft revision created -- add new work, then submit for approval");
      loadDay(date, { silent: true });
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
      <div className="flex flex-col gap-4 print:gap-2">
        <div className="print:hidden">
          <p className="eyebrow">Scheduling</p>
          <h1 className="mt-1.5 text-3xl">Daily schedule</h1>
          <p className="text-muted-foreground mt-1 text-[0.9375rem]">
            Day and night shifts, synced with Zoho FSM and versioned through approval.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <DateNav
              date={date}
              onChange={setDate}
              onStep={(delta) => setDate(addDaysIso(date, delta))}
              onToday={() => setDate(todayIso())}
              isToday={date === todayIso()}
            />
            <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing} title="Refresh from FSM">
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            </Button>
          </div>

          {/* Wraps on narrow screens so the toolbar never widens the page. */}
          <div className="flex flex-wrap items-center gap-2">
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
              aria-label="Search the schedule"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-80"
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

            {/* Sort is one choice out of four, so it is a select rather than
                four competing buttons -- those read as filters you can
                combine, which is exactly what they are not. */}
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs">Sort</span>
              <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                <SelectTrigger size="sm" className="w-[130px]" aria-label="Sort technicians">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* FR-6: "Supervisor" groups each team under its supervisor (the
                      default); "Site" groups technicians by appointment address. */}
                  {/* The team's own row order, arranged by dragging rows. */}
                  <SelectItem value="custom" disabled={!hasCustomOrder}>
                    {hasCustomOrder ? "Custom" : "Custom (drag rows to arrange)"}
                  </SelectItem>
                  <SelectItem value="default">Supervisor</SelectItem>
                  <SelectItem value="site">Site</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="role">Role</SelectItem>
                  <SelectItem value="service">Service</SelectItem>
                </SelectContent>
              </Select>
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
          {(version?.status === "published" || version?.status === "partially_synced") && (
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

        {/* FR-3: bar colour = the job's FSM status (row tint = role). */}
        {!loading && shiftBounds && (
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] print:hidden">
            <span className="font-medium">Bar colour = FSM status:</span>
            {APPOINTMENT_STATE_ORDER.filter((state) => presentStates.has(state) || HEADLINE_STATES.has(state)).map((state) => (
              <span key={state} className="inline-flex items-center gap-1">
                <span className={cn("size-2.5 rounded-sm", APPOINTMENT_STATE_STYLES[state].dot)} />
                {APPOINTMENT_STATE_LABELS[state]}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="bg-danger size-2.5 rounded-sm" style={{ backgroundImage: SYNC_FAILED_STRIPES }} />
              Sync failed
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="border-border bg-ink/40 size-2.5 rounded-sm border border-dashed" />
              Note
            </span>
          </div>
        )}
        {loading || !shiftBounds ? (
          <ScheduleBoardSkeleton />
        ) : (
          // Both shifts stacked: Night Shift on top, Morning Shift underneath
          // (YFI: the board must show both shifts at once, not split into tabs).
          <div className="flex flex-col gap-4 print:hidden">
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
              roleColors={roleColorById}
              tagsByTechnician={assignments}
              entriesByTechnician={entriesByTechnician}
              leaveByTechnician={leaveByTechnician}
              isEditable={isEditable}
              onAddEntry={(technicianFsmId, slot) => setAddEntryFor({ shift: "night", technicianFsmId, ...slot })}
              roles={roles}
              onRoleChange={handleRoleChange}
              canEditRoles={Boolean(access?.canEdit)}
              onEntryClick={setSelectedEntry}
              onEntryCommit={commitEntryChange}
              canReorder={Boolean(access?.canEdit)}
              onReorder={handleReorder}
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
              roleColors={roleColorById}
              tagsByTechnician={assignments}
              entriesByTechnician={entriesByTechnician}
              leaveByTechnician={leaveByTechnician}
              isEditable={isEditable}
              onAddEntry={(technicianFsmId, slot) => setAddEntryFor({ shift: "day", technicianFsmId, ...slot })}
              roles={roles}
              onRoleChange={handleRoleChange}
              canEditRoles={Boolean(access?.canEdit)}
              onEntryClick={setSelectedEntry}
              onEntryCommit={commitEntryChange}
              canReorder={Boolean(access?.canEdit)}
              onReorder={handleReorder}
            />
          </div>
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
            loadDay(date, { silent: true });
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
          dayEntries={entries}
          onOpenChange={(open) => !open && setSelectedEntry(null)}
          onChanged={() => {
            setSelectedEntry(null);
            loadDay(date, { silent: true });
          }}
        />
      )}

      {exportOpen && (
        <Dialog open onOpenChange={(o) => !o && setExportOpen(false)}>
          <DialogContent className="w-[calc(100%-2rem)] sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Export as PDF</DialogTitle>
              {/* Was a loose <p>; as the description it is announced with the
                  dialog and Radix stops warning about a missing one. */}
              <DialogDescription>
                Which shifts to include? The PDF uses your current filters, field choices and visible
                technicians, then downloads.
              </DialogDescription>
            </DialogHeader>
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

const TECH_COL_WIDTH = 224; // px — sticky first column, so it needs a fixed width
// A press that moves less than this is a click, not a drag.
const DRAG_THRESHOLD_PX = 4;
// How long a row's handle must be held before the row lifts, so a stray click
// or a scroll gesture never reorders anything.
const LONG_PRESS_MS = 280;
// Dragging within this distance of the pane's edge scrolls the pane.
const AUTOSCROLL_EDGE_PX = 48;
const AUTOSCROLL_MAX_PX = 18;
const EMPTY_ENTRIES: ScheduleEntry[] = [];
const EMPTY_TAGS: TechnicianTag[] = [];

type HourCell = { start: number; end: number; leftPct: number; widthPct: number };

type SlotSelection = { startTime: string; endTime: string };

type Bounds = { start: number; end: number };

type Placement = {
  startMin: number;
  endMin: number;
  outside: boolean;
  allDay: boolean;
  leftPct: number;
  widthPct: number;
};

// An appointment being moved (body) or stretched (right edge). Only snapped
// values live here, so the board re-renders once per 30-minute step or row
// change -- never per pixel.
type EntryDrag = {
  entry: ScheduleEntry;
  mode: "move" | "resize";
  sourceTech: string;
  targetTech: string;
  origStartMin: number;
  origEndMin: number;
  startMin: number;
  endMin: number;
  blockedReason: string | null;
};

// A technician row being dragged to a new position.
type RowDrag = {
  techId: string;
  fromIndex: number;
  insertIndex: number; // the boundary (0..n) the row would drop at
  boundaryTop: number; // px within the rows wrapper
  rowHeight: number;
};

type EntryDragCommit = {
  entry: ScheduleEntry;
  sourceTech: string;
  targetTech: string;
  startMin: number;
  endMin: number;
  timeChanged: boolean;
  techChanged: boolean;
};

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ISO timestamp for `minutes` after midnight on the entry's own day (values
// past 1440 roll into the next day).
function isoAtMinutes(dayIso: string, minutes: number) {
  return isoAtZonedMinutes(zonedDateString(dayIso), minutes);
}

// Left/width percentages for a time range: never runs off the right edge and
// keeps a clickable minimum width.
function spanPct(startMin: number, endMin: number, bounds: Bounds, span: number) {
  const leftPct = ((startMin - bounds.start) / span) * 100;
  const rawWidth = ((endMin - startMin) / span) * 100;
  const widthPct = Math.max(Math.min(rawWidth, 100 - leftPct), Math.min(6, 100 - leftPct));
  return { leftPct, widthPct };
}

// An entry whose window does not intersect this shift at all used to be
// positioned past 100% and disappeared off the right edge (D-01). Now it is
// clamped to the nearest edge and flagged instead.
function placeEntry(entry: ScheduleEntry, bounds: Bounds, span: number): Placement {
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
    return { startMin, endMin, outside, allDay: false, leftPct: pinRight ? 100 - 14 : 0, widthPct: 14 };
  }
  return { startMin, endMin, outside, allDay: false, ...spanPct(visibleStart, visibleEnd, bounds, span) };
}

// Assign each of a technician's entries to a vertical lane so overlapping
// appointments stack under one another and are all visible (YFI v1.5 on
// N-7), instead of one hiding another.
function laneLayout(rowEntries: ScheduleEntry[]) {
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
}

// The lane a dropped range would sit in: the first lane with nothing
// overlapping it, or a new lane underneath (the row grows to make room).
function laneForRange(
  rowEntries: ScheduleEntry[],
  laneOf: Map<string, number>,
  laneCount: number,
  range: { startMin: number; endMin: number; ignoreId: string },
  bounds: Bounds,
  span: number,
) {
  for (let lane = 0; lane < laneCount; lane += 1) {
    const clash = rowEntries.some((e) => {
      if (e.id === range.ignoreId || laneOf.get(e.id) !== lane) return false;
      const p = placeEntry(e, bounds, span);
      return p.startMin < range.endMin && p.endMin > range.startMin;
    });
    if (!clash) return lane;
  }
  return laneCount;
}

// E3: which text lines a bar shows, driven by the eye menu.
function entryText(entry: ScheduleEntry, fieldVis: FieldVis, allDay: boolean) {
  const label = entryLabel(entry);
  if (entry.entry_type === "free_text") return { primaryText: label, secondaryText: "" };
  const addr = entry.address || entry.client_name || "";
  const parts: string[] = [];
  if (fieldVis.ids) parts.push(label);
  if (fieldVis.address && addr) parts.push(addr);
  if (allDay && parts.length < 2) parts.push("All Day");
  if (parts.length === 0) parts.push(label);
  return { primaryText: parts[0], secondaryText: parts[1] ?? "" };
}

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
  roleColors,
  tagsByTechnician,
  entriesByTechnician,
  leaveByTechnician,
  isEditable,
  onAddEntry,
  onEntryClick,
  onEntryCommit,
  roles,
  onRoleChange,
  canEditRoles,
  canReorder,  onReorder,
}: {
  title: string;
  shift: ShiftType;
  bounds: Bounds;
  zoom: number;
  fieldVis: FieldVis;
  technicians: TechnicianReference[];
  // Every active technician for this shift (incl. hidden) — the picker list.
  pickTechnicians: TechnicianReference[];
  hiddenTechIds: Set<string>;
  onToggleHidden: (id: string) => void;
  onSetTechsHidden: (ids: string[], hidden: boolean) => void;
  roleColors: Map<string, string>;
  tagsByTechnician: Record<string, TechnicianTag[]>;
  entriesByTechnician: Map<string, ScheduleEntry[]>;
  leaveByTechnician: Map<string, LeaveRecord>;
  isEditable: boolean;
  onAddEntry: (technicianFsmId: string, slot?: SlotSelection) => void;
  onEntryClick: (entry: ScheduleEntry) => void;
  onEntryCommit: (commit: EntryDragCommit) => void;
  roles: TechnicianRole[];
  onRoleChange: (technicianFsmId: string, roleId: string | null) => void;
  canEditRoles: boolean;
  canReorder: boolean;
  // `sectionIds` is this section's displayed order; `toIndex` the new position.
  onReorder: (sectionIds: string[], technicianFsmId: string, toIndex: number) => void;
}) {
  const span = bounds.end - bounds.start || 1;

  // FR-1: which technician row is editing its role inline (by fsm_resource_id).
  const [editingRoleFor, setEditingRoleFor] = useState<string | null>(null);
  const [entryDrag, setEntryDrag] = useState<EntryDrag | null>(null);
  const [rowDrag, setRowDrag] = useState<RowDrag | null>(null);
  // The row just dropped, briefly highlighted so the eye can find where it went.
  const [flashTech, setFlashTech] = useState<string | null>(null);

  const paneRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const rowGhostRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  // Pointer handlers are created once, so memoised rows don't re-render every
  // time this section does; they read current props through this ref.
  const latest = useRef({
    bounds,
    span,
    isEditable,
    canReorder,
    technicians,
    leaveByTechnician,
    onEntryClick,
    onEntryCommit,
    onReorder,
    onAddEntry,
    onRoleChange,
  });
  useLayoutEffect(() => {
    latest.current = {
      bounds,
      span,
      isEditable,
      canReorder,
      technicians,
      leaveByTechnician,
      onEntryClick,
      onEntryCommit,
      onReorder,
      onAddEntry,
      onRoleChange,
    };
  });

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

  const outOfWindow = useMemo(() => {
    const seen = new Map<string, ScheduleEntry>();
    technicians.forEach((t) => {
      (entriesByTechnician.get(t.fsm_resource_id) ?? [])
        .filter((e) => e.shift === shift)
        .forEach((e) => {
          if (placeEntry(e, bounds, span).outside) seen.set(e.id, e);
        });
    });
    return [...seen.values()];
  }, [technicians, entriesByTechnician, shift, bounds, span]);

  // The floating label next to the cursor while dragging a bar. Positioned
  // straight on the DOM so following the pointer costs no re-render.
  const positionPill = useCallback(() => {
    const pill = pillRef.current;
    if (!pill) return;
    const { x, y } = pointerRef.current;
    const width = pill.offsetWidth;
    const left = x + 16 + width > window.innerWidth - 8 ? x - 16 - width : x + 16;
    pill.style.transform = `translate3d(${Math.max(8, left)}px, ${y + 18}px, 0)`;
  }, []);
  useLayoutEffect(() => {
    if (entryDrag) positionPill();
  }, [entryDrag, positionPill]);

  // Scrolls the pane while the pointer rests near its edge during a drag, and
  // re-runs `onScrolled` so the drop target keeps up. Returns a stop function.
  const startAutoScroll = useCallback((axis: "both" | "y", onScrolled: () => void) => {
    let raf = 0;
    const speed = (depth: number) =>
      Math.min(AUTOSCROLL_MAX_PX, Math.ceil((depth / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_PX));
    const tick = () => {
      const pane = paneRef.current;
      if (pane) {
        const r = pane.getBoundingClientRect();
        const { x, y } = pointerRef.current;
        let dx = 0;
        let dy = 0;
        if (y < r.top + AUTOSCROLL_EDGE_PX) dy = -speed(r.top + AUTOSCROLL_EDGE_PX - y);
        else if (y > r.bottom - AUTOSCROLL_EDGE_PX) dy = speed(y - (r.bottom - AUTOSCROLL_EDGE_PX));
        if (axis === "both") {
          const trackLeft = r.left + TECH_COL_WIDTH;
          if (x >= trackLeft - 8 && x < trackLeft + AUTOSCROLL_EDGE_PX) dx = -speed(trackLeft + AUTOSCROLL_EDGE_PX - x);
          else if (x > r.right - AUTOSCROLL_EDGE_PX) dx = speed(x - (r.right - AUTOSCROLL_EDGE_PX));
        }
        if (dx || dy) {
          const beforeLeft = pane.scrollLeft;
          const beforeTop = pane.scrollTop;
          pane.scrollBy(dx, dy);
          if (pane.scrollLeft !== beforeLeft || pane.scrollTop !== beforeTop) onScrolled();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // FR-5: press on a bar to drag it. Sideways changes the time (30-minute
  // snap, clamped inside the shift); up/down onto another row reassigns it;
  // the right edge stretches the end time. A press that barely moves is a
  // click and opens the detail. On release the change is handed to the
  // dashboard, which updates the board at once and saves in the background.
  const beginEntryDrag = useCallback(
    (
      e: ReactPointerEvent<HTMLElement>,
      entry: ScheduleEntry,
      placed: Placement,
      sourceTech: string,
      mode: "move" | "resize",
    ) => {
      if (e.button !== 0) return;
      if (mode === "resize") e.stopPropagation(); // don't also start a move
      const canDrag = latest.current.isEditable && !placed.allDay && !placed.outside;
      const track = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-track]");
      const minPerPx = latest.current.span / (track?.clientWidth || 1);
      const startX = e.clientX;
      const startY = e.clientY;
      const startScrollLeft = paneRef.current?.scrollLeft ?? 0;
      const duration = Math.max(TIME_STEP_MINUTES, placed.endMin - placed.startMin);
      pointerRef.current = { x: startX, y: startY };
      let started = false;
      let current: EntryDrag | null = null;
      let stopScroll: (() => void) | null = null;

      // Only rows inside this shift section are valid drop targets.
      const rowAt = (x: number, y: number) => {
        const row = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-tech-fsm]");
        return row && rowsRef.current?.contains(row) ? (row.dataset.techFsm ?? null) : null;
      };

      const compute = (): EntryDrag => {
        const { bounds: b, leaveByTechnician: leaveMap, technicians: techs } = latest.current;
        const { x, y } = pointerRef.current;
        const scrolled = (paneRef.current?.scrollLeft ?? startScrollLeft) - startScrollLeft;
        const delta = Math.round(((x - startX + scrolled) * minPerPx) / TIME_STEP_MINUTES) * TIME_STEP_MINUTES;
        const base = { entry, mode, sourceTech, origStartMin: placed.startMin, origEndMin: placed.endMin };

        if (mode === "resize") {
          const endMin = Math.max(placed.startMin + TIME_STEP_MINUTES, Math.min(placed.endMin + delta, b.end));
          return { ...base, targetTech: sourceTech, startMin: placed.startMin, endMin, blockedReason: null };
        }

        const startMin = Math.max(b.start, Math.min(placed.startMin + delta, b.end - duration));
        const endMin = startMin + duration;
        const targetTech = rowAt(x, y) ?? current?.targetTech ?? sourceTech;
        let blockedReason: string | null = null;
        const leave = targetTech !== sourceTech ? leaveMap.get(targetTech) : undefined;
        if (leave) {
          const s = new Date(isoAtMinutes(entry.start_at, startMin)).getTime();
          const en = new Date(isoAtMinutes(entry.start_at, endMin)).getTime();
          if (new Date(leave.start_at).getTime() < en && new Date(leave.end_at).getTime() > s) {
            const name = techs.find((t) => t.fsm_resource_id === targetTech)?.display_name ?? "This technician";
            blockedReason = `${name} is on leave (${leave.leave_type}) at that time`;
          }
        }
        return { ...base, targetTech, startMin, endMin, blockedReason };
      };

      const update = () => {
        positionPill();
        const next = compute();
        if (
          !current ||
          next.startMin !== current.startMin ||
          next.endMin !== current.endMin ||
          next.targetTech !== current.targetTech ||
          next.blockedReason !== current.blockedReason
        ) {
          current = next;
          setEntryDrag(next);
        }
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        stopScroll?.();
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };

      const onMove = (ev: PointerEvent) => {
        pointerRef.current = { x: ev.clientX, y: ev.clientY };
        if (!started) {
          if (!canDrag) return;
          if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD_PX) {
            return;
          }
          started = true;
          document.body.style.cursor = mode === "resize" ? "ew-resize" : "grabbing";
          document.body.style.userSelect = "none";
          stopScroll = startAutoScroll("both", update);
        }
        update();
      };

      const onUp = () => {
        cleanup();
        if (!started) {
          latest.current.onEntryClick(entry); // barely moved → a click
          return;
        }
        const final = current;
        setEntryDrag(null);
        if (!final) return;
        const timeChanged = final.startMin !== final.origStartMin || final.endMin !== final.origEndMin;
        const techChanged = final.targetTech !== final.sourceTech;
        if (!timeChanged && !techChanged) return;
        if (final.blockedReason) {
          toast.error(final.blockedReason);
          return;
        }
        latest.current.onEntryCommit({
          entry,
          sourceTech,
          targetTech: final.targetTech,
          startMin: final.startMin,
          endMin: final.endMin,
          timeChanged,
          techChanged,
        });
      };

      const onCancel = () => {
        cleanup();
        setEntryDrag(null);
      };
      // Escape drops the drag without changing anything.
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape" || !started) return;
        cleanup();
        setEntryDrag(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
    },
    [positionPill, startAutoScroll],
  );

  const flashRow = useCallback((techId: string) => {
    setFlashTech(techId);
    window.setTimeout(() => setFlashTech((t) => (t === techId ? null : t)), 1200);
  }, []);

  // Team-arranged rows: press and hold a row's handle, then drag it up or down.
  // The row lifts and follows the pointer, a line shows where it will land, and
  // releasing saves the new order for everyone.
  const beginRowPress = useCallback(
    (e: ReactPointerEvent<HTMLElement>, techId: string) => {
      if (e.button !== 0 || !latest.current.canReorder) return;
      e.preventDefault(); // no text selection while holding...
      const grip = e.currentTarget as HTMLElement;
      // ...but do select the handle, so ↑ / ↓ move the row after a click.
      grip.focus({ preventScroll: true });
      // With a mouse, dragging the handle is unambiguous, so it starts as soon
      // as the pointer moves. On touch the hold is required, so scrolling the
      // board with a finger never reorders anything.
      const isMouse = e.pointerType === "mouse";
      const startX = e.clientX;
      const startY = e.clientY;
      pointerRef.current = { x: startX, y: startY };
      grip.dataset.pressing = "true";

      let dragging = false;
      let cancelled = false;
      let ids: string[] = [];
      let geometry: { top: number; height: number }[] = [];
      let fromIndex = -1;
      let insertIndex = -1;
      let grabOffset = 0;
      let stopScroll: (() => void) | null = null;

      const positionGhost = () => {
        const ghost = rowGhostRef.current;
        const wrap = rowsRef.current;
        const pane = paneRef.current;
        if (!ghost || !wrap || !pane) return;
        const top = pointerRef.current.y - wrap.getBoundingClientRect().top - grabOffset;
        ghost.style.transform = `translate3d(${pane.scrollLeft}px, ${top}px, 0)`;
      };

      const update = () => {
        positionGhost();
        const wrap = rowsRef.current;
        if (!wrap || geometry.length === 0) return;
        const y = pointerRef.current.y - wrap.getBoundingClientRect().top;
        let idx = geometry.findIndex((g) => y < g.top + g.height / 2);
        if (idx === -1) idx = geometry.length;
        if (idx === insertIndex) return;
        insertIndex = idx;
        const last = geometry[geometry.length - 1];
        setRowDrag({
          techId,
          fromIndex,
          insertIndex: idx,
          boundaryTop: idx < geometry.length ? geometry[idx].top : last.top + last.height,
          rowHeight: geometry[fromIndex].height,
        });
      };

      const lift = () => {
        const wrap = rowsRef.current;
        if (!wrap || cancelled) return;
        const rows = Array.from(wrap.querySelectorAll<HTMLElement>(":scope > [data-tech-fsm]"));
        ids = rows.map((r) => r.dataset.techFsm ?? "");
        fromIndex = ids.indexOf(techId);
        if (fromIndex === -1) return;
        geometry = rows.map((r) => ({ top: r.offsetTop, height: r.offsetHeight }));
        grabOffset = startY - rows[fromIndex].getBoundingClientRect().top;
        dragging = true;
        delete grip.dataset.pressing;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        navigator.vibrate?.(10); // a small tick on touch devices
        update();
        stopScroll = startAutoScroll("y", update);
      };
      const timer = window.setTimeout(lift, LONG_PRESS_MS);

      const cleanup = () => {
        window.clearTimeout(timer);
        delete grip.dataset.pressing;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        stopScroll?.();
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };

      const onMove = (ev: PointerEvent) => {
        pointerRef.current = { x: ev.clientX, y: ev.clientY };
        if (dragging) {
          update();
          return;
        }
        const distance = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (isMouse && distance > DRAG_THRESHOLD_PX) {
          window.clearTimeout(timer);
          lift();
        } else if (!isMouse && distance > 8) {
          // A finger moved before the hold completed: a scroll, not a reorder.
          cancelled = true;
          cleanup();
        }
      };

      const onUp = () => {
        cleanup();
        if (!dragging) {
          if (!cancelled) {
            toast.info("Row selected — use ↑ / ↓ to move it, or drag the handle.", { id: "row-reorder-hint" });
          }
          return;
        }
        setRowDrag(null);
        const to = insertIndex > fromIndex ? insertIndex - 1 : insertIndex;
        if (to === fromIndex) return;
        latest.current.onReorder(ids, techId, to);
        flashRow(techId);
      };

      const onCancel = () => {
        cleanup();
        if (dragging) setRowDrag(null);
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        cleanup();
        if (dragging) setRowDrag(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
    },
    [startAutoScroll, flashRow],
  );

  // Keyboard alternative: focus a row's handle and use ↑ / ↓.
  const moveRowByKey = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>, techId: string) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const ids = latest.current.technicians.map((t) => t.fsm_resource_id);
      const from = ids.indexOf(techId);
      const to = e.key === "ArrowUp" ? from - 1 : from + 1;
      if (from === -1 || to < 0 || to >= ids.length) return;
      latest.current.onReorder(ids, techId, to);
      flashRow(techId);
      // The row re-renders in its new place; keep focus on its handle.
      requestAnimationFrame(() =>
        rowsRef.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(techId)}"]`)?.focus(),
      );
    },
    [flashRow],
  );

  const addEntry = useCallback(
    (techId: string, slot?: SlotSelection) => latest.current.onAddEntry(techId, slot),
    [],
  );
  const clickEntry = useCallback((entry: ScheduleEntry) => latest.current.onEntryClick(entry), []);
  const changeRole = useCallback(
    (techId: string, roleId: string | null) => latest.current.onRoleChange(techId, roleId),
    [],
  );

  const nameOf = (techId: string) =>
    technicians.find((t) => t.fsm_resource_id === techId)?.display_name ?? "another technician";
  const dragTimeChanged = entryDrag
    ? entryDrag.startMin !== entryDrag.origStartMin || entryDrag.endMin !== entryDrag.origEndMin
    : false;
  const dragTechChanged = entryDrag ? entryDrag.targetTech !== entryDrag.sourceTech : false;
  const dragBand = entryDrag ? spanPct(entryDrag.startMin, entryDrag.endMin, bounds, span) : null;
  const rowDragTech = rowDrag ? (technicians.find((t) => t.fsm_resource_id === rowDrag.techId) ?? null) : null;
  const showInsertLine =
    rowDrag !== null && rowDrag.insertIndex !== rowDrag.fromIndex && rowDrag.insertIndex !== rowDrag.fromIndex + 1;

  return (
    <div className="rounded-md border">
      <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-t-md border-b px-3 py-1.5">
        <span className="text-sm font-semibold">{title}</span>
        <div className="flex min-w-0 items-center gap-3">
          {(isEditable || canReorder) && (
            <span className="text-muted-foreground hidden truncate text-[11px] xl:inline">
              {[
                isEditable && "Drag a bar to move or reassign it, or its right edge to change its length",
                canReorder && "drag ⠿ to reorder technicians",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {formatRange(bounds.start, bounds.end)}
          </span>
        </div>
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
      <div ref={paneRef} className="max-h-[65vh] overflow-auto print:overflow-visible">
        <div style={{ width: `${trackWidthPct}%`, minWidth: `max(100%, ${Math.round(trackMinPx)}px)` }}>
          <div className="bg-background sticky top-0 z-40 flex border-b">
            <div
              className="bg-background sticky left-0 z-50 flex shrink-0 items-center justify-between gap-1 border-r px-2 py-1.5"
              style={{ width: TECH_COL_WIDTH }}
            >
              <span className="text-muted-foreground text-xs font-medium">Technician</span>
              {/* S1: show / hide this shift's technicians. */}
              <TechnicianPicker
                title={title}
                technicians={pickTechnicians}
                hiddenIds={hiddenTechIds}
                onToggle={onToggleHidden}
                onSetHidden={onSetTechsHidden}
              />
            </div>
            <div className="relative min-w-0 flex-1">
              {hourCells.map((cell) => (
                <div
                  key={cell.start}
                  // inset-y-0 + items-center so the hour sits on the same
                  // baseline as the "Technician" label in the frozen column;
                  // pinned to top-0 it rode ~9px high above it.
                  className="text-muted-foreground absolute inset-y-0 flex items-center border-l px-1.5 text-[11px] tabular-nums"
                  style={{ left: `${cell.leftPct}%`, width: `${cell.widthPct}%` }}
                >
                  {formatHourLabel(cell.start)}
                </div>
              ))}
              {/* While a bar is dragged, the hour row marks the time it would take. */}
              {dragBand && (
                <div
                  className="border-primary bg-primary/15 pointer-events-none absolute inset-y-0 z-10 border-x-2"
                  style={{
                    left: `${dragBand.leftPct}%`,
                    width: `${dragBand.widthPct}%`,
                    transition: "left 90ms ease-out, width 90ms ease-out",
                  }}
                />
              )}
              {/* Spacer giving the absolutely-positioned labels their height. */}
              <div className="py-1.5 text-[11px] leading-none">&nbsp;</div>
            </div>
          </div>

          {technicians.length === 0 ? (
            <div className="text-muted-foreground p-4 text-center text-sm">
              No technicians match the current filters.
            </div>
          ) : (
            <div ref={rowsRef} className="relative">
              {technicians.map((technician) => {
                const id = technician.fsm_resource_id;
                const involved =
                  entryDrag && (entryDrag.sourceTech === id || entryDrag.targetTech === id) ? entryDrag : null;
                return (
                  <TechnicianRow
                    key={id}
                    technician={technician}
                    entries={entriesByTechnician.get(id) ?? EMPTY_ENTRIES}
                    shift={shift}
                    title={title}
                    leave={leaveByTechnician.get(id)}
                    tags={tagsByTechnician[id] ?? EMPTY_TAGS}
                    roleColor={technician.role_id ? (roleColors.get(technician.role_id) ?? null) : null}
                    fieldVis={fieldVis}
                    hourCells={hourCells}
                    bounds={bounds}
                    span={span}
                    laneHeight={laneHeight}
                    isEditable={isEditable}
                    canEditRoles={canEditRoles}
                    canReorder={canReorder}
                    isEditingRole={editingRoleFor === id}
                    roles={roles}
                    drag={involved}
                    isRowDragSource={rowDrag?.techId === id}
                    flash={flashTech === id}
                    onAddEntry={addEntry}
                    onEntryClick={clickEntry}
                    onBeginEntryDrag={beginEntryDrag}
                    onBeginRowPress={beginRowPress}
                    onRowKey={moveRowByKey}
                    onSetEditingRole={setEditingRoleFor}
                    onRoleChange={changeRole}
                  />
                );
              })}

              {/* Row reorder: where the row will land... */}
              {showInsertLine && (
                <div
                  className="bg-primary pointer-events-none absolute right-0 left-0 z-40 h-[3px] -translate-y-1/2 rounded-full shadow-[0_0_0_2px_var(--background)]"
                  style={{ top: rowDrag.boundaryTop }}
                />
              )}
              {/* ...and the lifted row, following the pointer (moved on the DOM). */}
              <div
                ref={rowGhostRef}
                aria-hidden
                className="pointer-events-none absolute top-0 left-0 z-50 will-change-transform"
                style={{ display: rowDrag ? "block" : "none", width: TECH_COL_WIDTH + 24 }}
              >
                {rowDragTech && (
                  <div
                    className="bg-background ring-primary flex -rotate-1 items-center gap-2 rounded-md px-2 py-2 shadow-xl ring-2"
                    style={{ minHeight: rowDrag?.rowHeight }}
                  >
                    <GripVertical className="text-primary size-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{rowDragTech.display_name}</div>
                      {rowDragTech.role_name && (
                        <div className="text-muted-foreground truncate text-[10px]">{rowDragTech.role_name}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* What the drop will do, next to the cursor. */}
      {entryDrag &&
        createPortal(
          <div ref={pillRef} className="pointer-events-none fixed top-0 left-0 z-[100] will-change-transform">
            <div
              className={cn(
                "flex max-w-xs flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-xs shadow-lg ring-1",
                entryDrag.blockedReason
                  ? "bg-destructive ring-destructive text-white"
                  : "bg-popover text-popover-foreground ring-foreground/10",
              )}
            >
              {entryDrag.blockedReason ? (
                <span className="flex items-center gap-1.5 font-medium">
                  <Ban className="size-3.5 shrink-0" />
                  {entryDrag.blockedReason}
                </span>
              ) : entryDrag.mode === "resize" ? (
                <>
                  <span className="flex items-center gap-1.5 font-medium">
                    <MoveHorizontal className="text-primary size-3.5 shrink-0" />
                    Ends {formatTimeAmPm(minutesToHhmm(entryDrag.endMin))}
                  </span>
                  <span className="text-muted-foreground">
                    {formatRange(entryDrag.startMin, entryDrag.endMin)} ·{" "}
                    {formatDuration(entryDrag.endMin - entryDrag.startMin)}
                  </span>
                </>
              ) : (
                <>
                  {dragTechChanged && (
                    <span className="flex items-center gap-1.5">
                      <UserRound className="text-primary size-3.5 shrink-0" />
                      <span className="truncate">{nameOf(entryDrag.sourceTech)}</span>
                      <ArrowRight className="size-3 shrink-0" />
                      <b className="truncate">{nameOf(entryDrag.targetTech)}</b>
                    </span>
                  )}
                  {dragTimeChanged && (
                    <span className="flex items-center gap-1.5">
                      <Clock className="text-primary size-3.5 shrink-0" />
                      <b>{formatRange(entryDrag.startMin, entryDrag.endMin)}</b>
                    </span>
                  )}
                  {dragTimeChanged && (
                    <span className="text-muted-foreground pl-5">
                      was {formatRange(entryDrag.origStartMin, entryDrag.origEndMin)}
                    </span>
                  )}
                  {!dragTechChanged && !dragTimeChanged && (
                    <span className="text-muted-foreground">
                      Drag sideways to change the time, or up / down to reassign
                    </span>
                  )}
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

type TechnicianRowProps = {
  technician: TechnicianReference;
  // All of this technician's entries for the day (any shift) — a stable array.
  entries: ScheduleEntry[];
  shift: ShiftType;
  title: string;
  leave: LeaveRecord | undefined;
  tags: TechnicianTag[];
  roleColor: string | null;
  fieldVis: FieldVis;
  hourCells: HourCell[];
  bounds: Bounds;
  span: number;
  laneHeight: number;
  isEditable: boolean;
  canEditRoles: boolean;
  canReorder: boolean;
  isEditingRole: boolean;
  roles: TechnicianRole[];
  // Set only when this row is the source or target of a bar drag.
  drag: EntryDrag | null;
  isRowDragSource: boolean;
  flash: boolean;
  onAddEntry: (technicianFsmId: string, slot?: SlotSelection) => void;
  onEntryClick: (entry: ScheduleEntry) => void;
  onBeginEntryDrag: (
    e: ReactPointerEvent<HTMLElement>,
    entry: ScheduleEntry,
    placed: Placement,
    sourceTech: string,
    mode: "move" | "resize",
  ) => void;
  onBeginRowPress: (e: ReactPointerEvent<HTMLElement>, techId: string) => void;
  onRowKey: (e: ReactKeyboardEvent<HTMLElement>, techId: string) => void;
  onSetEditingRole: (techId: string | null) => void;
  onRoleChange: (techId: string, roleId: string | null) => void;
};

// One technician's row. Memoised: during a drag only the rows it touches
// (source and target) re-render, which is what keeps dragging smooth on a
// board with many technicians.
const TechnicianRow = memo(function TechnicianRow({
  technician,
  entries,
  shift,
  title,
  leave,
  tags,
  roleColor,
  fieldVis,
  hourCells,
  bounds,
  span,
  laneHeight,
  isEditable,
  canEditRoles,
  canReorder,  isEditingRole,
  roles,
  drag,
  isRowDragSource,
  flash,
  onAddEntry,
  onEntryClick,
  onBeginEntryDrag,
  onBeginRowPress,
  onRowKey,
  onSetEditingRole,
  onRoleChange,
}: TechnicianRowProps) {
  const id = technician.fsm_resource_id;
  const rowEntries = useMemo(() => entries.filter((e) => e.shift === shift), [entries, shift]);

  // L-2: flag entries that overlap another appointment for the same
  // technician (allowed, but shown so it's never silent).
  const overlappingIds = useMemo(() => {
    const ids = new Set<string>();
    for (let i = 0; i < rowEntries.length; i += 1) {
      for (let j = i + 1; j < rowEntries.length; j += 1) {
        const a = rowEntries[i];
        const b = rowEntries[j];
        if (
          new Date(a.start_at).getTime() < new Date(b.end_at).getTime() &&
          new Date(a.end_at).getTime() > new Date(b.start_at).getTime()
        ) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return ids;
  }, [rowEntries]);

  // Stack overlapping entries in separate lanes so both are visible; the row
  // grows to fit the busiest moment (YFI v1.5).
  const { laneOf, laneCount } = useMemo(() => laneLayout(rowEntries), [rowEntries]);

  // A bar being moved lands here: preview it in the lane it would take.
  const ghost = drag && drag.mode === "move" && drag.targetTech === id ? drag : null;
  const ghostLane = ghost
    ? laneForRange(
        rowEntries,
        laneOf,
        laneCount,
        { startMin: ghost.startMin, endMin: ghost.endMin, ignoreId: ghost.entry.id },
        bounds,
        span,
      )
    : -1;
  const rowHeight = Math.max(laneCount, ghostLane + 1) * laneHeight + 6;
  const reassignTarget = Boolean(ghost && ghost.targetTech !== ghost.sourceTech);
  const targetBlocked = reassignTarget && Boolean(ghost?.blockedReason);
  const roleLabel = technician.role_name;
  // Role & service only show when switched on in the Fields menu; the row's
  // colour tint still marks the role either way.
  const showRoleLine = fieldVis.roles && !isEditingRole && Boolean(roleLabel || technician.service_type_name);

  const ghostView = ghost
    ? {
        ...spanPct(ghost.startMin, ghost.endMin, bounds, span),
        top: ghostLane * laneHeight + 2,
        text: entryText(ghost.entry, fieldVis, false).primaryText,
        freeText: ghost.entry.entry_type === "free_text",
      }
    : null;

  return (
    <div
      data-tech-fsm={id}
      className={cn(
        "group/row relative flex items-stretch border-b transition-opacity last:border-0",
        isRowDragSource && "opacity-40",
      )}
      style={{ backgroundColor: roleColor ? `${roleColor}0f` : undefined }}
    >
      <div
        className={cn(
          "bg-background sticky left-0 z-30 flex shrink-0 flex-col justify-center gap-1 border-r py-1.5 pr-2",
          canReorder ? "pl-8" : "pl-2",
          reassignTarget && (targetBlocked ? "ring-destructive ring-2 ring-inset" : "ring-primary ring-2 ring-inset"),
        )}
        style={{
          width: TECH_COL_WIDTH,
          borderLeft: roleColor ? `3px solid ${roleColor}` : undefined,
        }}
      >
        {/* Team row order: a full-height handle down the left of the name cell,
            big enough to grab comfortably with a mouse. */}
        {canReorder && (
          <button
            type="button"
            data-grip={id}
            onPointerDown={(e) => onBeginRowPress(e, id)}
            onKeyDown={(e) => onRowKey(e, id)}
            // A long press on touch would otherwise open the context menu.
            onContextMenu={(e) => e.preventDefault()}
            className="group/grip text-muted-foreground hover:bg-muted hover:text-foreground focus:bg-primary/10 focus:text-primary data-[pressing=true]:bg-primary/15 data-[pressing=true]:text-primary absolute inset-y-0 left-0 flex w-7 cursor-grab touch-none items-center justify-center opacity-0 transition-[opacity,background-color,color] duration-150 group-hover/row:opacity-100 focus:opacity-100 focus:outline-none active:cursor-grabbing data-[pressing=true]:opacity-100"
            title="Drag to reorder — or click, then use ↑ ↓"
            aria-label={`Reorder ${technician.display_name}: drag the handle, or use the arrow keys`}
          >
            <GripVertical className="size-4 transition-transform duration-200 group-data-[pressing=true]/grip:scale-125" />
          </button>
        )}
        <div className="group flex min-w-0 items-start gap-1">
          <span
            className="line-clamp-2 min-w-0 flex-1 text-sm leading-tight font-medium break-words"
            style={{ color: roleColor ?? undefined }}
            title={technician.display_name}
          >
            {technician.display_name}
          </span>
          {/* FR-1: edit this technician's role without leaving the board. */}
          {canEditRoles && !isEditingRole && (
            <button
              type="button"
              onClick={() => onSetEditingRole(id)}
              className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              title={`Edit role for ${technician.display_name}`}
              aria-label={`Edit role for ${technician.display_name}`}
            >
              <Pencil className="size-3" />
            </button>
          )}
        </div>
        {canEditRoles && isEditingRole && (
          <Select
            defaultOpen
            value={technician.role_id ?? NO_ROLE_VALUE}
            onValueChange={(v) => {
              onRoleChange(id, v === NO_ROLE_VALUE ? null : v);
              onSetEditingRole(null);
            }}
            onOpenChange={(open) => {
              if (!open) onSetEditingRole(null);
            }}
          >
            <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label={`Role for ${technician.display_name}`}>
              <SelectValue placeholder="Set role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ROLE_VALUE}>No role</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {(showRoleLine || leave) && (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {showRoleLine &&
              roleLabel &&
              (roleColor ? (
                <span
                  className="rounded px-1 py-0.5 text-[9px] font-semibold tracking-wide uppercase"
                  style={{ backgroundColor: `${roleColor}22`, color: roleColor }}
                >
                  {roleLabel}
                </span>
              ) : (
                <span className="text-muted-foreground text-[10px]">{roleLabel}</span>
              ))}
            {showRoleLine && technician.service_type_name && (
              <span className="text-muted-foreground truncate text-[10px]">{technician.service_type_name}</span>
            )}
            {leave && (
              <span className="rounded bg-warning/15 px-1 py-0.5 text-[10px] font-medium text-warning">
                Unavailable
              </span>
            )}
          </div>
        )}
        {fieldVis.tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-0.5">
            {tags.map((tag) => (
              <Badge key={tag.id} variant="secondary" className="px-1 py-0 text-[10px]">
                {tag.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div
        data-track
        className={cn("relative min-w-0 flex-1", leave && "bg-warning/10")}
        // min-height (not height) so the track also fills a taller name cell.
        style={{ minHeight: rowHeight, transition: "min-height 120ms ease-out" }}
      >
        {/* One clickable cell per hour: clicking 5–6 AM opens the add dialog
            with 5:00 AM–6:00 AM already selected. */}
        {hourCells.map((cell) => (
          <button
            key={cell.start}
            type="button"
            disabled={!isEditable || !!leave}
            onClick={() =>
              onAddEntry(id, {
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
            On Leave: {leave.leave_type} ({formatZonedDate(leave.start_at)}–
            {formatZonedDate(leave.end_at)})
          </span>
        )}

        {/* This row is where a dragged bar would be reassigned to. */}
        {reassignTarget && (
          <span
            className={cn(
              "pointer-events-none absolute inset-0 z-[5]",
              targetBlocked ? "bg-destructive/10" : "bg-primary/10",
            )}
          />
        )}

        {rowEntries.map((entry) => {
          const placed = placeEntry(entry, bounds, span);
          const { startMin, endMin, outside, allDay } = placed;
          const beingDragged = drag !== null && drag.entry.id === entry.id && drag.sourceTech === id;
          const resizing = beingDragged && drag.mode === "resize";
          const movingAway = beingDragged && drag.mode === "move";
          const shownEnd = resizing ? drag.endMin : endMin;
          const { leftPct, widthPct } = resizing ? spanPct(startMin, shownEnd, bounds, span) : placed;
          const isFreeText = entry.entry_type === "free_text";
          const conflictsWithLeave = leave ? entryOverlapsLeave(entry, leave) : false;
          const label = entryLabel(entry);
          const timeLabel = allDay ? "All Day" : formatRange(startMin, shownEnd);

          const syncFailed = entry.sync_status === "failed";
          const overlaps = overlappingIds.has(entry.id);

          // FR-3 (as decided 18 Sep: mirror FSM's own statuses): the bar is coloured
          // by the appointment's status in FSM; the row tint is the role, so the two
          // channels never collide. An appointment not yet created in FSM reads as
          // Scheduled -- that is the plan for it. A failed sync is a portal state,
          // not a job status: red with stripes, so it can't be mistaken for
          // Cannot complete (solid red).
          const state: AppointmentState | null = isFreeText
            ? null
            : entry.fsm_appointment_id
              ? resolveAppointmentState(entry.fsm_status)
              : "scheduled";
          const stateLabel = state ? APPOINTMENT_STATE_LABELS[state] : null;
          const boxColour = syncFailed
            ? "bg-danger text-white"
            : isFreeText
              ? "border border-dashed border-border bg-ink/40 text-white"
              : APPOINTMENT_STATE_STYLES[state ?? "scheduled"].bar;

          // Rings only mark real, actionable states: an out-of-window time, or
          // a leave conflict.
          let ring = "";
          if (outside) ring = "ring-2 ring-warning ring-offset-1";
          else if (conflictsWithLeave) ring = "ring-2 ring-destructive";

          const tooltip = syncFailed
            ? `Sync failed: ${entry.last_sync_error || "Zoho FSM rejected the change"}. Open to retry.`
            : allDay
              ? `${stateLabel ? `${stateLabel} · ` : ""}${label} — All Day`
              : outside
                ? `Outside the ${title} window — scheduled ${timeLabel}. Open to change the time or move it to the other shift.`
                : conflictsWithLeave
                  ? `Conflict: ${technician.display_name} is on leave during this appointment (${timeLabel})`
                  : `${stateLabel ? `${stateLabel} · ` : ""}${label} — ${timeLabel}${
                      !isFreeText && entry.fsm_appointment_id && entry.sync_status === "synced"
                        ? " · Synced to Zoho FSM"
                        : entry.entry_type === "new_appointment" && !entry.fsm_appointment_id
                          ? " · Will be created in FSM on approval"
                          : ""
                    }${overlaps ? " · Overlaps another appointment for this technician" : ""}${entry.origin === "fsm" ? " · Booked in Zoho FSM" : ""}`;

          // N1: sync-status icon.
          const synced = !isFreeText && Boolean(entry.fsm_appointment_id) && entry.sync_status === "synced";
          const pendingCreate = entry.entry_type === "new_appointment" && !entry.fsm_appointment_id && !syncFailed;

          // Vertical lane so overlapping entries stack (YFI v1.5). A small 2px
          // inset keeps stacked bars apart.
          const lane = laneOf.get(entry.id) ?? 0;
          const laneTop = lane * laneHeight + 2;
          const laneBoxHeight = laneHeight - 4;
          const draggable = isEditable && !allDay && !outside;
          const { primaryText, secondaryText } = entryText(entry, fieldVis, allDay);

          return (
            <button
              key={entry.id}
              type="button"
              onPointerDown={(e) => onBeginEntryDrag(e, entry, placed, id, "move")}
              // Pointer clicks are handled on pointer-up (so a drag isn't also
              // a click); this only catches keyboard activation.
              onClick={(e) => {
                if (e.detail === 0) onEntryClick(entry);
              }}
              className={cn(
                "group/bar absolute flex flex-col justify-center gap-0.5 overflow-hidden rounded border-r border-black/15 px-2 text-left shadow-sm transition-[box-shadow,filter,opacity] select-none",
                boxColour,
                movingAway
                  ? "z-10 opacity-35 shadow-none outline-2 -outline-offset-2 outline-white/80 outline-dashed"
                  : resizing
                    ? "ring-primary z-20 shadow-md ring-2 ring-offset-1"
                    : cn("z-10", ring),
                draggable ? "cursor-grab hover:shadow-md hover:brightness-110 active:cursor-grabbing" : "cursor-pointer",
              )}
              style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                top: laneTop,
                height: laneBoxHeight,
                touchAction: "none",
                transition: resizing ? "width 90ms ease-out" : undefined,
                backgroundImage: syncFailed ? SYNC_FAILED_STRIPES : undefined,
              }}
              title={beingDragged ? undefined : tooltip}
            >
              <span className="flex items-center gap-1 truncate text-[11px] leading-tight font-medium">
                {(outside || syncFailed) && <AlertTriangle className="size-3.5 shrink-0" />}
                {synced && <CircleCheck className="size-3.5 shrink-0" aria-label="Synced to FSM" />}
                {pendingCreate && <Clock className="size-3.5 shrink-0" aria-label="Pending creation in FSM" />}
                {overlaps && <Layers className="size-3.5 shrink-0" aria-label="Overlaps another appointment" />}
                <span className="truncate">{primaryText}</span>
              </span>
              {secondaryText && (
                <span className="truncate text-[10px] leading-tight opacity-85">{secondaryText}</span>
              )}
              {/* Right edge: drag to change how long the appointment runs. */}
              {draggable && !movingAway && (
                <span
                  onPointerDown={(e) => onBeginEntryDrag(e, entry, placed, id, "resize")}
                  className={cn(
                    "absolute inset-y-0 right-0 flex w-2.5 cursor-ew-resize items-center justify-center transition-opacity hover:bg-white/25",
                    resizing ? "bg-white/25 opacity-100" : "opacity-0 group-hover/bar:opacity-100",
                  )}
                  title="Drag to change the end time"
                  aria-hidden
                >
                  <span className="h-4 w-[3px] rounded-full border-x border-white/90" />
                </span>
              )}
            </button>
          );
        })}

        {/* The bar being moved, previewed where it would land. */}
        {ghostView && ghost && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute z-30 flex flex-col justify-center gap-0.5 overflow-hidden rounded px-2 text-white shadow-lg ring-2 ring-white",
              ghost.blockedReason ? "bg-destructive" : ghostView.freeText ? "bg-ink/70" : "bg-primary",
            )}
            style={{
              left: `${ghostView.leftPct}%`,
              width: `${ghostView.widthPct}%`,
              top: ghostView.top,
              height: laneHeight - 4,
              transition: "left 90ms ease-out, top 90ms ease-out",
            }}
          >
            <span className="flex items-center gap-1 truncate text-[11px] leading-tight font-semibold">
              {ghost.blockedReason ? <Ban className="size-3.5 shrink-0" /> : <Clock className="size-3.5 shrink-0" />}
              <span className="truncate">{formatRange(ghost.startMin, ghost.endMin)}</span>
            </span>
            <span className="truncate text-[10px] leading-tight opacity-90">{ghostView.text}</span>
          </div>
        )}

        {/* Just dropped here: a brief highlight. */}
        <span
          className={cn(
            "bg-primary/15 pointer-events-none absolute inset-0 z-[6] transition-opacity duration-700",
            flash ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
    </div>
  );
});
