"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ListCard } from "@/components/dashboard/compliance/settings-admin";
import { PageHeading, PillTabs, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ManageListDialog } from "@/components/dashboard/workforce/people";
import { leaveTypesService, rolesService, serviceTypesService, tagsService } from "@/modules/scheduling";
import type { LeaveType, TechnicianRole, TechnicianServiceType, TechnicianTag } from "@/types/types";

/*
  Settings → Workforce (13-5, Sami 31 Oct 2026): the lists Scheduling and
  Compliance share, in one place for admins and managers. Each list is still
  stored and served by its own module; only the screen moved here from
  Scheduling's "Manage lists" menu and Compliance settings.
*/
const VIEWS = ["roles", "services", "tags", "leave-types", "designations", "nationalities"] as const;
type View = (typeof VIEWS)[number];

export type WorkforceSettingsRights = {
  scheduling: { view: boolean; add: boolean; edit: boolean; delete: boolean };
  compliance: { view: boolean; add: boolean; edit: boolean };
};

export default function WorkforceSettings({ rights }: { rights: WorkforceSettingsRights }) {
  // The open tab is kept in ?view= like Compliance settings, without a remount.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setViewState] = useState<View>(() => {
    const v = searchParams.get("view");
    if ((VIEWS as readonly string[]).includes(v ?? "")) return v as View;
    return rights.scheduling.view ? "roles" : "designations";
  });
  const setView = (next: View) => {
    setViewState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("view", next);
    window.history.replaceState(window.history.state, "", `${pathname}?${params.toString()}`);
  };

  const [roles, setRoles] = useState<TechnicianRole[]>([]);
  const [services, setServices] = useState<TechnicianServiceType[]>([]);
  const [tags, setTags] = useState<TechnicianTag[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);

  const load = useCallback(
    () =>
      !rights.scheduling.view
        ? Promise.resolve()
        : Promise.all([rolesService.list(), serviceTypesService.list(), tagsService.listTags(), leaveTypesService.list()])
        .then(([roleList, serviceList, tagList, leaveTypeList]) => {
          setRoles(roleList);
          setServices(serviceList);
          setTags(tagList);
          setLeaveTypes(leaveTypeList);
        })
        .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load the lists")),
    [rights.scheduling.view],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Settings"
        title="Workforce"
        description="The lists Scheduling and Compliance share. A change here shows in both modules."
      />
      <PillTabs<View>
        value={view}
        onChange={setView}
        tabs={[
          ...(rights.scheduling.view
            ? ([
                { value: "roles", label: "Roles", count: roles.length },
                { value: "services", label: "Service types", count: services.length },
                { value: "tags", label: "Tags", count: tags.length },
                { value: "leave-types", label: "Leave types", count: leaveTypes.length },
              ] as const)
            : []),
          ...(rights.compliance.view
            ? ([
                { value: "designations", label: "Designations" },
                { value: "nationalities", label: "Nationalities" },
              ] as const)
            : []),
        ]}
      />
      <div className="max-w-3xl">
        {rights.scheduling.view && view === "roles" ? (
          <SectionCard title="Roles" description="Used by Scheduling to group and highlight technicians." bodyClassName="px-5 pb-5">
            <ManageListDialog
              inline
              canAdd={rights.scheduling.add}
              canEdit={rights.scheduling.edit}
              canDelete={rights.scheduling.delete}
              title="Manage Roles"
              noun="role"
              items={roles}
              colorable
              onCreate={(n) => rolesService.create(n)}
              onRename={(id, n, c) => rolesService.update(id, n, c)}
              onDelete={(id) => rolesService.remove(id).then(() => undefined)}
              onChanged={load}
            />
          </SectionCard>
        ) : null}
        {rights.scheduling.view && view === "services" ? (
          <SectionCard title="Service types" description="The default board order follows this list." bodyClassName="px-5 pb-5">
            <ManageListDialog
              inline
              canAdd={rights.scheduling.add}
              canEdit={rights.scheduling.edit}
              canDelete={rights.scheduling.delete}
              title="Manage Service Types"
              noun="service type"
              items={services}
              onCreate={(n) => serviceTypesService.create(n)}
              onRename={(id, n) => serviceTypesService.update(id, n)}
              onDelete={(id) => serviceTypesService.remove(id).then(() => undefined)}
              onChanged={load}
            />
          </SectionCard>
        ) : null}
        {rights.scheduling.view && view === "tags" ? (
          <SectionCard title="Tags" description="Free labels on technicians, for filtering." bodyClassName="px-5 pb-5">
            <ManageListDialog
              inline
              canAdd={rights.scheduling.add}
              canEdit={rights.scheduling.edit}
              canDelete={rights.scheduling.delete}
              title="Manage Tags"
              noun="tag"
              items={tags}
              onCreate={(n) => tagsService.createTag(n)}
              onRename={(id, n) => tagsService.updateTag(id, n)}
              onDelete={(id) => tagsService.deleteTag(id).then(() => undefined)}
              onChanged={load}
            />
          </SectionCard>
        ) : null}
        {rights.scheduling.view && view === "leave-types" ? (
          <SectionCard title="Leave types" description="Offered when leave is added." bodyClassName="px-5 pb-5">
            <ManageListDialog
              inline
              canAdd={rights.scheduling.add}
              canEdit={rights.scheduling.edit}
              canDelete={rights.scheduling.delete}
              title="Manage Leave Types"
              noun="leave type"
              countNoun="leave records"
              description="These types are offered when leave is added. Renaming one renames the leave records that carry it. Deleting one retires it: it leaves the dropdown, and past leave records keep their type."
              deleteDescription={(item) =>
                `"${item.name}" will no longer be offered when leave is added. ${item.technician_count ?? 0} leave record(s) keep the name.`
              }
              items={leaveTypes.map((t) => ({ id: t.id, name: t.name, technician_count: t.record_count }))}
              onCreate={(n) => leaveTypesService.create(n)}
              onRename={(id, n) => leaveTypesService.update(id, n)}
              onDelete={(id) => leaveTypesService.remove(id).then(() => undefined)}
              onChanged={load}
            />
          </SectionCard>
        ) : null}
        {rights.compliance.view && view === "designations" ? (
          <ListCard listKey="designation" title="Designations" canAdd={rights.compliance.add} canEdit={rights.compliance.edit} />
        ) : null}
        {rights.compliance.view && view === "nationalities" ? (
          <ListCard listKey="nationality" title="Nationalities" canAdd={rights.compliance.add} canEdit={rights.compliance.edit} />
        ) : null}
      </div>
    </div>
  );
}
