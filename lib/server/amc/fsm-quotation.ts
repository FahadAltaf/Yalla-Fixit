import type { SupabaseClient } from "@supabase/supabase-js";

import { FSM_QUOTATION_NEEDED, fsmQuotationRequired } from "@/lib/amc/call-outs";
import { FSM_QUOTATION_SKIP_LABELS, type FsmQuotationSkip, type FsmQuotationSkipKind } from "@/lib/amc/fsm-quotation";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError } from "@/lib/server/amc/contracts";
import { readCharge } from "@/lib/server/amc/visit-charges";

/**
 * DEV-508 (24 Nov 2026): the Zoho FSM quotation number on a chargeable call
 * out or on additional work. A small chargeable call out (no parts, under 2
 * hours) may go ahead on the client's WhatsApp confirmation with no
 * quotation; Finance still needs a quotation number to record the revenue
 * and issue the tax invoice, so the coordinator prepares it in FSM afterwards
 * and records its number here. Required before the call out is closed or the
 * work completed. Only a field: nothing goes to or comes from FSM.
 *
 * Before 20261124110000 the columns are missing: nothing is shown or
 * required (migrated: false).
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };
export type FsmQuotationKind = "call_out" | "additional_work";

const TABLE: Record<FsmQuotationKind, string> = { call_out: "amc_call_outs", additional_work: "amc_additional_works" };
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const missingColumn = (e: { code?: string; message?: string }) => e.code === "42703" || e.code === "PGRST204" || /fsm_quotation/.test(e.message ?? "");

export interface FsmQuotationState {
  migrated: boolean;
  value: string | null;
  /** Chargeable: closing or completing needs the number (or a reason to go without it). */
  required: boolean;
  /** Closed without the number (25 Nov 2026): not chargeable after all, or the number follows. Null before 20261125110000. */
  skip: { kind: FsmQuotationSkipKind; reason: string | null; at: string | null } | null;
  /** The number is still owed: chargeable, none on file, and not marked not chargeable. */
  outstanding: boolean;
}

/* The skip columns are newer than the number (20261125110000): read apart, so a missing column is no error. */
async function readSkip(admin: Admin, kind: FsmQuotationKind, id: string): Promise<FsmQuotationState["skip"]> {
  const { data, error } = await admin.from(TABLE[kind]).select("fsm_quotation_skip, fsm_quotation_skip_reason, fsm_quotation_skip_at").eq("id", id).maybeSingle<Row>();
  if (error || !data || !str(data.fsm_quotation_skip)) return null;
  const k = str(data.fsm_quotation_skip) as FsmQuotationSkipKind;
  return k in FSM_QUOTATION_SKIP_LABELS ? { kind: k, reason: str(data.fsm_quotation_skip_reason), at: str(data.fsm_quotation_skip_at) } : null;
}

/** The number on file and whether this record needs one. */
export async function fsmQuotationState(admin: Admin, kind: FsmQuotationKind, id: string): Promise<FsmQuotationState> {
  const extra = kind === "call_out" ? "coverage" : "total";
  const { data, error } = await admin.from(TABLE[kind]).select(`fsm_quotation_no, ${extra}`).eq("id", id).maybeSingle<Row>();
  if (error) {
    if (missingColumn(error)) return { migrated: false, value: null, required: false, skip: null, outstanding: false };
    throw new ContractError(error.message, 500);
  }
  if (!data) throw new ContractError(kind === "call_out" ? "Call out not found." : "Additional work not found.", 404);
  /* A covered call out can still carry chargeable lines (parts, extra time): those need the number too. */
  const charge = kind === "call_out" ? (await readCharge(admin, "call_out", id).catch(() => ({ charge: null }))).charge : null;
  /* DEV-495: handyman team-hours beyond the free hours are charged (missing column before 20261124120000: none). */
  const extraHours =
    kind === "call_out"
      ? await admin
          .from(TABLE.call_out)
          .select("hours_chargeable")
          .eq("id", id)
          .maybeSingle<Row>()
          .then(({ data: h, error: e }) => (e ? 0 : Number(h?.hours_chargeable ?? 0)))
      : 0;
  const required = fsmQuotationRequired(
    kind === "call_out"
      ? { kind, coverage: extraHours > 0 ? "chargeable" : str(data.coverage), chargeTotal: Number(charge?.total ?? 0) }
      : { kind, workTotal: Number(data.total ?? 0) },
  );
  const value = str(data.fsm_quotation_no);
  const skip = await readSkip(admin, kind, id);
  /* Not chargeable after all: nothing is owed; the number follows: still owed until it is entered. */
  const owed = required && skip?.kind !== "not_chargeable";
  return { migrated: true, value, required: owed, skip, outstanding: owed && !value };
}

