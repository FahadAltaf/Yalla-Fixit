"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeading, PillTabs, SectionCard } from "@/components/dashboard/shared/kaizen";
import { usePathname, useSearchParams } from "next/navigation";
import { SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { complianceService, type CertificateType, type ComplianceListKey, type LookupOption, type PortalUserOption, type SettingsResponse } from "@/modules/compliance";
import { useComplianceRights } from "./use-rights";
import { FsmLinksCard } from "./fsm-links-card";

/**
 * Compliance settings (FRD D5, D6, D11, section 6): certificate types with
 * their "expires" flag, the designation and nationality lists, and who
 * receives deactivation requests. Reminder recipients and the role
 * requirements list arrive with phases 4 and 5.
 */
export default function SettingsAdmin() {
  const { rights } = useComplianceRights();
  /* Create adds values; Edit renames, retires, deletes and sets recipients, as the routes require. */
  const canAdd = rights.settings_create;
  const canEdit = rights.settings_edit;

  /*
    One section at a time behind pill tabs, as AMC settings do (Sharon, C9).
    The open tab is kept in the address (?view=designations) so a reload
    stays on it, written with history.replaceState so Next does not remount
    the page.
  */
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setViewState] = useState<SettingsView>(() => {
    const v = searchParams.get("view");
    return (SETTINGS_VIEWS as readonly string[]).includes(v ?? "") ? (v as SettingsView) : "certificates";
  });
  const setView = (next: SettingsView) => {
    setViewState(next);
    const params = new URLSearchParams(window.location.search);
    params.set("view", next);
    window.history.replaceState(window.history.state, "", `${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeading eyebrow="Settings" title="Compliance" description="Certificate types, deactivation recipients and FSM links. Designations and nationalities are under Settings → Workforce." />
      <PillTabs<SettingsView>
        value={view}
        onChange={setView}
        tabs={[
          { value: "certificates", label: "Certificate types" },
          { value: "deactivation", label: "Deactivation requests" },
          { value: "fsm-links", label: "FSM links" },
        ]}
      />
      <div className={view === "fsm-links" ? "max-w-5xl" : "max-w-3xl"}>
        {view === "certificates" ? <CertificateTypesCard canAdd={canAdd} canEdit={canEdit} /> : null}
        {view === "deactivation" ? <DeactivationRecipientsCard canEdit={canEdit} /> : null}
        {view === "fsm-links" ? <FsmLinksCard canEdit={rights.edit} /> : null}
      </div>
    </div>
  );
}

// Designations and nationalities moved to Settings → Workforce (31 Oct 2026).
const SETTINGS_VIEWS = ["certificates", "deactivation", "fsm-links"] as const;
type SettingsView = (typeof SETTINGS_VIEWS)[number];

/** A name with a pencil: click to rename in place, Enter saves, Escape cancels. */
function InlineName({ name, muted, canEdit, onRename }: { name: string; muted?: boolean; canEdit: boolean; onRename: (next: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const next = draft.trim();
    if (!next || next === name) {
      setEditing(false);
      setDraft(name);
      return;
    }
    setBusy(true);
    try {
      await onRename(next);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  if (!editing) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className={muted ? "text-muted-foreground line-through" : ""}>{name}</span>
        {canEdit ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Rename ${name}`} onClick={() => { setDraft(name); setEditing(true); }}>
            <Pencil className="size-3.5" />
          </Button>
        ) : null}
      </span>
    );
  }
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        className="h-8 max-w-xs"
        aria-label="New name"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setEditing(false);
            setDraft(name);
          }
        }}
      />
      <SubmitButton type="submit" size="sm" pending={busy}>
        Save
      </SubmitButton>
      <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(name); }} disabled={busy}>
        Cancel
      </Button>
    </form>
  );
}

