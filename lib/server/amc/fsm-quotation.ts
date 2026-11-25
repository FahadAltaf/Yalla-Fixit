import type { SupabaseClient } from "@supabase/supabase-js";

import { FSM_QUOTATION_NEEDED, fsmQuotationRequired } from "@/lib/amc/call-outs";
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
  /** Chargeable: closing or completing needs the number. */
  required: boolean;
}

/** The number on file and whether this record needs one. */
export async function fsmQuotationState(admin: Admin, kind: FsmQuotationKind, id: string): Promise<FsmQuotationState> {
  const extra = kind === "call_out" ? "coverage" : "total";
  const { data, error } = await admin.from(TABLE[kind]).select(`fsm_quotation_no, ${extra}`).eq("id", id).maybeSingle<Row>();
  if (error) {
    if (missingColumn(error)) return { migrated: false, value: null, required: false };
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
  return { migrated: true, value: str(data.fsm_quotation_no), required };
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

/** Refuses to close a chargeable call out or complete work with no number (DEV-508). */
export async function assertFsmQuotation(admin: Admin, kind: FsmQuotationKind, id: string): Promise<void> {
  const state = await fsmQuotationState(admin, kind, id);
  if (state.migrated && state.required && !state.value) throw new ContractError(FSM_QUOTATION_NEEDED, 409);
}
