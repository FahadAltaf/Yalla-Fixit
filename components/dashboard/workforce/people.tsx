"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { complianceService } from "@/modules/compliance";
import { executeRESTBackend } from "@/lib/rest-server";
import type { EmployeeRecord, LookupOption } from "@/lib/compliance/types";
import { EMPLOYMENT_STATUS_LABEL, EMPLOYMENT_STATUSES, type ComplianceEmploymentStatus } from "@/lib/compliance/statuses";
import {
  leaveService,
  leaveTypesService,
  tagsService,
  rolesService,
  serviceTypesService,
  techniciansService,
  type TechnicianAttributeUpdate,
} from "@/modules/scheduling";
import {
  LeaveRecord,
  LeaveType,
  TechnicianReference,
  TechnicianTag,
  TechnicianRole,
  TechnicianServiceType,
} from "@/types/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select as UiSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/actions/utils";
import {
  formatZonedDate,
  zonedTimeToUtc,
} from "@/lib/scheduling/org-time";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Check,
  ListFilter,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Clock,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import {
  AvailabilityCell,
  RoleCell,
  ServiceCell,
  ShiftCell,
  TechnicianIdentity,
  TechnicianRowSkeleton,
  Unset,
} from "@/components/dashboard/scheduling/technician-cells";
import TimeSelect from "@/components/ui/time-select";
import { Card } from "@/components/ui/card";
import { TablePager } from "@/components/data-table/table-pager";
import { ManageTechnicianDialog, type TechnicianDialogView } from "./manage-technician-dialog";
import { Hint } from "@/components/ui/hint";

/*
  Workforce People (C6, Sami 31 Oct 2026). This was Scheduling's
  "Technicians & leave" page; it now lists everyone:

  - FSM technicians, each with their compliance employee when linked;
  - compliance employees not in FSM, who never hold scheduling fields or
    leave, so they can never reach the board or a submission.

  Every field is still stored where its module reads it: scheduling fields
  and leave on the FSM technician (Scheduling's routes), compliance fields
  on the employee (Compliance's routes).
*/
export type WorkforceAccess = {
  scheduling: boolean;
  compliance: boolean;
  complianceCreate: boolean;
  complianceEdit: boolean;
  /** Settings → Workforce (the shared lists). */
  lists: boolean;
  /** Leave for employees not in FSM. */
  leaveAdd: boolean;
  leaveCancel: boolean;
};

type Props = { technicians: TechnicianReference[]; access: WorkforceAccess };

// Who is shown: everyone, FSM technicians only (Scheduling's old page),
// employees with no FSM user, or FSM technicians with no employee record.
type Scope = "all" | "fsm" | "not_fsm" | "needs_maher";
const SCOPES: { value: Scope; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "fsm", label: "In FSM" },
  { value: "not_fsm", label: "Not in FSM" },
  { value: "needs_maher", label: "Needs a Maher ID" },
];

type Person = {
  key: string;
  name: string;
  tech: TechnicianReference | null;
  employee: EmployeeRecord | null;
};

/** The person page address: the employee when there is one, else the technician. */
export function personHref(p: { employee: { id: string } | null; tech: { fsm_resource_id: string } | null }): string {
  return p.employee ? `/workforce/${p.employee.id}` : `/workforce/fsm-${p.tech?.fsm_resource_id ?? ""}`;
}

const ACTIVE_STATUSES: ComplianceEmploymentStatus[] = ["active", "on_leave"];
// "Who is on leave" (Sami, 31 Oct 2026), across both kinds of leave.
type LeaveFilter = "any" | "now" | "upcoming" | "now_or_upcoming";
const LEAVE_FILTERS: { value: LeaveFilter; label: string }[] = [
  { value: "any", label: "Leave: anyone" },
  { value: "now", label: "On leave now" },
  { value: "upcoming", label: "Upcoming leave" },
  { value: "now_or_upcoming", label: "On leave now or upcoming" },
];

// The compliance filters the old Employees list took, so its links still land.
const COMPLIANCE_FILTER_KEYS = ["employment_status", "item_status", "site"] as const;

// Columns of the technician list that can be filtered like a spreadsheet.
type FilterColumn = "role" | "service" | "shift" | "supervisor" | "tags" | "availability";
const FILTER_COLUMNS: FilterColumn[] = ["role", "service", "shift", "supervisor", "tags", "availability"];
const FILTER_LABELS: Record<FilterColumn, string> = {
  role: "Role",
  service: "Service",
  shift: "Shift",
  supervisor: "Supervisor",
  tags: "Tags",
  availability: "Availability",
};
// The value a row has when a column is empty for it.
const BLANK = "(blank)";

const SHIFT_OPTIONS = [
  { value: "", label: "— Shift —" },
  { value: "morning", label: "Morning" },
  { value: "night", label: "Night" },
];

// A leave period from either table: Scheduling's (FSM technicians) or the
// Workforce one (employees not in FSM).
type LeavePeriod = Pick<LeaveRecord, "leave_type" | "start_at" | "end_at" | "status">;

function nearestActiveLeave<T extends LeavePeriod>(records: T[]): { record: T; current: boolean } | null {
  const now = Date.now();
  const active = records.filter((r) => r.status === "active" && new Date(r.end_at).getTime() >= now);
  if (active.length === 0) return null;
  const current = active.find((r) => new Date(r.start_at).getTime() <= now && now <= new Date(r.end_at).getTime());
  if (current) return { record: current, current: true };
  active.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  return { record: active[0], current: false };
}

