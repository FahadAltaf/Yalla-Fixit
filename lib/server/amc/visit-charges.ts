import type { SupabaseClient } from "@supabase/supabase-js";

import { servicesForProperty } from "@/components/dashboard/extensions/amc/amc-settings";
import { rateItemFor } from "@/lib/amc/rate-card";
import {
  chargeTotals,
  type ChargeLine,
  type ChargePaymentMode,
  type ChargeStatus,
  type PaymentTiming,
  type PaymentTimingInput,
  type PricedService,
  type VisitCharge,
} from "@/lib/amc/visit-charges";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { rateCardInForce } from "@/lib/server/amc/rate-card";
import { readAmcSettings } from "@/lib/server/amc/settings";

/*
  Visit charges (18 Nov 2026): what a call out or additional work costs the
  client, priced from the rate card, and its one payment, before or after
  the visit. Table amc_visit_charges (migration 20261118130000); before it
  every read is empty and every write says the update is needed.
*/

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };
export type ChargeKind = "call_out" | "additional_work";

const TABLE = "amc_visit_charges";
const OWNER: Record<ChargeKind, "call_out_id" | "additional_work_id"> = { call_out: "call_out_id", additional_work: "additional_work_id" };
const NOT_READY = "Visit charges need the database update 20261118130000 first.";
const notReady = (e: { code?: string; message?: string } | null | undefined) =>
  Boolean(e && (isMissingTable(e) || e.code === "42P01" || e.code === "PGRST205" || /amc_visit_charges/.test(e.message ?? "")));
const fail = (e: { code?: string; message: string }) => (notReady(e) ? new ContractError(NOT_READY, 503) : new ContractError(e.message, e.code === "23514" ? 400 : 500));
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const money = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function mapCharge(r: Row, ref: string | null): VisitCharge {
  const kind: ChargeKind = r.call_out_id ? "call_out" : "additional_work";
  return {
    id: String(r.id),
    contractId: String(r.contract_id),
    kind,
    ownerId: String(r.call_out_id ?? r.additional_work_id),
    ref,
    lines: (Array.isArray(r.lines) ? r.lines : []) as ChargeLine[],
    subtotal: num(r.subtotal),
    vatAmount: num(r.vat_amount),
    total: num(r.total),
    status: r.status as ChargeStatus,
    paymentTiming: (str(r.payment_timing) as PaymentTiming | null) ?? null,
    paymentTimingReason: str(r.payment_timing_reason),
    paidAmount: money(r.paid_amount),
    paidOn: str(r.paid_on),
    paymentMode: (str(r.payment_mode) as ChargePaymentMode | null) ?? null,
    paymentReference: str(r.payment_reference),
    paymentNote: str(r.payment_note),
    recordedAt: str(r.recorded_at),
    createdAt: String(r.created_at),
  };
}

/** The call out's or additional work's charge; ready is false before the migration. */
export async function readCharge(admin: Admin, kind: ChargeKind, id: string): Promise<{ charge: VisitCharge | null; ready: boolean }> {
  const { data, error } = await admin.from(TABLE).select("*").eq(OWNER[kind], id).maybeSingle<Row>();
  if (error) {
    if (notReady(error)) return { charge: null, ready: false };
    throw fail(error);
  }
  return { charge: data ? mapCharge(data, null) : null, ready: true };
}

/** The services the office can pick for a contract's property, priced from the rate card in force. */
export async function priceList(admin: Admin, contractId: string): Promise<PricedService[]> {
  const { data: c } = await admin.from("amc_contracts").select("property").eq("id", contractId).maybeSingle<Row>();
  const property = (c?.property ?? {}) as Row;
  const chain = [str(property.propertyType), str(property.unitType)];
  const [card, settings] = await Promise.all([rateCardInForce(admin), readAmcSettings(admin)]);
  return servicesForProperty(settings, chain).map((s) => {
    const item = card ? rateItemFor(card.card, s.id, chain) : null;
    return { serviceId: s.id, label: s.label, unit: item?.unit ?? s.unitOfMeasure ?? null, rate: item ? item.standardRate : null };
  });
}

async function upsertCharge(admin: Admin, kind: ChargeKind, id: string, contractId: string, fields: Row, actor: Actor) {
  const existing = await readCharge(admin, kind, id);
  if (!existing.ready) throw new ContractError(NOT_READY, 503);
  const now = new Date().toISOString();
  if (existing.charge) {
    const { error } = await admin.from(TABLE).update({ ...fields, updated_at: now }).eq("id", existing.charge.id);
    if (error) throw fail(error);
  } else {
    const { error } = await admin.from(TABLE).insert({ ...fields, [OWNER[kind]]: id, contract_id: contractId, created_by: actor.id });
    if (error) throw fail(error);
  }
  return (await readCharge(admin, kind, id)).charge;
}

/**
 * A call out's services and price: each line from the rate card (its card
 * price kept beside the one used), charged or free. Kept as they are once
 * the charge is paid.
 */
