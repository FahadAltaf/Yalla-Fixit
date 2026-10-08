import type { SupabaseClient } from "@supabase/supabase-js";

import type { AmcConfig } from "@/lib/amc/config";
import { todayInDubai } from "@/lib/amc/contracts";
import {
  PLANNABLE_STATUSES,
  addDays,
  buildPpmSchedule,
  classifyMove,
  clubbedWindow,
  clubbingGroups,
  ppmProgress,
  windowAfterMove,
  type PpmAction,
  type PpmProgress,
  type ServiceLineInput,
  type VisitStatus,
  type WorkingCalendar,
} from "@/lib/amc/ppm";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { notifyUsers } from "@/lib/server/amc/notifications";

/**
 * The PPM schedule on the server (Phase 8: DEV-354, 388, 389, 390). Rules
 * are in lib/amc/ppm.ts; routes check the caller before calling these.
 *
 * The tentative schedule is made once the contract is active (after the
 * initial payment gate), one visit per service line occurrence. The team
 * adjusts, adds, removes, clubs and separates, then confirms it as the plan
 * of record. Every change is kept in amc_visit_changes.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

const NOT_MIGRATED = "The PPM schedule is not set up on this database yet (migration 20261008110000).";
const notMigrated = (error: { code?: string } | null | undefined) =>
  isMissingTable(error) || error?.code === "42703" || error?.code === "PGRST204";
function fail(error: { code?: string; message: string }): ContractError {
  if (notMigrated(error)) return new ContractError(NOT_MIGRATED, 503);
  return new ContractError(error.message, error.code === "23514" || error.code === "23505" ? 409 : 400);
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row | undefined) ?? null) : ((v as Row | null) ?? null));

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export interface VisitLineRecord {
  id: string;
  entitlementId: string;
  serviceId: string;
  serviceLabel: string;
  occurrence: number;
  status: string;
  homeWindowStart: string;
  homeWindowEnd: string;
  homeTargetDate: string;
}

export interface VisitRecord {
  id: string;
  visitNo: number;
  status: VisitStatus;
  cycleStart: string;
  cycleEnd: string;
  windowStart: string;
  windowEnd: string;
  targetDate: string;
  originalTargetDate: string | null;
  rescheduleCount: number;
  source: string;
  statusReason: string | null;
  lines: VisitLineRecord[];
  /** The window has passed and the visit is not done. */
  overdue: boolean;
}

export interface VisitChangeRecord {
  id: string;
  visitId: string | null;
  changeType: string;
  fromDate: string | null;
  toDate: string | null;
  reason: string | null;
  detail: Row;
  actorLabel: string | null;
  createdAt: string;
}

export interface ScheduleRules {
  windowDays: number;
  attemptCount: number;
  attemptIntervalDays: number;
  attemptChannels: string[];
  escalationUserId: string | null;
  /** Which of the above are the contract's own (the rest come from AMC configuration). */
  own: { windowDays: boolean; attempts: boolean };
}

export interface SchedulableLine {
  entitlementId: string;
  serviceId: string;
  label: string;
  frequencyPerYear: number;
  planned: number;
  preferredMonths: number[];
  preferredDays: number[];
}

export interface ContractPpm {
  migrated: boolean;
  /** The contract is active (or on hold): the schedule can be made and changed. */
  open: boolean;
  confirmed: { at: string; by: string | null } | null;
  rules: ScheduleRules;
  lines: SchedulableLine[];
  visits: VisitRecord[];
  changes: VisitChangeRecord[];
  progress: PpmProgress;
}

const VISIT_COLUMNS =
  "id, contract_id, visit_no, status, cycle_start, cycle_end, window_start, window_end, target_date, original_target_date, reschedule_count, source, status_reason, overdue_notified_at, " +
  "lines:amc_visit_lines!amc_visit_lines_visit_id_fkey(id, entitlement_id, service_id, service_label, occurrence, status, home_window_start, home_window_end, home_target_date)";

