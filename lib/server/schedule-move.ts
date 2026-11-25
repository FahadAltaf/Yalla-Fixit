import { canOperateContract } from "@/lib/amc/access";
import { DEFAULT_ORG_TIMEZONE, todayInZone, zonedDateString, zonedHhmm } from "@/lib/scheduling/org-time";
import { moveDayProblem, slotOnDay, type MoveEntriesInput, type MoveEntryResult } from "@/lib/scheduling/move-entries";
import { additionalWorkOwner, performWorkAction, workSlot } from "@/lib/server/amc/additional-works";
import { callOutOwner, performCallOutAction } from "@/lib/server/amc/call-outs";
import { readAmcConfig } from "@/lib/server/amc/config";
import type { ContractGate } from "@/lib/server/amc/contract-access";
import { ContractError } from "@/lib/server/amc/contracts";
import { fieldWorkRights } from "@/lib/server/amc/field-work-access";
import { syncAmcScheduleEntry, type AmcEntryKind } from "@/lib/server/amc/schedule-link";
import { performBoardAction } from "@/lib/server/amc/visits";
import { findLeaveConflicts, findOrCreateDraftVersion, leaveConflictName } from "@/lib/server/schedule-entries";
import type { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Moves entries on the Scheduling board (DEV-393, 25 Nov 2026): to another
 * day, to a new crew, or both, for one entry or several at once. Each entry
 * answers for itself: one that cannot move is reported with the reason and
 * the others still move.
 *
 * An ordinary entry moves from its day's draft to the other day's draft (the
 * day is opened as a draft when nobody has yet), keeps its clock time, and
 * remembers the day it was first planned for. An FSM appointment is
 * rescheduled in FSM when the new day is approved, as any edit is; until then
 * the old day's FSM refresh leaves it alone.
 *
 * AMC work moves through AMC (the record is the source of truth): a PPM visit
 * by the AMC board's move and reassign (service window, original date, crew
 * checks, access lead time), a call out and additional work by scheduling
 * them again on the new day or crew. The board entry then follows.
 */

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;
type Row = Record<string, unknown>;
type Gate = Extract<ContractGate, { ok: true }>;

const EDITABLE = ["draft", "draft_revision"];
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function entryLabel(e: Row): string {
  return str(e.title) || [str(e.fsm_work_order_name), str(e.fsm_appointment_name)].filter(Boolean).join(" · ") || "Entry";
}

const errorText = (e: unknown, fallback: string) => (e instanceof ContractError || e instanceof Error ? e.message : fallback);

/** The column is missing before migration 20261125100000. */
const missingColumn = (e: { code?: string; message?: string } | null) =>
  Boolean(e) && (e!.code === "42703" || e!.code === "PGRST204" || /original_operating_date/.test(e!.message ?? ""));

