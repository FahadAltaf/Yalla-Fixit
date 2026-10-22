import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { computeAttendance, summariseAttendance, type AttendanceDay, type AttendanceSummary } from "@/lib/reports/attendance";
import { computeAvailability, datesBetween, MAX_RANGE_DAYS } from "@/lib/reports/available-hours";
import {
  complianceMonthPhase,
  computeCompliance,
  missesInOutage,
  monthRange,
  requiredEvents,
  type ComplianceEventKind,
  type EventOutcome,
  type RecordedCheckIn,
  type TechnicianCompliance,
  type Waiver,
} from "@/lib/reports/compliance";
import type { ReportingSettings } from "@/lib/reporting/settings";
import { addDaysToDateString, todayInZone, zonedDateString } from "@/lib/scheduling/org-time";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { readAllRows } from "@/lib/server/snagging/read-all";

import {
  loadAvailabilityInput,
  loadComplianceAppointments,
  loadTechnicians,
  type ComplianceAppointmentRow,
  type ReportTechnician,
} from "./data";
import { dataAsOf } from "./reports";

/**
 * The P7 reports, assembled for their routes: app compliance (BRD 5.2 B4;
 * DEV-447, 448, 450) and daily attendance (B5; DEV-451). The rules are
 * pure, in lib/reports/compliance.ts and attendance.ts.
 *
 * Where the check-ins come from, and what is measured until they can:
 *
 *  - Shift check-ins and check-outs live in FSM's time sheets, which the
 *    Zoho token cannot read (B-01). Until it can, shift events are NOT
 *    counted: counting them would mark every technician as missing every
 *    shift, which is the portal not seeing, not the technician not doing.
 *  - Appointment check-ins are counted only when the provisional setting
 *    reads FSM's actual start and end as the check-in and check-out
 *    (D-15). Off by default.
 *
 * A month is finalised only on complete data, so until both sources can
 * be read nothing is frozen and no statement is issued.
 */

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = z.string().trim().max(200);
const id = z.string().trim().max(80);

type Roster = Map<string, ReportTechnician>;

const SHIFT_KINDS: ComplianceEventKind[] = ["shift_check_in", "shift_check_out"];
const isShiftKind = (kind: ComplianceEventKind) => SHIFT_KINDS.includes(kind);

const teamKeyOf = (t: ReportTechnician) => t.teamLeaderId ?? "none";
const teamNameOf = (roster: Roster, t: ReportTechnician) =>
  t.teamLeaderId ? `${roster.get(t.teamLeaderId)?.name ?? t.teamLeaderId}'s team` : "No team";

function teamOptions(roster: Roster) {
  const leaders = new Set([...roster.values()].map((t) => t.teamLeaderId).filter((v): v is string => Boolean(v)));
  return [
    ...[...leaders].map((leader) => ({ id: leader, name: `${roster.get(leader)?.name ?? leader}'s team` })).sort((a, b) => a.name.localeCompare(b.name)),
    { id: "none", name: "No team" },
  ];
}

