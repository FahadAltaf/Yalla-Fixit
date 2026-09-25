"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  leaveService,
  tagsService,
  rolesService,
  serviceTypesService,
  techniciansService,
  type TechnicianAttributeUpdate,
} from "@/modules/scheduling";
import {
  LeaveRecord,
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
import StatusBadge from "@/components/ui/status-badge";
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
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
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
} from "./technician-cells";
import TimeSelect from "@/components/ui/time-select";

type Props = { technicians: TechnicianReference[] };

const SHIFT_OPTIONS = [
  { value: "", label: "— Shift —" },
  { value: "morning", label: "Morning" },
  { value: "night", label: "Night" },
];

function nearestActiveLeave(records: LeaveRecord[]): { record: LeaveRecord; current: boolean } | null {
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

export default function SchedulingDashboard({ technicians }: Props) {
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

  const [manageList, setManageList] = useState<null | "tags" | "roles" | "services">(null);
  const [activeTechnician, setActiveTechnician] = useState<TechnicianReference | null>(null);

  const loadAll = async () => {
    try {
      const [tagList, assignmentMap, leave, roleList, serviceList] = await Promise.all([
        tagsService.listTags(),
        tagsService.listAssignmentsByTechnician(),
        leaveService.listLeave({ status: "active" }),
        rolesService.list(),
        serviceTypesService.list(),
      ]);
      setTags(tagList);
      setAssignments(assignmentMap);
      setLeaveRecords(leave);
      setRoles(roleList);
      setServices(serviceList);
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

  const visibleTechnicians = useMemo(() => {
    let list = [...techs];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => t.display_name.toLowerCase().includes(q));
    }
    return list.sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [techs, search]);

  // Paginate rather than rendering all ~90 technicians at once: a long
  // unbroken table is slow to scan and slow to render.
  const total = visibleTechnicians.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = visibleTechnicians.slice(pageStart, pageStart + pageSize);

  // Searching or resizing should always land you back on the first page,
  // otherwise a narrowed result set can look empty.
  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await techniciansService.refreshFromFsm();
      const removed = (result?.removed?.deleted?.length ?? 0) + (result?.removed?.referenced?.length ?? 0);
      toast.success(
        `Synced ${result?.resources?.length ?? 0} technicians from Zoho FSM` +
        (removed > 0 ? ` (${removed} no longer listed)` : ""),
      );
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
  const selectedTechs = useMemo(() => techs.filter((t) => selected.has(t.fsm_resource_id)), [techs, selected]);
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
    const ids = [...selected];
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

  const allVisibleSelected = pageRows.length > 0 && pageRows.every((t) => selected.has(t.fsm_resource_id));
  const toggleSelectAll = () =>
    setSelected(allVisibleSelected ? new Set<string>() : new Set(pageRows.map((t) => t.fsm_resource_id)));

  const selectedIds = [...selected];

  return (
    <>
      <div className="flex flex-col gap-4">
        <PageHeading
          eyebrow="Scheduling"
          title="Technicians & leave"
          description={`${techs.length} technicians synced from Zoho FSM. Set role, service, shift, supervisor, tags, and leave.`}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings2 className="size-4" /> Manage lists
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setManageList("roles")}>Roles</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setManageList("services")}>Service types</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setManageList("tags")}>Tags</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />

        {/* Toolbar: search on the left, page size / refresh on the right. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search technicians..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Search technicians"
            />
          </div>
          <div className="flex items-center gap-2">
            {/* A native <select> was the one control on this page that did
                not match the rest of the app; this is the same Select used
                everywhere else. */}
            <UiSelect value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger size="sm" className="h-8 w-max" aria-label="Rows per page">
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
            <Button size="sm" className="h-8" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              {refreshing ? "Syncing..." : "Refresh"}
            </Button>
          </div>
        </div>

        {/* Bulk edit bar (#15) — appears when technicians are selected. */}
        {selectedTechs.length > 0 && (
          <div className="border-primary/40 bg-primary/5 flex flex-col gap-2 rounded-md border p-2.5">
            {/* Who is selected, each removable; Clear is a real button. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{selectedTechs.length} selected</span>
              {(showAllSelected ? selectedTechs : selectedTechs.slice(0, 6)).map((t) => (
                <span
                  key={t.fsm_resource_id}
                  className="bg-background inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-xs"
                >
                  {t.display_name}
                  <button
                    type="button"
                    onClick={() => deselect(t.fsm_resource_id)}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-full p-0.5"
                    aria-label={`Deselect ${t.display_name}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {selectedTechs.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllSelected((v) => !v)}
                  className="text-primary text-xs hover:underline"
                >
                  {showAllSelected ? "Show fewer" : `+${selectedTechs.length - 6} more`}
                </button>
              )}
              <Button size="sm" variant="outline" className="ml-auto h-8" onClick={clearSelection}>
                <X className="size-3.5" />
                Clear selection
              </Button>
            </div>
            {/* Set for all. Each dropdown shows what the selection currently shares. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">Set for all:</span>
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
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[1%]">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all on this page"
                  />
                </TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Supervisor</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead className="w-[1%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                // Skeleton rows mirror the real row shape so nothing reflows
                // when the data lands.
                Array.from({ length: 5 }).map((_, i) => <TechnicianRowSkeleton key={i} columns={9} />)
              ) : pageRows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="p-0">
                    <EmptyState
                      className="border-0"
                      icon={<UsersRound className="size-5" />}
                      title={search ? "No matching technicians" : "No technicians yet"}
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
                pageRows.map((technician) => {
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
                        <TechnicianIdentity
                          name={technician.display_name}
                          subtitle={id}
                          seed={id}
                          inactive={!technician.is_active}
                        />
                      </TableCell>
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
                            <DropdownMenuItem onSelect={() => setActiveTechnician(technician)}>
                              <SlidersHorizontal className="size-4" /> Edit attributes
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setActiveTechnician(technician)}>
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

          {/* Footer: what you are looking at, and how to move through it. */}
          {!loading && total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <p className="text-muted-foreground text-sm">
                Showing {pageStart + 1} to {Math.min(pageStart + pageSize, total)} of {total} technicians
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="size-4" /> Previous
                </Button>
                <span className="text-muted-foreground px-2 text-sm tabular-nums">
                  Page {currentPage} of {pageCount}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={currentPage === pageCount}
                >
                  Next <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {manageList === "tags" && (
          <ManageListDialog
            title="Manage Tags"
            noun="tag"
            items={tags}
            onCreate={(n) => tagsService.createTag(n)}
            onRename={(id, n) => tagsService.updateTag(id, n)}
            onDelete={(id) => tagsService.deleteTag(id).then(() => undefined)}
            onOpenChange={(o) => !o && setManageList(null)}
            onChanged={loadAll}
          />
        )}
        {manageList === "roles" && (
          <ManageListDialog
            title="Manage Roles"
            noun="role"
            items={roles}
            colorable
            onCreate={(n) => rolesService.create(n)}
            onRename={(id, n, c) => rolesService.update(id, n, c)}
            onDelete={(id) => rolesService.remove(id).then(() => undefined)}
            onOpenChange={(o) => !o && setManageList(null)}
            onChanged={loadAll}
          />
        )}
        {manageList === "services" && (
          <ManageListDialog
            title="Manage Service Types"
            noun="service type"
            items={services}
            onCreate={(n) => serviceTypesService.create(n)}
            onRename={(id, n) => serviceTypesService.update(id, n)}
            onDelete={(id) => serviceTypesService.remove(id).then(() => undefined)}
            onOpenChange={(o) => !o && setManageList(null)}
            onChanged={loadAll}
          />
        )}

        {activeTechnician && (
          <ManageTechnicianDialog
            technician={techs.find((t) => t.fsm_resource_id === activeTechnician.fsm_resource_id) ?? activeTechnician}
            tags={tags}
            roleOptions={roleOptions}
            serviceOptions={serviceOptions}
            supervisorOptions={supervisorOptions.filter((o) => o.value !== activeTechnician.fsm_resource_id)}
            assignedTags={assignments[activeTechnician.fsm_resource_id] ?? []}
            leaveRecords={leaveRecords.filter((r) => r.technician_fsm_id === activeTechnician.fsm_resource_id)}
            onApplyAttributes={(attrs) => applyAttributes([activeTechnician.fsm_resource_id], attrs)}
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
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded border disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: value ?? "transparent" }}
          title={value ? `Highlight colour ${value}` : "No highlight colour — click to choose"}
          aria-label={`Highlight colour for ${name}`}
        >
          {!value && (
            // A diagonal slash reads as "none" at a glance.
            <span className="bg-muted-foreground/50 absolute top-1/2 left-1/2 h-px w-[130%] -translate-x-1/2 -translate-y-1/2 -rotate-45" />
          )}
        </button>
      </PopoverTrigger>
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

function ManageListDialog({
  title,
  noun,
  items,
  onCreate,
  onRename,
  onDelete,
  onOpenChange,
  onChanged,
  colorable,
}: {
  title: string;
  noun: string;
  items: ListItem[];
  onCreate: (name: string) => Promise<unknown>;
  onRename: (id: string, name: string, color?: string | null) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  // FR-2: when set, each item gets a highlight-colour swatch (roles).
  colorable?: boolean;
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

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              These options appear wherever a {noun} can be chosen. Renaming one updates it everywhere;
              deleting clears it from any technician that had it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <Input
              placeholder={`New ${noun} name`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <Button onClick={create} disabled={saving || !newName.trim()}>
              <Plus className="size-4" /> Add
            </Button>
          </div>

          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
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
                    onClick={() => {
                      setEditingId(item.id);
                      setEditingName(item.name);
                    }}
                  >
                    {item.name}{" "}
                    <span className="text-muted-foreground text-xs">({item.technician_count ?? 0} technicians)</span>
                  </button>
                )}
                {colorable && (
                  <RoleColorPicker
                    name={item.name}
                    value={item.color ?? null}
                    disabled={saving}
                    onApply={(color) => changeColor(item, color)}
                  />
                )}
                <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(item)}>
                  <Trash2 className="text-destructive size-4" />
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationAlertDialog
        isOpen={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description={`This clears the ${noun} from ${deleteTarget?.technician_count ?? 0} technician(s). This cannot be undone.`}
        confirmText="Delete"
        variant="destructive"
        loading={saving}
        onConfirm={remove}
      />
    </>
  );
}

function ManageTechnicianDialog({
  technician,
  tags,
  roleOptions,
  serviceOptions,
  supervisorOptions,
  assignedTags,
  leaveRecords,
  onApplyAttributes,
  onOpenChange,
  onChanged,
}: {
  technician: TechnicianReference;
  tags: TechnicianTag[];
  roleOptions: { value: string; label: string }[];
  serviceOptions: { value: string; label: string }[];
  supervisorOptions: { value: string; label: string }[];
  assignedTags: TechnicianTag[];
  leaveRecords: LeaveRecord[];
  onApplyAttributes: (attrs: TechnicianAttributeUpdate) => void;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set(assignedTags.map((t) => t.id)));
  const [busyTagId, setBusyTagId] = useState<string | null>(null);

  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:30");
  const [notes, setNotes] = useState("");
  const [savingLeave, setSavingLeave] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const toggleTag = async (tagId: string) => {
    if (busyTagId) return;
    const currentlyAssigned = assignedIds.has(tagId);
    setBusyTagId(tagId);
    setAssignedIds((prev) => {
      const next = new Set(prev);
      if (currentlyAssigned) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
    try {
      if (currentlyAssigned) await tagsService.removeTag(technician.fsm_resource_id, tagId);
      else await tagsService.assignTag(technician.fsm_resource_id, tagId);
      onChanged();
    } catch (error) {
      setAssignedIds((prev) => {
        const next = new Set(prev);
        if (currentlyAssigned) next.add(tagId);
        else next.delete(tagId);
        return next;
      });
      toast.error(error instanceof Error ? error.message : "Failed to update tag");
    } finally {
      setBusyTagId(null);
    }
  };

  const handleAddLeave = async () => {
    if (!leaveType.trim() || !startDate || !endDate) {
      toast.error("Leave type, start date, and end date are required");
      return;
    }
    setSavingLeave(true);
    try {
      const { conflicts } = await leaveService.createLeave({
        technicianFsmId: technician.fsm_resource_id,
        leaveType: leaveType.trim(),
        startAt: zonedTimeToUtc(startDate, startTime).toISOString(),
        endAt: zonedTimeToUtc(endDate, endTime).toISOString(),
        notes: notes.trim() || null,
      });
      toast.success(
        conflicts.length > 0
          ? `Leave saved — ${conflicts.length} existing assignment(s) now conflict on the schedule`
          : "Leave saved",
      );
      setLeaveType("");
      setStartDate("");
      setEndDate("");
      setNotes("");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save leave");
    } finally {
      setSavingLeave(false);
    }
  };

  const handleCancelLeave = async (id: string) => {
    setCancellingId(id);
    try {
      await leaveService.cancelLeave(id);
      toast.success("Leave cancelled");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel leave");
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{technician.display_name}</DialogTitle>
          <DialogDescription>
            Role, service type, shift and supervisor are portal-only settings — they are never written back to
            Zoho FSM. Tags and leave are managed here too.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Role
            <Select value={technician.role_id ?? ""} options={roleOptions} onChange={(v) => onApplyAttributes({ roleId: v || null })} className="h-9" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Service type
            <Select value={technician.service_type_id ?? ""} options={serviceOptions} onChange={(v) => onApplyAttributes({ serviceTypeId: v || null })} className="h-9" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Shift
            <Select value={technician.shift ?? ""} options={SHIFT_OPTIONS} onChange={(v) => onApplyAttributes({ shift: (v || null) as "morning" | "night" | null })} className="h-9" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Supervisor
            <Select value={technician.team_leader_fsm_id ?? ""} options={supervisorOptions} onChange={(v) => onApplyAttributes({ teamLeaderFsmId: v || null })} className="h-9" />
          </label>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Tags</p>
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {tags.length === 0 && <p className="text-muted-foreground text-sm">No tags created yet.</p>}
            {tags.map((tag) => {
              const selected = assignedIds.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  disabled={busyTagId === tag.id}
                  className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-60 ${selected ? "border-primary bg-primary/10" : "hover:bg-muted/50"
                    }`}
                >
                  <span>{tag.name}</span>
                  {busyTagId === tag.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : selected ? (
                    <Check className="text-primary size-4" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Leave</p>
          <div className="mb-3 flex max-h-32 flex-col gap-1 overflow-y-auto">
            {leaveRecords.length === 0 && <p className="text-muted-foreground text-sm">No leave records.</p>}
            {leaveRecords.map((record) => (
              <div key={record.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <div>
                  <span className="font-medium">{record.leave_type}</span>{" "}
                  <span className="text-muted-foreground text-xs">
                    {formatZonedDate(record.start_at)} – {formatZonedDate(record.end_at)}
                  </span>{" "}
                  <StatusBadge status={record.status} />
                </div>
                {record.status === "active" && (
                  <Button size="icon" variant="ghost" disabled={cancellingId === record.id} onClick={() => handleCancelLeave(record.id)} title="Cancel leave">
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <Input placeholder="Leave type (e.g. Annual Leave)" value={leaveType} onChange={(e) => setLeaveType(e.target.value)} />
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
        </div>

        <DialogFooter>
          <Button onClick={handleAddLeave} disabled={savingLeave}>
            {savingLeave && <Loader2 className="size-4 animate-spin" />}
            Add Leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
