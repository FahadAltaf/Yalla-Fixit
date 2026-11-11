import type { SupabaseClient } from "@supabase/supabase-js";

import { todayInDubai } from "@/lib/amc/contracts";
import {
  FIELD_VISIT_STAGES,
  LATE_CAPABLE_STAGES,
  OPEN_FIELD_VISIT_STAGES,
  fieldVisitStatusLabel,
  isFieldVisitLate,
  type FieldVisitKind,
  type FieldVisitStage,
  type FieldVisitWhen,
} from "@/lib/amc/field-visits";
import { addDays } from "@/lib/amc/ppm";
import { safeTerm } from "@/lib/server/amc/business";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";

/*
  AMC -> Visits: the list of every AMC visit, read from the amc_field_visits
  view (migration 20261111100000). One page per request, filtered and
  counted in the database; the page's crew names and services are read in
  two batched queries for that page only.
*/

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

const VIEW = "amc_field_visits";
const COLUMNS =
  "kind, id, ref, visit_no, contract_id, contract_number, customer_id, customer_name, property_id, property_label, status, stage, day, due_on, " +
  "scheduled_start, scheduled_end, window_start, window_end, technician_ids, lead_technician_id, priority, coverage, trade, summary, client_confirmation, access_status";

export interface FieldVisitRow {
  kind: FieldVisitKind;
  id: string;
  ref: string;
  visitNo: number | null;
  contractId: string | null;
  contractNumber: string | null;
  customerId: string | null;
  customerName: string;
  propertyId: string | null;
  propertyLabel: string;
  status: string;
  statusLabel: string;
  stage: FieldVisitStage;
  /** The Dubai day it is planned for. */
  day: string;
  /** The last acceptable day, when there is one. */
  dueOn: string | null;
  late: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  crew: Array<{ id: string; name: string; lead: boolean }>;
  priority: string | null;
  coverage: string | null;
  trade: string | null;
  /** What it is for: the services of a planned visit, the issue of a call out, the finding of additional work. */
  summary: string | null;
  clientConfirmation: string | null;
  accessStatus: string | null;
}

export interface FieldVisitFilters {
  kind?: FieldVisitKind | null;
  /** "open" (default) = every stage still to be done; "all" = no stage filter. */
  stage?: FieldVisitStage | "open" | "all";
  when?: FieldVisitWhen;
  technicianId?: string | null;
  contractId?: string | null;
  customerId?: string | null;
  q?: string | null;
  from: number;
  to: number;
}

/** Who is asking: everyone's visits, or only the ones on their own contracts and site visits. */
export type FieldVisitViewer = { all: true } | { all: false; userId: string };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/* The filters every query of a listing shares (the page, and the per-stage counts). */
function applyFilters<Q extends { eq: any; in: any; or: any; lt: any; gte: any; lte: any; contains: any }>(
  query: Q,
  filters: Omit<FieldVisitFilters, "from" | "to" | "stage">,
  viewer: FieldVisitViewer,
  today: string,
): Q {
  let q = query;
  if (!viewer.all) q = q.or(`owner_id.eq.${viewer.userId},assessor_id.eq.${viewer.userId}`);
  if (filters.kind) q = q.eq("kind", filters.kind);
  if (filters.contractId) q = q.eq("contract_id", filters.contractId);
  if (filters.customerId) q = q.eq("customer_id", filters.customerId);
  if (filters.technicianId) q = q.contains("technician_ids", [filters.technicianId]);
  switch (filters.when) {
    case "overdue":
      q = q.lt("due_on", today).in("stage", LATE_CAPABLE_STAGES as string[]);
      break;
    case "today":
      q = q.eq("day", today);
      break;
    case "week":
      q = q.gte("day", today).lte("day", addDays(today, 6));
      break;
    case "past30":
      q = q.gte("day", addDays(today, -30)).lte("day", today);
      break;
    default:
      break;
  }
  const term = safeTerm(filters.q ?? "");
  if (term) {
    const like = `%${term}%`;
    q = q.or(`ref.ilike.${like},customer_name.ilike.${like},property_label.ilike.${like},summary.ilike.${like},contract_number.ilike.${like}`);
  }
  return q;
}