const technicianOptions = (roster: Roster) =>
  [...roster.values()]
    .filter((t) => t.isActive)
    .map((t) => ({ id: t.fsmId, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

/** The last twelve months, newest first, for the month filter. */
function monthOptions(today: string) {
  const out: Array<{ id: string; name: string }> = [];
  let [y, m] = today.slice(0, 7).split("-").map(Number);
  const NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  for (let i = 0; i < 12; i += 1) {
    out.push({ id: `${y}-${String(m).padStart(2, "0")}`, name: `${NAMES[m - 1]} ${y}` });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

function page<T>(rows: T[], p: { page: number; pageSize: number }, all: boolean): T[] {
  return all ? rows : rows.slice(p.page * p.pageSize, (p.page + 1) * p.pageSize);
}

export type CheckInSources = { shift: boolean; appointment: boolean };

/*
  Schema `hr` arrives with migration 20261023100000. Before it is applied
  (and exposed) the report still works on its figures; waiving and
  finalising are switched off and the page says why.
*/
function hrMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST106" || error.code === "42P01" || /schema|does not exist/i.test(error.message ?? "");
}

function sourcesFor(settings: ReportingSettings): CheckInSources {
  return { shift: false, appointment: settings.compliance.appointmentActualsAsCheckIns };
}

/** FSM's actual times as appointment check-ins, for each technician on the crew (D-15, provisional). */
function appointmentCheckIns(appointments: ComplianceAppointmentRow[]): RecordedCheckIn[] {
  const out: RecordedCheckIn[] = [];
  for (const a of appointments) {
    for (const tech of new Set(a.technicianIds)) {
      if (a.actualStart) out.push({ technicianFsmId: tech, kind: "appointment_check_in", at: a.actualStart, appointmentId: a.id });
      if (a.actualEnd) out.push({ technicianFsmId: tech, kind: "appointment_check_out", at: a.actualEnd, appointmentId: a.id });
    }
  }
  return out;
}

/** Who is counted: active technicians, leavers with a date, and anyone who was booked. */
function inScope(roster: Roster, booked: Set<string>, filters: { technician?: string; team?: string }) {
  return [...roster.values()].filter((t) => {
    if (filters.technician && t.fsmId !== filters.technician) return false;
    if (filters.team && teamKeyOf(t) !== filters.team) return false;
    return t.isActive || Boolean(t.leavingDate) || booked.has(t.fsmId);
  });
}

// ---------------------------------------------------------------------
// The month, worked out (shared by the report, waivers and finalising)
// ---------------------------------------------------------------------

type MonthWork = {
  month: string;
  from: string;
  /** Measured up to: the month's end, or today while it runs. */
  to: string;
  phase: ReturnType<typeof complianceMonthPhase>;
  sources: CheckInSources;
  settings: ReportingSettings["compliance"];
  roster: Roster;
  technicians: ReportTechnician[];
  results: Map<string, TechnicianCompliance>;
  /** Events owed by kind, whether or not they can be measured yet. */
  owed: Map<string, { shift: number; appointment: number }>;
  crewsUnknown: number;
  /** Whether the `hr` tables can be read (migration 20261023100000 applied and exposed). */
  storageReady: boolean;
};

async function workOutMonth(
  admin: SupabaseClient,
  month: string,
  filters: { technician?: string; team?: string } = {},
): Promise<MonthWork> {
  const today = todayInZone();
  const settings = await readReportingSettings(admin);
  const range = monthRange(month);
  const to = range.to < today ? range.to : today;
  const phase = complianceMonthPhase(month, today, settings.compliance.disputeCutoffDay);
  const sources = sourcesFor(settings);
  const roster = await loadTechnicians(admin);

  if (to < range.from) {
    return {
      month,
      from: range.from,
      to: range.from,
      phase,
      sources,
      settings: settings.compliance,
      roster,
      technicians: [],
      results: new Map(),
      owed: new Map(),
      crewsUnknown: 0,
      storageReady: true,
    };
  }

  const loaded = await loadComplianceAppointments(admin, { from: range.from, to });
  const booked = new Set(loaded.appointments.flatMap((a) => a.technicianIds));
  const technicians = inScope(roster, booked, filters);
  const scopeIds = new Set(technicians.map((t) => t.fsmId));
  const appointments = loaded.appointments
    .map((a) => ({ ...a, technicianIds: a.technicianIds.filter((t) => scopeIds.has(t)) }))
    .filter((a) => a.technicianIds.length > 0);

  const availability = computeAvailability(
    await loadAvailabilityInput(admin, {
      from: range.from,
      to,
      technicians,
      unpaidBreakMinutes: settings.attendance.unpaidBreakMinutes,
    }),
  );

  /* Only what was due by now: the rest of today's shift is not missed yet. */
  const now = Date.now();
  const owedEvents = requiredEvents({ availability, appointments }).filter((e) => !e.dueAt || Date.parse(e.dueAt) <= now);
  const owed = new Map<string, { shift: number; appointment: number }>();
  for (const e of owedEvents) {
    const entry = owed.get(e.technicianFsmId) ?? { shift: 0, appointment: 0 };
    if (isShiftKind(e.kind)) entry.shift += 1;
    else entry.appointment += 1;
    owed.set(e.technicianFsmId, entry);
  }
  const measured = owedEvents.filter((e) => (isShiftKind(e.kind) ? sources.shift : sources.appointment));
  const recorded = sources.appointment ? appointmentCheckIns(appointments) : [];

  const { data: waiverRows, error } = await admin
    .schema("hr")
    .from("waivers")
    .select("event_key, reason, note, waived_by_label, waived_at, batch_id")
    .eq("month", month);
  const storageReady = !hrMissing(error);
  if (error && storageReady) throw new Error(`waivers: ${error.message}`);
  const waivers: Waiver[] = (waiverRows ?? []).map((w) => ({
    eventKey: String(w.event_key),
    reason: String(w.reason),
    waivedBy: String(w.waived_by_label ?? "Unknown user"),
    waivedAt: String(w.waived_at),
    batchId: (w.batch_id as string | null) ?? null,
  }));

  const settingsUsed = {
    thresholdPercent: settings.compliance.thresholdPercent,
    penaltyPerMissAed: settings.compliance.penaltyPerMissAed,
    monthlyCapAed: settings.compliance.monthlyCapAed,
  };
  const results = new Map(computeCompliance({ required: measured, recorded, waivers, settings: settingsUsed }).map((r) => [r.technicianFsmId, r]));

  return {
    month,
    from: range.from,
    to,
    phase,
    sources,
    settings: settings.compliance,
    roster,
    technicians,
    results,
    owed,
    crewsUnknown: loaded.crewsUnknown,
    storageReady,
  };
}

// ---------------------------------------------------------------------
// Compliance report
// ---------------------------------------------------------------------

export const complianceFiltersSchema = z.object({
  month: MONTH.optional(),
  view: z.enum(["technicians", "events"]).default("technicians"),
  technician: id.optional(),
  team: id.optional(),
  /** Events: which outcome (missed by default). */
  state: z.enum(["missed", "waived", "performed", "all"]).optional(),
  q: text.optional(),
});

export type ComplianceRow = {
  fsmId: string;
  name: string;
  teamName: string;
  required: number;
  performed: number;
  missed: number;
  waived: number;
  compliancePercent: number | null;
  belowThreshold: boolean | null;
  penaltyBeforeCapAed: number | null;
  penaltyPayableAed: number | null;
  /** Owed in the period, measured or not. */
  owedShift: number;
  owedAppointment: number;
};

export type ComplianceEventRow = Omit<EventOutcome, "waiver"> & {
  technicianName: string;
  waiverReason: string | null;
  waivedBy: string | null;
  waivedAt: string | null;
};

export type ComplianceReport = {
  view: "technicians" | "events";
  month: string;
  from: string;
  to: string;
  phase: "running" | "disputes_open" | "final";
  cutoffDate: string;
  finalized: { at: string; by: string | null } | null;
  /** False until migration 20261023100000 is applied: no waiving or finalising. */
  storageReady: boolean;
  sources: CheckInSources;
  settings: { thresholdPercent: number | null; penaltyPerMissAed: number; monthlyCapAed: number };
  overall: {
    technicians: number;
    required: number;
    performed: number;
    missed: number;
    waived: number;
    compliancePercent: number | null;
    penaltyPayableAed: number | null;
    belowThreshold: number | null;
    owedShift: number;
    owedAppointment: number;
  };
  technicians: ComplianceRow[];
  events: ComplianceEventRow[];
  total: number;
  notes: { crewsUnknown: number; noRestDays: number };
  options: {
    technicians: Array<{ id: string; name: string }>;
    teams: Array<{ id: string; name: string }>;
    months: Array<{ id: string; name: string }>;
  };
  dataAsOf: Record<string, string | null>;
};

export async function buildComplianceReport(
  admin: SupabaseClient,
  filters: z.infer<typeof complianceFiltersSchema>,
  paging: { page: number; pageSize: number },
  options: { all?: boolean } = {},
): Promise<ComplianceReport> {
  const today = todayInZone();
  const month = filters.month ?? today.slice(0, 7);
  const needle = (filters.q ?? "").toLowerCase();

  const { data: monthRow, error: monthError } = await admin
    .schema("hr")
    .from("compliance_months")
    .select("month, finalized_at, finalized_by_label, settings")
    .eq("month", month)
    .maybeSingle();
  if (monthError && !hrMissing(monthError)) throw new Error(`compliance months: ${monthError.message}`);

  const [work, asOf] = await Promise.all([
    workOutMonth(admin, month, { technician: filters.technician, team: filters.team }),
    dataAsOf(admin),
  ]);
  const { roster } = work;

  let rows: ComplianceRow[];
  let settingsUsed = {
    thresholdPercent: work.settings.thresholdPercent,
    penaltyPerMissAed: work.settings.penaltyPerMissAed,
    monthlyCapAed: work.settings.monthlyCapAed,
  };

  if (monthRow) {
    /* A finalised month is read from its statements and never worked out again. */
    const statements = await readAllRows<Record<string, unknown>>(
      (from, to) =>
        admin.schema("hr").from("compliance_statements").select("*").eq("month", month).order("technician_fsm_id").range(from, to),
      "compliance statements",
    );
    const frozen = monthRow.settings as typeof settingsUsed;
    settingsUsed = { ...settingsUsed, ...frozen };
    rows = statements
      .map((s) => {
        const tech = roster.get(String(s.technician_fsm_id));
        return {
          fsmId: String(s.technician_fsm_id),
          name: String(s.technician_name ?? tech?.name ?? s.technician_fsm_id),
          teamName: tech ? teamNameOf(roster, tech) : "No team",
          required: Number(s.required),
          performed: Number(s.performed),
          missed: Number(s.missed),
          waived: Number(s.waived),
          compliancePercent: s.compliance_percent === null ? null : Number(s.compliance_percent),
          belowThreshold: (s.below_threshold as boolean | null) ?? null,
          penaltyBeforeCapAed: s.penalty_before_cap === null ? null : Number(s.penalty_before_cap),
          penaltyPayableAed: s.penalty_payable === null ? null : Number(s.penalty_payable),
          owedShift: 0,
          owedAppointment: 0,
        };
      })
      .filter((r) => (!filters.technician || r.fsmId === filters.technician) && (!filters.team || teamKeyOf(roster.get(r.fsmId)!) === filters.team));
  } else {
    rows = work.technicians.map((t) => {
      const r = work.results.get(t.fsmId);
      const owed = work.owed.get(t.fsmId) ?? { shift: 0, appointment: 0 };
      return {
        fsmId: t.fsmId,
        name: t.name,
        teamName: teamNameOf(roster, t),
        required: r?.required ?? 0,
        performed: r?.performed ?? 0,
        missed: r?.missed ?? 0,
        waived: r?.waived ?? 0,
        compliancePercent: r?.compliancePercent ?? null,
        belowThreshold: r?.belowThreshold ?? (work.settings.thresholdPercent === null ? null : false),
        penaltyBeforeCapAed: r?.penaltyBeforeCapAed ?? (work.settings.thresholdPercent === null ? null : 0),
        penaltyPayableAed: r?.penaltyPayableAed ?? (work.settings.thresholdPercent === null ? null : 0),
        owedShift: owed.shift,
        owedAppointment: owed.appointment,
      };
    });
  }

  /* Worst first: most misses, then lowest compliance, then name. */
  rows.sort(
    (a, b) =>
      b.missed - a.missed ||
      (a.compliancePercent ?? 101) - (b.compliancePercent ?? 101) ||
      a.name.localeCompare(b.name),
  );

  const sum = (pick: (r: ComplianceRow) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
  const required = sum((r) => r.required);
  const performed = sum((r) => r.performed);
  const overall = {
    technicians: rows.length,
    required,
    performed,
    missed: sum((r) => r.missed),
    waived: sum((r) => r.waived),
    compliancePercent: required ? (performed / required) * 100 : null,
    penaltyPayableAed: settingsUsed.thresholdPercent === null ? null : sum((r) => r.penaltyPayableAed ?? 0),
    belowThreshold: settingsUsed.thresholdPercent === null ? null : rows.filter((r) => r.belowThreshold).length,
    owedShift: sum((r) => r.owedShift),
    owedAppointment: sum((r) => r.owedAppointment),
  };

  let technicians: ComplianceRow[] = [];
  let events: ComplianceEventRow[] = [];
  let total = 0;
  if (filters.view === "events") {
    const state = filters.state ?? "missed";
    const all = [...work.results.values()]
      .flatMap((r) => r.events)
      .filter((e) => state === "all" || e.state === state)
      .map<ComplianceEventRow>(({ waiver, ...e }) => ({
        ...e,
        technicianName: roster.get(e.technicianFsmId)?.name ?? e.technicianFsmId,
        waiverReason: waiver?.reason ?? null,
        waivedBy: waiver?.waivedBy ?? null,
        waivedAt: waiver?.waivedAt ?? null,
      }))
      .filter((e) => !needle || `${e.technicianName} ${e.appointmentNumber ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? "") || a.technicianName.localeCompare(b.technicianName));
    events = page(all, paging, Boolean(options.all));
    total = all.length;
  } else {
    const filtered = needle ? rows.filter((r) => `${r.name} ${r.teamName}`.toLowerCase().includes(needle)) : rows;
    technicians = page(filtered, paging, Boolean(options.all));
    total = filtered.length;
  }

  return {
    view: filters.view,
    month,
    from: work.from,
    to: work.to,
    phase: work.phase.phase,
    cutoffDate: work.phase.cutoffDate,
    finalized: monthRow ? { at: String(monthRow.finalized_at), by: (monthRow.finalized_by_label as string | null) ?? null } : null,
    storageReady: work.storageReady,
    sources: work.sources,
    settings: settingsUsed,
    overall,
    technicians,
    events,
    total,
    notes: {
      crewsUnknown: work.crewsUnknown,
      noRestDays: work.technicians.filter((t) => t.restWeekdays.length === 0).length,
    },
    options: { technicians: technicianOptions(roster), teams: teamOptions(roster), months: monthOptions(today) },
    dataAsOf: asOf,
  };
}

// ---------------------------------------------------------------------
// Waivers (DEV-448)
// ---------------------------------------------------------------------

export class ComplianceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const waiverRequestSchema = z
  .object({
    month: MONTH,
    reason: z.string().trim().min(1).max(60),
    note: z.string().trim().max(2000).nullish(),
    /** One or several misses, by key. */
    eventKeys: z.array(z.string().min(5).max(200)).max(500).optional(),
    /** Or a confirmed outage: every miss due inside the window, for everyone. */
    outage: z
      .object({
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
        kinds: z.array(z.enum(["shift_check_in", "shift_check_out", "appointment_check_in", "appointment_check_out"])).max(4).default([]),
      })
      .optional(),
  })
  .strict()
  .refine((v) => Boolean(v.eventKeys?.length) !== Boolean(v.outage), "Give either the misses or an outage window");

/**
 * Waives misses, checked against the month as worked out now: only an
 * event that is missed can be waived, so a stale screen cannot waive a
 * check-in that has since arrived.
 */
export async function waiveMisses(
  admin: SupabaseClient,
  input: z.infer<typeof waiverRequestSchema>,
  actor: { id: string; label: string },
): Promise<{ waived: number; matched: number }> {
  const work = await workOutMonth(admin, input.month);
  if (!work.storageReady) throw new ComplianceError("Waivers need migration 20261023100000 to be applied first.", 409);
  if (work.phase.phase === "final") throw new ComplianceError(`Disputes for ${input.month} closed on ${work.phase.cutoffDate}.`, 409);

  const misses = [...work.results.values()].flatMap((r) => r.events).filter((e) => e.state === "missed");
  let chosen: EventOutcome[];
  if (input.outage) {
    if (input.outage.to < input.outage.from) throw new ComplianceError("The outage ends before it starts.", 400);
    chosen = missesInOutage([...work.results.values()], {
      from: input.outage.from,
      to: input.outage.to,
      kinds: input.outage.kinds,
    });
  } else {
    const wanted = new Set(input.eventKeys);
    chosen = misses.filter((e) => wanted.has(e.key));
    if (chosen.length !== wanted.size) {
      throw new ComplianceError("Some of these are no longer misses. Reload and try again.", 409);
    }
  }
  if (chosen.length === 0) return { waived: 0, matched: 0 };

  const payload = chosen.map((e) => ({
    key: e.key,
    technician: e.technicianFsmId,
    kind: e.kind,
    month: input.month,
    due_at: e.dueAt,
  }));
  const { data, error } = await admin.schema("hr").rpc("record_waivers", {
    p_events: payload,
    p_reason: input.reason,
    p_note: input.note ?? null,
    p_actor: actor.id,
    p_actor_label: actor.label,
    p_batch: input.outage ? { from: input.outage.from, to: input.outage.to, kinds: input.outage.kinds } : null,
  });
  if (error) {
    if (error.code === "23514") throw new ComplianceError(error.message.replace(/^record_waivers: /, ""), 409);
    throw new Error(error.message);
  }
  return { waived: Number(data ?? 0), matched: chosen.length };
}

// ---------------------------------------------------------------------
// Finalising a month (DEV-450)
// ---------------------------------------------------------------------

/**
 * Freezes the month's statements once disputes have closed. Refused until
 * both check-in sources can be read: a statement HR acts on must not be
 * frozen from a month the portal could only half see.
 */
export async function finalizeMonth(admin: SupabaseClient, month: string, actor: { id: string; label: string }): Promise<number> {
  const work = await workOutMonth(admin, month);
  if (!work.storageReady) throw new ComplianceError("Finalising needs migration 20261023100000 to be applied first.", 409);
  if (work.phase.phase !== "final") {
    throw new ComplianceError(`Disputes for ${month} are open until ${work.phase.cutoffDate}.`, 409);
  }
  if (!work.sources.shift || !work.sources.appointment) {
    throw new ComplianceError(
      "A month is finalised only on complete check-in data. Shift check-ins cannot be read from FSM yet (B-01).",
      409,
    );
  }
  const rows = work.technicians.map((t) => {
    const r = work.results.get(t.fsmId);
    return {
      technician: t.fsmId,
      name: t.name,
      required: r?.required ?? 0,
      performed: r?.performed ?? 0,
      missed: r?.missed ?? 0,
      waived: r?.waived ?? 0,
      compliance_percent: r?.compliancePercent ?? null,
      below_threshold: r?.belowThreshold ?? null,
      penalty_before_cap: r?.penaltyBeforeCapAed ?? null,
      penalty_payable: r?.penaltyPayableAed ?? null,
    };
  });
  const { data, error } = await admin.schema("hr").rpc("finalize_month", {
    p_month: month,
    p_cutoff: work.phase.cutoffDate,
    p_rows: rows,
    p_settings: {
      thresholdPercent: work.settings.thresholdPercent,
      penaltyPerMissAed: work.settings.penaltyPerMissAed,
      monthlyCapAed: work.settings.monthlyCapAed,
      disputeCutoffDay: work.settings.disputeCutoffDay,
    },
    p_actor: actor.id,
    p_actor_label: actor.label,
  });
  if (error) {
    if (error.code === "23505" || error.code === "23514") throw new ComplianceError(error.message.replace(/^finalize_month: /, ""), 409);
    throw new Error(error.message);
  }
  return Number(data ?? 0);
}

// ---------------------------------------------------------------------
// Daily attendance (DEV-451)
// ---------------------------------------------------------------------

export const attendanceFiltersSchema = z.object({
  view: z.enum(["days", "summary"]).default("days"),
  from: DATE.optional(),
  to: DATE.optional(),
  technician: id.optional(),
  team: id.optional(),
  /** Days: which kind of day. */
  status: z.enum(["working", "leave", "holiday", "rest_day", "left"]).optional(),
  q: text.optional(),
});

export type AttendanceRow = AttendanceDay & {
  name: string;
  teamName: string;
  /** From FSM appointment actual times: when work started and ended that day. Not a check-in. */
  firstJobAt: string | null;
  lastJobAt: string | null;
  jobs: number;
};

export type AttendanceSummaryRow = AttendanceSummary & { name: string; teamName: string; jobDays: number };

export type AttendanceReport = {
  view: "days" | "summary";
  from: string;
  to: string;
  measured: boolean;
  lateToleranceMinutes: number;
  overall: { technicians: number; shiftDays: number; leaveDays: number; jobDays: number; presentDays: number; lateDays: number; absentDays: number };
  days: AttendanceRow[];
  summary: AttendanceSummaryRow[];
  total: number;
  notes: { leaveRecords: number; holidays: number; noRestDays: number };
  options: { technicians: Array<{ id: string; name: string }>; teams: Array<{ id: string; name: string }> };
  dataAsOf: Record<string, string | null>;
};

export async function buildAttendanceReport(
  admin: SupabaseClient,
  filters: z.infer<typeof attendanceFiltersSchema>,
  paging: { page: number; pageSize: number },
  options: { all?: boolean } = {},
): Promise<AttendanceReport> {
  const today = todayInZone();
  let to = filters.to ?? today;
  let from = filters.from ?? `${to.slice(0, 8)}01`;
  if (from > to) [from, to] = [to, from];
  if (datesBetween(from, to).length > MAX_RANGE_DAYS) from = addDaysToDateString(to, -(MAX_RANGE_DAYS - 1));

  const [settings, roster, loaded, asOf] = await Promise.all([
    readReportingSettings(admin),
    loadTechnicians(admin),
    loadComplianceAppointments(admin, { from, to }),
    dataAsOf(admin),
  ]);
  const booked = new Set(loaded.appointments.flatMap((a) => a.technicianIds));
  const technicians = inScope(roster, booked, filters);
  const input = await loadAvailabilityInput(admin, {
    from,
    to,
    technicians,
    unpaidBreakMinutes: settings.attendance.unpaidBreakMinutes,
  });
  const availability = computeAvailability(input);
  const measured = false; // Shift check-ins: B-01.
  const days = computeAttendance({
    availability,
    recorded: [],
    leave: input.leave.map((l) => ({ ...l, category: l.category ?? null })),
    lateToleranceMinutes: settings.attendance.lateArrivalToleranceMinutes,
    shiftCheckInsAvailable: measured,
  });

  /* Work done per technician and day, from the appointments' actual times. */
  const jobs = new Map<string, { first: string; last: string; count: number }>();
  for (const a of loaded.appointments) {
    if (!a.actualStart) continue;
    const date = zonedDateString(a.actualStart);
    for (const tech of new Set(a.technicianIds)) {
      const key = `${tech}|${date}`;
      const end = a.actualEnd ?? a.actualStart;
      const entry = jobs.get(key);
      if (!entry) jobs.set(key, { first: a.actualStart, last: end, count: 1 });
      else {
        if (a.actualStart < entry.first) entry.first = a.actualStart;
        if (end > entry.last) entry.last = end;
        entry.count += 1;
      }
    }
  }

  const rows: AttendanceRow[] = days.map((d) => {
    const tech = roster.get(d.technicianFsmId)!;
    const job = jobs.get(`${d.technicianFsmId}|${d.date}`);
    return {
      ...d,
      name: tech.name,
      teamName: teamNameOf(roster, tech),
      firstJobAt: job?.first ?? null,
      lastJobAt: job?.last ?? null,
      jobs: job?.count ?? 0,
    };
  });

  const jobDays = new Map<string, number>();
  for (const r of rows) if (r.jobs > 0) jobDays.set(r.technicianFsmId, (jobDays.get(r.technicianFsmId) ?? 0) + 1);
  const summary: AttendanceSummaryRow[] = summariseAttendance(days)
    .map((s) => {
      const tech = roster.get(s.technicianFsmId)!;
      return { ...s, name: tech.name, teamName: teamNameOf(roster, tech), jobDays: jobDays.get(s.technicianFsmId) ?? 0 };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const needle = (filters.q ?? "").toLowerCase();
  const matches = (r: { name: string; teamName: string }) => !needle || `${r.name} ${r.teamName}`.toLowerCase().includes(needle);

  let pageDays: AttendanceRow[] = [];
  let pageSummary: AttendanceSummaryRow[] = [];
  let total = 0;
  if (filters.view === "summary") {
    const all = summary.filter(matches);
    pageSummary = page(all, paging, Boolean(options.all));
    total = all.length;
  } else {
    const all = rows
      .filter((r) => matches(r) && (!filters.status || r.status === filters.status))
      .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
    pageDays = page(all, paging, Boolean(options.all));
    total = all.length;
  }

  return {
    view: filters.view,
    from,
    to,
    measured,
    lateToleranceMinutes: settings.attendance.lateArrivalToleranceMinutes,
    overall: {
      technicians: summary.length,
      shiftDays: summary.reduce((a, s) => a + s.shiftDays, 0),
      leaveDays: summary.reduce((a, s) => a + s.leaveDays, 0),
      jobDays: summary.reduce((a, s) => a + s.jobDays, 0),
      presentDays: summary.reduce((a, s) => a + s.presentDays, 0),
      lateDays: summary.reduce((a, s) => a + s.lateDays, 0),
      absentDays: summary.reduce((a, s) => a + s.absentDays, 0),
    },
    days: pageDays,
    summary: pageSummary,
    total,
    notes: {
      leaveRecords: input.leave.length,
      holidays: [...input.holidays].length,
      noRestDays: technicians.filter((t) => t.restWeekdays.length === 0).length,
    },
    options: { technicians: technicianOptions(roster), teams: teamOptions(roster) },
    dataAsOf: asOf,
  };
}