// A compact styled native select used for the attribute cells.
function Select({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "border-input bg-transparent dark:bg-input/30 h-8 rounded-md border px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function WorkforcePeople({ technicians, access }: Props) {
  const searchParams = useSearchParams();
  const initialScope = (SCOPES.find((s) => s.value === searchParams.get("scope"))?.value ?? "all") as Scope;
  const [scope, setScopeState] = useState<Scope>(initialScope);
  const setScope = (next: Scope) => {
    setScopeState(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "all") params.delete("scope");
    else params.set("scope", next);
    const query = params.toString();
    window.history.replaceState(window.history.state, "", query ? `/workforce?${query}` : "/workforce");
  };
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [designations, setDesignations] = useState<LookupOption[]>([]);
  const [nationalities, setNationalities] = useState<LookupOption[]>([]);
  // Employee ids matching the compliance filters in the address, or null.
  const complianceFilter = useMemo(() => {
    const out: Record<string, string> = {};
    COMPLIANCE_FILTER_KEYS.forEach((k) => {
      const v = searchParams.get(k);
      if (v) out[k] = v;
    });
    return Object.keys(out).length ? out : null;
  }, [searchParams]);
  const [filteredEmployeeIds, setFilteredEmployeeIds] = useState<Set<string> | null>(null);
  const [leaveFilter, setLeaveFilter] = useState<LeaveFilter>(() =>
    LEAVE_FILTERS.some((f) => f.value === searchParams.get("leave")) ? (searchParams.get("leave") as LeaveFilter) : "any",
  );
  // Current and upcoming leave of employees not in FSM, by employee id.
  const [employeeLeave, setEmployeeLeave] = useState<Map<string, (LeavePeriod & { employee_id: string })[]>>(new Map());

  const [tags, setTags] = useState<TechnicianTag[]>([]);
  const [roles, setRoles] = useState<TechnicianRole[]>([]);
  const [services, setServices] = useState<TechnicianServiceType[]>([]);
  const [assignments, setAssignments] = useState<Record<string, TechnicianTag[]>>({});
  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);
  // Live copy of technicians so attribute edits reflect without a full reload.
  const [techs, setTechs] = useState<TechnicianReference[]>(technicians);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [refreshing, setRefreshing] = useState(false);

  /* The row menu's dialog: which technician, and which view (attributes, working hours or leave). */
  const [activeTechnician, setActiveTechnician] = useState<{ technician: TechnicianReference; view: TechnicianDialogView } | null>(null);
  // FR-21: the managed list behind the Add Leave dropdown.
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [bulkLeaveOpen, setBulkLeaveOpen] = useState(false);
  // FR-23: resigned technicians (inactive in FSM) are out of the way by
  // default; the filter brings them back for a look at their history.
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">(() => {
    const status = searchParams.get("employment_status");
    return status && !["active", "on_leave", "active_manpower"].includes(status) ? "all" : "active";
  });

  const loadEmployees = useCallback(async () => {
    if (!access.compliance) return;
    try {
      const [all, designationList, nationalityList, filtered] = await Promise.all([
        complianceService.listEmployees({ page: 0, pageSize: 500 }),
        complianceService.listOptions("designation"),
        complianceService.listOptions("nationality"),
        complianceFilter ? complianceService.listEmployees({ ...complianceFilter, page: 0, pageSize: 500 }) : Promise.resolve(null),
      ]);
      setEmployees(all.data);
      if (all.totalCount > all.data.length) {
        toast.warning(`Showing the first ${all.data.length} of ${all.totalCount} employees; the rest are not listed here.`);
      }
      setDesignations(designationList);
      setNationalities(nationalityList);
      setFilteredEmployeeIds(filtered ? new Set(filtered.data.map((e) => e.id)) : null);
      // Soft: before the leave migration is applied this simply finds nothing.
      executeRESTBackend<(LeavePeriod & { employee_id: string })[]>("/api/workforce/leave", { params: { current: "1" } })
        .then((rows) => {
          const byEmployee = new Map<string, (LeavePeriod & { employee_id: string })[]>();
          rows.forEach((r) => byEmployee.set(r.employee_id, [...(byEmployee.get(r.employee_id) ?? []), r]));
          setEmployeeLeave(byEmployee);
        })
        .catch((e) => console.warn("Workforce leave not loaded:", e));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load employees");
    }
  }, [access.compliance, complianceFilter]);

  // Again whenever the compliance filter in the address changes.
  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  const loadAll = async () => {
    if (!access.scheduling) {
      setLoading(false);
      return;
    }
    try {
      const [tagList, assignmentMap, leave, roleList, serviceList, leaveTypeList] = await Promise.all([
        tagsService.listTags(),
        tagsService.listAssignmentsByTechnician(),
        leaveService.listLeave({ status: "active" }),
        rolesService.list(),
        serviceTypesService.list(),
        leaveTypesService.list(),
      ]);
      setTags(tagList);
      setAssignments(assignmentMap);
      setLeaveRecords(leave);
      setRoles(roleList);
      setServices(serviceList);
      setLeaveTypes(leaveTypeList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load scheduling data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const roleOptions = useMemo(
    () => [{ value: "", label: "— Role —" }, ...roles.map((r) => ({ value: r.id, label: r.name }))],
    [roles],
  );
  const serviceOptions = useMemo(
    () => [{ value: "", label: "— Service —" }, ...services.map((s) => ({ value: s.id, label: s.name }))],
    [services],
  );
  // Supervisors only: each technician is assigned to the supervisor they report to.
  const supervisorOptions = useMemo(
    () => [
      { value: "", label: "— Supervisor —" },
      ...[...techs]
        .filter((t) => t.is_active && (t.role_name ?? "").toLowerCase() === "supervisor")
        .sort((a, b) => a.display_name.localeCompare(b.display_name))
        .map((t) => ({ value: t.fsm_resource_id, label: t.display_name })),
    ],
    [techs],
  );

  const leaveByTechnician = useMemo(() => {
    const byTech = new Map<string, LeaveRecord[]>();
    leaveRecords.forEach((r) => {
      const list = byTech.get(r.technician_fsm_id) ?? [];
      list.push(r);
      byTech.set(r.technician_fsm_id, list);
    });
    return byTech;
  }, [leaveRecords]);

  // Column filters, as in a spreadsheet: each column offers its distinct
  // values with a tick box; a row shows when it matches every active column.
  const [columnFilters, setColumnFilters] = useState<Partial<Record<FilterColumn, Set<string>>>>({});
  const valuesOf = useMemo(() => {
    const leaveOf = (id: string) => nearestActiveLeave(leaveByTechnician.get(id) ?? []);
    return (t: TechnicianReference, column: FilterColumn): string[] => {
      switch (column) {
        case "role":
          return [t.role_name ?? BLANK];
        case "service":
          return [t.service_type_name ?? BLANK];
        case "shift":
          return [t.shift === "night" ? "Night" : t.shift === "morning" ? "Morning" : BLANK];
        case "supervisor":
          return [t.team_leader_name ?? BLANK];
        case "tags": {
          const names = (assignments[t.fsm_resource_id] ?? []).map((tag) => tag.name);
          return names.length ? names : [BLANK];
        }
        case "availability": {
          // FR-21: the leave type is part of the value, so the column filters
          // by type as well ("On leave · Annual", "Upcoming leave · Sick").
          const leave = leaveOf(t.fsm_resource_id);
          return [leave ? `${leave.current ? "On leave" : "Upcoming leave"} · ${leave.record.leave_type}` : "Available"];
        }
      }
    };
  }, [assignments, leaveByTechnician]);
  const filterOptions = useMemo(() => {
    const out = {} as Record<FilterColumn, { value: string; count: number }[]>;
    FILTER_COLUMNS.forEach((column) => {
      const counts = new Map<string, number>();
      techs.forEach((t) => valuesOf(t, column).forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1)));
      out[column] = [...counts.entries()]
        .sort((a, b) => (a[0] === BLANK ? 1 : b[0] === BLANK ? -1 : a[0].localeCompare(b[0])))
        .map(([value, count]) => ({ value, count }));
    });
    return out;
  }, [techs, valuesOf]);
  const setColumnFilter = (column: FilterColumn, values: Set<string> | null) =>
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (values && values.size > 0) next[column] = values;
      else delete next[column];
      return next;
    });
  const activeFilterCount = Object.keys(columnFilters).length;

  // One row per person. A technician carries its linked employee; an
  // employee whose technician is not in the list (not in FSM, or no
  // Scheduling access to see technicians) is a row of its own.
  const people = useMemo<Person[]>(() => {
    const byFsm = new Map(employees.filter((e) => e.technician).map((e) => [e.technician!.fsm_resource_id, e]));
    const techIds = new Set(techs.map((t) => t.fsm_resource_id));
    const rows: Person[] = techs.map((t) => ({ key: t.fsm_resource_id, name: t.display_name, tech: t, employee: byFsm.get(t.fsm_resource_id) ?? null }));
    employees
      .filter((e) => !e.technician || !techIds.has(e.technician.fsm_resource_id))
      .forEach((e) => rows.push({ key: `emp:${e.id}`, name: e.full_name, tech: null, employee: e }));
    return rows;
  }, [techs, employees]);

  // The person's nearest leave: on the technician when in FSM, else on the employee.
  const leaveOfPerson = useCallback(
    (p: Person) =>
      p.tech
        ? nearestActiveLeave(leaveByTechnician.get(p.tech.fsm_resource_id) ?? [])
        : p.employee
          ? nearestActiveLeave(employeeLeave.get(p.employee.id) ?? [])
          : null,
    [leaveByTechnician, employeeLeave],
  );

  const visiblePeople = useMemo(() => {
    let list = [...people];
    if (scope === "fsm") list = list.filter((p) => p.tech);
    if (scope === "not_fsm") list = list.filter((p) => !p.tech && !p.employee?.technician);
    if (scope === "needs_maher") list = list.filter((p) => p.tech && !p.employee);
    if (filteredEmployeeIds) list = list.filter((p) => p.employee && filteredEmployeeIds.has(p.employee.id));
    if (leaveFilter !== "any") {
      list = list.filter((p) => {
        const leave = leaveOfPerson(p);
        if (!leave) return false;
        if (leaveFilter === "now") return leave.current;
        if (leaveFilter === "upcoming") return !leave.current;
        return true;
      });
    }
    if (activeFilter !== "all") {
      const wantActive = activeFilter === "active";
      list = list.filter((p) =>
        p.tech ? p.tech.is_active === wantActive : ACTIVE_STATUSES.includes(p.employee!.employment_status) === wantActive,
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.employee?.full_name.toLowerCase().includes(q) ?? false) ||
          (p.employee?.maher_id.toLowerCase().includes(q) ?? false),
      );
    }
    // Scheduling column filters: a person not in FSM has no values there.
    (Object.entries(columnFilters) as [FilterColumn, Set<string>][]).forEach(([column, allowed]) => {
      list = list.filter((p) => p.tech && valuesOf(p.tech, column).some((v) => allowed.has(v)));
    });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [people, scope, filteredEmployeeIds, leaveFilter, leaveOfPerson, search, columnFilters, valuesOf, activeFilter]);

  // Paginate rather than rendering all ~90 technicians at once: a long
  // unbroken table is slow to scan and slow to render.
  const total = visiblePeople.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = visiblePeople.slice(pageStart, pageStart + pageSize);

  // Searching or resizing should always land you back on the first page,
  // otherwise a narrowed result set can look empty.
  useEffect(() => {
    setPage(1);
  }, [search, pageSize, columnFilters, activeFilter, scope, leaveFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (access.complianceEdit) {
        // Runs Scheduling's sync, then the C3 site check.
        await complianceService.refreshRoster();
        toast.success("Synced technicians and sites from Zoho FSM");
      } else {
        const result = await techniciansService.refreshFromFsm();
        const removed = (result?.removed?.deleted?.length ?? 0) + (result?.removed?.referenced?.length ?? 0);
        toast.success(
          `Synced ${result?.resources?.length ?? 0} technicians from Zoho FSM` +
          (removed > 0 ? ` (${removed} no longer listed)` : ""),
        );
      }
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh technicians");
      setRefreshing(false);
    }
  };

  // Applies an attribute change to one or many technicians and updates local
  // state immediately (optimistic) with a background revert on error.
  // Bulk edit bar: who is selected, and what they currently have in common. A
  // dropdown shows the value every selected technician shares (or a "Mixed"
  // placeholder), so after "set for all" it reads back what was set instead of
  // snapping to its label.
  const [showAllSelected, setShowAllSelected] = useState(false);
  // Only ticked people still shown count: a filter change never leaves a
  // hidden person inside a bulk edit.
  const visibleKeys = useMemo(() => new Set(visiblePeople.map((p) => p.key)), [visiblePeople]);
  const selectedTechs = useMemo(
    () => techs.filter((t) => selected.has(t.fsm_resource_id) && visibleKeys.has(t.fsm_resource_id)),
    [techs, selected, visibleKeys],
  );
  const selectedPeople = useMemo(() => visiblePeople.filter((p) => selected.has(p.key)), [visiblePeople, selected]);
  const selectedEmployees = useMemo(
    () => selectedPeople.map((p) => p.employee).filter((e): e is EmployeeRecord => Boolean(e)),
    [selectedPeople],
  );
  const notInFsmSelected = selectedPeople.length - selectedTechs.length;
  const commonEmployeeValue = (pick: (e: EmployeeRecord) => string | null | undefined) => {
    const values = new Set(selectedEmployees.map((e) => pick(e) ?? ""));
    return values.size === 1 ? [...values][0] : null;
  };
  const designationOptions = useMemo(
    () => [{ value: "", label: "— Designation —" }, ...designations.map((d) => ({ value: d.id, label: d.name }))],
    [designations],
  );
  const nationalityOptions = useMemo(
    () => [{ value: "", label: "— Nationality —" }, ...nationalities.map((n) => ({ value: n.id, label: n.name }))],
    [nationalities],
  );
  const STATUS_OPTIONS = [{ value: "", label: "— Status —" }, ...EMPLOYMENT_STATUSES.map((s) => ({ value: s, label: EMPLOYMENT_STATUS_LABEL[s] }))];
  const [savingEmployees, setSavingEmployees] = useState(false);
  // 13-7 decision 4: compliance fields in bulk, each employee through the
  // ordinary update, so the FSM status rule and the audit apply
  // to each. A refusal names the person and the rest still go through.
  const applyEmployeeBulk = async (
    patch: { designation_id?: string | null; nationality_id?: string | null; employment_status?: ComplianceEmploymentStatus },
    what: string,
    valueLabel?: string,
  ) => {
    setSavingEmployees(true);
    const failed: string[] = [];
    // Five at a time: each update checks and audits on its own (about 4 s
    // each), so one by one a large selection took minutes.
    for (let i = 0; i < selectedEmployees.length; i += 5) {
      await Promise.all(
        selectedEmployees.slice(i, i + 5).map((e) =>
          complianceService.updateEmployee(e.id, patch).catch((error) => {
            failed.push(`${e.full_name}: ${error instanceof Error ? error.message : "failed"}`);
          }),
        ),
      );
    }
    setSavingEmployees(false);
    await loadEmployees();
    const done = selectedEmployees.length - failed.length;
    if (done > 0) toast.success(`${what} set to ${valueLabel ?? "blank"} for ${done} employee${done === 1 ? "" : "s"}`);
    if (failed.length) toast.error(`${failed.length} not changed. ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? " …" : ""}`, { duration: 10000 });
  };
  const commonValue = (pick: (t: TechnicianReference) => string | null | undefined) => {
    const values = new Set(selectedTechs.map((t) => pick(t) ?? ""));
    return values.size === 1 ? [...values][0] : null; // null = mixed
  };
  const bulk = {
    role: commonValue((t) => t.role_id),
    service: commonValue((t) => t.service_type_id),
    shift: commonValue((t) => t.shift),
    supervisor: commonValue((t) => t.team_leader_fsm_id),
  };
  // Mixed: swap the placeholder so the dropdown says so. Picking it again is a
  // no-op (the value doesn't change), so nothing gets cleared by accident.
  const bulkOptions = (options: { value: string; label: string }[], common: string | null) =>
    common === null ? [{ value: "", label: "Mixed — pick one to set all" }, ...options.slice(1)] : options;
  const deselect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  const clearSelection = () => {
    setSelected(new Set());
    setShowAllSelected(false);
  };
  const applyBulk = async (attrs: TechnicianAttributeUpdate, what: string, valueLabel?: string) => {
    // People not in FSM are skipped: only FSM technicians hold these fields.
    const ids = selectedTechs.map((t) => t.fsm_resource_id);
    if (!(await applyAttributes(ids, attrs))) return;
    const who = `${ids.length} technician${ids.length === 1 ? "" : "s"}`;
    toast.success(valueLabel ? `${what} set to ${valueLabel} for ${who}` : `${what} cleared for ${who}`, {
      action: { label: "Clear selection", onClick: clearSelection },
    });
  };

  const applyAttributes = async (ids: string[], attrs: TechnicianAttributeUpdate) => {
    const before = new Map(techs.map((t) => [t.fsm_resource_id, t]));
    setTechs((prev) =>
      prev.map((t) => {
        if (!ids.includes(t.fsm_resource_id)) return t;
        const next = { ...t };
        if ("roleId" in attrs) {
          next.role_id = attrs.roleId ?? null;
          next.role_name = roles.find((r) => r.id === attrs.roleId)?.name ?? null;
        }
        if ("serviceTypeId" in attrs) {
          next.service_type_id = attrs.serviceTypeId ?? null;
          next.service_type_name = services.find((s) => s.id === attrs.serviceTypeId)?.name ?? null;
        }
        if ("shift" in attrs) next.shift = attrs.shift ?? null;
        if ("teamLeaderFsmId" in attrs) {
          next.team_leader_fsm_id = attrs.teamLeaderFsmId ?? null;
          next.team_leader_name = techs.find((x) => x.fsm_resource_id === attrs.teamLeaderFsmId)?.display_name ?? null;
        }
        if (attrs.employmentStatus !== undefined) next.employment_status = attrs.employmentStatus;
        if ("leavingDate" in attrs) next.leaving_date = attrs.leavingDate ?? null;
        if (attrs.hiddenFromLists !== undefined) next.hidden_from_lists = attrs.hiddenFromLists;
        if ("restWeekdays" in attrs) next.rest_weekdays = attrs.restWeekdays ?? null;
        if ("dailyHours" in attrs) next.daily_hours = attrs.dailyHours ?? null;
        if ("weeklyHours" in attrs) next.weekly_hours = attrs.weeklyHours ?? null;
        if ("offDaysPerWeek" in attrs) next.off_days_per_week = attrs.offDaysPerWeek ?? null;
        return next;
      }),
    );
    try {
      await techniciansService.updateAttributes(ids, attrs);
      return true;
    } catch (error) {
      setTechs((prev) => prev.map((t) => before.get(t.fsm_resource_id) ?? t));
      toast.error(error instanceof Error ? error.message : "Failed to update technician");
      return false;
    }
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Everything that matches the search and the column filters, across every
  // page: filter first, then tick the box, then edit in bulk.
  const allVisibleSelected = visiblePeople.length > 0 && visiblePeople.every((p) => selected.has(p.key));
  const toggleSelectAll = () => setSelected(allVisibleSelected ? new Set<string>() : new Set(visiblePeople.map((p) => p.key)));

  const selectedIds = selectedTechs.map((t) => t.fsm_resource_id);
  const fsmCount = techs.length;
  const columnCount = 3 + (access.compliance ? 1 : 0) + (access.scheduling ? FILTER_COLUMNS.length : 0);
  const notInFsmCount = people.filter((p) => !p.tech && !p.employee?.technician).length;
  const needsMaherCount = people.filter((p) => p.tech && !p.employee).length;

  return (
    <>
      <div className="flex flex-col gap-4">
        <PageHeading
          eyebrow="Workforce"
          title="People"
          description={[
            access.scheduling ? `${fsmCount} in FSM` : null,
            access.compliance ? `${employees.length} employees` : null,
            access.compliance ? `${notInFsmCount} not in FSM` : null,
            access.scheduling && access.compliance ? `${needsMaherCount} need a Maher ID` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          actions={
            <div className="flex items-center gap-2">
              {access.lists && (
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings/workforce">
                    <Settings2 className="size-4" /> Lists
                  </Link>
                </Button>
              )}
              {access.complianceCreate && (
                <Button asChild size="sm">
                  <Link href="/compliance/employees/new">
                    <Plus className="size-4" /> New employee
                  </Link>
                </Button>
              )}
            </div>
          }
        />

        {/* 2 Nov: one card for toolbar, table and footer, as on Users and Quotations. */}
        <Card className="gap-0 overflow-hidden py-0">
        {/* Toolbar: search on the left, filters / page size / refresh on the right (the house toolbar shape). */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 sm:gap-4 sm:py-6">
          <div className="relative w-full sm:w-80 sm:flex-none">
            <Input
              placeholder="Search name or Maher ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="peer w-full ps-9"
              aria-label="Search people"
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
              <Search className="size-4" aria-hidden />
            </div>
          </div>
          {complianceFilter && (
            <Button asChild variant="outline" size="sm">
              <Link href="/workforce">
                <X className="size-3.5" />
                Compliance filter: {Object.values(complianceFilter).join(", ").replaceAll("_", " ")} · {visiblePeople.length} shown
              </Link>
            </Button>
          )}
          {activeFilterCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => setColumnFilters({})}>
              <X className="size-3.5" />
              Clear {activeFilterCount} column filter{activeFilterCount === 1 ? "" : "s"} · {visiblePeople.length} shown
            </Button>
          )}
          <div className="flex items-center gap-2">
            {/* FR-23: active technicians by default; inactive ones (resigned
                in FSM) stay reachable for their history. */}
            {access.scheduling && access.compliance && (
              <UiSelect value={scope} onValueChange={(v) => setScope(v as Scope)}>
                <SelectTrigger className="w-max" aria-label="Who to show">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </UiSelect>
            )}
            <UiSelect
              value={leaveFilter}
              onValueChange={(v) => {
                setLeaveFilter(v as LeaveFilter);
                const params = new URLSearchParams(window.location.search);
                if (v === "any") params.delete("leave");
                else params.set("leave", v);
                const query = params.toString();
                window.history.replaceState(window.history.state, "", query ? `/workforce?${query}` : "/workforce");
              }}
            >
              <SelectTrigger className="w-max" aria-label="Who is on leave">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </UiSelect>
            <UiSelect value={activeFilter} onValueChange={(v) => setActiveFilter(v as typeof activeFilter)}>
              <SelectTrigger className="w-max" aria-label="Active or inactive technicians">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="all">Active and inactive</SelectItem>
              </SelectContent>
            </UiSelect>
            {/* A native <select> was the one control on this page that did
                not match the rest of the app; this is the same Select used
                everywhere else. */}
            <UiSelect value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="w-max" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </UiSelect>
            <Button variant="outline" onClick={handleRefresh} disabled={refreshing || (!access.scheduling && !access.complianceEdit)}>
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              {refreshing ? "Syncing..." : "Refresh"}
            </Button>
          </div>
        </div>

        {/* Bulk edit bar (#15) — appears when technicians are selected. */}
        {selectedPeople.length > 0 && (
          <div className="border-primary/40 bg-primary/5 mx-4 mb-4 flex flex-col gap-2 rounded-md border p-2.5">
            {/* Who is selected, each removable; Clear is a real button. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{selectedPeople.length} selected</span>
              {(showAllSelected ? selectedPeople : selectedPeople.slice(0, 6)).map((p) => (
                <span
                  key={p.key}
                  className="bg-background inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-xs"
                >
                  {p.name}
                  <button
                    type="button"
                    onClick={() => deselect(p.key)}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-full p-0.5"
                    aria-label={`Deselect ${p.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {selectedPeople.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllSelected((v) => !v)}
                  className="text-primary text-xs hover:underline"
                >
                  {showAllSelected ? "Show fewer" : `+${selectedPeople.length - 6} more`}
                </button>
              )}
              <Button size="sm" variant="outline" className="ml-auto h-8" onClick={clearSelection}>
                <X className="size-3.5" />
                Clear selection
              </Button>
            </div>
            {/* Set for all. Each dropdown shows what the selection currently shares. */}
            {access.scheduling && selectedTechs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">
                Scheduling, {selectedTechs.length} in FSM{notInFsmSelected > 0 ? ` (${notInFsmSelected} not in FSM skipped)` : ""}:
              </span>
              <Select
                ariaLabel="Set role"
                value={bulk.role ?? ""}
                options={bulkOptions(roleOptions, bulk.role)}
                onChange={(v) => applyBulk({ roleId: v || null }, "Role", roleOptions.find((o) => o.value === v)?.label)}
              />
              <Select
                ariaLabel="Set service"
                value={bulk.service ?? ""}
                options={bulkOptions(serviceOptions, bulk.service)}
                onChange={(v) =>
                  applyBulk({ serviceTypeId: v || null }, "Service", serviceOptions.find((o) => o.value === v)?.label)
                }
              />
              <Select
                ariaLabel="Set shift"
                value={bulk.shift ?? ""}
                options={bulkOptions(SHIFT_OPTIONS, bulk.shift)}
                onChange={(v) =>
                  applyBulk(
                    { shift: (v || null) as "morning" | "night" | null },
                    "Shift",
                    SHIFT_OPTIONS.find((o) => o.value === v)?.label,
                  )
                }
              />
              <Select
                ariaLabel="Set supervisor"
                value={bulk.supervisor ?? ""}
                options={bulkOptions(supervisorOptions.filter((o) => !selected.has(o.value)), bulk.supervisor)}
                onChange={(v) =>
                  applyBulk({ teamLeaderFsmId: v || null }, "Supervisor", supervisorOptions.find((o) => o.value === v)?.label)
                }
              />
              <BulkTagMenu tags={tags} selectedIds={selectedIds} onChanged={loadAll} />
              {/* FR-21: one leave period for everyone ticked, e.g. a Public
                  Holiday for the whole team. Inactive technicians are skipped. */}
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => setBulkLeaveOpen(true)}
                disabled={!selectedTechs.some((t) => t.is_active)}
              >
                <Plus className="size-3.5" /> Add leave
              </Button>
            </div>
            )}
            {access.complianceEdit && selectedEmployees.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  Compliance, {selectedEmployees.length} employee{selectedEmployees.length === 1 ? "" : "s"}
                  {selectedPeople.length > selectedEmployees.length ? ` (${selectedPeople.length - selectedEmployees.length} with no employee record skipped)` : ""}:
                </span>
                {(() => {
                  const d = commonEmployeeValue((e) => e.designation?.id);
                  const n = commonEmployeeValue((e) => e.nationality?.id);
                  const s = commonEmployeeValue((e) => e.stored_employment_status);
                  return (
                    <>
                      <Select
                        ariaLabel="Set designation"
                        value={d ?? ""}
                        options={bulkOptions(designationOptions, d)}
                        onChange={(v) => v && applyEmployeeBulk({ designation_id: v }, "Designation", designationOptions.find((o) => o.value === v)?.label)}
                      />
                      <Select
                        ariaLabel="Set nationality"
                        value={n ?? ""}
                        options={bulkOptions(nationalityOptions, n)}
                        onChange={(v) => v && applyEmployeeBulk({ nationality_id: v }, "Nationality", nationalityOptions.find((o) => o.value === v)?.label)}
                      />
                      <Select
                        ariaLabel="Set employment status"
                        value={s ?? ""}
                        options={bulkOptions(STATUS_OPTIONS, s)}
                        onChange={(v) =>
                          v && applyEmployeeBulk({ employment_status: v as ComplianceEmploymentStatus }, "Status", STATUS_OPTIONS.find((o) => o.value === v)?.label)
                        }
                      />
                      {savingEmployees && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        <div className="overflow-x-auto [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th]:text-muted-foreground [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
          <Table>
            <TableHeader>
              <TableRow className="h-14 border-t hover:bg-transparent">
                <TableHead className="w-[1%]">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label={`Select all ${visiblePeople.length} matching people`}
                    title={`Select all ${visiblePeople.length} matching people`}
                  />
                </TableHead>
                <TableHead>Person</TableHead>
                {access.compliance && <TableHead>Employee</TableHead>}
                {access.scheduling && FILTER_COLUMNS.map((column) => (
                  <TableHead key={column}>
                    <span className="flex items-center gap-1">
                      {FILTER_LABELS[column]}
                      <ColumnFilter
                        label={FILTER_LABELS[column]}
                        options={filterOptions[column]}
                        selected={columnFilters[column] ?? null}
                        onChange={(values) => setColumnFilter(column, values)}
                      />
                    </span>
                  </TableHead>
                ))}
                <TableHead className="w-[1%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                // Skeleton rows mirror the real row shape so nothing reflows
                // when the data lands.
                Array.from({ length: 5 }).map((_, i) => <TechnicianRowSkeleton key={i} columns={columnCount} />)
              ) : pageRows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columnCount} className="p-0">
                    <EmptyState
                      className="border-0"
                      icon={<UsersRound className="size-5" />}
                      title={search ? "No matching people" : "Nobody here yet"}
                      description={
                        search
                          ? `Nothing matches “${search}”. Try a different name, or clear the search.`
                          : "Technicians are synced from Zoho FSM. Run a refresh to pull the current roster."
                      }
                      action={
                        search
                          ? { label: "Clear search", onClick: () => setSearch(""), variant: "outline" }
                          : { label: "Refresh from FSM", onClick: handleRefresh }
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((person) => {
                  const technician = person.tech;
                  const employee = person.employee;
                  const employeeCell = access.compliance ? (
                    <TableCell>
                      {employee ? (
                        <div className="flex flex-col">
                          <span className="text-sm">{employee.designation?.name ?? <Unset />}</span>
                          <span className="text-muted-foreground text-xs">
                            {employee.maher_id} · {EMPLOYMENT_STATUS_LABEL[employee.employment_status]}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">No employee record</span>
                      )}
                    </TableCell>
                  ) : null;
                  if (!technician) {
                    // Not in FSM (or no Scheduling access): compliance only.
                    return (
                      <TableRow key={person.key} data-state={selected.has(person.key) ? "selected" : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(person.key)}
                            onCheckedChange={() => toggleSelect(person.key)}
                            aria-label={`Select ${person.name}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Link href={personHref(person)} className="hover:underline">
                            <TechnicianIdentity
                              name={person.name}
                              subtitle={employee?.technician ? `FSM: ${employee.technician.display_name}` : "Not in FSM"}
                              seed={person.key}
                              inactive={!!employee && !ACTIVE_STATUSES.includes(employee.employment_status)}
                            />
                          </Link>
                        </TableCell>
                        {employeeCell}
                        {access.scheduling && (
                          <>
                            <TableCell colSpan={FILTER_COLUMNS.length - 1}>
                              <span className="text-muted-foreground text-xs">Not in FSM, not scheduled</span>
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const leave = leaveOfPerson(person);
                                return (
                                  <AvailabilityCell
                                    state={leave ? (leave.current ? "on-leave" : "upcoming") : "available"}
                                    detail={leave ? `${leave.record.leave_type} · ${formatZonedDate(leave.record.start_at)} – ${formatZonedDate(leave.record.end_at)}` : undefined}
                                  />
                                );
                              })()}
                            </TableCell>
                          </>
                        )}
                        <TableCell className="text-right">
                          <Button asChild size="sm" variant="ghost">
                            <Link href={personHref(person)}>Open</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  }
                  const leave = nearestActiveLeave(leaveByTechnician.get(technician.fsm_resource_id) ?? []);
                  const technicianTags = assignments[technician.fsm_resource_id] ?? [];
                  const id = technician.fsm_resource_id;
                  const leaveDetail = leave
                    ? `${formatZonedDate(leave.record.start_at)} – ${new Date(
                      leave.record.end_at,
                    ).toLocaleDateString()}`
                    : undefined;
                  return (
                    <TableRow key={id} data-state={selected.has(id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(id)}
                          onCheckedChange={() => toggleSelect(id)}
                          aria-label={`Select ${technician.display_name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Link href={personHref(person)} className="hover:underline">
                          <TechnicianIdentity
                            name={technician.display_name}
                            subtitle={employee ? employee.maher_id : access.compliance ? "Needs a Maher ID" : id}
                            seed={id}
                            inactive={!technician.is_active}
                            inactiveSince={technician.deactivated_at ?? null}
                          />
                        </Link>
                      </TableCell>
                      {employeeCell}
                      <TableCell>
                        <RoleCell name={technician.role_name} />
                      </TableCell>
                      <TableCell>
                        <ServiceCell name={technician.service_type_name} />
                      </TableCell>
                      <TableCell>
                        <ShiftCell shift={technician.shift} />
                      </TableCell>
                      <TableCell>
                        {technician.team_leader_name ? (
                          <span className="text-sm">{technician.team_leader_name}</span>
                        ) : (
                          <Unset />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-[180px] flex-wrap gap-1">
                          {technicianTags.length === 0 ? (
                            <Unset label="—" />
                          ) : (
                            technicianTags.map((tag) => (
                              <Badge key={tag.id} variant="secondary" className="font-normal">
                                {tag.name}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <AvailabilityCell
                          state={leave ? (leave.current ? "on-leave" : "upcoming") : "available"}
                          detail={leaveDetail}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Actions for ${technician.display_name}`}
                            >
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={personHref(person)}>
                                <UsersRound className="size-4" /> Open profile
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setActiveTechnician({ technician, view: "attributes" })}>
                              <SlidersHorizontal className="size-4" /> Edit attributes
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setActiveTechnician({ technician, view: "hours" })}>
                              <Clock className="size-4" /> Working hours
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setActiveTechnician({ technician, view: "leave" })}>
                              <Plus className="size-4" /> Add leave
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Footer: what you are looking at, and how to move through it (the shared pager). */}
        <div className="border-t">
          <TablePager
            currentPage={currentPage - 1}
            pageSize={pageSize}
            rowCount={total}
            loading={loading}
            onPageChange={(index) => setPage(index + 1)}
          />
        </div>
        </Card>

        {bulkLeaveOpen && (
          <BulkLeaveDialog
            technicians={selectedTechs.filter((t) => t.is_active)}
            leaveTypes={leaveTypes.map((t) => t.name)}
            onOpenChange={(open) => !open && setBulkLeaveOpen(false)}
            onChanged={loadAll}
          />
        )}

        {activeTechnician && (
          <ManageTechnicianDialog
            key={`${activeTechnician.technician.fsm_resource_id}-${activeTechnician.view}`}
            view={activeTechnician.view}
            technician={techs.find((t) => t.fsm_resource_id === activeTechnician.technician.fsm_resource_id) ?? activeTechnician.technician}
            tags={tags}
            leaveTypes={leaveTypes.map((t) => t.name)}
            roleOptions={roleOptions}
            serviceOptions={serviceOptions}
            supervisorOptions={supervisorOptions.filter((o) => o.value !== activeTechnician.technician.fsm_resource_id)}
            assignedTags={assignments[activeTechnician.technician.fsm_resource_id] ?? []}
            leaveRecords={leaveRecords.filter((r) => r.technician_fsm_id === activeTechnician.technician.fsm_resource_id)}
            onApplyAttributes={(attrs) => applyAttributes([activeTechnician.technician.fsm_resource_id], attrs)}
            onOpenChange={(open) => !open && setActiveTechnician(null)}
            onChanged={loadAll}
          />
        )}
      </div>
    </>
  );
}

// One "add or remove a tag on all selected" menu for the bulk bar.
function BulkTagMenu({
  tags,
  selectedIds,
  onChanged,
}: {
  tags: TechnicianTag[];
  selectedIds: string[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const apply = async (tagId: string, action: "assign" | "remove") => {
    setBusy(true);
    try {
      await Promise.all(
        selectedIds.map((id) =>
          action === "assign" ? tagsService.assignTag(id, tagId) : tagsService.removeTag(id, tagId),
        ),
      );
      toast.success(action === "assign" ? "Tag added to selected" : "Tag removed from selected");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update tags");
    } finally {
      setBusy(false);
    }
  };

  if (tags.length === 0) return null;
  return (
    <select
      aria-label="Add or remove a tag for selected"
      disabled={busy}
      value=""
      onChange={(e) => {
        const [action, tagId] = e.target.value.split(":");
        if (tagId) apply(tagId, action as "assign" | "remove");
      }}
      className="border-input bg-transparent dark:bg-input/30 h-8 rounded-md border px-2 text-sm"
    >
      <option value="">Tags…</option>
      <optgroup label="Add tag">
        {tags.map((t) => (
          <option key={`a-${t.id}`} value={`assign:${t.id}`}>
            + {t.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Remove tag">
        {tags.map((t) => (
          <option key={`r-${t.id}`} value={`remove:${t.id}`}>
            − {t.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

type ListItem = { id: string; name: string; color?: string | null; technician_count?: number };

// FR-2: preset highlight colours, readable as a row tint and as text.
const PRESET_COLORS = [
  "#dc2626", "#ea580c", "#d97706", "#ca8a04", "#65a30d", "#16a34a",
  "#059669", "#0d9488", "#0891b2", "#0284c7", "#2563eb", "#4f46e5",
  "#7c3aed", "#9333ea", "#c026d3", "#db2777", "#475569", "#78716c",
];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Pick a role's highlight colour: presets first, a custom colour as an option,
// and nothing is saved until OK -- the native picker fires on every drag, so
// saving on change sent a request per pixel.
function RoleColorPicker({
  name,
  value,
  disabled,
  onApply,
}: {
  name: string;
  value: string | null;
  disabled?: boolean;
  onApply: (color: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(value);
  const [customOpen, setCustomOpen] = useState(false);
  const [hexText, setHexText] = useState(value ?? "");

  const isPreset = (c: string | null) => !!c && PRESET_COLORS.includes(c.toLowerCase());

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // Start from the saved colour every time; Cancel/close discards.
      setDraft(value);
      setHexText(value ?? "");
      setCustomOpen(!!value && !isPreset(value));
    }
    setOpen(next);
  };

  const setCustom = (color: string) => {
    setDraft(color.toLowerCase());
    setHexText(color.toLowerCase());
  };

  const unchanged = (draft ?? "").toLowerCase() === (value ?? "").toLowerCase();

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Hint label={value ? `Highlight colour ${value}` : "No highlight colour — click to choose"}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded border disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: value ?? "transparent" }}
            aria-label={`Highlight colour for ${name}`}
          >
            {!value && (
              // A diagonal slash reads as "none" at a glance.
              <span className="bg-muted-foreground/50 absolute top-1/2 left-1/2 h-px w-[130%] -translate-x-1/2 -translate-y-1/2 -rotate-45" />
            )}
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Colour for {name}</PopoverTitle>
          <PopoverDescription className="text-xs">
            Tints this role&apos;s technicians on the schedule board.
          </PopoverDescription>
        </PopoverHeader>

        <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Preset colours">
          {PRESET_COLORS.map((c) => {
            const selected = draft?.toLowerCase() === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={c}
                onClick={() => setCustom(c)}
                className={cn(
                  "ring-offset-background flex size-9 items-center justify-center rounded-md transition-transform hover:scale-110 focus-visible:outline-none",
                  selected ? "ring-foreground ring-2 ring-offset-2" : "focus-visible:ring-ring focus-visible:ring-2",
                )}
                style={{ backgroundColor: c }}
              >
                {selected && <Check className="size-4 text-white drop-shadow" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={draft === null ? "secondary" : "outline"}
            onClick={() => setDraft(null)}
            aria-pressed={draft === null}
          >
            <X className="size-3.5" /> No colour
          </Button>
          <Button
            type="button"
            size="sm"
            variant={customOpen ? "secondary" : "outline"}
            onClick={() => {
              setCustomOpen((v) => !v);
              if (!customOpen && draft) setHexText(draft);
            }}
            aria-expanded={customOpen}
          >
            Custom colour…
          </Button>
        </div>

        {customOpen && (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={draft && HEX_COLOR.test(draft) ? draft : "#dc2626"}
              onChange={(e) => setCustom(e.target.value)}
              className="h-9 w-12 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
              aria-label="Pick a custom colour"
            />
            <Input
              value={hexText}
              onChange={(e) => {
                const text = e.target.value.trim();
                setHexText(text);
                if (HEX_COLOR.test(text)) setDraft(text.toLowerCase());
              }}
              placeholder="#1a2b3c"
              className="h-9 font-mono text-sm"
              aria-label="Hex colour"
              aria-invalid={hexText !== "" && !HEX_COLOR.test(hexText)}
            />
          </div>
        )}

        {/* Preview of how the row will read on the board. */}
        <div
          className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
          style={{
            backgroundColor: draft ? `${draft}0f` : undefined,
            borderLeft: draft ? `3px solid ${draft}` : undefined,
          }}
        >
          <span className="font-medium" style={{ color: draft ?? undefined }}>
            Technician name
          </span>
          {draft && (
            <span
              className="rounded px-1 py-0.5 text-[9px] font-semibold tracking-wide uppercase"
              style={{ backgroundColor: `${draft}22`, color: draft }}
            >
              {name}
            </span>
          )}
          {!draft && <span className="text-muted-foreground text-xs">No highlight</span>}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={unchanged}
            onClick={() => {
              onApply(draft);
              setOpen(false);
            }}
          >
            OK
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ManageListDialog({
  title,
  noun,
  items,
  onCreate,
  onRename,
  onDelete,
  onOpenChange,
  onChanged,
  colorable,
  countNoun,
  description,
  deleteDescription,
  inline,
  canAdd = true,
  canEdit = true,
  canDelete = true,
}: {
  title: string;
  noun: string;
  items: ListItem[];
  onCreate: (name: string) => Promise<unknown>;
  onRename: (id: string, name: string, color?: string | null) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  onChanged: () => void;
  // FR-2: when set, each item gets a highlight-colour swatch (roles).
  colorable?: boolean;
  // What technician_count counts, when it is not technicians (FR-21: leave records).
  countNoun?: string;
  description?: string;
  deleteDescription?: (item: ListItem) => string;
  // Settings → Workforce (31 Oct 2026): the same editor on the page, no dialog.
  inline?: boolean;
  // Hide what the list's route would refuse (default: everything allowed).
  canAdd?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ListItem | null>(null);

  const create = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await onCreate(newName.trim());
      setNewName("");
      toast.success(`${title.replace("Manage ", "").replace(/s$/, "")} created`);
      onChanged();
    } catch (error) {
      // #16: the API returns a clear "already exists" on a duplicate name.
      toast.error(error instanceof Error ? error.message : `Failed to create ${noun}`);
    } finally {
      setSaving(false);
    }
  };

  const rename = async (id: string) => {
    if (!editingName.trim()) {
      setEditingId(null);
      return;
    }
    setSaving(true);
    try {
      await onRename(id, editingName.trim());
      setEditingId(null);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to rename ${noun}`);
    } finally {
      setSaving(false);
    }
  };

  // FR-2: colour is persisted through onRename (name unchanged, colour set).
  const changeColor = async (item: ListItem, color: string | null) => {
    setSaving(true);
    try {
      await onRename(item.id, item.name, color);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to update ${noun} colour`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await onDelete(deleteTarget.id);
      toast.success(`${noun} deleted`);
      setDeleteTarget(null);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to delete ${noun}`);
    } finally {
      setSaving(false);
    }
  };

  const explanation =
    description ??
    `These options appear wherever a ${noun} can be chosen. Renaming one updates it everywhere; deleting clears it from any technician that had it.`;
  const body = (
    <>
          {canAdd && <div className="flex gap-2">
            <Input
              placeholder={`New ${noun} name`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <Button onClick={create} disabled={saving || !newName.trim()}>
              <Plus className="size-4" /> Add
            </Button>
          </div>}

          <div className={cn("flex flex-col gap-2", !inline && "max-h-80 overflow-y-auto")}>
            {items.length === 0 && (
              <p className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-sm">
                No {noun}s yet. Add the first one above.
              </p>
            )}
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                {editingId === item.id ? (
                  <Input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && rename(item.id)}
                    onBlur={() => rename(item.id)}
                    className="h-8"
                  />
                ) : (
                  <button
                    className="flex-1 text-left text-sm"
                    disabled={!canEdit}
                    onClick={() => {
                      setEditingId(item.id);
                      setEditingName(item.name);
                    }}
                  >
                    {item.name}{" "}
                    <span className="text-muted-foreground text-xs">({item.technician_count ?? 0} {countNoun ?? "technicians"})</span>
                  </button>
                )}
                {colorable && (
                  <RoleColorPicker
                    name={item.name}
                    value={item.color ?? null}
                    disabled={saving || !canEdit}
                    onApply={(color) => changeColor(item, color)}
                  />
                )}
                {canDelete && (
                  <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(item)} aria-label={`Delete ${item.name}`}>
                    <Trash2 className="text-destructive size-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
    </>
  );

  return (
    <>
      {inline ? (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">{explanation}</p>
          {body}
        </div>
      ) : (
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{explanation}</DialogDescription>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      )}

      <ConfirmationAlertDialog
        isOpen={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description={
          deleteTarget && deleteDescription
            ? deleteDescription(deleteTarget)
            : `This clears the ${noun} from ${deleteTarget?.technician_count ?? 0} technician(s). This cannot be undone.`
        }
        confirmText="Delete"
        variant="destructive"
        loading={saving}
        onConfirm={remove}
      />
    </>
  );
}

// FR-21: the Add Leave type picker. The free-text box it replaces let every
// supervisor spell a type their own way; this offers the managed list only.
function LeaveTypeSelect({
  value,
  onChange,
  types,
}: {
  value: string;
  onChange: (value: string) => void;
  types: string[];
}) {
  if (types.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-2 text-xs">
        No leave types yet. Add Annual, Sick, Public Holiday and Offset under Settings → Workforce → Leave types.
      </p>
    );
  }
  return (
    <UiSelect value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label="Leave type">
        <SelectValue placeholder="Leave type" />
      </SelectTrigger>
      <SelectContent>
        {types.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </UiSelect>
  );
}

// FR-21: one leave period for several technicians at once, which is how a
// Public Holiday is entered for the whole team. One record per technician.
function BulkLeaveDialog({
  technicians,
  leaveTypes,
  onOpenChange,
  onChanged,
}: {
  technicians: TechnicianReference[];
  leaveTypes: string[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:30");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!leaveType || !startDate || !endDate) {
      toast.error("Leave type, start date, and end date are required");
      return;
    }
    setSaving(true);
    try {
      const { records, conflicts, conflictsError } = await leaveService.createLeave({
        technicianFsmIds: technicians.map((t) => t.fsm_resource_id),
        leaveType,
        startAt: zonedTimeToUtc(startDate, startTime).toISOString(),
        endAt: zonedTimeToUtc(endDate, endTime).toISOString(),
        notes: notes.trim() || null,
      });
      toast.success(
        `${leaveType} saved for ${records.length} technician${records.length === 1 ? "" : "s"}` +
          (conflicts.length > 0 ? ` — ${conflicts.length} existing assignment(s) now conflict on the schedule` : "") +
          (conflictsError ? " — the conflict check failed, so check the board for overlaps" : ""),
      );
      onChanged();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save leave");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add leave for {technicians.length} technician{technicians.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            The same type and period is recorded for each ticked technician. Use this for a Public Holiday.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          {technicians.map((t) => (
            <Badge key={t.fsm_resource_id} variant="secondary" className="font-normal">
              {t.display_name}
            </Badge>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <LeaveTypeSelect value={leaveType} onChange={setLeaveType} types={leaveTypes} />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Start date
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Start time
              <TimeSelect value={startTime} onChange={setStartTime} aria-label="Leave start time" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              End date
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              End time
              <TimeSelect value={endTime} onChange={setEndTime} aria-label="Leave end time" />
            </label>
          </div>
          <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || technicians.length === 0}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Add Leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// One column's filter, as in a spreadsheet: every value the column holds,
// each with a tick box and a count; search to find one; Select all / Clear.
// Only the ticked values show. An active filter is marked on the heading.
function ColumnFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; count: number }[];
  // null = no filter on this column (everything shows).
  selected: Set<string> | null;
  onChange: (values: Set<string> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const active = selected !== null;
  const shown = options.filter((o) => o.value.toLowerCase().includes(query.trim().toLowerCase()));
  const isTicked = (value: string) => (selected ? selected.has(value) : true);
  const toggle = (value: string) => {
    const next = new Set(selected ?? options.map((o) => o.value));
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // Everything ticked again means no filter.
    onChange(next.size === options.length ? null : next);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <Hint label={active ? `${label}: ${selected!.size} of ${options.length} values shown. Click to change.` : `Filter by ${label}`}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "rounded p-0.5 transition-colors",
              active
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground/60 hover:bg-muted hover:text-foreground",
            )}
            aria-label={`Filter by ${label}`}
          >
            <ListFilter className="size-3.5" />
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="start" className="w-64 gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">{label}</span>
          <span className="flex gap-2">
            <button type="button" className="text-primary underline underline-offset-2" onClick={() => onChange(null)}>
              Select all
            </button>
            <button
              type="button"
              className="text-primary underline underline-offset-2"
              onClick={() => onChange(new Set<string>(["\u0000none"]))}
            >
              Clear
            </button>
          </span>
        </div>
        {options.length > 8 && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search values…"
            className="h-8 text-xs"
            aria-label={`Search ${label} values`}
          />
        )}
        <div className="max-h-64 overflow-y-auto">
          {shown.length === 0 ? (
            <div className="text-muted-foreground px-1 py-2 text-xs">No values match.</div>
          ) : (
            shown.map((o) => (
              <label key={o.value} className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm">
                <Checkbox checked={isTicked(o.value)} onCheckedChange={() => toggle(o.value)} aria-label={o.value} />
                <span className={cn("min-w-0 flex-1 truncate", o.value === BLANK && "text-muted-foreground italic")}>
                  {o.value}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">{o.count}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