function stageFilter<Q extends { in: (c: string, v: string[]) => Q; eq: (c: string, v: string) => Q }>(q: Q, stage: FieldVisitFilters["stage"]): Q {
  if (!stage || stage === "open") return q.in("stage", OPEN_FIELD_VISIT_STAGES as string[]);
  if (stage === "all") return q;
  return q.eq("stage", stage);
}

export async function listFieldVisits(
  admin: Admin,
  filters: FieldVisitFilters,
  viewer: FieldVisitViewer,
): Promise<{ migrated: boolean; visits: FieldVisitRow[]; total: number; stageCounts: Record<FieldVisitStage, number>; today: string }> {
  const today = todayInDubai();
  const emptyCounts = Object.fromEntries(FIELD_VISIT_STAGES.map((s) => [s, 0])) as Record<FieldVisitStage, number>;
  /* Open work soonest first; finished or everything, newest first. */
  const ascending = !filters.stage || filters.stage === "open" || OPEN_FIELD_VISIT_STAGES.includes(filters.stage as FieldVisitStage);

  const page = stageFilter(applyFilters(admin.from(VIEW).select(COLUMNS, { count: "exact" }), filters, viewer, today), filters.stage)
    .order("day", { ascending })
    .order("ref", { ascending: true })
    .range(filters.from, filters.to);
  /* How many in each stage under the same filters, for the stage filter's labels: one small count per stage, in parallel. */
  const counts = FIELD_VISIT_STAGES.map((stage) =>
    applyFilters(admin.from(VIEW).select("id", { count: "exact", head: true }), filters, viewer, today).eq("stage", stage),
  );
  const [pageRes, ...countRes] = await Promise.all([page, ...counts]);
  if (pageRes.error) {
    if (isMissingTable(pageRes.error)) return { migrated: false, visits: [], total: 0, stageCounts: emptyCounts, today };
    throw new ContractError(pageRes.error.message, 500);
  }
  const rows = (pageRes.data ?? []) as unknown as Row[];
  const stageCounts = Object.fromEntries(FIELD_VISIT_STAGES.map((s, i) => [s, countRes[i]?.count ?? 0])) as Record<FieldVisitStage, number>;

  const visits = await enrichRows(admin, rows, today);

  return { migrated: true, visits, total: pageRes.count ?? visits.length, stageCounts, today };
}

