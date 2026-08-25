"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Download, Loader2, Save, ShieldCheck, UserCog } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

import { SectionCard } from "./shared";

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

  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState<null | "appt" | "contacts" | "assign">(null);
  const [busyMap, setBusyMap] = useState<Record<string, string>>({});

  const initial = splitAppointment(task.appointment_at ?? null);
  const [apptDate, setApptDate] = useState(initial.date);
  const [apptTime, setApptTime] = useState(initial.time);

  const [devName, setDevName] = useState(task.developer_contact_name ?? "");
  const [devPhone, setDevPhone] = useState(task.developer_contact_phone ?? "");
  const [cliName, setCliName] = useState(task.client_contact_name ?? "");
  const [cliPhone, setCliPhone] = useState(task.client_contact_phone ?? "");

  const [inspectorId, setInspectorId] = useState(task.inspector_id ?? UNASSIGNED);
  const [managerId, setManagerId] = useState(task.approval_manager_id ?? UNASSIGNED);

  useEffect(() => {
    usersService
      .getUsers()
      .then((rows: User[]) => setUsers(rows.filter((r) => r.is_active !== false)))
      .catch(() => setUsers([]));
  }, []);

  // Availability for the appointment day, so a booked inspector is flagged.
  useEffect(() => {
    if (!apptDate) {
      setBusyMap({});
      return;
    }
    let active = true;
    snaggingService
      .getAvailability(apptDate, task.id)
      .then((r) => active && setBusyMap(r.busy ?? {}))
      .catch(() => active && setBusyMap({}));
    return () => {
      active = false;
    };
  }, [apptDate, task.id]);

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
        <section className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="size-4" /> Appointment
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={apptDate} disabled={!canEdit} onChange={(e) => setApptDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Time (GST)</Label>
              <Input type="time" value={apptTime} disabled={!canEdit || !apptDate} onChange={(e) => setApptTime(e.target.value)} />
            </div>
          </div>
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={() => void saveAppointment()} disabled={saving !== null}>
              {saving === "appt" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save appointment
            </Button>
          ) : null}
        </section>

        {/* Site contacts (FR-3.03) */}
        <section className="space-y-3 p-5">
          <div className="text-sm font-medium">Site contacts</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-muted-foreground text-xs font-semibold uppercase">Developer side</div>
              <Input placeholder="Name" value={devName} disabled={!canEdit} onChange={(e) => setDevName(e.target.value)} />
              <Input placeholder="Phone" value={devPhone} disabled={!canEdit} onChange={(e) => setDevPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <div className="text-muted-foreground text-xs font-semibold uppercase">Client / representative</div>
              <Input placeholder="Name" value={cliName} disabled={!canEdit} onChange={(e) => setCliName(e.target.value)} />
              <Input placeholder="Phone" value={cliPhone} disabled={!canEdit} onChange={(e) => setCliPhone(e.target.value)} />
            </div>
          </div>
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={() => void saveContacts()} disabled={saving !== null}>
              {saving === "contacts" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save contacts
            </Button>
          ) : null}
        </section>

        {/* NOC (FR-3.04) — read-only, from the property (FR-1.09) */}
        <section className="space-y-2 p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4" /> NOC
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Required:</span>
            <Badge variant={nocRequired ? "default" : "secondary"} className="border-0">
              {nocRequired ? "Yes" : "No"}
            </Badge>
            <span className="text-muted-foreground ml-2">On file:</span>
            {nocOnFile ? (
              <Badge className="border-0 bg-emerald-600 text-white">On file</Badge>
            ) : (
              <Badge variant="secondary" className="border-0">Not uploaded</Badge>
            )}
            {nocOnFile && property?.noc_url ? (
              <Button asChild size="sm" variant="outline" className="ml-1">
                <a href={property.noc_url} target="_blank" rel="noopener noreferrer">
                  <Download className="size-3.5" /> View NOC
                </a>
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            The NOC is managed on the property record. {nocRequired && !nocOnFile ? "It is required but not yet uploaded." : null}
          </p>
        </section>

        {/* Inspector assignment (FR-3.08) */}
        <section className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <UserCog className="size-4" /> Inspector assignment
          </div>
          {!quotationApproved ? (
            <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
              An inspector can be assigned once the client approves the quotation.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Inspector</Label>
                  <Select value={inspectorId} onValueChange={setInspectorId} disabled={!canAssign}>
                    <SelectTrigger className="w-full">
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
                  {apptDate ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Availability shown for {apptDate}. Booked inspectors are disabled.
                    </p>
                  ) : (
                    <p className="text-muted-foreground mt-1 text-xs">Set an appointment date to check availability.</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Approval manager (required)</Label>
                  <Select value={managerId} onValueChange={setManagerId} disabled={!canAssign}>
                    <SelectTrigger className="w-full">
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
                </div>
              </div>
              {canAssign ? (
                <Button size="sm" onClick={() => void saveAssignment()} disabled={saving !== null}>
                  {saving === "assign" ? <Loader2 className="size-4 animate-spin" /> : <UserCog className="size-4" />}
                  {task.inspector_id ? "Update assignment" : "Assign inspector"}
                </Button>
              ) : task.locked ? (
                <p className="text-muted-foreground text-sm">This inspection is locked; reassignment is disabled.</p>
              ) : null}
            </>
          )}
        </section>
      </div>
    </SectionCard>
  );
}