function CertificateTypesCard({ canAdd, canEdit }: { canAdd: boolean; canEdit: boolean }) {
  const [types, setTypes] = useState<CertificateType[]>([]);
  const [name, setName] = useState("");
  const [expires, setExpires] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => complianceService.certificateTypes(true).then(setTypes).catch((e) => toast.error(e instanceof Error ? e.message : "Could not load certificate types")), []);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await complianceService.createCertificateType({ name: name.trim(), expires, sort_order: (types.length + 1) * 10 });
      setName("");
      setExpires(true);
      await load();
      toast.success("Certificate type added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, body: { name?: string; expires?: boolean; is_active?: boolean }) => {
    try {
      await complianceService.updateCertificateType({ id, ...body });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
      throw e;
    }
  };

  return (
    <SectionCard title="Certificate types" description="Seven at go-live: Confined Space, Scissor Lift, Health & Safety, First Aid, Working at Height, Scaffolding, DCCS." bodyClassName="px-5 pb-5">
      <ul className="divide-y rounded-md border">
        {types.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <InlineName name={t.name} muted={!t.is_active} canEdit={canEdit} onRename={(name) => patch(t.id, { name })} />
            <span className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs" htmlFor={`ct-expires-${t.id}`}>
                <Switch id={`ct-expires-${t.id}`} checked={t.expires} onCheckedChange={(v) => void patch(t.id, { expires: v })} disabled={!canEdit} /> Expires
              </label>
              {canEdit ? (
                <Button variant="ghost" size="sm" onClick={() => void patch(t.id, { is_active: !t.is_active })}>
                  {t.is_active ? "Retire" : "Reinstate"}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
        {!types.length ? <li className="text-muted-foreground px-3 py-2 text-sm">None yet.</li> : null}
      </ul>
      {canAdd ? (
        <form
          className="mt-4 flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input id="ct-new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New certificate type" className="min-w-48 flex-1" />
          <label className="flex items-center gap-2 text-xs" htmlFor="ct-new-expires">
            <Switch id="ct-new-expires" checked={expires} onCheckedChange={setExpires} /> Expires
          </label>
          <SubmitButton type="submit" size="sm" pending={busy} icon={<Plus className="size-4" />} disabled={!name.trim()}>
            Add
          </SubmitButton>
        </form>
      ) : null}
    </SectionCard>
  );
}

export function ListCard({ listKey, title, canAdd, canEdit }: { listKey: ComplianceListKey; title: string; canAdd: boolean; canEdit: boolean }) {
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => complianceService.listOptions(listKey).then(setOptions).catch((e) => toast.error(e instanceof Error ? e.message : `Could not load ${title}`)), [listKey, title]);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await complianceService.createOption(listKey, name.trim());
      setName("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await complianceService.deleteOption(listKey, id);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  };

  const rename = async (id: string, name: string) => {
    try {
      await complianceService.renameOption(listKey, id, name);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rename");
      throw e;
    }
  };

  return (
    <SectionCard title={title} description="Used on the employee form. A value in use cannot be deleted." bodyClassName="px-5 pb-5">
      <ul className="divide-y rounded-md border">
        {options.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <InlineName name={o.name} canEdit={canEdit} onRename={(name) => rename(o.id, name)} />
            {canEdit ? (
              <Button variant="ghost" size="sm" onClick={() => void remove(o.id)} aria-label={`Delete ${o.name}`}>
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </li>
        ))}
        {!options.length ? <li className="text-muted-foreground px-3 py-2 text-sm">None yet.</li> : null}
      </ul>
      {canAdd ? (
        <form
          className="mt-4 flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input id={`list-new-${listKey}`} value={name} onChange={(e) => setName(e.target.value)} placeholder={listKey === "designation" ? "New designation" : "New nationality"} className="min-w-48 flex-1" />
          <SubmitButton type="submit" size="sm" pending={busy} icon={<Plus className="size-4" />} disabled={!name.trim()}>
            Add
          </SubmitButton>
        </form>
      ) : null}
    </SectionCard>
  );
}

function DeactivationRecipientsCard({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [users, setUsers] = useState<PortalUserOption[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => complianceService.settings().then(setSettings).catch((e) => toast.error(e instanceof Error ? e.message : "Could not load settings")), []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!canEdit) return;
    const handle = setTimeout(() => {
      complianceService.portalUsers(search).then(setUsers).catch(() => setUsers([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [search, canEdit]);

  const save = async (ids: string[]) => {
    setBusy(true);
    try {
      setSettings(await complianceService.updateSettings({ deactivation_request_user_ids: ids }));
      toast.success("Recipients updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const current = settings?.deactivation_request_user_ids ?? [];
  return (
    <SectionCard title="Deactivation requests" description="Technicians are deactivated in FSM. The Deactivate button on a linked employee emails these people." bodyClassName="px-5 pb-5">
      <ul className="divide-y rounded-md border">
        {(settings?.deactivation_request_recipients ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>
              {r.name} <span className="text-muted-foreground text-xs">{r.email}</span>
            </span>
            {canEdit ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save(current.filter((id) => id !== r.id))} aria-label={`Remove ${r.name}`}>
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </li>
        ))}
        {!settings?.deactivation_request_recipients?.length ? <li className="text-muted-foreground px-3 py-2 text-sm">Nobody yet. Requests cannot be sent until someone is added.</li> : null}
      </ul>
      {canEdit ? (
        <div className="mt-4 flex flex-col gap-2">
          <Input id="deactivation-user-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search portal users to add" />
          {search ? (
            <ul className="max-h-40 divide-y overflow-auto rounded-md border text-sm">
              {users
                .filter((u) => !current.includes(u.id))
                .map((u) => (
                  <li key={u.id}>
                    <button type="button" className="hover:bg-muted flex w-full justify-between px-3 py-2 text-left" disabled={busy} onClick={() => void save([...current, u.id])}>
                      <span>{u.name}</span>
                      <span className="text-muted-foreground text-xs">{u.email}</span>
                    </button>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}