function mapVisit(r: Row, today: string): VisitRecord {
  const status = r.status as VisitStatus;
  const windowEnd = String(r.window_end);
  const lines = ((r.lines ?? []) as Row[])
    .map((l) => ({
      id: String(l.id),
      entitlementId: String(l.entitlement_id),
      serviceId: String(l.service_id),
      serviceLabel: String(l.service_label),
      occurrence: Number(l.occurrence),
      status: String(l.status),
      homeWindowStart: String(l.home_window_start),
      homeWindowEnd: String(l.home_window_end),
      homeTargetDate: String(l.home_target_date),
    }))
    .sort((a, b) => a.serviceLabel.localeCompare(b.serviceLabel));
  return {
    id: String(r.id),
    visitNo: Number(r.visit_no),
    status,
    cycleStart: String(r.cycle_start),
    cycleEnd: String(r.cycle_end),
    windowStart: String(r.window_start),
    windowEnd,
    targetDate: String(r.target_date),
    originalTargetDate: str(r.original_target_date),
    rescheduleCount: Number(r.reschedule_count ?? 0),
    source: String(r.source),
    statusReason: str(r.status_reason),
    lines,
    overdue: PLANNABLE_STATUSES.includes(status) && windowEnd < today,
  };
}

/* ------------------------------------------------------------------ */
/* The contract, as the schedule needs it                              */
/* ------------------------------------------------------------------ */

const CONTRACT_COLUMNS =
  "id, status, contract_number, proposal_number, customer_name, property_id, start_date, end_date, term_months, ppm_confirmed_at, ppm_window_days, attempt_count, attempt_interval_days, attempt_channels, attempt_escalation_user_id, " +
  "confirmer:user_profile!amc_contracts_ppm_confirmed_by_fkey(full_name, email), " +
  "submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id)";

async function contractFacts(admin: Admin, contractId: string): Promise<Row> {
  const { data, error } = await admin.from("amc_contracts").select(CONTRACT_COLUMNS).eq("id", contractId).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Contract not found.", 404);
  return data;
}

const isOpen = (c: Row) => c.status === "active" || c.status === "on_hold";
const reference = (c: Row) => String(c.contract_number ?? c.proposal_number ?? "");

function rulesOf(c: Row, config: AmcConfig): ScheduleRules {
  const s = config.scheduling;
  return {
    windowDays: Number(c.ppm_window_days) || s.serviceWindowDays,
    attemptCount: Number(c.attempt_count) || s.attemptCount,
    attemptIntervalDays: c.attempt_interval_days === null || c.attempt_interval_days === undefined ? s.attemptIntervalDays : Number(c.attempt_interval_days),
    attemptChannels: Array.isArray(c.attempt_channels) && c.attempt_channels.length ? (c.attempt_channels as string[]) : [...s.attemptChannels],
    escalationUserId: str(c.attempt_escalation_user_id),
    own: { windowDays: Boolean(c.ppm_window_days), attempts: Boolean(c.attempt_count ?? c.attempt_channels ?? c.attempt_interval_days) },
  };
}

const calendarOf = (config: AmcConfig): WorkingCalendar => ({ weekendDays: config.calendar.weekendDays, holidays: config.calendar.holidays });

/**
 * The contract's PPM service lines: the visit entitlements a schedule is
 * made from (PPM and fixed services; an older contract's visit lines with
 * no type recorded count too), with the client's preferred months and days
 * from the property's scope.
 */
