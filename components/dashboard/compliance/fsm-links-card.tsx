"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { executeRESTBackend } from "@/lib/rest-server";
import type { LinkSuggestions } from "@/lib/server/compliance/link-suggestions";

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
    if (canEdit) void load();
    else setLoading(false);
  }, [load, canEdit]);

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
    <SectionCard
      title="FSM links"
      description="Each employee linked to their FSM technician gets the current site and the FSM deactivation rule. Exact name matches start ticked; check the likely ones before ticking them."
      icon={<Link2 className="size-4" />}
      bodyClassName="px-5 pb-5"
    >
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
            <span className="text-muted-foreground text-xs">Employees left unmatched (helpers, drivers, office staff with no FSM user) keep a blank site. Link anyone else by hand on their record.</span>
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
    </SectionCard>
  );
}