export type FsmQuotationFlag = "needed" | "to_follow";

/**
 * For the call out lists (25 Nov 2026): which ones still owe their FSM
 * quotation number, without a read per row. "needed": chargeable (the
 * booking, or handyman hours beyond the free hours) and no number;
 * "to_follow": closed with the number to follow. Parts priced on the visit
 * are not counted here (the call out's own page says so). Columns missing
 * before 20261124110000 / 20261125110000: fewer flags, never an error.
 */
export async function fsmQuotationFlags(admin: Admin, ids: readonly string[]): Promise<Map<string, FsmQuotationFlag>> {
  const flags = new Map<string, FsmQuotationFlag>();
  if (!ids.length) return flags;
  const tries = [
    "id, status, coverage, fsm_quotation_no, hours_chargeable, fsm_quotation_skip",
    "id, status, coverage, fsm_quotation_no, hours_chargeable",
    "id, status, coverage, fsm_quotation_no",
  ];
  for (const columns of tries) {
    const rows: Row[] = [];
    let failed = false;
    for (let i = 0; i < ids.length && !failed; i += 200) {
      const { data, error } = await admin.from(TABLE.call_out).select(columns).in("id", ids.slice(i, i + 200));
      if (error) failed = true;
      else rows.push(...((data ?? []) as unknown as Row[]));
    }
    if (failed) continue;
    for (const r of rows) {
      if (String(r.status) === "cancelled" || str(r.fsm_quotation_no)) continue;
      const skip = str(r.fsm_quotation_skip);
      if (skip === "not_chargeable") continue;
      if (skip === "later") flags.set(String(r.id), "to_follow");
      else if (r.coverage === "chargeable" || Number(r.hours_chargeable ?? 0) > 0) flags.set(String(r.id), "needed");
    }
    return flags;
  }
  return flags;
}

/** Records (or corrects) the number, with who and when. */
export async function setFsmQuotation(admin: Admin, kind: FsmQuotationKind, id: string, value: string, actor: Actor): Promise<void> {
  const number = value.trim().slice(0, 40);
  if (!number) throw new ContractError("Enter the FSM quotation number.", 400);
  const before = await fsmQuotationState(admin, kind, id);
  if (!before.migrated) throw new ContractError("The FSM quotation number needs a database update first (migration 20261124110000). Ask an admin to apply it.", 409);
  if (before.value === number) return;
  const now = new Date().toISOString();
  const { error } = await admin.from(TABLE[kind]).update({ fsm_quotation_no: number, fsm_quotation_at: now, fsm_quotation_by: actor.id, updated_at: now }).eq("id", id);
  if (error) throw new ContractError(error.message, 500);
  await recordAmcAudit(admin, {
    entityType: kind,
    entityId: id,
    eventType: "fsm_quotation_recorded",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { fsmQuotationNo: number, previous: before.value },
  });
}

/**
 * Refuses to close a chargeable call out or complete work with no number
 * (DEV-508), unless a reason to go without it is given (25 Nov 2026). Returns
 * that reason when it is needed, for recordFsmQuotationSkip once the close
 * has gone through; null when nothing is to be recorded.
 */
export async function assertFsmQuotation(admin: Admin, kind: FsmQuotationKind, id: string, skip: FsmQuotationSkip | null = null): Promise<FsmQuotationSkip | null> {
  const state = await fsmQuotationState(admin, kind, id);
  if (!(state.migrated && state.required && !state.value)) return null;
  if (!skip) throw new ContractError(FSM_QUOTATION_NEEDED, 409);
  return skip;
}

/** Keeps why it closed without the number, with who and when, and in the job's history. */
export async function recordFsmQuotationSkip(admin: Admin, kind: FsmQuotationKind, id: string, skip: FsmQuotationSkip, actor: Actor): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from(TABLE[kind])
    .update({ fsm_quotation_skip: skip.kind, fsm_quotation_skip_reason: skip.reason, fsm_quotation_skip_at: now, fsm_quotation_skip_by: actor.id, updated_at: now })
    .eq("id", id);
  /* Before 20261125110000 the reason is kept in the history only. */
  if (error && !(error.code === "42703" || error.code === "PGRST204" || /fsm_quotation_skip/.test(error.message ?? ""))) throw new ContractError(error.message, 500);
  await recordAmcAudit(admin, {
    entityType: kind,
    entityId: id,
    eventType: skip.kind === "not_chargeable" ? "fsm_quotation_not_chargeable" : "fsm_quotation_to_follow",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { kind: skip.kind, label: FSM_QUOTATION_SKIP_LABELS[skip.kind], reason: skip.reason },
  });
}