/* Rows of the view as the screens read them: the crew's names and a planned visit's services, in two batched reads for these rows only. */
async function enrichRows(admin: Admin, rows: Row[], today: string): Promise<FieldVisitRow[]> {
  const techIds = [...new Set(rows.flatMap((r) => (Array.isArray(r.technician_ids) ? (r.technician_ids as string[]) : [])))];
  const ppmIds = rows.filter((r) => r.kind === "ppm").map((r) => String(r.id));
  const [techs, lines] = await Promise.all([
    techIds.length ? admin.from("technician_reference").select("fsm_resource_id, display_name").in("fsm_resource_id", techIds) : Promise.resolve({ data: [] as Row[] }),
    ppmIds.length
      ? admin.from("amc_visit_lines").select("visit_id, service_label, occurrence").in("visit_id", ppmIds).neq("status", "cancelled").order("occurrence")
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const techName = new Map(((techs.data ?? []) as Row[]).map((t) => [String(t.fsm_resource_id), String(t.display_name ?? "")]));
  const servicesOf = new Map<string, string[]>();
  for (const l of (lines.data ?? []) as Row[]) {
    const list = servicesOf.get(String(l.visit_id)) ?? [];
    const label = String(l.service_label ?? "");
    if (label && !list.includes(label)) list.push(label);
    servicesOf.set(String(l.visit_id), list);
  }

  return rows.map((r): FieldVisitRow => {
    const kind = r.kind as FieldVisitKind;
    const stage = r.stage as FieldVisitStage;
    const lead = str(r.lead_technician_id);
    const ids = Array.isArray(r.technician_ids) ? (r.technician_ids as string[]) : [];
    const dueOn = str(r.due_on);
    return {
      kind,
      id: String(r.id),
      ref: String(r.ref ?? ""),
      visitNo: r.visit_no === null || r.visit_no === undefined ? null : Number(r.visit_no),
      contractId: str(r.contract_id),
      contractNumber: str(r.contract_number),
      customerId: str(r.customer_id),
      customerName: String(r.customer_name ?? ""),
      propertyId: str(r.property_id),
      propertyLabel: String(r.property_label ?? ""),
      status: String(r.status),
      statusLabel: fieldVisitStatusLabel(kind, String(r.status)),
      stage,
      day: String(r.day),
      dueOn,
      late: isFieldVisitLate({ stage, dueOn }, today),
      scheduledStart: str(r.scheduled_start),
      scheduledEnd: str(r.scheduled_end),
      windowStart: str(r.window_start),
      windowEnd: str(r.window_end),
      /* The lead first. */
      crew: [...ids].sort((a, b) => (a === lead ? -1 : b === lead ? 1 : 0)).map((id) => ({ id, name: techName.get(id) || "Technician", lead: id === lead })),
      priority: str(r.priority),
      coverage: str(r.coverage),
      trade: str(r.trade),
      summary: kind === "ppm" ? (servicesOf.get(String(r.id)) ?? []).join(", ") || null : str(r.summary),
      clientConfirmation: str(r.client_confirmation),
      accessStatus: str(r.access_status),
    };
  });
}

/** One visit by id, as the list shows it (the visit page's header), or null when it does not exist or the viewer may not see it. */
export async function getFieldVisit(admin: Admin, id: string, viewer: FieldVisitViewer): Promise<FieldVisitRow | null> {
  let q = admin.from(VIEW).select(COLUMNS).eq("id", id);
  if (!viewer.all) q = q.or(`owner_id.eq.${viewer.userId},assessor_id.eq.${viewer.userId}`);
  const { data, error } = await q.limit(1);
  if (error) {
    if (isMissingTable(error)) throw new ContractError("The visits view is not on this database yet (migration 20261111100000).", 503);
    throw new ContractError(error.message, 500);
  }
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return null;
  const [row] = await enrichRows(admin, rows, todayInDubai());
  return row;
}

export interface FieldVisitHistoryItem {
  at: string;
  /** status: a status change; schedule: a date change; attempt: a confirmation attempt; review: the job sheet; event: anything else recorded. */
  type: "status" | "schedule" | "attempt" | "review" | "event";
  title: string;
  detail: string | null;
  actorLabel: string | null;
  /** portal, client, system or database. */
  origin: string | null;
}

const words = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const dayText = (d: unknown) =>
  typeof d === "string" && d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(`${d}T12:00:00Z`)) : null;
const JOB_SHEET_STATUS: Record<string, string> = { draft: "Draft", submitted: "Submitted for review", returned: "Returned", closed: "Closed" };
const ATTEMPT_OUTCOME: Record<string, string> = {
  message_sent: "message sent",
  no_answer: "no answer",
  confirmed: "confirmed",
  reschedule_requested: "asked to reschedule",
  declined: "declined",
};

/**
 * Everything that happened to a visit, newest first, from the records that
 * already keep it: status changes (written by the database or the server),
 * other recorded events, and for a planned visit its date changes,
 * confirmation attempts and job sheet decisions. Read when the History tab
 * opens, not with the page.
 */
export async function fieldVisitHistory(admin: Admin, kind: FieldVisitKind, id: string): Promise<FieldVisitHistoryItem[]> {
  const entityType = kind === "ppm" ? "visit" : kind === "call_out" ? "call_out" : kind === "additional_work" ? "additional_work" : "assessment";
  const [events, changes, attempts, sheet] = await Promise.all([
    admin
      .from("amc_audit_events")
      .select("event_type, payload, justification, actor_label, origin, created_at")
      .eq("entity_type", entityType)
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(300),
    kind === "ppm"
      ? admin.from("amc_visit_changes").select("change_type, from_date, to_date, reason, actor_label, created_at").eq("visit_id", id).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as Row[] }),
    kind === "ppm"
      ? admin.from("amc_visit_attempts").select("attempt_no, channel, outcome, note, actor_label, attempted_at").eq("visit_id", id).order("attempted_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as Row[] }),
    kind === "ppm" ? admin.from("amc_visit_job_sheets").select("id").eq("visit_id", id).maybeSingle<Row>() : Promise.resolve({ data: null as Row | null }),
  ]);
  if (events.error) throw new ContractError(events.error.message, 500);
  const sheetEvents = sheet.data?.id
    ? await admin
        .from("amc_audit_events")
        .select("event_type, payload, justification, actor_label, origin, created_at")
        .eq("entity_type", "job_sheet")
        .eq("entity_id", String(sheet.data.id))
        .eq("event_type", "status_changed")
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [] as Row[] };

  const items: FieldVisitHistoryItem[] = [];
  for (const e of (events.data ?? []) as Row[]) {
    const payload = (e.payload ?? {}) as Row;
    if (e.event_type === "status_changed") {
      const from = str(payload.from);
      const to = String(payload.to ?? "");
      items.push({
        at: String(e.created_at),
        type: "status",
        title: from ? `${fieldVisitStatusLabel(kind, from)} → ${fieldVisitStatusLabel(kind, to)}` : fieldVisitStatusLabel(kind, to),
        detail: str(e.justification),
        actorLabel: str(e.actor_label),
        origin: str(e.origin),
      });
    } else {
      items.push({ at: String(e.created_at), type: "event", title: words(String(e.event_type)), detail: str(e.justification), actorLabel: str(e.actor_label), origin: str(e.origin) });
    }
  }
  for (const c of (changes.data ?? []) as Row[]) {
    const from = dayText(c.from_date);
    const to = dayText(c.to_date);
    items.push({
      at: String(c.created_at),
      type: "schedule",
      title: `${words(String(c.change_type))}${from && to && from !== to ? `: ${from} → ${to}` : to ? `: ${to}` : ""}`,
      detail: str(c.reason),
      actorLabel: str(c.actor_label),
      origin: null,
    });
  }
  for (const a of (attempts.data ?? []) as Row[]) {
    items.push({
      at: String(a.attempted_at),
      type: "attempt",
      title: `Confirmation attempt ${Number(a.attempt_no)} by ${words(String(a.channel))}: ${ATTEMPT_OUTCOME[String(a.outcome)] ?? words(String(a.outcome))}`,
      detail: str(a.note),
      actorLabel: str(a.actor_label),
      origin: null,
    });
  }
  for (const e of (sheetEvents.data ?? []) as Row[]) {
    const payload = (e.payload ?? {}) as Row;
    const to = String(payload.to ?? "");
    items.push({
      at: String(e.created_at),
      type: "review",
      title: `Job sheet: ${JOB_SHEET_STATUS[to] ?? words(to)}`,
      detail: str(e.justification),
      actorLabel: str(e.actor_label),
      origin: str(e.origin),
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** The active technicians, for the list's technician filter. */
export async function fieldVisitTechnicians(admin: Admin): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await admin.from("technician_reference").select("fsm_resource_id, display_name").eq("is_active", true).order("display_name");
  if (error) throw new ContractError(error.message, 500);
  return ((data ?? []) as Row[]).map((t) => ({ id: String(t.fsm_resource_id), name: String(t.display_name ?? "") }));
}