export async function moveScheduleEntries(
  admin: Admin,
  input: MoveEntriesInput,
  actor: { id: string },
  /* Loaded only when AMC work is among the entries (it needs AMC access). */
  amcGate: () => Promise<ContractGate>,
): Promise<MoveEntryResult[]> {
  const { data: zoneRow } = await admin.from("settings").select("org_timezone").eq("id", 1).maybeSingle();
  const timeZone = (zoneRow?.org_timezone as string | undefined) || DEFAULT_ORG_TIMEZONE;
  const today = todayInZone(timeZone);
  const toDate = input.toDate ?? null;
  const crew = input.technicianFsmIds?.length ? input.technicianFsmIds : null;

  const { data: rows, error } = await admin
    .from("schedule_entries")
    .select("*, schedule_entry_assignments(technician_fsm_id), schedule_versions!inner(id, status, schedule_date)")
    .in("id", input.entryIds);
  if (error) throw new Error(error.message);
  const byId = new Map(((rows ?? []) as Row[]).map((r) => [String(r.id), r]));

  const dayProblem = toDate ? moveDayProblem(toDate, today) : null;
  let gate: Gate | null | undefined;
  const results: MoveEntryResult[] = [];

  for (const entryId of [...new Set(input.entryIds)]) {
    const entry = byId.get(entryId);
    if (!entry) {
      results.push({ entryId, label: "Entry", status: "skipped", reason: "It is no longer on the board." });
      continue;
    }
    const label = entryLabel(entry);
    const amcKind = str(entry.amc_kind) as AmcEntryKind | null;
    const amcId = str(entry.amc_record_id);
    try {
      if (dayProblem) throw new Error(dayProblem);
      if (amcKind && amcId) {
        if (gate === undefined) {
          const g = await amcGate();
          gate = g.ok ? g : null;
        }
        if (!gate) throw new Error("Moving AMC work needs AMC access.");
        await moveAmcWork(gate, amcKind, amcId, { toDate, crew, reason: input.reason ?? null, insideLeadTime: input.insideLeadTime });
        await syncAmcScheduleEntry(admin, amcKind, amcId, actor.id);
        results.push({ entryId, label, status: "moved", amc: true });
        continue;
      }
      await moveOrdinaryEntry(entry);
      results.push({ entryId, label, status: "moved" });
    } catch (e) {
      results.push({ entryId, label, status: "skipped", reason: errorText(e, "It could not be moved."), ...(amcKind ? { amc: true } : {}) });
    }
  }
  return results;

  async function moveOrdinaryEntry(entry: Row) {
    const version = entry.schedule_versions as Row;
    if (!EDITABLE.includes(String(version.status))) {
      throw new Error(`Its day is ${String(version.status).replace(/_/g, " ")}: open that day and create a revision first.`);
    }
    const isNote = entry.entry_type === "free_text";
    const current = ((entry.schedule_entry_assignments as Row[] | null) ?? []).map((a) => String(a.technician_fsm_id));
    const technicians = crew ?? current;
    if (!isNote && technicians.length === 0) throw new Error("An appointment needs at least one technician.");

    const fromDate = String(entry.operating_date);
    const changesDay = Boolean(toDate && toDate !== fromDate);
    const slot = changesDay
      ? slotOnDay({ startAt: String(entry.start_at), endAt: String(entry.end_at), operatingDate: fromDate }, toDate!, timeZone)
      : { startAt: String(entry.start_at), endAt: String(entry.end_at) };

    /* Leave blocks the new day or the new crew, as when the entry is added. */
    if (changesDay || crew) {
      const conflicts = await findLeaveConflicts(admin, technicians, slot.startAt, slot.endAt);
      if (conflicts.length) throw new Error(`On leave then: ${[...new Set(conflicts.map(leaveConflictName))].join(", ")}.`);
    }

    let targetVersionId = String(entry.schedule_version_id);
    if (changesDay) {
      const found = await findOrCreateDraftVersion(admin, toDate!, actor.id, timeZone);
      if (!found) throw new Error("The day is in the past.");
      if (!EDITABLE.includes(found.version.status)) {
        throw new Error(`${toDate} is ${found.version.status.replace(/_/g, " ")}: open that day and create a revision first.`);
      }
      targetVersionId = found.version.id;

      /* A service line can be on one new appointment per day (as when adding). */
      const lines = (entry.fsm_service_line_item_ids as string[] | null) ?? [];
      const waitingForOwnWorkOrder = Boolean(entry.fsm_create_work_order) && !entry.fsm_created_work_order_id;
      if (entry.entry_type === "new_appointment" && lines.length && !waitingForOwnWorkOrder) {
        const { data: siblings, error: sibError } = await admin
          .from("schedule_entries")
          .select("id, fsm_service_line_item_ids, fsm_create_work_order, fsm_created_work_order_id")
          .eq("schedule_version_id", targetVersionId)
          .eq("entry_type", "new_appointment");
        if (sibError) throw new Error(sibError.message);
        const held = ((siblings ?? []) as Row[])
          .filter((s) => !(s.fsm_create_work_order && !s.fsm_created_work_order_id))
          .flatMap((s) => (s.fsm_service_line_item_ids as string[] | null) ?? []);
        if (lines.some((l) => held.includes(l))) throw new Error("Its service lines are already on a new appointment that day.");
      }
    }

    const now = new Date().toISOString();
    const update: Row = { updated_by: actor.id, updated_at: now, needs_sync: true };
    if (changesDay) {
      Object.assign(update, {
        schedule_version_id: targetVersionId,
        operating_date: toDate,
        start_at: slot.startAt,
        end_at: slot.endAt,
        original_operating_date: str(entry.original_operating_date) ?? fromDate,
      });
    }
    let { error: updateError } = await admin.from("schedule_entries").update(update).eq("id", String(entry.id));
    if (updateError && missingColumn(updateError)) {
      delete update.original_operating_date;
      ({ error: updateError } = await admin.from("schedule_entries").update(update).eq("id", String(entry.id)));
    }
    if (updateError) {
      if (updateError.code === "23505") throw new Error("This appointment is already on that day.");
      throw new Error(updateError.message);
    }

    if (crew) {
      const { error: delError } = await admin.from("schedule_entry_assignments").delete().eq("schedule_entry_id", String(entry.id));
      if (delError) throw new Error(delError.message);
      const { error: insError } = await admin
        .from("schedule_entry_assignments")
        .insert(crew.map((t) => ({ schedule_entry_id: String(entry.id), technician_fsm_id: t })));
      if (insError) throw new Error(insError.message);
    }

    await admin.from("schedule_audit_events").insert({
      event_type: changesDay ? "entry_moved" : "entry_updated",
      actor_id: actor.id,
      origin: "portal",
      schedule_version_id: targetVersionId,
      schedule_date: changesDay ? toDate : fromDate,
      affected_entity_type: "schedule_entry",
      affected_entity_id: String(entry.id),
      before_value: { schedule_version_id: entry.schedule_version_id, operating_date: fromDate, start_at: entry.start_at, end_at: entry.end_at, technicians: current },
      after_value: { ...update, technicians, moved_from: changesDay ? fromDate : null },
    });
  }
}