async function schedulableLines(admin: Admin, c: Row): Promise<SchedulableLine[]> {
  const { data, error } = await admin
    .from("amc_contract_entitlements")
    .select("id, service_id, service_label, frequency_type, entitlement_type, frequency, sort_order")
    .eq("contract_id", String(c.id))
    .order("sort_order");
  if (error) throw fail(error);
  const rows = ((data ?? []) as Row[]).filter(
    (e) => e.entitlement_type === "visits" && (e.frequency_type === "ppm" || e.frequency_type === "fixed" || !e.frequency_type),
  );
  const prefs = new Map<string, { months: number[]; days: number[] }>();
  if (c.property_id && rows.length) {
    const { data: scope } = await admin
      .from("amc_scope_items")
      .select("service_id, preferred_months, preferred_days")
      .eq("property_id", String(c.property_id))
      .eq("active", true);
    for (const s of (scope ?? []) as Row[]) {
      prefs.set(String(s.service_id), {
        months: Array.isArray(s.preferred_months) ? (s.preferred_months as number[]) : [],
        days: Array.isArray(s.preferred_days) ? (s.preferred_days as number[]) : [],
      });
    }
  }
  const { data: planned } = await admin.from("amc_visit_lines").select("entitlement_id, status").eq("contract_id", String(c.id));
  const count = new Map<string, number>();
  for (const l of (planned ?? []) as Row[]) {
    if (l.status === "cancelled") continue;
    count.set(String(l.entitlement_id), (count.get(String(l.entitlement_id)) ?? 0) + 1);
  }
  return rows.map((e) => ({
    entitlementId: String(e.id),
    serviceId: String(e.service_id),
    label: String(e.service_label),
    frequencyPerYear: Math.max(1, Number(e.frequency) || 1),
    planned: count.get(String(e.id)) ?? 0,
    preferredMonths: prefs.get(String(e.service_id))?.months ?? [],
    preferredDays: prefs.get(String(e.service_id))?.days ?? [],
  }));
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export async function contractPpm(admin: Admin, contractId: string, config: AmcConfig, now = new Date()): Promise<ContractPpm> {
  const today = todayInDubai(now);
  let c: Row;
  try {
    c = await contractFacts(admin, contractId);
  } catch (error) {
    if (error instanceof ContractError && error.status === 503) {
      return {
        migrated: false,
        open: false,
        confirmed: null,
        rules: rulesOf({}, config),
        lines: [],
        visits: [],
        changes: [],
        progress: ppmProgress([], today),
      };
    }
    throw error;
  }
  const [visitsResult, changesResult, lines] = await Promise.all([
    admin.from("amc_visits").select(VISIT_COLUMNS).eq("contract_id", contractId).order("target_date").order("visit_no"),
    admin
      .from("amc_visit_changes")
      .select("id, visit_id, change_type, from_date, to_date, reason, detail, actor_label, created_at")
      .eq("contract_id", contractId)
      .order("created_at", { ascending: false })
      .limit(100),
    schedulableLines(admin, c),
  ]);
  if (visitsResult.error) throw fail(visitsResult.error);
  if (changesResult.error) throw fail(changesResult.error);
  const visits = ((visitsResult.data ?? []) as unknown as Row[]).map((r) => mapVisit(r, today));
  const confirmer = one(c.confirmer);
  return {
    migrated: true,
    open: isOpen(c),
    confirmed: c.ppm_confirmed_at ? { at: String(c.ppm_confirmed_at), by: str(confirmer?.full_name) ?? str(confirmer?.email) } : null,
    rules: rulesOf(c, config),
    lines,
    visits,
    changes: ((changesResult.data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      visitId: str(r.visit_id),
      changeType: String(r.change_type),
      fromDate: str(r.from_date),
      toDate: str(r.to_date),
      reason: str(r.reason),
      detail: (r.detail as Row | null) ?? {},
      actorLabel: str(r.actor_label),
      createdAt: String(r.created_at),
    })),
    progress: ppmProgress(visits, today),
  };
}

/* ------------------------------------------------------------------ */
/* Changes                                                             */
/* ------------------------------------------------------------------ */

