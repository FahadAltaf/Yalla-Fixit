"use client";

import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  scheduleService,
  type ScheduleEntry,
  type ScheduleVersionStatus,
  type SchedulingConfig,
  type ShiftType,
  type TechnicianReference,
} from "@/modules/scheduling";
import type { LeaveRecord } from "@/types/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import StatusBadge from "@/components/ui/status-badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import TimeSelect, { formatTimeAmPm } from "@/components/ui/time-select";
import { resolveShift, shiftWindowLabel, fsmRecordUrl } from "./shift-utils";

function firstProfile(p: ScheduleEntry["created_by_user"]) {
  return Array.isArray(p) ? p[0] : p;
}

type Props = {
  entry: ScheduleEntry;
  isEditable: boolean;
  versionStatus: ScheduleVersionStatus | null;
  isApprover: boolean;
  config: SchedulingConfig;
  technicians: TechnicianReference[];
  leaveRecords: LeaveRecord[];
  scheduleVersionId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
};

function toLocalHhmm(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const PUBLISHED_LIKE: ScheduleVersionStatus[] = ["published", "partially_synced"];

export default function EntryDetailDialog({
  entry,
  isEditable,
  versionStatus,
  isApprover,
  config,
  technicians,
  leaveRecords,
  scheduleVersionId,
  onOpenChange,
  onChanged,
}: Props) {
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startTime, setStartTime] = useState(toLocalHhmm(entry.start_at));
  const [endTime, setEndTime] = useState(toLocalHhmm(entry.end_at));
  const [techFilter, setTechFilter] = useState("");
  const [selectedTechs, setSelectedTechs] = useState<string[]>(
    (entry.schedule_entry_assignments ?? []).map((a) => a.technician_fsm_id),
  );

  const originalTechs = (entry.schedule_entry_assignments ?? []).map((a) => a.technician_fsm_id);
  const publishedLike = versionStatus !== null && PUBLISHED_LIKE.includes(versionStatus);
  const isSyncedAppointment = entry.entry_type !== "free_text" && Boolean(entry.fsm_appointment_id);

  // Who can be edited here, and how the write happens:
  //  - Draft: local edit via updateEntry (no FSM write until approval).
  //  - Published synced appointment + approver: pushes straight to FSM.
  const canEditDraft = isEditable;
  const canEditPublished = publishedLike && isApprover && isSyncedAppointment;
  const canEdit = canEditDraft || canEditPublished;

  const resolvedShift = useMemo(() => resolveShift(startTime, config), [startTime, config]);
  const targetShift: ShiftType = resolvedShift ?? entry.shift;

  const onLeave = useMemo(() => {
    const startAt = new Date(`${entry.operating_date}T${startTime}:00`).getTime();
    const endAt = new Date(`${entry.operating_date}T${endTime}:00`).getTime();
    const map = new Map<string, LeaveRecord>();
    leaveRecords.forEach((r) => {
      if (r.status !== "active") return;
      if (new Date(r.start_at).getTime() < endAt && new Date(r.end_at).getTime() > startAt) {
        map.set(r.technician_fsm_id, r);
      }
    });
    return map;
  }, [leaveRecords, entry.operating_date, startTime, endTime]);

  const techsChanged =
    selectedTechs.length !== originalTechs.length ||
    selectedTechs.some((t) => !originalTechs.includes(t));
  const timeChanged = startTime !== toLocalHhmm(entry.start_at) || endTime !== toLocalHhmm(entry.end_at);
  const dirty = timeChanged || techsChanged;

  const outOfWindow = resolvedShift === null || resolvedShift !== entry.shift;

  const technicianNames = originalTechs
    .map((id) => technicians.find((t) => t.fsm_resource_id === id)?.display_name ?? id)
    .join(", ");

  const filteredTechs = technicians
    .filter((t) => t.is_active || selectedTechs.includes(t.fsm_resource_id))
    .filter((t) => t.display_name.toLowerCase().includes(techFilter.toLowerCase()));

  const toggleTech = (id: string) => {
    if (onLeave.has(id)) return;
    setSelectedTechs((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    if (endTime <= startTime) {
      toast.error("End time must be after start time");
      return;
    }
    if (selectedTechs.length === 0) {
      toast.error("Select at least one technician");
      return;
    }
    const day = entry.operating_date;
    const startAt = new Date(`${day}T${startTime}:00`).toISOString();
    const endAt = new Date(`${day}T${endTime}:00`).toISOString();
    setSaving(true);
    try {
      if (canEditPublished) {
        await scheduleService.editPublished({
          entryId: entry.id,
          startAt,
          endAt,
          shift: targetShift,
          technicianFsmIds: selectedTechs,
        });
        toast.success("Appointment updated and pushed to Zoho FSM");
      } else {
        await scheduleService.updateEntry({
          id: entry.id,
          shift: targetShift,
          startAt,
          endAt,
          technicianFsmIds: selectedTechs,
        });
        toast.success(
          targetShift !== entry.shift
            ? `Saved and moved to the ${targetShift === "night" ? "Night" : "Morning"} shift`
            : "Entry updated",
        );
      }
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save the change");
    } finally {
      setSaving(false);
    }
  };

  const handleRetry = async () => {
    if (!scheduleVersionId) return;
    setRetrying(true);
    try {
      const { results } = await scheduleService.retrySync(scheduleVersionId, entry.id);
      const failed = results.find((r) => r.entryId === entry.id && r.status === "failed");
      if (failed) toast.error(failed.error ?? "Sync failed again");
      else toast.success("Synced to Zoho FSM");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await scheduleService.removeEntry(entry.id);
      toast.success("Entry removed");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove entry");
    } finally {
      setRemoving(false);
      setConfirmOpen(false);
    }
  };

  const workOrderLabel = entry.fsm_work_order_name || entry.fsm_work_order_id || "--";
  const appointmentLabel =
    entry.fsm_appointment_name || (entry.fsm_appointment_id ? "Linked" : "Pending Appointment Creation");
  const woUrl = fsmRecordUrl("Work_Orders", entry.fsm_work_order_id);
  const apUrl = fsmRecordUrl("Service_Appointments", entry.fsm_appointment_id);
  const creator = firstProfile(entry.created_by_user);
  const updater = firstProfile(entry.updated_by_user);
  const addedBy = creator?.full_name || creator?.email || null;
  const updatedBy = updater?.full_name || updater?.email || null;

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {entry.entry_type === "free_text" ? entry.title || "Text entry" : `${workOrderLabel} · ${appointmentLabel}`}
            </DialogTitle>
            <DialogDescription>
              {entry.entry_type === "free_text"
                ? "A note on the board. Free-text entries are never written to Zoho FSM."
                : "Appointment detail, its Zoho FSM sync state, and who last touched it."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={entry.entry_type.replace(/_/g, " ")} />
            <StatusBadge status={entry.sync_status.replace(/_/g, " ")} />
            <StatusBadge status={entry.shift === "night" ? "night shift" : "morning shift"} />
            {entry.origin === "fsm" && <StatusBadge status="fsm" />}
          </div>

          {/* Two-column detail grid. WO / appointment ids link into Zoho FSM. */}
          <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            {entry.entry_type !== "free_text" && (
              <>
                <Detail label="Work Order">
                  {woUrl ? (
                    <a href={woUrl} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline">
                      {workOrderLabel} <ExternalLink className="size-3.5" />
                    </a>
                  ) : (
                    workOrderLabel
                  )}
                </Detail>
                <Detail label="Appointment">
                  {apUrl ? (
                    <a href={apUrl} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline">
                      {appointmentLabel} <ExternalLink className="size-3.5" />
                    </a>
                  ) : (
                    appointmentLabel
                  )}
                </Detail>
                {entry.fsm_appointment_type && <Detail label="Type">{entry.fsm_appointment_type}</Detail>}
                {entry.fsm_schedule_type && <Detail label="Schedule">{entry.fsm_schedule_type}</Detail>}
                {entry.client_name && <Detail label="Client">{entry.client_name}</Detail>}
                {entry.address && <Detail label="Address">{entry.address}</Detail>}
              </>
            )}
            {entry.title && entry.entry_type !== "free_text" && <Detail label="Summary">{entry.title}</Detail>}
            <Detail label="Scheduled">
              {formatTimeAmPm(toLocalHhmm(entry.start_at))} – {formatTimeAmPm(toLocalHhmm(entry.end_at))} on{" "}
              {entry.operating_date}
            </Detail>
            <Detail label="Technicians">{technicianNames || "None assigned"}</Detail>
            {addedBy && <Detail label="Added by">{addedBy}</Detail>}
            {updatedBy && updatedBy !== addedBy && <Detail label="Last edited by">{updatedBy}</Detail>}
            {entry.notes && <Detail label="Notes">{entry.notes}</Detail>}
          </div>

          {/* AC-015: a failed sync says WHY, and offers a retry in place. */}
          {entry.sync_status === "failed" && (
            <div className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-xs text-danger">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <b>Sync failed.</b> {entry.last_sync_error || "Zoho FSM rejected the change."}
                </span>
              </div>
              {isApprover && scheduleVersionId && (
                <Button size="sm" variant="outline" className="self-start" onClick={handleRetry} disabled={retrying}>
                  {retrying ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Retry this entry
                </Button>
              )}
            </div>
          )}

          {outOfWindow && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This entry is filed under the {entry.shift === "night" ? "Night" : "Morning"} shift (
                {shiftWindowLabel(entry.shift, config)}) but starts at {formatTimeAmPm(toLocalHhmm(entry.start_at))},
                outside that window{canEdit ? " — change the time below to place it correctly." : "."}
              </span>
            </div>
          )}

          {canEdit && (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <span className="text-xs font-medium">
                {canEditPublished ? "Edit appointment (pushes to FSM)" : "Edit entry"}
              </span>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs">
                  Start
                  <TimeSelect value={startTime} onChange={setStartTime} aria-label="Start time" />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  End
                  <TimeSelect value={endTime} onChange={setEndTime} aria-label="End time" />
                </label>
              </div>
              {resolvedShift === null ? (
                <span className="text-[11px] text-warning">
                  {formatTimeAmPm(startTime)} is outside both shift windows — it will stay flagged on the grid.
                </span>
              ) : resolvedShift !== entry.shift ? (
                <span className="text-[11px] text-brand">
                  Saving moves this entry to the {resolvedShift === "night" ? "Night" : "Morning"} shift.
                </span>
              ) : null}

              <div>
                <span className="mb-1 block text-xs font-medium">
                  Technicians{selectedTechs.length ? ` (${selectedTechs.length})` : ""}
                </span>
                <Input
                  placeholder="Filter technicians..."
                  value={techFilter}
                  onChange={(e) => setTechFilter(e.target.value)}
                  className="mb-2 h-8"
                />
                <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border p-2">
                  {filteredTechs.map((t) => {
                    const leave = onLeave.get(t.fsm_resource_id);
                    return (
                      <label
                        key={t.fsm_resource_id}
                        className={`flex items-center gap-2 rounded px-1 py-1 text-sm ${
                          leave ? "cursor-not-allowed opacity-55" : "hover:bg-muted/50 cursor-pointer"
                        }`}
                        title={leave ? `On leave: ${leave.leave_type}` : undefined}
                      >
                        <Checkbox
                          checked={selectedTechs.includes(t.fsm_resource_id)}
                          disabled={!!leave}
                          onCheckedChange={() => toggleTech(t.fsm_resource_id)}
                        />
                        <span className="flex-1">{t.display_name}</span>
                        {leave && (
                          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                            On leave
                          </span>
                        )}
                      </label>
                    );
                  })}
                  {filteredTechs.length === 0 && (
                    <span className="text-muted-foreground px-1 py-2 text-xs">No technicians match.</span>
                  )}
                </div>
              </div>

              <Button size="sm" className="self-start" onClick={handleSave} disabled={saving || !dirty}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {canEditPublished ? "Save & push to FSM" : "Save changes"}
              </Button>
            </div>
          )}

          {isEditable && (
            <DialogFooter>
              <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={removing}>
                <Trash2 className="size-4" />
                Remove from draft
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmationAlertDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove this entry?"
        description={
          entry.entry_type === "new_appointment"
            ? "No FSM appointment has been created yet, so removing this leaves FSM unchanged."
            : "This removes the entry from the draft. It does not affect FSM until the day is approved."
        }
        confirmText="Remove"
        variant="destructive"
        loading={removing}
        onConfirm={handleRemove}
      />
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="break-words">{children}</div>
    </div>
  );
}
