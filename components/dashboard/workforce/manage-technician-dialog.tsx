"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Check, X } from "lucide-react";
import { toast } from "sonner";

import { ActionDialogContent, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DateSelect from "@/components/ui/date-select";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import StatusBadge from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import TimeSelect from "@/components/ui/time-select";
import { cn } from "@/lib/actions/utils";
import { formatZonedDate, zonedTimeToUtc } from "@/lib/scheduling/org-time";
import { leaveService, tagsService, type TechnicianAttributeUpdate } from "@/modules/scheduling";
import type { LeaveRecord, TechnicianReference, TechnicianTag } from "@/types/types";

/**
 * One technician, from the row menu on Workforce → People and from the
 * profile (2 Nov). Three views, each its own menu item, no tabs:
 *
 *   attributes  role, service, shift, supervisor, employment, hide from
 *               lists, tags
 *   hours       hours a day, weekly limit, off days a week, fixed rest days
 *   leave       the leave on record (cancel one) and Add leave
 *
 * Attributes and hours are a draft until Save changes, which writes only
 * what changed; Cancel, the close button or Escape leave everything as it
 * was, asking first when something was changed. Leave is added with its
 * own button: a record is added, not edited.
 */

export type TechnicianDialogView = "attributes" | "hours" | "leave";

type Option = { value: string; label: string };

/* Radix Select has no empty value: "nothing chosen" travels as this. */
const NONE = "__none";
const STANDARD_DAY = "standard";
const DAILY_HOURS = [6, 8, 9, 10, 12];
const NO_WEEKLY_LIMIT = "none";
const WEEKLY_HOURS = [40, 45, 48, 54, 60, 66, 72];
const DEFAULT_OFF_DAYS = "default";
const OFF_DAYS = [0, 1, 2, 3];
/* ISO weekdays, as stored: 1 = Monday .. 7 = Sunday. */
const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];
const SHIFTS: Option[] = [
  { value: "morning", label: "Morning" },
  { value: "night", label: "Night" },
];

type Draft = {
  roleId: string | null;
  serviceTypeId: string | null;
  shift: "morning" | "night" | null;
  teamLeaderFsmId: string | null;
  employmentStatus: "active" | "resigned";
  leavingDate: string;
  hiddenFromLists: boolean;
  restWeekdays: number[];
  dailyHours: number | null;
  weeklyHours: number | null;
  offDaysPerWeek: number | null;
  tagIds: string[];
};

function draftOf(t: TechnicianReference, tagIds: string[]): Draft {
  return {
    roleId: t.role_id ?? null,
    serviceTypeId: t.service_type_id ?? null,
    shift: t.shift ?? null,
    teamLeaderFsmId: t.team_leader_fsm_id ?? null,
    employmentStatus: t.employment_status ?? "active",
    leavingDate: t.leaving_date ?? "",
    hiddenFromLists: t.hidden_from_lists === true,
    restWeekdays: [...(t.rest_weekdays ?? [])].sort((a, b) => a - b),
    dailyHours: t.daily_hours ?? null,
    weeklyHours: t.weekly_hours ?? null,
    offDaysPerWeek: t.off_days_per_week ?? null,
    tagIds: [...tagIds].sort(),
  };
}

const sameList = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/* What Save sends: only the fields that changed. */
function changesOf(from: Draft, to: Draft): TechnicianAttributeUpdate {
  const out: TechnicianAttributeUpdate = {};
  if (from.roleId !== to.roleId) out.roleId = to.roleId;
  if (from.serviceTypeId !== to.serviceTypeId) out.serviceTypeId = to.serviceTypeId;
  if (from.shift !== to.shift) out.shift = to.shift;
  if (from.teamLeaderFsmId !== to.teamLeaderFsmId) out.teamLeaderFsmId = to.teamLeaderFsmId;
  /* Status and leaving date go together: the database refuses "resigned" without a date (DEV-457). */
  if (from.employmentStatus !== to.employmentStatus || from.leavingDate !== to.leavingDate) {
    out.employmentStatus = to.employmentStatus;
    out.leavingDate = to.leavingDate || null;
  }
  if (from.hiddenFromLists !== to.hiddenFromLists) out.hiddenFromLists = to.hiddenFromLists;
  if (!sameList(from.restWeekdays, to.restWeekdays)) out.restWeekdays = to.restWeekdays.length ? to.restWeekdays : null;
  if (from.dailyHours !== to.dailyHours) out.dailyHours = to.dailyHours;
  if (from.weeklyHours !== to.weeklyHours) out.weeklyHours = to.weeklyHours;
  if (from.offDaysPerWeek !== to.offDaysPerWeek) out.offDaysPerWeek = to.offDaysPerWeek;
  return out;
}

