"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";

import EmployeeRecordView from "@/components/dashboard/compliance/employee-record";
import EmployeeLeaveCard from "@/components/dashboard/workforce/employee-leave";
import { AvailabilityCell, RoleCell, ServiceCell, ShiftCell, Unset } from "@/components/dashboard/scheduling/technician-cells";
import { PageHeading, PillTabs, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ManageTechnicianDialog, type WorkforceAccess } from "@/components/dashboard/workforce/people";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EmployeeRecord } from "@/lib/compliance/types";
import { EMPLOYMENT_STATUS_LABEL } from "@/lib/compliance/statuses";
import { formatZonedDate, formatZonedDateTime } from "@/lib/scheduling/org-time";
import { complianceService } from "@/modules/compliance";
import {
  leaveService,
  leaveTypesService,
  rolesService,
  serviceTypesService,
  tagsService,
  techniciansService,
  type TechnicianAttributeUpdate,
} from "@/modules/scheduling";
import type { LeaveRecord, LeaveType, TechnicianReference, TechnicianRole, TechnicianServiceType, TechnicianTag } from "@/types/types";

/*
  One person in Workforce (13-4): Profile shows the scheduling fields (stored
  on the FSM technician, saved through Scheduling's routes) beside the
  compliance fields (stored on the employee); Leave is the technician's
  leave; Compliance is the full compliance record, unchanged.
*/
type Tab = "profile" | "leave" | "compliance";

