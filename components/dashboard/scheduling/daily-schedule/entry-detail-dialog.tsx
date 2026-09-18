"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  scheduleService,
  fsmLookupService,
  type FsmWorkOrderLines,
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
import {
  APPOINTMENT_STATE_LABELS,
  APPOINTMENT_STATE_STYLES,
  resolveAppointmentState,
} from "@/lib/scheduling/appointment-status";
import {
  formatZonedTime,
  zonedHhmm,
  zonedTimeToUtc,
} from "@/lib/scheduling/org-time";

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
  // Every entry on the day, so a line already claimed by another new
  // appointment in this draft can be shown as taken.
  dayEntries: ScheduleEntry[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
};

// The entry's time of day in the org's zone (not the viewer's).
function toLocalHhmm(iso: string) {
  return zonedHhmm(iso);
}

const PUBLISHED_LIKE: ScheduleVersionStatus[] = ["published", "partially_synced"];
// Approved days on which an approver may drop an entry FSM refused.
const APPROVED_LIKE: ScheduleVersionStatus[] = ["published", "partially_synced", "sync_failed"];

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

export default function EntryDetailDialog({
  entry,
  isEditable,
  versionStatus,
  isApprover,
  config,
  technicians,
  leaveRecords,
  scheduleVersionId,
  dayEntries,
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

  // 7-7: FSM refused this entry on an approved day (e.g. the appointment was
  // cancelled in FSM) -- an approver can drop it from the board.
  const canRemoveFailed =
    isApprover && entry.sync_status === "failed" && versionStatus !== null && APPROVED_LIKE.includes(versionStatus);

  // Service lines. Only a new appointment that hasn't been created in FSM yet
  // can change its lines. Once the appointment exists (created on an earlier
  // approval, or picked as an existing one), its lines are managed in FSM:
  // approving a revision only updates its time and technicians, and only if
  // they were edited.
  const isNewAppointment = entry.entry_type === "new_appointment";
  const existsInFsm = Boolean(entry.fsm_appointment_id);
  const workOrderId = entry.entry_type !== "free_text" ? entry.fsm_work_order_id : null;
  const canEditLines = canEditDraft && isNewAppointment && !existsInFsm;
  const originalLineIds = useMemo(() => entry.fsm_service_line_item_ids ?? [], [entry.fsm_service_line_item_ids]);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>(originalLineIds);
  const [woLines, setWoLines] = useState<FsmWorkOrderLines | null>(null);
  const [linesLoading, setLinesLoading] = useState(Boolean(workOrderId));

  useEffect(() => {
    if (!workOrderId) return;
    let cancelled = false;
    fsmLookupService.getWorkOrderLines(workOrderId).then((lines) => {
      if (cancelled) return;
      setWoLines(lines);
      setLinesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId]);

  // Lines another new appointment in this draft already claims.
  const lineOwners = useMemo(() => {
    const owners = new Map<string, string>();
    dayEntries
      .filter((e) => e.id !== entry.id && e.entry_type === "new_appointment")
      .forEach((e) =>
        (e.fsm_service_line_item_ids ?? []).forEach((lineId) =>
          owners.set(lineId, `another new appointment at ${formatTimeAmPm(toLocalHhmm(e.start_at))}`),
        ),
      );
    return owners;
  }, [dayEntries, entry.id]);

  const lineById = useMemo(
    () => new Map((woLines?.serviceLineItems ?? []).map((l) => [l.id, l] as const)),
    [woLines],
  );

  // Read-only list. Once the appointment exists in FSM, read its lines from FSM
  // (the truth -- create leaves off any line that was already booked); before
  // that, the lines this draft will ask for.
  const fsmAppointmentLines = existsInFsm
    ? woLines?.appointments.find((a) => a.id === entry.fsm_appointment_id)?.lines
    : undefined;
  const coveredLines: { key: string; code: string; service: string | null }[] = fsmAppointmentLines
    ? fsmAppointmentLines.map((l) => ({ key: l.code, code: l.code, service: l.service }))
    : isNewAppointment && !existsInFsm
      ? originalLineIds.map((id) => {
          const line = lineById.get(id);
          return { key: id, code: line?.name ?? id, service: line?.serviceName ?? null };
        })
      : [];

  // Editable list: lines free to schedule, plus whatever this entry holds now.
  const editableLines = (woLines?.serviceLineItems ?? []).filter(
    (l) => !l.scheduled || originalLineIds.includes(l.id) || selectedLineIds.includes(l.id),
  );
  const hiddenScheduledCount = (woLines?.serviceLineItems ?? []).length - editableLines.length;

  const toggleLine = (id: string) =>
    setSelectedLineIds((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));
  const linesChanged = canEditLines && !sameIds(selectedLineIds, originalLineIds);

  const resolvedShift = useMemo(() => resolveShift(startTime, config), [startTime, config]);
  const targetShift: ShiftType = resolvedShift ?? entry.shift;

  const onLeave = useMemo(() => {
    const startAt = zonedTimeToUtc(entry.operating_date, startTime).getTime();
    const endAt = zonedTimeToUtc(entry.operating_date, endTime).getTime();
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
  const dirty = timeChanged || techsChanged || linesChanged;

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
    if (canEditLines && selectedLineIds.length === 0) {
      toast.error("Select at least one service line");
      return;
    }
    const day = entry.operating_date;
    const startAt = zonedTimeToUtc(day, startTime).toISOString();
    const endAt = zonedTimeToUtc(day, endTime).toISOString();
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
          ...(linesChanged ? { serviceLineItemIds: selectedLineIds } : {}),
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
      toast.success(canRemoveFailed && !isEditable ? "Failed entry removed from the schedule" : "Entry removed");
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
  // FR-3: which colour bucket this appointment currently falls in, and why.
  const fsmState =
    entry.entry_type !== "free_text" && entry.fsm_appointment_id
      ? resolveAppointmentState(entry.fsm_status)
      : null;
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
            {/* FR-3: the colour bucket next to FSM's own status text, so a red bar
                can be traced back to the raw value and the rule that produced it. */}
            {fsmState && (
              <Detail label="FSM status">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className={`size-2 shrink-0 rounded-full ${APPOINTMENT_STATE_STYLES[fsmState].dot}`} />
                  <b>{APPOINTMENT_STATE_LABELS[fsmState]}</b>
                  {entry.fsm_status ? (
                    entry.fsm_status.toLowerCase() !== APPOINTMENT_STATE_LABELS[fsmState].toLowerCase() && (
                      <span className="text-muted-foreground">— FSM says &ldquo;{entry.fsm_status}&rdquo;</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">— not read from FSM yet</span>
                  )}
                </span>
                {entry.fsm_status_checked_at && (
                  <span className="text-muted-foreground block text-xs">
                    As of {formatZonedTime(entry.fsm_status_checked_at)} — Refresh the board to re-check.
                  </span>
                )}
              </Detail>
            )}
            <Detail label="Technicians">{technicianNames || "None assigned"}</Detail>
            {addedBy && <Detail label="Added by">{addedBy}</Detail>}
            {updatedBy && updatedBy !== addedBy && <Detail label="Last edited by">{updatedBy}</Detail>}
            {entry.notes && <Detail label="Notes">{entry.notes}</Detail>}
          </div>

          {/* Service lines this appointment covers (read-only here; a new
              appointment's lines are edited in the panel below). */}
          {workOrderId && !canEditLines && (
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">
                {existsInFsm ? "Service lines on this appointment" : "Service lines this appointment will cover"}
              </span>
              {linesLoading ? (
                <span className="text-muted-foreground flex items-center gap-2 text-xs">
                  <Loader2 className="size-3.5 animate-spin" /> Loading service lines from FSM…
                </span>
              ) : coveredLines.length === 0 ? (
                <span className="text-muted-foreground text-xs">
                  {woLines ? "No service lines found for this appointment." : "Couldn't load service lines from Zoho FSM."}
                </span>
              ) : (
                <ul className="flex flex-col gap-1 rounded-md border p-2">
                  {coveredLines.map((l) => (
                    <li key={l.key} className="text-sm">
                      <span className="font-medium">{l.code}</span>
                      {l.service && <span className="text-muted-foreground"> · {l.service}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {existsInFsm && canEditDraft && (
                <span className="text-muted-foreground text-[11px]">
                  This appointment already exists in Zoho FSM ({entry.fsm_appointment_name || "linked"}), so its service
                  lines are managed there. Approving only updates its time and technicians, and only if you changed
                  them.
                </span>
              )}
            </div>
          )}

          {/* AC-015: a failed sync says WHY, and offers a retry in place. */}
          {entry.sync_status === "failed" && (
            <div className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-xs text-danger">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <b>Sync failed.</b> {entry.last_sync_error || "Zoho FSM rejected the change."}
                  {canRemoveFailed && /cancel/i.test(entry.last_sync_error ?? "") && (
                    <>
                      {" "}
                      The appointment was cancelled in Zoho FSM. Remove it from the schedule, or add the work again as
                      a new appointment.
                    </>
                  )}
                </span>
              </div>
              {((isApprover && scheduleVersionId) || (canRemoveFailed && !isEditable)) && (
                <div className="flex flex-wrap gap-2">
                  {isApprover && scheduleVersionId && (
                    <Button size="sm" variant="outline" onClick={handleRetry} disabled={retrying || removing}>
                      {retrying ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                      Retry this entry
                    </Button>
                  )}
                  {canRemoveFailed && !isEditable && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmOpen(true)}
                      disabled={removing || retrying}
                    >
                      <Trash2 className="size-4" />
                      Remove from schedule
                    </Button>
                  )}
                </div>
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

              {canEditLines && (
                <div>
                  <span className="mb-1 block text-xs font-medium">
                    Service lines{selectedLineIds.length ? ` (${selectedLineIds.length})` : ""}
                  </span>
                  {linesLoading ? (
                    <div className="text-muted-foreground flex items-center gap-2 rounded-md border px-2 py-2 text-xs">
                      <Loader2 className="size-3.5 animate-spin" /> Loading service lines from FSM…
                    </div>
                  ) : !woLines ? (
                    <div className="rounded-md border border-warning/40 bg-warning/10 px-2 py-2 text-xs text-warning">
                      Couldn&apos;t load this work order&apos;s service lines from Zoho FSM. Close and reopen to try again.
                    </div>
                  ) : (
                    <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-md border p-2">
                      {editableLines.map((line) => {
                        const owner = lineOwners.get(line.id);
                        const selected = selectedLineIds.includes(line.id);
                        const takenElsewhere = Boolean(owner) && !selected;
                        const nowInFsm = line.scheduled ? line.appointments[0]?.name : null;
                        return (
                          <label
                            key={line.id}
                            className={`flex items-start gap-2 rounded px-1 py-1 text-sm ${
                              takenElsewhere ? "cursor-not-allowed opacity-55" : "hover:bg-muted/50 cursor-pointer"
                            }`}
                            title={takenElsewhere ? `Already on ${owner}` : undefined}
                          >
                            <Checkbox
                              checked={selected}
                              disabled={takenElsewhere}
                              onCheckedChange={() => toggleLine(line.id)}
                              className="mt-0.5"
                            />
                            <span className="flex-1">
                              <span className="font-medium">{line.name}</span>
                              {line.serviceName && <span className="text-muted-foreground"> · {line.serviceName}</span>}
                              {takenElsewhere && (
                                <span className="text-muted-foreground block text-[11px]">On {owner}</span>
                              )}
                              {nowInFsm && (
                                <span className="block text-[11px] text-warning">
                                  Booked on {nowInFsm} in Zoho FSM since this draft was made — it will be left off
                                  this appointment when approved
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                      {editableLines.length === 0 && (
                        <span className="text-muted-foreground px-1 py-2 text-xs">
                          No service lines are free on this work order.
                        </span>
                      )}
                      {hiddenScheduledCount > 0 && (
                        <span className="text-muted-foreground px-1 pt-1 text-[10px]">
                          Lines already on another FSM appointment are hidden.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

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

            </div>
          )}

          {/* Actions pinned to the bottom of the dialog, so Save is reachable
              without scrolling past the technician list. */}
          {(canEdit || isEditable) && (
            <DialogFooter className="bg-background sticky bottom-0 z-10 sm:items-center sm:justify-between">
              {isEditable ? (
                <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={removing || saving}>
                  <Trash2 className="size-4" />
                  Remove from draft
                </Button>
              ) : (
                <span />
              )}
              {canEdit && (
                <div className="flex items-center justify-end gap-3">
                  {dirty && <span className="text-muted-foreground text-xs">Unsaved changes</span>}
                  <Button onClick={handleSave} disabled={saving || !dirty}>
                    {saving && <Loader2 className="size-4 animate-spin" />}
                    {canEditPublished ? "Save & push to FSM" : "Save changes"}
                  </Button>
                </div>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmationAlertDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={canRemoveFailed && !isEditable ? "Remove this failed entry?" : "Remove this entry?"}
        description={
          canRemoveFailed && !isEditable
            ? "Zoho FSM refused this entry, so nothing was written for it. Removing it takes it off the approved schedule; the appointment in FSM stays as it is."
            : entry.entry_type === "new_appointment"
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