async function recordChange(
  admin: Admin,
  entry: { contractId: string; visitId?: string | null; type: string; from?: string | null; to?: string | null; reason?: string | null; detail?: Row },
  actor: Actor,
) {
  const { error } = await admin.from("amc_visit_changes").insert({
    contract_id: entry.contractId,
    visit_id: entry.visitId ?? null,
    change_type: entry.type,
    from_date: entry.from ?? null,
    to_date: entry.to ?? null,
    reason: entry.reason ?? null,
    detail: entry.detail ?? {},
    actor_id: actor.id,
    actor_label: actor.label,
  });
  if (error) throw fail(error);
}

async function visitOf(admin: Admin, contractId: string, visitId: string): Promise<Row> {
  const { data, error } = await admin.from("amc_visits").select(VISIT_COLUMNS).eq("id", visitId).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data || String(data.contract_id) !== contractId) throw new ContractError("That visit is not on this contract.", 404);
  return data;
}

function assertPlannable(v: Row) {
  if (!PLANNABLE_STATUSES.includes(v.status as VisitStatus)) {
    throw new ContractError(`Visit ${String(v.visit_no)} is ${String(v.status).replace(/_/g, " ")} and can no longer be changed here.`, 409);
  }
}

async function nextVisitNo(admin: Admin, contractId: string): Promise<number> {
  const { data } = await admin.from("amc_visits").select("visit_no").eq("contract_id", contractId).order("visit_no", { ascending: false }).limit(1);
  return Number((data?.[0] as Row | undefined)?.visit_no ?? 0) + 1;
}

/* ------------------------------------------------------------------ */
/* Generation (DEV-388)                                                */
/* ------------------------------------------------------------------ */

/**
 * Makes the tentative schedule: one visit per service line occurrence,
 * numbered in date order. With `replace`, a schedule nobody has touched
 * yet (not confirmed, no visit moved, clubbed or added) is made again.
 */
export async function generatePpmSchedule(
  admin: Admin,
  contractId: string,
  actor: Actor,
  config: AmcConfig,
  opts: { replace?: boolean } = {},
): Promise<{ created: number }> {
  const c = await contractFacts(admin, contractId);
  if (!isOpen(c)) throw new ContractError("The schedule is made once the contract is active (after its first payment).", 409);
  if (!c.start_date || !c.end_date) throw new ContractError("The contract needs its commencement and end dates first.", 409);
  const { count: existing, error: countError } = await admin.from("amc_visits").select("id", { count: "exact", head: true }).eq("contract_id", contractId);
  if (countError) throw fail(countError);
  if ((existing ?? 0) > 0) {
    if (!opts.replace) throw new ContractError("This contract already has a schedule.", 409);
    if (c.ppm_confirmed_at) throw new ContractError("The schedule is confirmed. Change its visits instead of making it again.", 409);
    const { count: touched } = await admin.from("amc_visit_changes").select("id", { count: "exact", head: true }).eq("contract_id", contractId).not("visit_id", "is", null);
    if ((touched ?? 0) > 0) throw new ContractError("Visits were already adjusted. Move or remove them instead of making the schedule again.", 409);
    const { error: lineError } = await admin.from("amc_visit_lines").delete().eq("contract_id", contractId);
    if (lineError) throw fail(lineError);
    const { error: visitError } = await admin.from("amc_visits").delete().eq("contract_id", contractId);
    if (visitError) throw fail(visitError);
  }

  const lines = await schedulableLines(admin, c);
  if (!lines.length) throw new ContractError("This contract has no PPM services to schedule.", 409);
  const rules = rulesOf(c, config);
  const term = Number(c.term_months) || Math.max(1, Math.round((Date.parse(String(c.end_date)) - Date.parse(String(c.start_date))) / (30.44 * 86_400_000)));
  const planned = buildPpmSchedule({
    lines: lines.map<ServiceLineInput>((l) => ({
      entitlementId: l.entitlementId,
      serviceId: l.serviceId,
      label: l.label,
      frequencyPerYear: l.frequencyPerYear,
      preferredMonths: l.preferredMonths,
      preferredDays: l.preferredDays,
    })),
    commencementDate: String(c.start_date),
    endDate: String(c.end_date),
    termMonths: term,
    windowDays: rules.windowDays,
    calendar: calendarOf(config),
  });

  const { data: visits, error: insertError } = await admin
    .from("amc_visits")
    .insert(
      planned.map((p, i) => ({
        contract_id: contractId,
        visit_no: i + 1,
        status: "not_scheduled",
        cycle_start: p.cycleStart,
        cycle_end: p.cycleEnd,
        window_start: p.windowStart,
        window_end: p.windowEnd,
        target_date: p.targetDate,
        source: "generated",
        created_by: actor.id,
      })),
    )
    .select("id, visit_no");
  if (insertError) throw fail(insertError);
  const idByNo = new Map(((visits ?? []) as Row[]).map((v) => [Number(v.visit_no), String(v.id)]));
  const { error: linesError } = await admin.from("amc_visit_lines").insert(
    planned.map((p, i) => ({
      visit_id: idByNo.get(i + 1),
      contract_id: contractId,
      entitlement_id: p.entitlementId,
      service_id: p.serviceId,
      service_label: p.label,
      occurrence: p.occurrence,
      home_cycle_start: p.cycleStart,
      home_cycle_end: p.cycleEnd,
      home_window_start: p.windowStart,
      home_window_end: p.windowEnd,
      home_target_date: p.targetDate,
    })),
  );
  if (linesError) throw fail(linesError);
  await recordChange(admin, { contractId, type: "generated", detail: { visits: planned.length, lines: lines.length, windowDays: rules.windowDays } }, actor);
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: "ppm_schedule_generated",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { visits: planned.length, replaced: Boolean(opts.replace && existing) },
  });
  return { created: planned.length };
}

