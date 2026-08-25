"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Contact,
  Download,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService } from "@/modules/snagging";
import { usersService } from "@/modules/users/services/users-service";
import { ActionType, ResourceType, type SnaggingTask, type User } from "@/types/types";

import {
  DataState,
  FieldsSkeleton,
  SectionCard,
  SubmitButton,
  useConfirm,
} from "./shared";

const UNASSIGNED = "none";

/** Splits a stored appointment instant into GST (+04:00) date + time parts. */
function splitAppointment(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const shifted = new Date(new Date(iso).getTime() + 4 * 3600 * 1000);
  if (Number.isNaN(shifted.getTime())) return { date: "", time: "" };
  const s = shifted.toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/**
 * Job setup (FR-3.02, FR-3.03, FR-3.04, FR-3.08): the appointment, the two site
 * contacts, the property NOC (read-only, from FR-1.09), and inspector
 * assignment. Assignment is gated on the client approving the quotation and is
 * enforced server-side too — this panel only surfaces the gate and availability.
 */
export function JobSetupPanel({ task, onChanged }: { task: SnaggingTask; onChanged: () => void }) {
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.EDIT);
  const { confirm, dialog } = useConfirm();

  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | "appt" | "contacts" | "assign">(null);
  const [busyMap, setBusyMap] = useState<Record<string, string>>({});
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  // Bumped to re-run the availability check after a failed one.
  const [availabilityNonce, setAvailabilityNonce] = useState(0);

  const initial = splitAppointment(task.appointment_at ?? null);
  const [apptDate, setApptDate] = useState(initial.date);
  const [apptTime, setApptTime] = useState(initial.time);

  const [devName, setDevName] = useState(task.developer_contact_name ?? "");
  const [devPhone, setDevPhone] = useState(task.developer_contact_phone ?? "");
  const [cliName, setCliName] = useState(task.client_contact_name ?? "");
  const [cliPhone, setCliPhone] = useState(task.client_contact_phone ?? "");

  const [inspectorId, setInspectorId] = useState(task.inspector_id ?? UNASSIGNED);
  const [managerId, setManagerId] = useState(task.approval_manager_id ?? UNASSIGNED);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const rows: User[] = await usersService.getUsers();
      setUsers(rows.filter((r) => r.is_active !== false));
    } catch (e) {
      // An empty Select was the only sign of a failed fetch, so "no staff
      // exist" and "the staff list broke" looked identical.
      setUsers([]);
      setUsersError(e instanceof Error ? e.message : "Could not load the staff list");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  // Availability for the appointment day, so a booked inspector is flagged.
  useEffect(() => {
    if (!apptDate) {
      setBusyMap({});
      setAvailabilityError(null);
      return;
    }
    let active = true;
    setAvailabilityError(null);
    snaggingService
      .getAvailability(apptDate, task.id)
      .then((r) => active && setBusyMap(r.busy ?? {}))
      .catch((e) => {
        // A swallowed failure reads as "everyone is free that day", which
        // is how two jobs get booked onto one inspector.
        if (!active) return;
        setBusyMap({});
        setAvailabilityError(e instanceof Error ? e.message : "Could not check availability");
      });
    return () => {
      active = false;
    };
  }, [apptDate, task.id, availabilityNonce]);

  // The quotation approval flips the job draft -> assigned; a child job (round /
  // additional visit) is created assigned. So anything past draft has cleared
  // the gate. `locked` (approved report) freezes further edits.
  const quotationApproved = task.status !== "draft";
  const canAssign = canEdit && quotationApproved && !task.locked;

  async function saveAppointment() {
    setSaving("appt");
    try {
      const appointment_at = apptDate ? `${apptDate}T${apptTime || "09:00"}:00+04:00` : null;
      await snaggingService.updateTask(task.id, { appointment_at });
      toast.success("Appointment saved");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the appointment");
    } finally {
      setSaving(null);
    }
  }

  async function saveContacts() {
    setSaving("contacts");
    try {
      await snaggingService.updateTask(task.id, {
        developer_contact_name: devName.trim() || null,
        developer_contact_phone: devPhone.trim() || null,
        client_contact_name: cliName.trim() || null,
        client_contact_phone: cliPhone.trim() || null,
      });
      toast.success("Site contacts saved");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the contacts");
    } finally {
      setSaving(null);
    }
  }

  async function saveAssignment() {
    if (inspectorId !== UNASSIGNED && managerId === UNASSIGNED) {
      toast.error("Select an approval manager before assigning an inspector");
      return;
    }

    // Saving clears technician_ids, so a change here quietly takes the
    // person currently on the job off it. Say whose job is being moved.
    const current = task.inspector_id ?? null;
    if (current && inspectorId !== current) {
      const previous = users.find((u) => u.id === current);
      const who = (previous?.full_name || previous?.email) ?? "The assigned inspector";
      const unassigning = inspectorId === UNASSIGNED;
      const ok = await confirm({
        title: unassigning ? "Unassign the inspector?" : "Change the assigned inspector?",
        description: unassigning
          ? `${who} will be taken off this job and it will have no inspector until someone else is assigned.`
          : `${who} will be taken off this job and replaced by the inspector you selected.`,
        confirmText: unassigning ? "Unassign" : "Change inspector",
        variant: "destructive",
      });
      if (!ok) return;
    }

    setSaving("assign");
    try {
      await snaggingService.updateTask(task.id, {
        technician_ids: inspectorId === UNASSIGNED ? [] : [inspectorId],
        approval_manager_id: managerId === UNASSIGNED ? null : managerId,
      });
      toast.success(inspectorId === UNASSIGNED ? "Inspector unassigned" : "Inspector assigned");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the assignment");
    } finally {
      setSaving(null);
    }
  }

  const property = task.property;
  const nocRequired = Boolean(property?.noc_required);
  const nocOnFile = Boolean(property?.noc_path);

  return (
    <SectionCard
      title="Job setup"
      description="Appointment, site contacts, NOC and inspector assignment"
      bodyClassName="border-t"
    >
      <div className="divide-y">
        {/* Appointment (FR-3.02) */}
        <SetupSection
          icon={CalendarClock}
          title="Appointment"
          description="When the inspector is expected on site. Quoted in Gulf time."
          footer={
            canEdit ? (
              <SubmitButton
                size="sm"
                variant="outline"
                onClick={() => void saveAppointment()}
                disabled={saving !== null}
                pending={saving === "appt"}
                pendingLabel="Saving…"
                icon={<Save className="size-4" />}
              >
                Save appointment
              </SubmitButton>
            ) : null
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="appt-date">
              <Input
                id="appt-date"
                type="date"
                value={apptDate}
                disabled={!canEdit}
                onChange={(e) => setApptDate(e.target.value)}
              />
            </Field>
            <Field label="Time (GST)" htmlFor="appt-time">
              <Input
                id="appt-time"
                type="time"
                value={apptTime}
                disabled={!canEdit || !apptDate}
                onChange={(e) => setApptTime(e.target.value)}
              />
            </Field>
          </div>
        </SetupSection>

        {/* Site contacts (FR-3.03) */}
        <SetupSection
          icon={Contact}
          title="Site contacts"
          description="Who the inspector calls to get in on the day."
          footer={
            canEdit ? (
              <SubmitButton
                size="sm"
                variant="outline"
                onClick={() => void saveContacts()}
                disabled={saving !== null}
                pending={saving === "contacts"}
                pendingLabel="Saving…"
                icon={<Save className="size-4" />}
              >
                Save contacts
              </SubmitButton>
            ) : null
          }
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-3">
              <p className="eyebrow">Developer side</p>
              <Field label="Name" htmlFor="dev-name">
                <Input
                  id="dev-name"
                  value={devName}
                  disabled={!canEdit}
                  onChange={(e) => setDevName(e.target.value)}
                />
              </Field>
              <Field label="Phone" htmlFor="dev-phone">
                <Input
                  id="dev-phone"
                  value={devPhone}
                  disabled={!canEdit}
                  onChange={(e) => setDevPhone(e.target.value)}
                />
              </Field>
            </div>
            <div className="space-y-3">
              <p className="eyebrow">Client / representative</p>
              <Field label="Name" htmlFor="cli-name">
                <Input
                  id="cli-name"
                  value={cliName}
                  disabled={!canEdit}
                  onChange={(e) => setCliName(e.target.value)}
                />
              </Field>
              <Field label="Phone" htmlFor="cli-phone">
                <Input
                  id="cli-phone"
                  value={cliPhone}
                  disabled={!canEdit}
                  onChange={(e) => setCliPhone(e.target.value)}
                />
              </Field>
            </div>
          </div>
        </SetupSection>

        {/* NOC (FR-3.04) — read-only, from the property (FR-1.09) */}
        <SetupSection
          icon={ShieldCheck}
          title="NOC"
          description="Managed on the property record, shown here so the gate is visible before the visit."
          action={
            nocOnFile && property?.noc_url ? (
              <Button asChild size="sm" variant="outline">
                <a href={property.noc_url} target="_blank" rel="noopener noreferrer">
                  <Download className="size-3.5" /> View NOC
                </a>
              </Button>
            ) : null
          }
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <dt className="text-muted-foreground text-xs font-medium">Required</dt>
              <dd>
                <Badge
                  variant="secondary"
                  className={cn(
                    "border-0 font-medium",
                    nocRequired ? "bg-brand-100 text-brand" : "bg-mist text-ink-soft",
                  )}
                >
                  {nocRequired ? "Yes" : "No"}
                </Badge>
              </dd>
            </div>
            <div className="space-y-1.5">
              <dt className="text-muted-foreground text-xs font-medium">On file</dt>
              <dd>
                <Badge
                  variant="secondary"
                  className={cn(
                    "border-0 font-medium",
                    nocOnFile ? "bg-success/10 text-success" : "bg-mist text-ink-soft",
                  )}
                >
                  {nocOnFile ? "On file" : "Not uploaded"}
                </Badge>
              </dd>
            </div>
          </dl>
          {nocRequired && !nocOnFile ? (
            <Alert variant="destructive" className="border-destructive/30 mt-4">
              <AlertTriangle />
              <AlertTitle>NOC required but not uploaded</AlertTitle>
              <AlertDescription>
                Add it to the property record before the inspector attends, or access may be
                refused on the day.
              </AlertDescription>
            </Alert>
          ) : null}
        </SetupSection>

        {/* Inspector assignment (FR-3.08) */}
        <SetupSection
          icon={UserCog}
          title="Inspector assignment"
          description="Who walks the unit, and who signs the report off."
        >
          {!quotationApproved ? (
            <Alert>
              <Lock />
              <AlertTitle>Waiting on the client&apos;s quotation approval</AlertTitle>
              <AlertDescription>
                An inspector can be assigned once the client approves the quotation above.
              </AlertDescription>
            </Alert>
          ) : (
            <DataState
              loading={usersLoading}
              error={usersError}
              onRetry={() => void loadUsers()}
              retrying={usersLoading}
              errorTitle="Could not load the staff list"
              // Matches the two selects below, so the inspector picker no
              // longer renders empty and then pops full.
              skeleton={<FieldsSkeleton fields={2} columns={2} className="p-0" />}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Inspector" htmlFor="assign-inspector">
                  <Select value={inspectorId} onValueChange={setInspectorId} disabled={!canAssign}>
                    <SelectTrigger id="assign-inspector" className="w-full">
                      <SelectValue placeholder="Assign an inspector" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {users.map((u) => {
                        const busyCode = busyMap[u.id];
                        const isBusy = Boolean(busyCode) && u.id !== task.inspector_id;
                        return (
                          <SelectItem key={u.id} value={u.id} disabled={isBusy}>
                            {(u.full_name || u.email) ?? u.id}
                            {isBusy ? ` — busy (${busyCode})` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {availabilityError ? (
                    <p className="text-destructive mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      Could not check availability for {apptDate}; booked inspectors are not flagged.
                      <button
                        type="button"
                        onClick={() => setAvailabilityNonce((n) => n + 1)}
                        className="inline-flex items-center gap-1 underline underline-offset-2"
                      >
                        <RefreshCw className="size-3" /> Try again
                      </button>
                    </p>
                  ) : apptDate ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Availability shown for {apptDate}. Booked inspectors are disabled.
                    </p>
                  ) : (
                    <p className="text-muted-foreground mt-1 text-xs">Set an appointment date to check availability.</p>
                  )}
                </Field>
                <Field label="Approval manager" hint="Required before an inspector can be assigned." htmlFor="assign-manager">
                  <Select value={managerId} onValueChange={setManagerId} disabled={!canAssign}>
                    <SelectTrigger id="assign-manager" className="w-full">
                      <SelectValue placeholder="Who signs this off?" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>None</SelectItem>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {(u.full_name || u.email) ?? u.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {canAssign ? (
                <div className="flex justify-end">
                  <SubmitButton
                    size="sm"
                    onClick={() => void saveAssignment()}
                    disabled={saving !== null}
                    pending={saving === "assign"}
                    pendingLabel="Saving…"
                    icon={<UserCog className="size-4" />}
                  >
                    {task.inspector_id ? "Update assignment" : "Assign inspector"}
                  </SubmitButton>
                </div>
              ) : task.locked ? (
                <Alert>
                  <Lock />
                  <AlertTitle>This inspection is locked</AlertTitle>
                  <AlertDescription>
                    The report has been approved, so the assignment can no longer be changed.
                  </AlertDescription>
                </Alert>
              ) : null}
            </DataState>
          )}
        </SetupSection>
      </div>

      {dialog}
    </SectionCard>
  );
}

/**
 * One block of the setup form: an icon'd title, a line saying what it is
 * for, the fields, and its own save on the right.
 *
 * Each block writes to a different endpoint, so they keep separate save
 * buttons — but they now share one header treatment instead of three
 * slightly different hand-rolled ones.
 */
function SetupSection({
  icon: Icon,
  title,
  description,
  action,
  footer,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div>
            <h3 className="text-sm leading-none font-medium">{title}</h3>
            {description ? (
              <p className="text-muted-foreground mt-1.5 text-xs">{description}</p>
            ) : null}
          </div>
        </div>
        {action}
      </div>

      {children}

      {footer ? <div className="mt-4 flex justify-end">{footer}</div> : null}
    </section>
  );
}

/** Label + control + optional hint, so every field on the panel lines up. */
function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-muted-foreground text-xs font-medium">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}
