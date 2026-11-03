import { AMC_BROCHURE_FIELDS } from "./amc-brochure-copy";
import type { AmcSettings } from "./amc-settings";

/**
 * What a save of AMC Settings changed, in words an admin reads (UAT
 * AMC-097, FR6.5).
 *
 * The history used to record key paths -- "clauseList", "accountManagers"
 * -- which say which part of the document moved and nothing a person can
 * use. This compares the settings before and after a save and names what
 * changed: which clause was edited, added, removed or moved, which service,
 * which scope of work, which account manager or approver. The text itself
 * is not copied into the history; the names are enough to find it.
 */

const PROVIDER_LABELS: Record<keyof AmcSettings["provider"], string> = {
  contactNo: "Contact numbers",
  coordinationEmails: "Coordination emails",
  poBox: "P.O. Box",
  email: "Company email",
  address: "Company address",
  contractType: "Contract type",
  standardResponseTime: "Standard response time",
  emergencyResponseTime: "Emergency response time",
  proposalValidity: "Proposal validity",
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const quoted = (value: string) => `"${value.trim() || "Untitled"}"`;

export function describeSettingsChanges(before: AmcSettings, after: AmcSettings): string[] {
  const out: string[] = [];

  // Standard values
  for (const key of Object.keys(PROVIDER_LABELS) as (keyof AmcSettings["provider"])[]) {
    if (!same(before.provider?.[key], after.provider?.[key])) out.push(`${PROVIDER_LABELS[key]} changed`);
  }

  // Contract clauses: by their stable id, so a moved clause is not read as a new one
  const beforeClauses = new Map((before.clauseList ?? []).map((clause) => [clause.id, clause]));
  const afterClauses = new Map((after.clauseList ?? []).map((clause) => [clause.id, clause]));
  for (const [id, clause] of afterClauses) {
    const old = beforeClauses.get(id);
    if (!old) {
      out.push(`Clause added: ${quoted(clause.title)}`);
      continue;
    }
    if (old.title !== clause.title) out.push(`Clause renamed: ${quoted(old.title)} to ${quoted(clause.title)}`);
    if ((old.body ?? "") !== (clause.body ?? "")) out.push(`Clause wording edited: ${quoted(clause.title)}`);
    if ((old.enabled !== false) !== (clause.enabled !== false)) {
      out.push(`${clause.enabled === false ? "Clause taken out" : "Clause put back"}: ${quoted(clause.title)}`);
    }
    if ((old.level ?? 1) !== (clause.level ?? 1)) {
      out.push(`Clause ${clause.level === 2 ? "made a sub-clause" : "made a main clause"}: ${quoted(clause.title)}`);
    }
  }
  for (const [id, clause] of beforeClauses) {
    if (!afterClauses.has(id)) out.push(`Clause removed: ${quoted(clause.title)}`);
  }
  const kept = (list: AmcSettings["clauseList"], other: Map<string, unknown>) =>
    (list ?? []).filter((clause) => other.has(clause.id)).map((clause) => clause.id);
  if (!same(kept(before.clauseList, afterClauses), kept(after.clauseList, beforeClauses))) {
    out.push("Clauses reordered");
  }

  // Services offered on proposals
  const beforeServices = new Map((before.services ?? []).map((service) => [service.id, service]));
  const afterServices = new Map((after.services ?? []).map((service) => [service.id, service]));
  for (const [id, service] of afterServices) {
    const old = beforeServices.get(id);
    if (!old) out.push(`Service added: ${quoted(service.label)}`);
    else if (!same(old, service)) out.push(`Service edited: ${quoted(service.label)}`);
  }
  for (const [id, service] of beforeServices) {
    if (!afterServices.has(id)) out.push(`Service removed: ${quoted(service.label)}`);
  }

  // Scope of work, per service
  const label = (id: string) =>
    afterServices.get(id)?.label ?? beforeServices.get(id)?.label ?? id;
  const scopeIds = new Set([
    ...Object.keys(before.serviceScopes ?? {}),
    ...Object.keys(after.serviceScopes ?? {}),
  ]);
  for (const id of scopeIds) {
    if (!same(before.serviceScopes?.[id], after.serviceScopes?.[id])) {
      out.push(`Scope of work edited: ${quoted(label(id))}`);
    }
  }

  // The proposal's brochure wording
  for (const field of AMC_BROCHURE_FIELDS) {
    const key = field.key as keyof AmcSettings["brochure"];
    if (!same(before.brochure?.[key], after.brochure?.[key])) out.push(`Proposal wording edited: ${field.label}`);
  }

  // Approvers, by email
  const beforeApprovers = new Set(before.approval?.approvers ?? []);
  const afterApprovers = new Set(after.approval?.approvers ?? []);
  for (const email of afterApprovers) if (!beforeApprovers.has(email)) out.push(`Approver added: ${email}`);
  for (const email of beforeApprovers) if (!afterApprovers.has(email)) out.push(`Approver removed: ${email}`);

  // Account managers, by name
  const key = (name: string) => name.trim().toLowerCase();
  const beforeManagers = new Map((before.accountManagers ?? []).map((manager) => [key(manager.name), manager]));
  const afterManagers = new Map((after.accountManagers ?? []).map((manager) => [key(manager.name), manager]));
  for (const [name, manager] of afterManagers) {
    const old = beforeManagers.get(name);
    if (!old) out.push(`Account manager added: ${manager.name}`);
    else if (!same(old, manager)) out.push(`Account manager updated: ${manager.name}`);
  }
  for (const [name, manager] of beforeManagers) {
    if (!afterManagers.has(name)) out.push(`Account manager removed: ${manager.name}`);
  }

  return out;
}