/**
 * Makes the tentative schedule once a contract has started, when it has
 * none (activation past the gate, the first payment, an override). Best
 * effort: a contract with nothing to schedule, or a database without the
 * PPM tables, just has no schedule yet.
 */
export async function ensurePpmSchedule(admin: Admin, contractId: string, actor: Actor, config: AmcConfig): Promise<void> {
  try {
    const { count, error } = await admin.from("amc_visits").select("id", { count: "exact", head: true }).eq("contract_id", contractId);
    if (error || (count ?? 0) > 0) return;
    await generatePpmSchedule(admin, contractId, actor, config);
  } catch (e) {
    if (!(e instanceof ContractError && (e.status === 409 || e.status === 503))) {
      console.error("[amc:ppm] schedule not generated:", e instanceof Error ? e.message : e);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Actions (DEV-389, 390)                                              */
/* ------------------------------------------------------------------ */

export async function performPpmAction(admin: Admin, contractId: string, action: PpmAction, actor: Actor, config: AmcConfig): Promise<{ ok: true; changed?: number }> {
  const c = await contractFacts(admin, contractId);
  if (action.action === "generate") {
    const made = await generatePpmSchedule(admin, contractId, actor, config, { replace: action.replace });
    return { ok: true, changed: made.created };
  }
  if (action.action === "rules") {
    const { error } = await admin
      .from("amc_contracts")
      .update({
        ppm_window_days: action.windowDays,
        attempt_count: action.attemptCount,
        attempt_interval_days: action.attemptIntervalDays,
        attempt_channels: action.attemptChannels,
        attempt_escalation_user_id: action.escalationUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contractId);
    if (error) throw fail(error);
    await recordChange(admin, { contractId, type: "rules_changed", detail: { ...action } }, actor);
    return { ok: true };
  }
  if (!isOpen(c)) throw new ContractError("The schedule can be changed while the contract is active or on hold.", 409);
  const confirmed = Boolean(c.ppm_confirmed_at);
  const rules = rulesOf(c, config);
  const calendar = calendarOf(config);
  const now = new Date().toISOString();

  switch (action.action) {
    case "move": {
      const v = await visitOf(admin, contractId, action.visitId);
      assertPlannable(v);
      const from = String(v.target_date);
      if (action.date === from) return { ok: true };
      const move = classifyMove({ windowStart: String(v.window_start), windowEnd: String(v.window_end) }, action.date, confirmed);
      if (move.needsReason && !action.reason) {
        throw new ContractError("That date is outside the visit's service window: say why it is rescheduled.", 400);
      }
      const window = windowAfterMove({ windowStart: String(v.window_start), windowEnd: String(v.window_end) }, action.date, rules.windowDays, confirmed);
      const reschedule = move.kind === "outside_window" && confirmed;
      const { error } = await admin
        .from("amc_visits")
        .update({
          target_date: action.date,
          window_start: window.windowStart,
          window_end: window.windowEnd,
          ...(reschedule
            ? { original_target_date: str(v.original_target_date) ?? from, reschedule_count: Number(v.reschedule_count ?? 0) + 1, status: "rescheduled", status_reason: action.reason }
            : {}),
          updated_at: now,
        })
        .eq("id", action.visitId);
      if (error) throw fail(error);
      await recordChange(
        admin,
        {
          contractId,
          visitId: action.visitId,
          type: move.kind === "in_window" ? "moved_in_window" : reschedule ? "rescheduled" : "adjusted",
          from,
          to: action.date,
          reason: action.reason,
        },
        actor,
      );
      return { ok: true };
    }
    case "add": {
      const lines = await schedulableLines(admin, c);
      const line = lines.find((l) => l.entitlementId === action.entitlementId);
      if (!line) throw new ContractError("That service is not a PPM service on this contract.", 404);
      const { data: last } = await admin
        .from("amc_visit_lines")
        .select("occurrence")
        .eq("entitlement_id", action.entitlementId)
        .order("occurrence", { ascending: false })
        .limit(1);
      const occurrence = Number((last?.[0] as Row | undefined)?.occurrence ?? 0) + 1;
      const windowEnd = addDays(action.date, rules.windowDays - 1);
      const { data: visit, error } = await admin
        .from("amc_visits")
        .insert({
          contract_id: contractId,
          visit_no: await nextVisitNo(admin, contractId),
          status: confirmed ? "scheduled" : "not_scheduled",
          cycle_start: action.date,
          cycle_end: windowEnd,
          window_start: action.date,
          window_end: windowEnd,
          target_date: action.date,
          source: "added",
          status_reason: action.reason,
          created_by: actor.id,
        })
        .select("id")
        .single<Row>();
      if (error) throw fail(error);
      const { error: lineError } = await admin.from("amc_visit_lines").insert({
        visit_id: String(visit.id),
        contract_id: contractId,
        entitlement_id: action.entitlementId,
        service_id: line.serviceId,
        service_label: line.label,
        occurrence,
        home_cycle_start: action.date,
        home_cycle_end: windowEnd,
        home_window_start: action.date,
        home_window_end: windowEnd,
        home_target_date: action.date,
      });
      if (lineError) throw fail(lineError);
      await recordChange(admin, { contractId, visitId: String(visit.id), type: "added", to: action.date, reason: action.reason, detail: { service: line.label } }, actor);
      return { ok: true };
    }
    case "remove": {
      const v = await visitOf(admin, contractId, action.visitId);
      assertPlannable(v);
      const { error } = await admin
        .from("amc_visits")
        .update({ status: "cancelled", status_reason: action.reason, updated_at: now })
        .eq("id", action.visitId);
      if (error) throw fail(error);
      await admin.from("amc_visit_lines").update({ status: "cancelled", status_reason: action.reason, updated_at: now }).eq("visit_id", action.visitId);
      await recordChange(admin, { contractId, visitId: action.visitId, type: "removed", from: String(v.target_date), reason: action.reason }, actor);
      return { ok: true };
    }
    case "club": {
      await clubVisits(admin, contractId, action.visitIds, actor, calendar);
      return { ok: true, changed: 1 };
    }
    case "club_overlapping": {
      const { data, error } = await admin.from("amc_visits").select(VISIT_COLUMNS).eq("contract_id", contractId).in("status", [...PLANNABLE_STATUSES]);
      if (error) throw fail(error);
      const candidates = ((data ?? []) as unknown as Row[]).map((r) => ({
        id: String(r.id),
        windowStart: String(r.window_start),
        windowEnd: String(r.window_end),
        lineIds: ((r.lines ?? []) as Row[]).map((l) => String(l.entitlement_id)),
      }));
      const groups = clubbingGroups(candidates);
      for (const g of groups) await clubVisits(admin, contractId, g.map((v) => v.id), actor, calendar);
      return { ok: true, changed: groups.length };
    }
    case "separate": {
      const { data: line, error } = await admin
        .from("amc_visit_lines")
        .select("id, visit_id, contract_id, service_label, home_cycle_start, home_cycle_end, home_window_start, home_window_end, home_target_date")
        .eq("id", action.lineId)
        .maybeSingle<Row>();
      if (error) throw fail(error);
      if (!line || String(line.contract_id) !== contractId) throw new ContractError("That trade is not on this contract.", 404);
      const host = await visitOf(admin, contractId, String(line.visit_id));
      assertPlannable(host);
      if (((host.lines ?? []) as Row[]).length < 2) throw new ContractError("That visit has only one trade: nothing to separate.", 409);
      const { data: visit, error: insertError } = await admin
        .from("amc_visits")
        .insert({
          contract_id: contractId,
          visit_no: await nextVisitNo(admin, contractId),
          status: confirmed ? "scheduled" : "not_scheduled",
          cycle_start: String(line.home_cycle_start),
          cycle_end: String(line.home_cycle_end),
          window_start: String(line.home_window_start),
          window_end: String(line.home_window_end),
          target_date: String(line.home_target_date),
          source: "separated",
          created_by: actor.id,
        })
        .select("id, visit_no")
        .single<Row>();
      if (insertError) throw fail(insertError);
      const { error: moveError } = await admin.from("amc_visit_lines").update({ visit_id: String(visit.id), updated_at: now }).eq("id", action.lineId);
      if (moveError) throw fail(moveError);
      await recordChange(
        admin,
        { contractId, visitId: String(visit.id), type: "separated", to: String(line.home_target_date), detail: { from: Number(host.visit_no), service: line.service_label } },
        actor,
      );
      return { ok: true };
    }
    case "confirm": {
      const { count } = await admin.from("amc_visits").select("id", { count: "exact", head: true }).eq("contract_id", contractId).neq("status", "cancelled");
      if (!count) throw new ContractError("There are no visits to confirm.", 409);
      const { error } = await admin.from("amc_contracts").update({ ppm_confirmed_at: now, ppm_confirmed_by: actor.id, updated_at: now }).eq("id", contractId);
      if (error) throw fail(error);
      await admin.from("amc_visits").update({ status: "scheduled", updated_at: now }).eq("contract_id", contractId).eq("status", "not_scheduled");
      await recordChange(admin, { contractId, type: "confirmed", detail: { visits: count, again: confirmed } }, actor);
      await recordAmcAudit(admin, { entityType: "contract", entityId: contractId, eventType: "ppm_schedule_confirmed", actorId: actor.id, actorLabel: actor.label, payload: { visits: count } });
      return { ok: true };
    }
  }
}

/**
 * Clubs visits into the first of them (BRD 5.10): their lines move onto
 * it, it takes the window where theirs meet and the earlier target, and
 * the others are cancelled as clubbed. Two visits of the same service line
 * are never clubbed.
 */
async function clubVisits(admin: Admin, contractId: string, visitIds: string[], actor: Actor, calendar: WorkingCalendar) {
  const visits = await Promise.all([...new Set(visitIds)].map((id) => visitOf(admin, contractId, id)));
  if (visits.length < 2) throw new ContractError("Choose at least two visits to club.", 400);
  visits.forEach(assertPlannable);
  const lineSets = visits.map((v) => ((v.lines ?? []) as Row[]).map((l) => String(l.entitlement_id)));
  const all = lineSets.flat();
  if (new Set(all).size !== all.length) throw new ContractError("Two visits of the same service cannot be clubbed.", 409);
  const meet = clubbedWindow(
    visits.map((v) => ({ windowStart: String(v.window_start), windowEnd: String(v.window_end), targetDate: String(v.target_date) })),
    calendar,
  );
  if (!meet) throw new ContractError("Those visits' service windows do not overlap.", 409);
  visits.sort((a, b) => Number(a.visit_no) - Number(b.visit_no));
  const [host, ...rest] = visits;
  const now = new Date().toISOString();
  const { error } = await admin
    .from("amc_visits")
    .update({ window_start: meet.windowStart, window_end: meet.windowEnd, target_date: meet.targetDate, updated_at: now })
    .eq("id", String(host.id));
  if (error) throw fail(error);
  for (const v of rest) {
    const { error: lineError } = await admin.from("amc_visit_lines").update({ visit_id: String(host.id), updated_at: now }).eq("visit_id", String(v.id));
    if (lineError) throw fail(lineError);
    const { error: cancelError } = await admin
      .from("amc_visits")
      .update({ status: "cancelled", status_reason: `Clubbed into visit ${String(host.visit_no)}`, updated_at: now })
      .eq("id", String(v.id));
    if (cancelError) throw fail(cancelError);
  }
  await recordChange(
    admin,
    {
      contractId,
      visitId: String(host.id),
      type: "clubbed",
      to: meet.targetDate,
      detail: { into: Number(host.visit_no), from: rest.map((v) => Number(v.visit_no)) },
    },
    actor,
  );
}

/* ------------------------------------------------------------------ */
/* The daily sweep (job "ppm_overdue")                                 */
/* ------------------------------------------------------------------ */

/**
 * PPM overdue (BRD 6.2): a planned visit whose service window has passed
 * and is still not done. The contract owner hears once per visit (claimed
 * with its stamp first, so overlapping runs tell once).
 */
export async function runPpmOverdueSweep(admin: Admin, now = new Date()) {
  const result = { overdue: 0, skipped: null as string | null };
  const today = todayInDubai(now);
  const { data, error } = await admin
    .from("amc_visits")
    .select("id, visit_no, target_date, window_end, contract:amc_contracts!amc_visits_contract_id_fkey(id, status, contract_number, proposal_number, customer_name, submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id))")
    .in("status", [...PLANNABLE_STATUSES])
    .lt("window_end", today)
    .is("overdue_notified_at", null)
    .limit(300);
  if (error) {
    if (notMigrated(error)) return { ...result, skipped: "not migrated" };
    throw new Error(error.message);
  }
  for (const v of (data ?? []) as unknown as Row[]) {
    const c = one(v.contract);
    if (!c || !isOpen(c)) continue;
    const { data: claimed } = await admin.from("amc_visits").update({ overdue_notified_at: now.toISOString() }).eq("id", String(v.id)).is("overdue_notified_at", null).select("id");
    if (!claimed?.length) continue;
    const owner = str(one(c.submission)?.owner_id);
    if (!owner) continue;
    await notifyUsers(admin, {
      event: "ppm_overdue",
      userIds: [owner],
      title: `PPM visit overdue: ${reference(c)}`,
      body: `${String(c.customer_name ?? "")}: visit ${String(v.visit_no)} (target ${String(v.target_date)}) is past its service window and not done.`,
      link: `/extensions/amc-contracts/${String(c.id)}?tab=schedule`,
      entityType: "contract",
      entityId: String(c.id),
      contractId: String(c.id),
      dedupeKey: `ppm_overdue:${String(v.id)}`,
    });
    result.overdue += 1;
  }
  return result;
}