function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/** A shadcn Select over options whose "nothing chosen" is an empty value. */
function OptionSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  noneLabel,
}: {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: Option[];
  placeholder: string;
  /** Offered as the first option when the field may be left empty. */
  noneLabel?: string;
}) {
  return (
    <Select value={value ?? (noneLabel ? NONE : "")} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {noneLabel ? (
          <SelectItem value={NONE}>
            <span className="text-muted-foreground">{noneLabel}</span>
          </SelectItem>
        ) : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const TITLES: Record<TechnicianDialogView, string> = {
  attributes: "Edit attributes",
  hours: "Working hours",
  leave: "Leave",
};
const DESCRIPTIONS: Record<TechnicianDialogView, string> = {
  attributes: "Portal settings for this technician. They are not sent to Zoho FSM.",
  hours: "Used for utilization and attendance.",
  leave: "Leave on record, and a new period to add.",
};

export function ManageTechnicianDialog({
  view,
  technician,
  tags,
  leaveTypes,
  roleOptions,
  serviceOptions,
  supervisorOptions,
  assignedTags,
  leaveRecords,
  onApplyAttributes,
  onOpenChange,
  onChanged,
}: {
  view: TechnicianDialogView;
  technician: TechnicianReference;
  tags: TechnicianTag[];
  /** Names from the managed leave-type list (Settings → Workforce). */
  leaveTypes: string[];
  roleOptions: Option[];
  serviceOptions: Option[];
  supervisorOptions: Option[];
  assignedTags: TechnicianTag[];
  leaveRecords: LeaveRecord[];
  /** Writes the changes; false when refused (the reason is shown already). */
  onApplyAttributes: (attrs: TechnicianAttributeUpdate) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [saved] = useState(() => draftOf(technician, assignedTags.map((t) => t.id)));
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const changes = useMemo(() => changesOf(saved, draft), [saved, draft]);
  const tagsChanged = !sameList(saved.tagIds, draft.tagIds);
  const dirty = Object.keys(changes).length > 0 || tagsChanged;
  const leavingDateMissing = draft.employmentStatus === "resigned" && !draft.leavingDate;

  /* Leave: added at once, with its own button. */
  const [leaveType, setLeaveType] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:30");
  const [notes, setNotes] = useState("");
  const [savingLeave, setSavingLeave] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const leaveStarted = Boolean(leaveType || startDate || endDate || notes.trim());

  const close = async () => {
    if (saving || savingLeave) return;
    if (dirty || leaveStarted) {
      const discard = await confirm({
        title: "Discard your changes?",
        description: dirty ? "What you changed for this technician has not been saved." : "The leave you started has not been added.",
        confirmText: "Discard",
        cancelText: "Keep editing",
        variant: "destructive",
      });
      if (!discard) return;
    }
    onOpenChange(false);
  };

  const save = async () => {
    if (!dirty || leavingDateMissing) return;
    setSaving(true);
    try {
      if (Object.keys(changes).length && !(await onApplyAttributes(changes))) return;
      if (tagsChanged) {
        const before = new Set(saved.tagIds);
        const after = new Set(draft.tagIds);
        for (const id of draft.tagIds) if (!before.has(id)) await tagsService.assignTag(technician.fsm_resource_id, id);
        for (const id of saved.tagIds) if (!after.has(id)) await tagsService.removeTag(technician.fsm_resource_id, id);
      }
      onChanged();
      toast.success(`${technician.display_name} saved`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The changes were not saved");
    } finally {
      setSaving(false);
    }
  };

  const toggleRestDay = (day: number) =>
    set(
      "restWeekdays",
      draft.restWeekdays.includes(day) ? draft.restWeekdays.filter((d) => d !== day) : [...draft.restWeekdays, day].sort((a, b) => a - b),
    );
  const toggleTag = (id: string) => set("tagIds", draft.tagIds.includes(id) ? draft.tagIds.filter((t) => t !== id) : [...draft.tagIds, id].sort());

  const addLeave = async () => {
    if (!leaveType || !startDate || !endDate) return;
    setSavingLeave(true);
    try {
      const { conflicts, conflictsError } = await leaveService.createLeave({
        technicianFsmId: technician.fsm_resource_id,
        leaveType,
        startAt: zonedTimeToUtc(startDate, startTime).toISOString(),
        endAt: zonedTimeToUtc(endDate, endTime).toISOString(),
        notes: notes.trim() || null,
      });
      toast.success(
        conflicts.length > 0
          ? `Leave added; ${conflicts.length} existing assignment(s) now clash on the schedule`
          : conflictsError
            ? "Leave added; the clash check failed, so check the board for overlaps"
            : "Leave added",
      );
      setLeaveType(null);
      setStartDate("");
      setEndDate("");
      setNotes("");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The leave was not added");
    } finally {
      setSavingLeave(false);
    }
  };

  const cancelLeave = async (id: string) => {
    const ok = await confirm({ title: "Cancel this leave?", description: "It comes off the schedule.", confirmText: "Cancel leave", cancelText: "Keep it", variant: "destructive" });
    if (!ok) return;
    setCancellingId(id);
    try {
      await leaveService.cancelLeave(id);
      toast.success("Leave cancelled");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The leave was not cancelled");
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && void close()}>
      <ActionDialogContent busy={saving || savingLeave} className="flex max-h-[90vh] w-[calc(100%-2rem)] flex-col gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {TITLES[view]} · {technician.display_name}
          </DialogTitle>
          <DialogDescription>{DESCRIPTIONS[view]}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 pb-1">
          {view === "attributes" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Role" htmlFor="tech-role">
                  <OptionSelect id="tech-role" value={draft.roleId} onChange={(v) => set("roleId", v)} options={roleOptions.filter((o) => o.value)} placeholder="No role" noneLabel="No role" />
                </Field>
                <Field label="Service type" htmlFor="tech-service">
                  <OptionSelect
                    id="tech-service"
                    value={draft.serviceTypeId}
                    onChange={(v) => set("serviceTypeId", v)}
                    options={serviceOptions.filter((o) => o.value)}
                    placeholder="No service type"
                    noneLabel="No service type"
                  />
                </Field>
                <Field label="Shift" htmlFor="tech-shift">
                  <OptionSelect
                    id="tech-shift"
                    value={draft.shift}
                    onChange={(v) => set("shift", v === "morning" || v === "night" ? v : null)}
                    options={SHIFTS}
                    placeholder="No shift"
                    noneLabel="No shift"
                  />
                </Field>
                <Field label="Supervisor" htmlFor="tech-supervisor">
                  <OptionSelect
                    id="tech-supervisor"
                    value={draft.teamLeaderFsmId}
                    onChange={(v) => set("teamLeaderFsmId", v)}
                    options={supervisorOptions.filter((o) => o.value)}
                    placeholder="No supervisor"
                    noneLabel="No supervisor"
                  />
                </Field>
                <Field label="Employment status" htmlFor="tech-status">
                  <OptionSelect
                    id="tech-status"
                    value={draft.employmentStatus}
                    onChange={(v) => set("employmentStatus", v === "resigned" ? "resigned" : "active")}
                    options={[
                      { value: "active", label: "Active" },
                      { value: "resigned", label: "Resigned" },
                    ]}
                    placeholder="Active"
                  />
                </Field>
                <Field label={draft.employmentStatus === "resigned" ? "Leaving date" : "Leaving date (optional)"} htmlFor="tech-leaving">
                  <DateSelect id="tech-leaving" value={draft.leavingDate} onChange={(v) => set("leavingDate", v)} placeholder="No leaving date" aria-label="Leaving date" />
                  {leavingDateMissing ? <p className="text-destructive text-xs">A resigned technician needs a leaving date.</p> : null}
                </Field>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="grid gap-0.5">
                  <Label htmlFor="tech-hidden">Hide from lists</Label>
                  <p className="text-muted-foreground text-xs">For test accounts: kept off the schedule board and its pickers.</p>
                </div>
                <Switch id="tech-hidden" checked={draft.hiddenFromLists} onCheckedChange={(v) => set("hiddenFromLists", v === true)} />
              </div>

              <Separator />

              <Field label="Tags">
                {tags.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No tags yet. Add them under Settings → Workforce.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tags">
                    {tags.map((tag) => {
                      const on = draft.tagIds.includes(tag.id);
                      return (
                        <Button key={tag.id} type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => toggleTag(tag.id)}>
                          {on ? <Check className="size-3.5" /> : null}
                          {tag.name}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </Field>
            </>
          ) : null}

          {view === "hours" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Hours a day" htmlFor="tech-daily">
                  <OptionSelect
                    id="tech-daily"
                    value={draft.dailyHours === null ? STANDARD_DAY : String(draft.dailyHours)}
                    onChange={(v) => set("dailyHours", !v || v === STANDARD_DAY ? null : Number(v))}
                    options={[{ value: STANDARD_DAY, label: "Standard (8 h)" }, ...DAILY_HOURS.map((h) => ({ value: String(h), label: `${h} hours` }))]}
                    placeholder="Standard (8 h)"
                  />
                </Field>
                <Field label="Weekly limit" htmlFor="tech-weekly">
                  <OptionSelect
                    id="tech-weekly"
                    value={draft.weeklyHours === null ? NO_WEEKLY_LIMIT : String(draft.weeklyHours)}
                    onChange={(v) => set("weeklyHours", !v || v === NO_WEEKLY_LIMIT ? null : Number(v))}
                    options={[{ value: NO_WEEKLY_LIMIT, label: "No limit" }, ...WEEKLY_HOURS.map((h) => ({ value: String(h), label: `${h} hours` }))]}
                    placeholder="No limit"
                  />
                </Field>
                <Field label="Off days a week" htmlFor="tech-off">
                  <OptionSelect
                    id="tech-off"
                    value={draft.offDaysPerWeek === null ? DEFAULT_OFF_DAYS : String(draft.offDaysPerWeek)}
                    onChange={(v) => set("offDaysPerWeek", !v || v === DEFAULT_OFF_DAYS ? null : Number(v))}
                    options={[{ value: DEFAULT_OFF_DAYS, label: "1 (standard)" }, ...OFF_DAYS.map((d) => ({ value: String(d), label: d === 1 ? "1 day" : `${d} days` }))]}
                    placeholder="1 (standard)"
                  />
                </Field>
              </div>

              <Field label="Fixed rest days" hint="Used by daily attendance and app compliance. Leave all off if their days off change.">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Fixed rest days">
                  {WEEKDAYS.map((day) => {
                    const on = draft.restWeekdays.includes(day.value);
                    return (
                      <Button key={day.value} type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => toggleRestDay(day.value)}>
                        {day.label}
                      </Button>
                    );
                  })}
                </div>
              </Field>
            </>
          ) : null}

          {view === "leave" ? (
            <>
              {leaveRecords.length === 0 ? (
                <p className="text-muted-foreground text-sm">No leave recorded.</p>
              ) : (
                <ul className="grid gap-1.5">
                  {leaveRecords.map((record) => (
                    <li key={record.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium">{record.leave_type}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatZonedDate(record.start_at)} – {formatZonedDate(record.end_at)}
                        </span>
                        <StatusBadge status={record.status} />
                      </div>
                      {record.status === "active" ? (
                        <Hint label="Cancel leave">
                          <Button aria-label="Cancel leave" size="icon" variant="ghost" disabled={cancellingId === record.id} onClick={() => void cancelLeave(record.id)}>
                            <X className="size-4" />
                          </Button>
                        </Hint>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              <div className="grid gap-3 rounded-lg border p-3">
                <p className="font-medium">Add leave</p>
                <Field label="Leave type" htmlFor="leave-type">
                  {leaveTypes.length === 0 ? (
                    <p className="text-muted-foreground rounded-md border border-dashed p-2 text-xs">No leave types yet. Add them under Settings → Workforce → Leave types.</p>
                  ) : (
                    <OptionSelect id="leave-type" value={leaveType} onChange={setLeaveType} options={leaveTypes.map((n) => ({ value: n, label: n }))} placeholder="Choose a type" />
                  )}
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From" htmlFor="leave-start">
                    <DateSelect id="leave-start" value={startDate} onChange={setStartDate} aria-label="Leave start date" />
                  </Field>
                  <Field label="Time">
                    <TimeSelect value={startTime} onChange={setStartTime} aria-label="Leave start time" />
                  </Field>
                  <Field label="To" htmlFor="leave-end">
                    <DateSelect id="leave-end" value={endDate} onChange={setEndDate} aria-label="Leave end date" />
                  </Field>
                  <Field label="Time">
                    <TimeSelect value={endTime} onChange={setEndTime} aria-label="Leave end time" />
                  </Field>
                </div>
                <Field label="Notes (optional)" htmlFor="leave-notes">
                  <Input id="leave-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="items-center">
          {view === "leave" ? (
            <>
              <Button variant="outline" onClick={() => void close()} disabled={savingLeave}>
                Close
              </Button>
              <SubmitButton
                pending={savingLeave}
                disabled={!leaveType || !startDate || !endDate}
                icon={<CalendarPlus className="size-4" />}
                onClick={() => void addLeave()}
              >
                Add leave
              </SubmitButton>
            </>
          ) : (
            <>
              {dirty ? (
                <Badge variant="secondary" className="bg-warning/10 text-warning mr-auto border-0">
                  Unsaved changes
                </Badge>
              ) : null}
              <Button variant="outline" onClick={() => void close()} disabled={saving}>
                Cancel
              </Button>
              <SubmitButton pending={saving} disabled={!dirty || leavingDateMissing} onClick={() => void save()}>
                Save changes
              </SubmitButton>
            </>
          )}
        </DialogFooter>
        {dialog}
      </ActionDialogContent>
    </Dialog>
  );
}