export default function WorkforcePerson({
  technicians,
  fsmResourceId,
  employeeId,
  access,
}: {
  technicians: TechnicianReference[];
  fsmResourceId: string | null;
  employeeId: string | null;
  access: WorkforceAccess;
}) {
  const [techs, setTechs] = useState(technicians);
  const tech = useMemo(() => (fsmResourceId ? techs.find((t) => t.fsm_resource_id === fsmResourceId) ?? null : null), [techs, fsmResourceId]);
  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);

  const tabs = useMemo(() => {
    const out: { value: Tab; label: string }[] = [{ value: "profile", label: "Profile" }];
    // Everyone has leave (31 Oct 2026): on the technician when in FSM, else on the employee.
    if ((tech && access.scheduling) || (employeeId && access.compliance)) out.push({ value: "leave", label: "Leave" });
    if (employeeId && access.compliance) out.push({ value: "compliance", label: "Compliance" });
    return out;
  }, [tech, employeeId, access]);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTabState] = useState<Tab>(() => {
    const v = searchParams.get("tab");
    return v === "leave" || v === "compliance" ? v : "profile";
  });
  const setTab = (next: Tab) => {
    setTabState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(window.history.state, "", `${pathname}?${params.toString()}`);
  };
  const activeTab = tabs.some((t) => t.value === tab) ? tab : "profile";

  // Scheduling data for the technician, as the People page loads it.
  const [tags, setTags] = useState<TechnicianTag[]>([]);
  const [assigned, setAssigned] = useState<TechnicianTag[]>([]);
  const [roles, setRoles] = useState<TechnicianRole[]>([]);
  const [services, setServices] = useState<TechnicianServiceType[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leave, setLeave] = useState<LeaveRecord[]>([]);
  const [editing, setEditing] = useState(false);
  // "Now" for the availability line, taken when the leave arrives.
  const [now, setNow] = useState(0);

  const loadScheduling = useCallback(() => {
    if (!fsmResourceId || !access.scheduling) return Promise.resolve();
    return Promise.all([
      tagsService.listTags(),
      tagsService.listAssignmentsByTechnician(),
      leaveService.listLeave({ technicianFsmId: fsmResourceId }),
      rolesService.list(),
      serviceTypesService.list(),
      leaveTypesService.list(),
    ])
      .then(([tagList, assignmentMap, leaveList, roleList, serviceList, leaveTypeList]) => {
        setTags(tagList);
        setAssigned(assignmentMap[fsmResourceId] ?? []);
        setLeave(leaveList);
        setNow(Date.now());
        setRoles(roleList);
        setServices(serviceList);
        setLeaveTypes(leaveTypeList);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load scheduling data"));
  }, [fsmResourceId, access.scheduling]);

  const loadEmployee = useCallback(() => {
    if (!employeeId || !access.compliance) return Promise.resolve();
    return complianceService
      .getEmployee(employeeId)
      .then(setEmployee)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load the employee"));
  }, [employeeId, access.compliance]);

  useEffect(() => {
    void loadScheduling();
    void loadEmployee();
  }, [loadScheduling, loadEmployee]);

  const roleOptions = [{ value: "", label: "— Role —" }, ...roles.map((r) => ({ value: r.id, label: r.name }))];
  const serviceOptions = [{ value: "", label: "— Service —" }, ...services.map((s) => ({ value: s.id, label: s.name }))];
  const supervisorOptions = [
    { value: "", label: "— Supervisor —" },
    ...techs
      .filter((t) => t.is_active && (t.role_name ?? "").toLowerCase() === "supervisor" && t.fsm_resource_id !== fsmResourceId)
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .map((t) => ({ value: t.fsm_resource_id, label: t.display_name })),
  ];

  // Same optimistic update the People page makes, through Scheduling's route.
  const applyAttributes = async (attrs: TechnicianAttributeUpdate) => {
    if (!tech) return;
    const before = tech;
    setTechs((prev) =>
      prev.map((t) => {
        if (t.fsm_resource_id !== tech.fsm_resource_id) return t;
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
          next.team_leader_name = prev.find((x) => x.fsm_resource_id === attrs.teamLeaderFsmId)?.display_name ?? null;
        }
        return next;
      }),
    );
    try {
      await techniciansService.updateAttributes([tech.fsm_resource_id], attrs);
    } catch (error) {
      setTechs((prev) => prev.map((t) => (t.fsm_resource_id === before.fsm_resource_id ? before : t)));
      toast.error(error instanceof Error ? error.message : "Failed to update technician");
    }
  };

  const activeLeave = leave.filter((r) => r.status === "active");
  const current = activeLeave.find((r) => Date.parse(r.start_at) <= now && Date.parse(r.end_at) > now);
  const upcoming = activeLeave.filter((r) => Date.parse(r.start_at) > now).sort((a, b) => a.start_at.localeCompare(b.start_at))[0];

  const name = employee?.full_name ?? tech?.display_name ?? "Person";
  const subtitle = [
    // While the record loads, say nothing rather than "No employee record".
    employee ? `Maher ID ${employee.maher_id}` : access.compliance && !employeeId ? "No employee record" : null,
    tech ? `FSM: ${tech.display_name}${tech.is_active ? "" : " (inactive)"}` : "Not in FSM",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Workforce"
        title={name}
        description={subtitle}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/workforce">
              <ArrowLeft className="size-4" /> People
            </Link>
          </Button>
        }
      />
      {tabs.length > 1 && <PillTabs<Tab> value={activeTab} onChange={setTab} tabs={tabs} />}

      {activeTab === "profile" && (
        <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
          {access.scheduling && (
            <SectionCard
              title="Scheduling"
              description={tech ? "Stored on the FSM technician; the board reads these." : undefined}
              bodyClassName="px-5 pb-5"
              action={
                tech ? (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    <SlidersHorizontal className="size-4" /> Edit
                  </Button>
                ) : undefined
              }
            >
              {tech ? (
                <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Role</dt>
                  <dd><RoleCell name={tech.role_name} /></dd>
                  <dt className="text-muted-foreground">Service type</dt>
                  <dd><ServiceCell name={tech.service_type_name} /></dd>
                  <dt className="text-muted-foreground">Shift</dt>
                  <dd><ShiftCell shift={tech.shift} /></dd>
                  <dt className="text-muted-foreground">Supervisor</dt>
                  <dd>{tech.team_leader_name ?? <Unset />}</dd>
                  <dt className="text-muted-foreground">Tags</dt>
                  <dd className="flex flex-wrap gap-1">
                    {assigned.length ? assigned.map((t) => <Badge key={t.id} variant="secondary" className="font-normal">{t.name}</Badge>) : <Unset label="—" />}
                  </dd>
                  <dt className="text-muted-foreground">Availability</dt>
                  <dd>
                    <AvailabilityCell
                      state={current ? "on-leave" : upcoming ? "upcoming" : "available"}
                      detail={current ? `${current.leave_type} until ${formatZonedDate(current.end_at)}` : upcoming ? `${upcoming.leave_type} from ${formatZonedDate(upcoming.start_at)}` : undefined}
                    />
                  </dd>
                </dl>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Not in FSM, not scheduled. Only FSM technicians hold scheduling fields, so this person never appears on the board. Their leave is kept on the Leave tab of this profile.
                </p>
              )}
            </SectionCard>
          )}
          {access.compliance && (
            <SectionCard
              title="Employee"
              description={employee ? "Stored on the compliance record." : undefined}
              bodyClassName="px-5 pb-5"
              action={
                employee ? (
                  <Button size="sm" variant="outline" onClick={() => setTab("compliance")}>
                    Open compliance
                  </Button>
                ) : undefined
              }
            >
              {employee ? (
                <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Maher ID</dt>
                  <dd>{employee.maher_id}</dd>
                  <dt className="text-muted-foreground">Designation</dt>
                  <dd>{employee.designation?.name ?? <Unset />}</dd>
                  <dt className="text-muted-foreground">Nationality</dt>
                  <dd>{employee.nationality?.name ?? <Unset />}</dd>
                  <dt className="text-muted-foreground">Joined</dt>
                  <dd>{employee.date_of_joining ? formatZonedDate(employee.date_of_joining) : <Unset />}</dd>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>{EMPLOYMENT_STATUS_LABEL[employee.employment_status]}</dd>
                  <dt className="text-muted-foreground">Site</dt>
                  <dd>{employee.site ? [employee.site.client_name, employee.site.property_label].filter(Boolean).join(" · ") : "Unassigned"}</dd>
                </dl>
              ) : employeeId ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : (
                <div className="flex flex-col items-start gap-3 text-sm">
                  <p className="text-muted-foreground">No employee record yet. Add one with this person&apos;s Maher ID and link it to the FSM technician.</p>
                  {access.complianceCreate && (
                    <Button asChild size="sm">
                      <Link href="/compliance/employees/new">New employee</Link>
                    </Button>
                  )}
                </div>
              )}
            </SectionCard>
          )}
        </div>
      )}

      {activeTab === "leave" && tech && (
        <SectionCard
          title="Leave"
          description="Recorded against the FSM technician, so the board's leave checks see it."
          bodyClassName="px-5 pb-5"
          className="max-w-4xl"
          action={
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={!tech.is_active}>
              Add or cancel leave
            </Button>
          }
        >
          {leave.length === 0 ? (
            <p className="text-muted-foreground text-sm">No leave recorded.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr className="text-left">
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">From</th>
                    <th className="px-3 py-2">To</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {[...leave]
                    .sort((a, b) => b.start_at.localeCompare(a.start_at))
                    .map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2">{r.leave_type}</td>
                        <td className="px-3 py-2">{formatZonedDateTime(r.start_at)}</td>
                        <td className="px-3 py-2">{formatZonedDateTime(r.end_at)}</td>
                        <td className="px-3 py-2">{r.status === "active" ? "Active" : "Cancelled"}</td>
                        <td className="text-muted-foreground px-3 py-2">{r.notes ?? ""}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {activeTab === "leave" && employeeId && (
        <EmployeeLeaveCard employeeId={employeeId} linked={Boolean(fsmResourceId)} canAdd={access.leaveAdd} canCancel={access.leaveCancel} />
      )}

      {activeTab === "compliance" && employeeId && <EmployeeRecordView id={employeeId} embedded />}

      {editing && tech && (
        <ManageTechnicianDialog
          technician={tech}
          tags={tags}
          leaveTypes={leaveTypes.map((t) => t.name)}
          roleOptions={roleOptions}
          serviceOptions={serviceOptions}
          supervisorOptions={supervisorOptions}
          assignedTags={assigned}
          leaveRecords={activeLeave}
          onApplyAttributes={(attrs) => void applyAttributes(attrs)}
          onOpenChange={(open) => !open && setEditing(false)}
          onChanged={loadScheduling}
        />
      )}
    </div>
  );
}
