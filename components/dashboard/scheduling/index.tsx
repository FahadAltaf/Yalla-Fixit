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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";
import { cn } from "@/lib/actions/utils";
import { Check, Loader2, Plus, Settings2, Trash2, X } from "lucide-react";
import SchedulingNav from "./scheduling-nav";
import TimeSelect from "./daily-schedule/time-select";

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
  // Drivers only: you assign each technician to the driver who drives them.
  const driverOptions = useMemo(
    () => [
      { value: "", label: "— Driver —" },
      ...[...techs]
        .filter((t) => t.is_active && (t.role_name ?? "").toLowerCase() === "driver")
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

  // Applies an attribute change to one or many technicians and updates local
  // state immediately (optimistic) with a background revert on error.
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
    } catch (error) {
      setTechs((prev) => prev.map((t) => before.get(t.fsm_resource_id) ?? t));
      toast.error(error instanceof Error ? error.message : "Failed to update technician");
    }
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected = visibleTechnicians.length > 0 && visibleTechnicians.every((t) => selected.has(t.fsm_resource_id));
  const toggleSelectAll = () =>
    setSelected(allVisibleSelected ? new Set<string>() : new Set(visibleTechnicians.map((t) => t.fsm_resource_id)));

  const selectedIds = [...selected];

  return (
    <>
      <SchedulingNav />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <PageHeading
          eyebrow="Scheduling"
          title="Technicians & leave"
          description={`${techs.length} technicians synced from Zoho FSM. Set role, service, shift, driver, tags, and leave.`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setManageList("roles")}>
                <Settings2 className="size-4" /> Roles
              </Button>
              <Button variant="outline" size="sm" onClick={() => setManageList("services")}>
                <Settings2 className="size-4" /> Services
              </Button>
              <Button variant="outline" size="sm" onClick={() => setManageList("tags")}>
                <Settings2 className="size-4" /> Tags
              </Button>
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search technicians..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>

        {/* Bulk edit bar (#15) — appears when technicians are selected. */}
        {selectedIds.length > 0 && (
          <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border p-2.5">
            <span className="text-sm font-medium">{selectedIds.length} selected</span>
            <span className="text-muted-foreground text-xs">Set for all:</span>
            <Select
              ariaLabel="Set role"
              value=""
              options={roleOptions}
              onChange={(v) => applyAttributes(selectedIds, { roleId: v || null })}
            />
            <Select
              ariaLabel="Set service"
              value=""
              options={serviceOptions}
              onChange={(v) => applyAttributes(selectedIds, { serviceTypeId: v || null })}
            />
            <Select
              ariaLabel="Set shift"
              value=""
              options={SHIFT_OPTIONS}
              onChange={(v) => applyAttributes(selectedIds, { shift: (v || null) as "morning" | "night" | null })}
            />
            <Select
              ariaLabel="Set driver"
              value=""
              options={driverOptions.filter((o) => !selected.has(o.value))}
              onChange={(v) => applyAttributes(selectedIds, { teamLeaderFsmId: v || null })}
            />
            <div className="ml-auto flex items-center gap-1.5">
              <BulkTagMenu tags={tags} selectedIds={selectedIds} onChanged={loadAll} />
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[1%]">
                  <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} aria-label="Select all" />
                </TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Leave</TableHead>
                <TableHead className="w-[1%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center">
                    <Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : visibleTechnicians.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground py-6 text-center">
                    No technicians match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                visibleTechnicians.map((technician) => {
                  const leave = nearestActiveLeave(leaveByTechnician.get(technician.fsm_resource_id) ?? []);
                  const technicianTags = assignments[technician.fsm_resource_id] ?? [];
                  const id = technician.fsm_resource_id;
                  return (
                    <TableRow key={id} data-state={selected.has(id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(id)}
                          onCheckedChange={() => toggleSelect(id)}
                          aria-label={`Select ${technician.display_name}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{technician.display_name}</TableCell>
                      <TableCell>
                        <Select
                          ariaLabel={`Role for ${technician.display_name}`}
                          value={technician.role_id ?? ""}
                          options={roleOptions}
                          onChange={(v) => applyAttributes([id], { roleId: v || null })}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          ariaLabel={`Service for ${technician.display_name}`}
                          value={technician.service_type_id ?? ""}
                          options={serviceOptions}
                          onChange={(v) => applyAttributes([id], { serviceTypeId: v || null })}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          ariaLabel={`Shift for ${technician.display_name}`}
                          value={technician.shift ?? ""}
                          options={SHIFT_OPTIONS}
                          onChange={(v) => applyAttributes([id], { shift: (v || null) as "morning" | "night" | null })}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          ariaLabel={`Driver for ${technician.display_name}`}
                          value={technician.team_leader_fsm_id ?? ""}
                          options={driverOptions.filter((o) => o.value !== id)}
                          onChange={(v) => applyAttributes([id], { teamLeaderFsmId: v || null })}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-[180px] flex-wrap gap-1">
                          {technicianTags.length === 0 ? (
                            <span className="text-muted-foreground text-xs">--</span>
                          ) : (
                            technicianTags.map((tag) => (
                              <Badge key={tag.id} variant="secondary">
                                {tag.name}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {leave ? (
                          <span className="text-xs">
                            <Badge className="border-none bg-warning/10 text-warning">
                              {leave.current ? "On Leave" : "Upcoming"}
                            </Badge>{" "}
                            <span className="text-muted-foreground">
                              {leave.record.leave_type} ({new Date(leave.record.start_at).toLocaleDateString()}–
                              {new Date(leave.record.end_at).toLocaleDateString()})
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">Available</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setActiveTechnician(technician)}>
                          Manage
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
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
            onCreate={(n) => rolesService.create(n)}
            onRename={(id, n) => rolesService.update(id, n)}
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
            driverOptions={driverOptions.filter((o) => o.value !== activeTechnician.fsm_resource_id)}
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

type ListItem = { id: string; name: string; technician_count?: number };

function ManageListDialog({
  title,
  noun,
  items,
  onCreate,
  onRename,
  onDelete,
  onOpenChange,
  onChanged,
}: {
  title: string;
  noun: string;
  items: ListItem[];
  onCreate: (name: string) => Promise<unknown>;
  onRename: (id: string, name: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
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
            {items.length === 0 && <p className="text-muted-foreground text-sm">Nothing yet.</p>}
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
  driverOptions,
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
  driverOptions: { value: string; label: string }[];
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
        startAt: new Date(`${startDate}T${startTime}:00`).toISOString(),
        endAt: new Date(`${endDate}T${endTime}:00`).toISOString(),
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
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{technician.display_name}</DialogTitle>
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
            Driver
            <Select value={technician.team_leader_fsm_id ?? ""} options={driverOptions} onChange={(v) => onApplyAttributes({ teamLeaderFsmId: v || null })} className="h-9" />
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
                  className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-60 ${
                    selected ? "border-primary bg-primary/10" : "hover:bg-muted/50"
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
                    {new Date(record.start_at).toLocaleDateString()} – {new Date(record.end_at).toLocaleDateString()}
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
