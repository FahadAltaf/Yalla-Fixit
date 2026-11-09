"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { executeRESTBackend } from "@/lib/rest-server";
import { complianceService } from "@/modules/compliance";
import { formatZonedDateTime } from "@/lib/scheduling/org-time";
import { EMPLOYMENT_STATUS_LABEL, type ComplianceEmploymentStatus } from "@/lib/compliance/statuses";
import { TechnicianLinkPicker } from "./technician-link-picker";
import type { EmployeeLinkRow, LinkSuggestions } from "@/lib/server/compliance/link-suggestions";

/**
 * Link employees to their FSM technicians (decision Q3): the portal proposes
 * name matches; you tick the ones that are right and apply them. Exact
 * matches start ticked, likely ones do not. Nothing is linked without Apply.
 */
export function FsmLinksCard({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<LinkSuggestions | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await executeRESTBackend<LinkSuggestions>("/api/compliance/link-suggestions");
      setData(d);
      setPicked(new Set(d.suggestions.filter((s) => s.kind === "exact").map((s) => s.employee_id)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the matches");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!canEdit) {
      setLoading(false);
      return;
    }
    void load();
    void complianceService
      .rosterSyncedAt()
      .then((r) => setSyncedAt(r.synced_at ?? null))
      .catch(() => {});
  }, [load, canEdit]);

  // Pull the technician roster from FSM now, then re-read the matches so any
  // newly added or deactivated technicians show up without leaving the page.
  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await complianceService.refreshRoster();
      setSyncedAt(r.synced_at ?? null);
      await load();
      toast.success("Roster refreshed from FSM");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refresh from FSM");
    } finally {
      setRefreshing(false);
    }
  };

  const counts = useMemo(() => {
    const s = data?.suggestions ?? [];
    return { exact: s.filter((x) => x.kind === "exact").length, likely: s.filter((x) => x.kind === "likely").length };
  }, [data]);

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    if (!data) return;
    const pairs = data.suggestions.filter((s) => picked.has(s.employee_id)).map((s) => ({ employee_id: s.employee_id, fsm_resource_id: s.fsm_resource_id }));
    if (!pairs.length) return;
    setBusy(true);
    try {
      const r = await executeRESTBackend<{ linked: number; failed: number; results: { employee_id: string; ok: boolean; error?: string }[] }>("/api/compliance/link-suggestions", { method: "POST", body: { pairs } });
      toast.success(`Linked ${r.linked}${r.failed ? `; ${r.failed} refused (see the list)` : ""}`);
      if (r.failed) {
        const names = new Map(data.suggestions.map((s) => [s.employee_id, s.employee_name]));
        r.results.filter((x) => !x.ok).slice(0, 5).forEach((x) => toast.error(`${names.get(x.employee_id)}: ${x.error}`));
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply the links");
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) {
    return (
      <SectionCard title="FSM links" bodyClassName="px-5 pb-5">
        <p className="text-muted-foreground text-sm">Linking needs the Compliance Edit right.</p>
      </SectionCard>
    );
  }

  return (
    <div className="flex flex-col gap-6">
    <SectionCard
      title="FSM links"
      description="Each employee linked to their FSM technician gets the current site and the FSM deactivation rule. Exact name matches start ticked; check the likely ones before ticking them."
      icon={<Link2 className="size-4" />}
      bodyClassName="px-5 pb-5"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">{syncedAt ? `Roster as of ${formatZonedDateTime(syncedAt)}` : "Roster not yet synced"}</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing || loading} title="Pull the technician roster from Zoho FSM now">
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /> Refresh from FSM
          </Button>
        </div>
        {loading || !data ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              {data.already_linked} already linked · {counts.exact} exact · {counts.likely} likely · {data.unmatched_employees.length} employees with no match · {data.unmatched_technicians.length} technicians with no employee
            </p>
            {data.suggestions.length ? (
              <div className="max-h-[28rem] overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0 z-10 shadow-[0_1px_0_var(--border)]">
                    <tr className="text-left">
                      <th className="w-10 px-3 py-2" />
                      <th className="px-3 py-2">Employee</th>
                      <th className="px-3 py-2">FSM technician</th>
                      <th className="px-3 py-2">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.suggestions.map((s) => (
                      <tr key={s.employee_id} className="border-t">
                        <td className="px-3 py-2">
                          <input type="checkbox" id={`link-${s.employee_id}`} checked={picked.has(s.employee_id)} onChange={() => toggle(s.employee_id)} aria-label={`Link ${s.employee_name}`} />
                        </td>
                        <td className="px-3 py-2">
                          <label htmlFor={`link-${s.employee_id}`}>{s.employee_name}</label>
                          <div className="text-muted-foreground text-xs">{s.maher_id}</div>
                        </td>
                        <td className="px-3 py-2">
                          {s.technician_name}
                          {!s.technician_active ? <span className="text-muted-foreground text-xs"> · inactive in FSM</span> : null}
                        </td>
                        <td className="px-3 py-2">{s.kind === "exact" ? <span className="text-success">Exact</span> : <span className="text-warning">Likely ({Math.round(s.score * 100)}%)</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No more matches to review.</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton pending={busy} pendingLabel="Linking…" disabled={!picked.size} onClick={() => void apply()}>
                Link {picked.size} selected
              </SubmitButton>
              <span className="text-muted-foreground text-xs">Employees left unmatched (helpers, drivers, office staff with no FSM user) keep a blank site. Link anyone else — including name typos or dropped suffixes — in Linked employees below.</span>
            </div>
            {data.unmatched_employees.length ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">{data.unmatched_employees.length} employees with no match</summary>
                <ul className="text-muted-foreground mt-2 columns-2 text-xs">
                  {data.unmatched_employees.map((e) => (
                    <li key={e.employee_id}>
                      {e.employee_name} · {e.maher_id}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        )}
      </div>
    </SectionCard>
    <SectionCard
      title="Linked employees"
      description="Who is linked to which FSM technician. Search to find anyone, then link, change or unlink. Linking an employee the sheet marked inactive to an active FSM technician sets them active (FSM is the source of truth)."
      icon={<Link2 className="size-4" />}
      bodyClassName="px-5 pb-5"
    >
      {loading || !data ? <p className="text-muted-foreground text-sm">Loading…</p> : <ManageLinks people={data.people} onChanged={load} />}
    </SectionCard>
    </div>
  );
}

/**
 * The manage-links table: every employee and the FSM technician they are linked
 * to, with an inline picker to link, change or unlink. This is the only place a
 * technician that did not auto-match (a name typo, a dropped suffix) can be
 * linked without opening the employee's record. One write per save, through the
 * normal employee update, so the D11 status rule and the audit log both apply.
 */
function ManageLinks({ people, onChanged }: { people: EmployeeLinkRow[]; onChanged: () => Promise<void> | void }) {
  const [q, setQ] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string | null>(null);
  const [editName, setEditName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const linkedCount = useMemo(() => people.filter((p) => p.fsm_resource_id).length, [people]);
  const term = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const base = term
      ? people.filter((p) => p.employee_name.toLowerCase().includes(term) || p.maher_id.includes(term) || (p.technician_name ?? "").toLowerCase().includes(term))
      : people.filter((p) => p.fsm_resource_id);
    return base.slice().sort((a, b) => a.employee_name.localeCompare(b.employee_name)).slice(0, 200);
  }, [people, term]);

  const startEdit = (p: EmployeeLinkRow) => {
    setEditingId(p.employee_id);
    setEditValue(p.fsm_resource_id);
    setEditName(p.technician_name);
  };
  const cancel = () => {
    setEditingId(null);
    setEditValue(null);
    setEditName(null);
  };
  const save = async (employeeId: string) => {
    setSaving(true);
    try {
      await complianceService.updateEmployee(employeeId, { fsm_resource_id: editValue });
      toast.success(editValue ? "Link updated" : "Unlinked");
      cancel();
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the link");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employees or technicians" aria-label="Search links" />
      <p className="text-muted-foreground text-xs">{term ? `${rows.length} shown · ${linkedCount} linked in total` : `${linkedCount} linked · search to find anyone, linked or not`}</p>
      <div className="max-h-[32rem] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted sticky top-0 z-10 shadow-[0_1px_0_var(--border)]">
            <tr className="text-left">
              <th className="px-3 py-2">Employee</th>
              <th className="px-3 py-2">FSM technician</th>
              <th className="w-40 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.employee_id} className="border-t align-top">
                <td className="px-3 py-2">
                  <div>{p.employee_name}</div>
                  <div className="text-muted-foreground text-xs">
                    {p.maher_id} · {EMPLOYMENT_STATUS_LABEL[p.employment_status as ComplianceEmploymentStatus] ?? p.employment_status}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {editingId === p.employee_id ? (
                    <TechnicianLinkPicker
                      value={editValue}
                      displayName={editName}
                      onChange={(id, name) => {
                        setEditValue(id);
                        setEditName(name);
                      }}
                    />
                  ) : p.fsm_resource_id ? (
                    <span>
                      {p.technician_name ?? p.fsm_resource_id}
                      {p.technician_active === false ? <span className="text-muted-foreground text-xs"> · inactive in FSM</span> : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not linked</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editingId === p.employee_id ? (
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton pending={saving} pendingLabel="Saving…" onClick={() => void save(p.employee_id)}>
                        Save
                      </SubmitButton>
                      <Button variant="ghost" size="sm" onClick={cancel} disabled={saving}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => startEdit(p)}>
                      {p.fsm_resource_id ? "Change" : "Link"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={3} className="text-muted-foreground px-3 py-4 text-sm">
                  {term ? "No employees match." : "No linked employees yet — search to find someone to link."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