/**
 * One AMC record moved by AMC's own actions, so its rules apply and its
 * history records the change. Throws the AMC message when a rule refuses.
 */
async function moveAmcWork(
  gate: Gate,
  kind: AmcEntryKind,
  id: string,
  change: { toDate: string | null; crew: string[] | null; reason: string | null; insideLeadTime?: boolean },
) {
  const admin = gate.admin;
  const actor = { id: gate.userId, label: gate.label };
  const config = await readAmcConfig(admin);

  if (kind === "ppm") {
    const canChange = (ownerId: string | null) => gate.visits.create || gate.visits.edit || canOperateContract(gate.actor, ownerId);
    if (change.toDate) {
      await performBoardAction(
        admin,
        { action: "move", visitIds: [id], date: change.toDate, reason: change.reason, insideLeadTime: change.insideLeadTime, expiredReason: null },
        actor,
        config,
        canChange,
        gate.canApprove,
      );
    }
    if (change.crew) {
      await performBoardAction(admin, { action: "reassign", visitIds: [id], technicianIds: change.crew, overrideReason: change.reason }, actor, config, canChange, gate.canApprove);
    }
    return;
  }

  /* A call out or additional work: scheduled again, on the new day and/or crew, at the same time and length. */
  const slot =
    kind === "call_out"
      ? await (async () => {
          const { data } = await admin.from("amc_call_outs").select("scheduled_start, scheduled_end, technician_ids").eq("id", id).maybeSingle<Row>();
          return {
            start: str(data?.scheduled_start),
            end: str(data?.scheduled_end),
            technicianIds: Array.isArray(data?.technician_ids) ? (data!.technician_ids as unknown[]).map(String) : [],
          };
        })()
      : await workSlot(admin, id).then((s) => ({ start: s.scheduledStart, end: s.scheduledEnd, technicianIds: s.technicianIds }));
  if (!slot.start || !slot.end) throw new ContractError("It has no time yet: schedule it in AMC first.", 409);
  const date = change.toDate ?? zonedDateString(slot.start, DEFAULT_ORG_TIMEZONE);
  const time = zonedHhmm(slot.start, DEFAULT_ORG_TIMEZONE);
  const durationMinutes = Math.max(15, Math.round((Date.parse(slot.end) - Date.parse(slot.start)) / 60_000));
  const technicianIds = change.crew ?? slot.technicianIds;
  if (!technicianIds.length) throw new ContractError("It has no crew yet: schedule it in AMC first.", 409);

  if (kind === "call_out") {
    const scope = await callOutOwner(admin, id);
    if (!scope.found || !fieldWorkRights(gate, "call_outs", scope.ownerId).edit) throw new ContractError("You cannot change this call out.", 403);
    await performCallOutAction(
      admin,
      id,
      { action: "schedule", date, time, durationMinutes: Math.min(720, durationMinutes), technicianIds, overrideReason: change.reason, insideLeadTime: change.insideLeadTime },
      actor,
      config,
    );
    return;
  }
  const scope = await additionalWorkOwner(admin, id);
  if (!scope.found || !fieldWorkRights(gate, "additional_works", scope.ownerId).edit) throw new ContractError("You cannot change this additional work.", 403);
  await performWorkAction(
    admin,
    id,
    { action: "schedule", date, time, durationMinutes: Math.min(1440, durationMinutes), technicianIds, overrideReason: change.reason, insideLeadTime: change.insideLeadTime },
    actor,
    config,
  );
}
