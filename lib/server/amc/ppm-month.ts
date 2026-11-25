import type { SupabaseClient } from "@supabase/supabase-js";

import { ppmContactState, type PpmContactState } from "@/lib/amc/visits";
import { isMissingTable } from "@/lib/server/amc/contracts";

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row) ?? null) : ((v as Row) ?? null));

export interface PpmMonthItem {
  visitId: string;
  contractId: string;
  contractNumber: string;
  visitNo: number;
  customerName: string;
  propertyLabel: string;
  services: string[];
  /** The tentative date, and the slot when one is placed. */
  targetDate: string;
  scheduledStart: string | null;
  status: string;
  clientConfirmation: string | null;
  state: PpmContactState;
  attempts: number;
  lastAttemptAt: string | null;
  coordinatorId: string | null;
  coordinatorName: string | null;
}

/** "2026-11" -> its first and last day; null when it is not a month. */
export function monthBounds(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * The coordinators' month of planned visits (DEV-492, BRD v0.4 5.11): every
 * PPM visit whose tentative date falls in the month, split into confirmed,
 * contacted (an attempt or request logged, not confirmed) and not yet
 * contacted, with the client, property, services and date. A coordinator is
 * the contract's owner; coordinatorId narrows the list to theirs.
 */
export async function ppmMonth(admin: Admin, month: string, coordinatorId: string | null = null): Promise<{ migrated: boolean; items: PpmMonthItem[] }> {
  const bounds = monthBounds(month);
  if (!bounds) return { migrated: true, items: [] };
  const { data, error } = await admin
    .from("amc_visits")
    .select(
      "id, contract_id, visit_no, status, target_date, scheduled_start, client_confirmation, " +
        "lines:amc_visit_lines!amc_visit_lines_visit_id_fkey(service_label, status), " +
        "contract:amc_contracts!amc_visits_contract_id_fkey(id, status, contract_number, proposal_number, customer_name, customer, property_label, submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id))",
    )
    .gte("target_date", bounds.from)
    .lte("target_date", bounds.to)
    .neq("status", "cancelled")
    .order("target_date")
    .limit(1000);
  if (error) {
    if (isMissingTable(error)) return { migrated: false, items: [] };
    throw new Error(error.message);
  }
  const rows = ((data ?? []) as unknown as Row[]).filter((v) => {
    const c = one(v.contract);
    if (!c || ["draft", "cancelled", "terminated"].includes(String(c.status))) return false;
    return !coordinatorId || str(one(c.submission)?.owner_id) === coordinatorId;
  });
  const ids = rows.map((v) => String(v.id));
  const owners = [...new Set(rows.map((v) => str(one(one(v.contract)?.submission)?.owner_id)).filter((v): v is string => Boolean(v)))];
  const [{ data: attempts }, { data: people }] = await Promise.all([
    ids.length ? admin.from("amc_visit_attempts").select("visit_id, attempted_at").in("visit_id", ids) : Promise.resolve({ data: [] as Row[] }),
    owners.length ? admin.from("user_profile").select("id, full_name, email").in("id", owners) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const tries = new Map<string, { count: number; last: string | null }>();
  for (const a of (attempts ?? []) as Row[]) {
    const t = tries.get(String(a.visit_id)) ?? { count: 0, last: null };
    t.count += 1;
    const at = str(a.attempted_at);
    if (at && (!t.last || at > t.last)) t.last = at;
    tries.set(String(a.visit_id), t);
  }
  const nameOf = new Map(((people ?? []) as Row[]).map((p) => [String(p.id), str(p.full_name) ?? str(p.email)]));
  return {
    migrated: true,
    items: rows.map((v) => {
      const c = one(v.contract) ?? {};
      const customer = (c.customer ?? {}) as Row;
      const t = tries.get(String(v.id)) ?? { count: 0, last: null };
      const owner = str(one(c.submission)?.owner_id);
      return {
        visitId: String(v.id),
        contractId: String(v.contract_id),
        contractNumber: String(c.contract_number ?? c.proposal_number ?? ""),
        visitNo: Number(v.visit_no ?? 0),
        customerName: str(customer.customerName) ?? String(c.customer_name ?? ""),
        propertyLabel: String(c.property_label ?? ""),
        services: ((v.lines ?? []) as Row[]).filter((l) => l.status !== "cancelled").map((l) => String(l.service_label ?? "")).filter(Boolean),
        targetDate: String(v.target_date),
        scheduledStart: str(v.scheduled_start),
        status: String(v.status),
        clientConfirmation: str(v.client_confirmation),
        state: ppmContactState(str(v.client_confirmation), t.count),
        attempts: t.count,
        lastAttemptAt: t.last,
        coordinatorId: owner,
        coordinatorName: owner ? (nameOf.get(owner) ?? null) : null,
      };
    }),
  };
}
