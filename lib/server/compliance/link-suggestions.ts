// Linking compliance employees to FSM technicians by name (Sami, 30 Oct 2026,
// decision Q3). Nothing is linked automatically: the portal proposes matches,
// a person approves them, and each approved pair goes through the normal
// employee update (D11 status rule and the audit log both apply).
//
// Names are compared as sets of words, ignoring case, punctuation, anything
// in brackets and an email suffix the roster adds when two technicians share
// a name. Score = shared words / words in the longer name.
//   exact  = same words (score 1)
//   likely = score >= 0.5 and the best candidate by a clear margin
// Each technician is proposed for at most one employee.

import type { SupabaseClient } from "@supabase/supabase-js";

export type LinkSuggestion = {
  employee_id: string;
  maher_id: string;
  employee_name: string;
  employment_status: string;
  fsm_resource_id: string;
  technician_name: string;
  technician_active: boolean;
  score: number;
  kind: "exact" | "likely";
};

export type LinkSuggestions = {
  suggestions: LinkSuggestion[];
  unmatched_employees: { employee_id: string; maher_id: string; employee_name: string }[];
  unmatched_technicians: { fsm_resource_id: string; technician_name: string; technician_active: boolean }[];
  already_linked: number;
};

export function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .replace(/\(.*?\)|<.*?>|\S+@\S+/g, " ")
      .toUpperCase()
      .replace(/[^A-Z ]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

export function nameScore(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / Math.max(a.size, b.size);
}

export async function buildLinkSuggestions(admin: SupabaseClient): Promise<LinkSuggestions> {
  const { data: emps, error: e1 } = await admin
    .from("compliance_employees")
    .select("id, maher_id, full_name, employment_status, fsm_resource_id")
    .is("archived_at", null);
  if (e1) throw new Error(e1.message);
  const { data: techs, error: e2 } = await admin.from("technician_reference").select("fsm_resource_id, display_name, is_active");
  if (e2) throw new Error(e2.message);

  type Emp = { id: string; maher_id: string; full_name: string; employment_status: string; fsm_resource_id: string | null };
  type Tech = { fsm_resource_id: string; display_name: string; is_active: boolean };
  const employees = (emps ?? []) as Emp[];
  const linkedTech = new Set(employees.map((e) => e.fsm_resource_id).filter((v): v is string => Boolean(v)));
  const freeTechs = ((techs ?? []) as Tech[]).filter((t) => !linkedTech.has(t.fsm_resource_id)).map((t) => ({ ...t, tokens: nameTokens(t.display_name) }));
  const unlinked = employees.filter((e) => !e.fsm_resource_id);

  // Every candidate pair worth considering, best first, then greedy one-to-one.
  const pairs: { e: Emp; t: (typeof freeTechs)[number]; score: number; margin: number }[] = [];
  for (const e of unlinked) {
    const et = nameTokens(e.full_name);
    const scored = freeTechs.map((t) => ({ t, score: nameScore(et, t.tokens) })).filter((x) => x.score >= 0.5).sort((a, b) => b.score - a.score);
    if (!scored.length) continue;
    const margin = scored[0].score - (scored[1]?.score ?? 0);
    for (const s of scored) pairs.push({ e, t: s.t, score: s.score, margin: s === scored[0] ? margin : 0 });
  }
  pairs.sort((a, b) => b.score - a.score || b.margin - a.margin);

  const usedEmp = new Set<string>();
  const usedTech = new Set<string>();
  const suggestions: LinkSuggestion[] = [];
  for (const p of pairs) {
    if (usedEmp.has(p.e.id) || usedTech.has(p.t.fsm_resource_id)) continue;
    const kind = p.score === 1 ? "exact" : "likely";
    // A "likely" match needs a clear lead over the employee's next candidate.
    if (kind === "likely" && p.margin < 0.15) continue;
    usedEmp.add(p.e.id);
    usedTech.add(p.t.fsm_resource_id);
    suggestions.push({
      employee_id: p.e.id,
      maher_id: p.e.maher_id,
      employee_name: p.e.full_name,
      employment_status: p.e.employment_status,
      fsm_resource_id: p.t.fsm_resource_id,
      technician_name: p.t.display_name,
      technician_active: p.t.is_active,
      score: Math.round(p.score * 100) / 100,
      kind,
    });
  }
  suggestions.sort((a, b) => (a.kind === b.kind ? a.employee_name.localeCompare(b.employee_name) : a.kind === "exact" ? -1 : 1));

  return {
    suggestions,
    unmatched_employees: unlinked.filter((e) => !usedEmp.has(e.id)).map((e) => ({ employee_id: e.id, maher_id: e.maher_id, employee_name: e.full_name })),
    unmatched_technicians: freeTechs.filter((t) => !usedTech.has(t.fsm_resource_id)).map((t) => ({ fsm_resource_id: t.fsm_resource_id, technician_name: t.display_name, technician_active: t.is_active })),
    already_linked: employees.length - unlinked.length,
  };
}