export async function saveCallOutServices(admin: Admin, id: string, lines: ChargeLine[], actor: Actor) {
  const { data: o, error } = await admin.from("amc_call_outs").select("id, call_out_no, contract_id, status").eq("id", id).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!o) throw new ContractError("Call out not found.", 404);
  if (o.status === "closed" || o.status === "cancelled") throw new ContractError(`Call out ${String(o.call_out_no)} is ${String(o.status)}: its services are kept as they are.`, 409);
  const existing = await readCharge(admin, "call_out", id);
  if (existing.charge?.status === "paid") throw new ContractError("The charge is paid: its services are kept as they are.", 409);
  const prices = new Map((await priceList(admin, String(o.contract_id))).map((p) => [p.serviceId, p.rate]));
  const kept = lines.map((l) => ({ ...l, cardPrice: l.serviceId ? (prices.get(l.serviceId) ?? null) : null }));
  const totals = chargeTotals(kept);
  const charge = await upsertCharge(
    admin,
    "call_out",
    id,
    String(o.contract_id),
    { lines: kept, subtotal: totals.subtotal, vat_amount: totals.vatAmount, total: totals.total, status: totals.total > 0 ? "due" : "waived" },
    actor,
  );
  await recordAmcAudit(admin, { entityType: "call_out", entityId: id, eventType: "charge_services_saved", actorId: actor.id, actorLabel: actor.label, payload: { total: totals.total, lines: kept.length } });
  return charge;
}

/** An additional work's charge follows its quotation (lines and totals, with the material fee); kept once paid. */
export async function syncWorkCharge(admin: Admin, workId: string, actor: Actor) {
  const { data: w, error } = await admin.from("amc_additional_works").select("id, contract_id, status, quotation_lines, subtotal, vat_amount, total").eq("id", workId).maybeSingle<Row>();
  if (error || !w) return null;
  if (!["approved", "scheduled", "completed", "invoiced", "paid"].includes(String(w.status))) return null;
  const existing = await readCharge(admin, "additional_work", workId);
  if (!existing.ready || existing.charge?.status === "paid") return existing.charge;
  const lines: ChargeLine[] = ((Array.isArray(w.quotation_lines) ? w.quotation_lines : []) as Row[]).map((l) => ({
    serviceId: str(l.serviceId),
    label: String(l.description ?? ""),
    unit: l.kind === "material" ? "material" : null,
    units: Number(l.quantity ?? 1),
    unitPrice: Number(l.unitPrice ?? 0),
    cardPrice: null,
    charged: true,
  }));
  const total = num(w.total);
  return upsertCharge(
    admin,
    "additional_work",
    workId,
    String(w.contract_id),
    { lines, subtotal: num(w.subtotal), vat_amount: num(w.vat_amount), total, status: total > 0 ? "due" : "waived" },
    actor,
  );
}

/** When the visit is started: paid before it, or after it with the reason. */
export async function setPaymentTiming(admin: Admin, chargeId: string, input: PaymentTimingInput, actor: Actor) {
  const { error } = await admin
    .from(TABLE)
    .update({
      payment_timing: input.timing,
      payment_timing_reason: input.timing === "after_visit" ? input.reason?.trim() || null : null,
      timing_set_at: new Date().toISOString(),
      timing_set_by: actor.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", chargeId);
  if (error) throw fail(error);
}

/** The one payment of a charge: the full amount, its date, mode and reference. */
export async function recordChargePayment(
  admin: Admin,
  kind: ChargeKind,
  id: string,
  input: { amount: number; paidOn: string; mode: ChargePaymentMode; reference: string | null; note: string | null },
  actor: Actor,
) {
  const { charge, ready } = await readCharge(admin, kind, id);
  if (!ready) throw new ContractError(NOT_READY, 503);
  if (!charge) throw new ContractError("There is no charge to pay yet: pick the services first.", 409);
  if (charge.status !== "due") throw new ContractError(charge.status === "paid" ? "This charge is already paid." : "There is nothing to pay on this charge.", 409);
  if (Math.abs(input.amount - charge.total) > 0.009) throw new ContractError(`The charge is AED ${charge.total.toFixed(2)} including VAT: record the full amount.`, 400);
  const now = new Date().toISOString();
  const { error } = await admin
    .from(TABLE)
    .update({
      status: "paid",
      paid_amount: input.amount,
      paid_on: input.paidOn,
      payment_mode: input.mode,
      payment_reference: input.reference?.trim() || null,
      payment_note: input.note?.trim() || null,
      recorded_by: actor.id,
      recorded_at: now,
      updated_at: now,
    })
    .eq("id", charge.id)
    .eq("status", "due");
  if (error) throw fail(error);
  await recordAmcAudit(admin, { entityType: kind, entityId: id, eventType: "charge_paid", actorId: actor.id, actorLabel: actor.label, payload: { amount: input.amount, mode: input.mode } });
  return { ok: true as const };
}

/** A contract's visit charges, newest first, each with its call out's or work's number. */
export async function contractCharges(admin: Admin, contractId: string): Promise<{ charges: VisitCharge[]; ready: boolean }> {
  const { data, error } = await admin.from(TABLE).select("*").eq("contract_id", contractId).order("created_at", { ascending: false });
  if (error) {
    if (notReady(error)) return { charges: [], ready: false };
    throw fail(error);
  }
  const rows = (data ?? []) as Row[];
  const callOutIds = rows.map((r) => str(r.call_out_id)).filter((v): v is string => Boolean(v));
  const workIds = rows.map((r) => str(r.additional_work_id)).filter((v): v is string => Boolean(v));
  const [outs, works] = await Promise.all([
    callOutIds.length ? admin.from("amc_call_outs").select("id, call_out_no").in("id", callOutIds) : Promise.resolve({ data: [] as Row[] }),
    workIds.length ? admin.from("amc_additional_works").select("id, work_no").in("id", workIds) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const refs = new Map<string, string>([
    ...((outs.data ?? []) as Row[]).map((o) => [String(o.id), String(o.call_out_no)] as [string, string]),
    ...((works.data ?? []) as Row[]).map((w) => [String(w.id), String(w.work_no)] as [string, string]),
  ]);
  return { ready: true, charges: rows.map((r) => mapCharge(r, refs.get(String(r.call_out_id ?? r.additional_work_id)) ?? null)) };
}
