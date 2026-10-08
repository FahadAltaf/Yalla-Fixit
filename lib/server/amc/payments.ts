import type { SupabaseClient } from "@supabase/supabase-js";

import type { AmcConfig } from "@/lib/amc/config";
import { fillTemplate, whatsappUrl } from "@/lib/amc/approval-ladder";
import { termMonthsBetween, todayInDubai } from "@/lib/amc/contracts";
import { templateText } from "@/lib/amc/message-templates";
import {
  buildSchedule,
  checkAmount,
  daysBetween,
  gateOpen,
  instalmentStatus,
  outstandingOf,
  summarizeBalance,
  type BalanceSummary,
  type ChequeStatus,
  type InstalmentStatus,
  type PaymentAction,
  type PaymentMode,
} from "@/lib/amc/payments";
import { planFromLegacyTerms, type CustomPlan, type PaymentPlan } from "@/lib/amc/proposal-rules";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { prospectBecomesClient, setContractStatus } from "@/lib/server/amc/contract-state";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { notifyContractEvent, notifyUsers } from "@/lib/server/amc/notifications";
import { ensurePpmSchedule } from "@/lib/server/amc/ppm";
import { recordSend } from "@/lib/server/amc/proposal-share";
import { closeAmcTodos, openAmcTodo } from "@/lib/server/amc/todos";
import { sendEmail } from "@/lib/server/send-email";

/**
 * AMC payments on the server (Phase 7: DEV-352, 382, 383, 384, 386, Email
 * 4 and to-do 6). Rules are in lib/amc/payments.ts; routes check the caller
 * (who may record, bounce, write off, override) before calling these.
 *
 * An instalment's status is never typed in: it is worked out again from
 * its payments, its live cheque and the date every time money moves (and
 * by the daily sweep), except Written Off and Waived, which a person sets.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

const NOT_MIGRATED = "Payments are not set up on this database yet (migration 20261008100000).";
const notMigrated = (error: { code?: string } | null | undefined) =>
  isMissingTable(error) || error?.code === "42703" || error?.code === "PGRST204";
function fail(error: { code?: string; message: string }): ContractError {
  if (notMigrated(error)) return new ContractError(NOT_MIGRATED, 503);
  return new ContractError(error.message, error.code === "23514" ? 409 : 400);
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number => Number(v ?? 0) || 0;
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row | undefined) ?? null) : ((v as Row | null) ?? null));
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const aed = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const contractLink = (id: string) => `/extensions/amc-contracts/${id}?tab=payments`;

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export interface InstalmentRecord {
  id: string;
  contractId: string;
  instalmentNo: number;
  label: string;
  dueDate: string;
  amount: number;
  vatAmount: number;
  total: number;
  expectedMode: PaymentMode | null;
  status: InstalmentStatus;
  receivedAmount: number;
  receivedDate: string | null;
  lastReference: string | null;
  statusReason: string | null;
  statusChangedAt: string;
  outstanding: number;
  /** Days past the due date while something is still owed; 0 otherwise. */
  daysOverdue: number;
  reminderCount: number;
  lastReminderAt: string | null;
}

export interface ChequeRecord {
  id: string;
  contractId: string;
  instalmentId: string;
  chequeNo: string;
  bank: string;
  chequeDate: string;
  amount: number;
  status: ChequeStatus;
  custody: string | null;
  depositedOn: string | null;
  clearedOn: string | null;
  bouncedOn: string | null;
  bounceReason: string | null;
  bounceCharges: number | null;
  replacesChequeId: string | null;
  statusReason: string | null;
  createdAt: string;
}

export interface PaymentRecord {
  id: string;
  contractId: string;
  instalmentId: string;
  mode: PaymentMode;
  amount: number;
  receivedOn: string;
  reference: string | null;
  valueDate: string | null;
  receiptNo: string | null;
  collectorId: string | null;
  collectorName: string | null;
  handedOverAt: string | null;
  handedOverTo: string | null;
  proofDocumentId: string | null;
  chequeId: string | null;
  notes: string | null;
  recordedByName: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

const INSTALMENT_COLUMNS =
  "id, contract_id, instalment_no, label, due_date, amount, vat_amount, total, expected_mode, status, received_amount, received_date, last_reference, status_reason, status_changed_at, reminder_count, last_reminder_at, due_notified_at, overdue_notified_at";
const CHEQUE_COLUMNS =
  "id, contract_id, instalment_id, cheque_no, bank, cheque_date, amount, status, custody, deposited_on, cleared_on, bounced_on, bounce_reason, bounce_charges, replaces_cheque_id, status_reason, created_at";
const PAYMENT_COLUMNS =
  "id, contract_id, instalment_id, mode, amount, received_on, reference, value_date, receipt_no, collector_id, handed_over_at, handed_over_to, proof_document_id, cheque_id, notes, created_at, voided_at, void_reason, " +
  "collector:user_profile!amc_payments_collector_id_fkey(full_name, email), recorder:user_profile!amc_payments_recorded_by_fkey(full_name, email)";

function mapInstalment(r: Row, today: string): InstalmentRecord {
  const status = r.status as InstalmentStatus;
  const total = num(r.total);
  const receivedAmount = num(r.received_amount);
  const outstanding = outstandingOf({ total, receivedAmount, status });
  const dueDate = String(r.due_date);
  return {
    id: String(r.id),
    contractId: String(r.contract_id),
    instalmentNo: Number(r.instalment_no),
    label: String(r.label),
    dueDate,
    amount: num(r.amount),
    vatAmount: num(r.vat_amount),
    total,
    expectedMode: (str(r.expected_mode) as PaymentMode | null) ?? null,
    status,
    receivedAmount,
    receivedDate: str(r.received_date),
    lastReference: str(r.last_reference),
    statusReason: str(r.status_reason),
    statusChangedAt: String(r.status_changed_at),
    outstanding,
    daysOverdue: outstanding > 0 ? Math.max(0, daysBetween(dueDate, today)) : 0,
    reminderCount: Number(r.reminder_count ?? 0),
    lastReminderAt: str(r.last_reminder_at),
  };
}

function mapCheque(r: Row): ChequeRecord {
  return {
    id: String(r.id),
    contractId: String(r.contract_id),
    instalmentId: String(r.instalment_id),
    chequeNo: String(r.cheque_no),
    bank: String(r.bank),
    chequeDate: String(r.cheque_date),
    amount: num(r.amount),
    status: r.status as ChequeStatus,
    custody: str(r.custody),
    depositedOn: str(r.deposited_on),
    clearedOn: str(r.cleared_on),
    bouncedOn: str(r.bounced_on),
    bounceReason: str(r.bounce_reason),
    bounceCharges: r.bounce_charges === null || r.bounce_charges === undefined ? null : num(r.bounce_charges),
    replacesChequeId: str(r.replaces_cheque_id),
    statusReason: str(r.status_reason),
    createdAt: String(r.created_at),
  };
}

const personName = (v: unknown) => {
  const p = one(v);
  return p ? (str(p.full_name) ?? str(p.email)) : null;
};

function mapPayment(r: Row): PaymentRecord {
  return {
    id: String(r.id),
    contractId: String(r.contract_id),
    instalmentId: String(r.instalment_id),
    mode: r.mode as PaymentMode,
    amount: num(r.amount),
    receivedOn: String(r.received_on),
    reference: str(r.reference),
    valueDate: str(r.value_date),
    receiptNo: str(r.receipt_no),
    collectorId: str(r.collector_id),
    collectorName: personName(r.collector),
    handedOverAt: str(r.handed_over_at),
    handedOverTo: str(r.handed_over_to),
    proofDocumentId: str(r.proof_document_id),
    chequeId: str(r.cheque_id),
    notes: str(r.notes),
    recordedByName: personName(r.recorder),
    createdAt: String(r.created_at),
    voidedAt: str(r.voided_at),
    voidReason: str(r.void_reason),
  };
}

/* ------------------------------------------------------------------ */
/* The contract, as payments need it                                   */
/* ------------------------------------------------------------------ */

const CONTRACT_FACTS =
  "id, status, contract_number, proposal_number, customer_name, customer_id, property_label, start_date, end_date, term_months, grand_total, vat_amount, payment_plan, payment_plan_custom, activated_at, initial_payment_received_at, gate_override_at, gate_override_reason, initial_payment_late_notified_at, " +
  "gate_override_person:user_profile!amc_contracts_gate_override_by_fkey(full_name, email), " +
  "submission:amc_submissions!amc_contracts_submission_id_fkey(id, owner_id, customer, property, payment_plan, payment_plan_custom)";

async function contractFacts(admin: Admin, contractId: string): Promise<Row> {
  const { data, error } = await admin.from("amc_contracts").select(CONTRACT_FACTS).eq("id", contractId).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Contract not found.", 404);
  return data;
}

const ownerOf = (c: Row) => str(one(c.submission)?.owner_id);
const reference = (c: Row) => String(c.contract_number ?? c.proposal_number ?? "");

/** The contract owner and Finance (BRD 6.8 to-do 6; 6.2 payment notifications). */
function recipients(c: Row, config: AmcConfig): string[] {
  return [...new Set([ownerOf(c), ...config.payments.financeUserIds].filter((id): id is string => Boolean(id)))];
}

/** The plan the contract is paid on: its own, else the approved proposal's, else the legacy terms. */
function planOf(c: Row): { plan: PaymentPlan; custom: CustomPlan | null } {
  const s = one(c.submission) ?? {};
  const plan = (str(c.payment_plan) ?? str(s.payment_plan) ?? planFromLegacyTerms(str((s.customer as Row | null)?.paymentTerms))) as PaymentPlan;
  const custom = (Array.isArray(c.payment_plan_custom) ? c.payment_plan_custom : Array.isArray(s.payment_plan_custom) ? s.payment_plan_custom : null) as CustomPlan | null;
  return { plan, custom };
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export interface ContractPayments {
  migrated: boolean;
  plan: { plan: PaymentPlan; custom: CustomPlan | null } | null;
  instalments: InstalmentRecord[];
  cheques: ChequeRecord[];
  payments: PaymentRecord[];
  summary: BalanceSummary;
  gate: {
    /** Waiting for the first instalment (Pending Initial Payment). */
    pending: boolean;
    firstInstalment: InstalmentRecord | null;
    receivedAt: string | null;
    override: { at: string; reason: string; by: string | null } | null;
  };
}

export async function contractPayments(admin: Admin, contractId: string, now = new Date()): Promise<ContractPayments> {
  const today = todayInDubai(now);
  const empty: ContractPayments = {
    migrated: false,
    plan: null,
    instalments: [],
    cheques: [],
    payments: [],
    summary: summarizeBalance([], today),
    gate: { pending: false, firstInstalment: null, receivedAt: null, override: null },
  };
  let c: Row;
  try {
    c = await contractFacts(admin, contractId);
  } catch (error) {
    if (error instanceof ContractError && error.status === 503) return empty;
    throw error;
  }
  const [inst, cheq, pay] = await Promise.all([
    admin.from("amc_instalments").select(INSTALMENT_COLUMNS).eq("contract_id", contractId).order("instalment_no"),
    admin.from("amc_cheques").select(CHEQUE_COLUMNS).eq("contract_id", contractId).order("created_at", { ascending: false }),
    admin.from("amc_payments").select(PAYMENT_COLUMNS).eq("contract_id", contractId).order("received_on", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  for (const r of [inst, cheq, pay]) {
    if (r.error) {
      if (notMigrated(r.error)) return empty;
      throw fail(r.error);
    }
  }
  const instalments = ((inst.data ?? []) as unknown as Row[]).map((r) => mapInstalment(r, today));
  return {
    migrated: true,
    plan: planOf(c),
    instalments,
    cheques: ((cheq.data ?? []) as unknown as Row[]).map(mapCheque),
    payments: ((pay.data ?? []) as unknown as Row[]).map(mapPayment),
    summary: summarizeBalance(instalments, today),
    gate: {
      pending: c.status === "pending_initial_payment",
      firstInstalment: instalments[0] ?? null,
      receivedAt: str(c.initial_payment_received_at),
      override: c.gate_override_at
        ? { at: String(c.gate_override_at), reason: String(c.gate_override_reason ?? ""), by: personName(c.gate_override_person) }
        : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* The schedule (DEV-382)                                              */
/* ------------------------------------------------------------------ */

/**
 * Makes the contract's payment schedule (BRD 5.8: on activation). Returns
 * the first instalment so activation knows whether the gate is open.
 * Idempotent: a contract that has one keeps it -- unless `replaceUnpaid`
 * and nothing has been received or handed over against it yet (a contract
 * activated again with other dates). On a database without the payments
 * tables it does nothing, and activation behaves as before Phase 7.
 */
export async function createSchedule(
  admin: Admin,
  input: { contractId: string; commencementDate: string; termMonths: number; replaceUnpaid?: boolean },
  actor: Actor,
  config: AmcConfig,
  now = new Date(),
): Promise<{ migrated: boolean; created: boolean; first: { total: number; status: InstalmentStatus } | null }> {
  const today = todayInDubai(now);
  const { data: existing, error } = await admin
    .from("amc_instalments")
    .select("id, instalment_no, total, status")
    .eq("contract_id", input.contractId)
    .order("instalment_no");
  if (error) {
    if (notMigrated(error)) return { migrated: false, created: false, first: null };
    throw fail(error);
  }
  if (existing?.length) {
    const firstRow = existing[0] as Row;
    const first = { total: num(firstRow.total), status: firstRow.status as InstalmentStatus };
    if (!input.replaceUnpaid) return { migrated: true, created: false, first };
    const [{ count: paid }, { count: cheques }] = await Promise.all([
      admin.from("amc_payments").select("id", { count: "exact", head: true }).eq("contract_id", input.contractId),
      admin.from("amc_cheques").select("id", { count: "exact", head: true }).eq("contract_id", input.contractId),
    ]);
    if ((paid ?? 0) > 0 || (cheques ?? 0) > 0) return { migrated: true, created: false, first };
    const { error: clearError } = await admin.from("amc_instalments").delete().eq("contract_id", input.contractId);
    if (clearError) throw fail(clearError);
  }

  const c = await contractFacts(admin, input.contractId);
  const { plan, custom } = planOf(c);
  const rows = buildSchedule({
    plan,
    custom,
    grandTotal: num(c.grand_total),
    vatAmount: c.vat_amount === null || c.vat_amount === undefined ? null : num(c.vat_amount),
    activationDate: today,
    commencementDate: input.commencementDate,
    termMonths: input.termMonths,
  });
  const dueSoon = config.payments.dueReminderDaysBefore;
  const insert = rows.map((r) => ({
    contract_id: input.contractId,
    instalment_no: r.instalmentNo,
    label: r.label,
    due_date: r.dueDate,
    amount: r.amount,
    vat_amount: r.vatAmount,
    total: r.total,
    status: instalmentStatus({ total: r.total, receivedAmount: 0, dueDate: r.dueDate, cheque: "none", manual: null }, today, dueSoon),
  }));
  const { error: insertError } = await admin.from("amc_instalments").insert(insert);
  if (insertError) throw fail(insertError);
  await admin
    .from("amc_contracts")
    .update({ payment_plan: plan, payment_plan_custom: custom, updated_at: now.toISOString() })
    .eq("id", input.contractId);
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: input.contractId,
    eventType: "payment_schedule_created",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { plan, instalments: rows.length, total: num(c.grand_total) },
  });
  return { migrated: true, created: true, first: { total: insert[0]?.total ?? 0, status: insert[0]?.status ?? "due" } };
}

/**
 * The older one-step activation (a signed proposal with no contract yet,
 * POST /api/amc-contracts) ends where the lifecycle's does: a schedule,
 * and the contract waiting for its first instalment. Starting before it is
 * the override on the contract's Payments tab.
 */
export async function gateAfterOneStepActivation(admin: Admin, contractId: string, actor: Actor, config: AmcConfig, now = new Date()) {
  const c = await contractFacts(admin, contractId);
  if (c.status !== "active" || !c.start_date) return { status: String(c.status) };
  const term = Number(c.term_months) || termMonthsBetween(String(c.start_date), String(c.end_date)) || 12;
  const made = await createSchedule(admin, { contractId, commencementDate: String(c.start_date), termMonths: term }, actor, config, now);
  if (!made.migrated || gateOpen(made.first, false)) {
    await ensurePpmSchedule(admin, contractId, actor, config);
    return { status: "active" };
  }
  await setContractStatus(admin, contractId, "active", "pending_initial_payment", {}, actor, "Waiting for the first instalment");
  await notifyUsers(admin, {
    event: "initial_payment_pending",
    userIds: recipients(c, config),
    title: `Contract ${reference(c)} is waiting for its first payment`,
    body: `${String(c.customer_name ?? "")}: no visits are released until the first instalment is received.`,
    link: contractLink(contractId),
    entityType: "contract",
    entityId: contractId,
    contractId,
    dedupeKey: `initial_payment_pending:${contractId}:${now.toISOString()}`,
  });
  return { status: "pending_initial_payment" };
}

/* ------------------------------------------------------------------ */
/* Status, worked out again                                            */
/* ------------------------------------------------------------------ */

/**
 * Recomputes one instalment from its payments, its live cheque and the
 * date, and saves it when anything changed. Written Off / Waived stand.
 */
export async function recomputeInstalment(admin: Admin, instalmentId: string, config: AmcConfig, actor: Actor, now = new Date()) {
  const today = todayInDubai(now);
  const { data: row, error } = await admin.from("amc_instalments").select(INSTALMENT_COLUMNS).eq("id", instalmentId).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!row) throw new ContractError("Instalment not found.", 404);
  const [{ data: paid }, { data: cheques }] = await Promise.all([
    admin.from("amc_payments").select("amount, received_on, reference").eq("instalment_id", instalmentId).is("voided_at", null).order("received_on"),
    admin
      .from("amc_cheques")
      .select("status")
      .eq("instalment_id", instalmentId)
      .in("status", ["held", "deposited", "bounced"])
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const payments = (paid ?? []) as Row[];
  const receivedFils = payments.reduce((s, p) => s + Math.round(num(p.amount) * 100), 0);
  const receivedAmount = receivedFils / 100;
  const before = row.status as InstalmentStatus;
  const manual = before === "written_off" || before === "waived" ? before : null;
  const live = (cheques?.[0] as Row | undefined)?.status as "held" | "deposited" | "bounced" | undefined;
  const after = instalmentStatus(
    { total: num(row.total), receivedAmount, dueDate: String(row.due_date), cheque: live ?? "none", manual },
    today,
    config.payments.dueReminderDaysBefore,
  );
  const last = payments[payments.length - 1];
  const changes: Row = {};
  if (after !== before) Object.assign(changes, { status: after, status_changed_at: now.toISOString(), status_changed_by: actor.id });
  if (Math.round(num(row.received_amount) * 100) !== receivedFils) {
    Object.assign(changes, {
      received_amount: receivedAmount,
      received_date: last ? String(last.received_on) : null,
      last_reference: last ? str(last.reference) : null,
    });
  }
  if (Object.keys(changes).length) {
    const { error: saveError } = await admin
      .from("amc_instalments")
      .update({ ...changes, updated_at: now.toISOString() })
      .eq("id", instalmentId);
    if (saveError) throw fail(saveError);
  }
  return { before, after, row: { ...row, ...changes } as Row };
}

/**
 * After money moves on an instalment: its status again, and the initial
 * payment gate (DEV-386) -- once the first instalment is settled, a
 * contract waiting in Pending Initial Payment starts, and the prospect
 * becomes a client. A settled instalment closes its overdue to-do.
 */
async function afterMoneyMoved(admin: Admin, instalmentId: string, config: AmcConfig, actor: Actor, now = new Date()) {
  const { after, row } = await recomputeInstalment(admin, instalmentId, config, actor, now);
  if (after === "received" || after === "written_off" || after === "waived") {
    await closeAmcTodos(admin, { entityType: "instalment", entityId: instalmentId }, { status: "done", reason: "Settled" }).catch(() => 0);
  }
  if (Number(row.instalment_no) !== 1) return { status: after, contractStarted: false };
  const c = await contractFacts(admin, String(row.contract_id));
  if (c.status !== "pending_initial_payment" || !gateOpen({ total: num(row.total), status: after }, false)) {
    return { status: after, contractStarted: false };
  }
  await setContractStatus(
    admin,
    String(c.id),
    "pending_initial_payment",
    "active",
    { initial_payment_received_at: now.toISOString() },
    actor,
    after === "received" ? "First instalment received" : `First instalment ${after === "waived" ? "waived" : "written off"}`,
  );
  await startedFollowUps(admin, c, actor, "First instalment received", config);
  return { status: after, contractStarted: true };
}

/** What happens once a waiting contract starts: the client, the follow-up to-do, the owner told. */
async function startedFollowUps(admin: Admin, c: Row, actor: Actor, reason: string, config: AmcConfig) {
  /* Phase 8: the tentative PPM schedule, now that visits can be released. */
  await ensurePpmSchedule(admin, String(c.id), actor, config);
  await prospectBecomesClient(admin, c.customer_id, actor, `Contract ${reference(c)}: ${reason.toLowerCase()}`);
  await closeAmcTodos(admin, { entityType: "contract", entityId: String(c.id), kind: "contract_follow_up" }, { status: "done", reason }).catch(() => 0);
  await notifyContractEvent(admin, { event: "contract_activated", contractId: String(c.id), actor: { id: actor.id, label: actor.label } }).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function instalmentOf(admin: Admin, contractId: string, instalmentId: string): Promise<Row> {
  const { data, error } = await admin.from("amc_instalments").select(INSTALMENT_COLUMNS).eq("id", instalmentId).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data || String(data.contract_id) !== contractId) throw new ContractError("That instalment is not on this contract.", 404);
  return data;
}

async function chequeOf(admin: Admin, contractId: string, chequeId: string): Promise<Row> {
  const { data, error } = await admin.from("amc_cheques").select(CHEQUE_COLUMNS).eq("id", chequeId).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data || String(data.contract_id) !== contractId) throw new ContractError("That cheque is not on this contract.", 404);
  return data;
}

/** What is still open on an instalment, and what cheques already held or deposited will bring in. */
async function openOn(admin: Admin, i: Row) {
  const status = i.status as InstalmentStatus;
  if (status === "received" || status === "written_off" || status === "waived") {
    throw new ContractError("This instalment is settled.", 409);
  }
  const { data } = await admin.from("amc_cheques").select("amount").eq("instalment_id", String(i.id)).in("status", ["held", "deposited"]);
  const pendingCheques = ((data ?? []) as Row[]).reduce((s, r) => s + num(r.amount), 0);
  return { outstanding: outstandingOf({ total: num(i.total), receivedAmount: num(i.received_amount), status }), pendingCheques };
}

/** A cheque status move that only happens from the given statuses. */
async function moveCheque(admin: Admin, chequeId: string, from: ChequeStatus[], changes: Row) {
  const { data, error } = await admin
    .from("amc_cheques")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", chequeId)
    .in("status", from)
    .select("id");
  if (error) throw fail(error);
  if (!data?.length) throw new ContractError("That cheque has moved on since you opened it. Reload the page.", 409);
}

function chequeInsertError(error: { code?: string; message: string }): ContractError {
  if (error.code === "23505") return new ContractError("That cheque (same bank and number) is already recorded.", 409);
  return fail(error);
}

export async function performPaymentAction(
  admin: Admin,
  contractId: string,
  action: PaymentAction,
  actor: Actor,
  config: AmcConfig,
  now = new Date(),
): Promise<{ ok: true; message?: string; whatsapp?: string | null; outcome?: string }> {
  const c = await contractFacts(admin, contractId);
  const audit = (eventType: string, payload: Row) =>
    recordAmcAudit(admin, { entityType: "contract", entityId: contractId, eventType, actorId: actor.id, actorLabel: actor.label, payload });
  const tell = (event: string, title: string, body: string, key: string) =>
    notifyUsers(admin, {
      event,
      userIds: recipients(c, config).filter((id) => id !== actor.id),
      title,
      body,
      link: contractLink(contractId),
      entityType: "contract",
      entityId: contractId,
      contractId,
      dedupeKey: key,
    });

  switch (action.action) {
    case "record_payment": {
      const i = await instalmentOf(admin, contractId, action.instalmentId);
      const problem = checkAmount(action.amount, await openOn(admin, i));
      if (problem) throw new ContractError(problem, 409);
      if (action.proofDocumentId) await assertContractDocument(admin, contractId, action.proofDocumentId);
      const { data, error } = await admin
        .from("amc_payments")
        .insert({
          contract_id: contractId,
          instalment_id: action.instalmentId,
          mode: action.mode,
          amount: action.amount,
          received_on: action.receivedOn,
          reference: action.reference,
          value_date: action.valueDate ?? null,
          receipt_no: action.receiptNo,
          collector_id: action.collectorId ?? (action.mode === "cash" ? actor.id : null),
          proof_document_id: action.proofDocumentId ?? null,
          notes: action.notes,
          recorded_by: actor.id,
        })
        .select("id")
        .single<Row>();
      if (error) throw fail(error);
      const moved = await afterMoneyMoved(admin, action.instalmentId, config, actor, now);
      await audit("payment_recorded", { paymentId: data.id, instalmentNo: i.instalment_no, mode: action.mode, amount: action.amount });
      await tell(
        "payment_received",
        `Payment received on ${reference(c)}`,
        `${String(c.customer_name ?? "")}: AED ${aed(action.amount)} (${action.mode}) against instalment ${String(i.instalment_no)}.${moved.contractStarted ? " The first instalment is in: the contract is active." : ""}`,
        `payment_received:${String(data.id)}`,
      );
      return { ok: true };
    }
    case "record_cheque": {
      const i = await instalmentOf(admin, contractId, action.instalmentId);
      const problem = checkAmount(action.amount, await openOn(admin, i));
      if (problem) throw new ContractError(problem, 409);
      const { data, error } = await admin
        .from("amc_cheques")
        .insert({
          contract_id: contractId,
          instalment_id: action.instalmentId,
          cheque_no: action.chequeNo,
          bank: action.bank,
          cheque_date: action.chequeDate,
          amount: action.amount,
          custody: action.custody,
          status_reason: action.notes,
          recorded_by: actor.id,
        })
        .select("id")
        .single<Row>();
      if (error) throw chequeInsertError(error);
      await audit("cheque_recorded", { chequeId: data.id, instalmentNo: i.instalment_no, chequeNo: action.chequeNo, amount: action.amount });
      return { ok: true };
    }
    case "cheque_deposit": {
      const ch = await chequeOf(admin, contractId, action.chequeId);
      await moveCheque(admin, action.chequeId, ["held"], { status: "deposited", deposited_on: action.depositedOn });
      await afterMoneyMoved(admin, String(ch.instalment_id), config, actor, now);
      await audit("cheque_deposited", { chequeId: action.chequeId, depositedOn: action.depositedOn });
      return { ok: true };
    }
    case "cheque_clear": {
      const ch = await chequeOf(admin, contractId, action.chequeId);
      await moveCheque(admin, action.chequeId, ["deposited"], { status: "cleared", cleared_on: action.clearedOn });
      const { error } = await admin.from("amc_payments").insert({
        contract_id: contractId,
        instalment_id: String(ch.instalment_id),
        mode: "cheque",
        amount: num(ch.amount),
        received_on: action.clearedOn,
        reference: `Cheque ${String(ch.cheque_no)} (${String(ch.bank)})`,
        cheque_id: action.chequeId,
        recorded_by: actor.id,
      });
      if (error) throw fail(error);
      const moved = await afterMoneyMoved(admin, String(ch.instalment_id), config, actor, now);
      await audit("cheque_cleared", { chequeId: action.chequeId, amount: num(ch.amount) });
      await tell(
        "payment_received",
        `Cheque cleared on ${reference(c)}`,
        `${String(c.customer_name ?? "")}: cheque ${String(ch.cheque_no)} for AED ${aed(num(ch.amount))} cleared.${moved.contractStarted ? " The first instalment is in: the contract is active." : ""}`,
        `payment_received:cheque:${action.chequeId}`,
      );
      return { ok: true };
    }
    case "cheque_bounce": {
      const ch = await chequeOf(admin, contractId, action.chequeId);
      await moveCheque(admin, action.chequeId, ["held", "deposited"], {
        status: "bounced",
        bounced_on: action.bouncedOn,
        bounce_reason: action.reason,
        bounce_charges: action.charges ?? null,
      });
      await afterMoneyMoved(admin, String(ch.instalment_id), config, actor, now);
      await audit("cheque_bounced", { chequeId: action.chequeId, reason: action.reason, charges: action.charges ?? null });
      /* BRD 6.8 to-do 6 covers the bounce too: record the replacement or escalate. */
      const owner = ownerOf(c);
      if (owner) {
        await openAmcTodo(
          admin,
          {
            kind: "installment_overdue",
            entityType: "instalment",
            entityId: String(ch.instalment_id),
            dedupeKey: `installment_overdue:${String(ch.instalment_id)}:bounce:${action.chequeId}`,
            title: `Cheque bounced on ${reference(c)}`,
            description: `${String(c.customer_name ?? "")}: cheque ${String(ch.cheque_no)} (${String(ch.bank)}) for AED ${aed(num(ch.amount))} bounced: ${action.reason}. Get a replacement or record another payment.`,
            ownerId: owner,
            assigneeIds: recipients(c, config),
            dueAt: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
            escalateAt: new Date(now.getTime() + 5 * 86_400_000).toISOString(),
          },
          config,
        ).catch((e) => console.error("[amc:payments] bounce to-do not opened:", e instanceof Error ? e.message : e));
      }
      await notifyUsers(admin, {
        event: "cheque_bounced",
        userIds: recipients(c, config),
        title: `Cheque bounced on ${reference(c)}`,
        body: `${String(c.customer_name ?? "")}: cheque ${String(ch.cheque_no)} for AED ${aed(num(ch.amount))} bounced (${action.reason}).`,
        link: contractLink(contractId),
        entityType: "contract",
        entityId: contractId,
        contractId,
        dedupeKey: `cheque_bounced:${action.chequeId}`,
      });
      return { ok: true };
    }
    case "cheque_replace": {
      const ch = await chequeOf(admin, contractId, action.chequeId);
      if (!["bounced", "held"].includes(String(ch.status))) throw new ContractError("Only a held or bounced cheque can be replaced.", 409);
      const { data, error } = await admin
        .from("amc_cheques")
        .insert({
          contract_id: contractId,
          instalment_id: String(ch.instalment_id),
          cheque_no: action.chequeNo,
          bank: action.bank,
          cheque_date: action.chequeDate,
          amount: action.amount,
          custody: action.custody,
          replaces_cheque_id: action.chequeId,
          recorded_by: actor.id,
        })
        .select("id")
        .single<Row>();
      if (error) throw chequeInsertError(error);
      await moveCheque(admin, action.chequeId, ["bounced", "held"], { status: "replaced", status_reason: `Replaced by cheque ${action.chequeNo}` });
      await afterMoneyMoved(admin, String(ch.instalment_id), config, actor, now);
      await audit("cheque_replaced", { chequeId: action.chequeId, replacementId: data.id, chequeNo: action.chequeNo });
      return { ok: true };
    }
    case "cheque_return": {
      const ch = await chequeOf(admin, contractId, action.chequeId);
      await moveCheque(admin, action.chequeId, ["held", "bounced"], { status: "returned", status_reason: action.reason });
      await afterMoneyMoved(admin, String(ch.instalment_id), config, actor, now);
      await audit("cheque_returned", { chequeId: action.chequeId, reason: action.reason });
      return { ok: true };
    }
    case "void_payment": {
      const { data: p, error } = await admin.from("amc_payments").select("id, contract_id, instalment_id, cheque_id, amount, voided_at").eq("id", action.paymentId).maybeSingle<Row>();
      if (error) throw fail(error);
      if (!p || String(p.contract_id) !== contractId) throw new ContractError("That payment is not on this contract.", 404);
      if (p.voided_at) throw new ContractError("That payment is already void.", 409);
      const { data: voided, error: voidError } = await admin
        .from("amc_payments")
        .update({ voided_at: now.toISOString(), voided_by: actor.id, void_reason: action.reason })
        .eq("id", action.paymentId)
        .is("voided_at", null)
        .select("id");
      if (voidError) throw fail(voidError);
      if (!voided?.length) throw new ContractError("That payment is already void.", 409);
      /* A cleared cheque whose receipt is voided did not, in the end, pay. */
      if (p.cheque_id) await moveCheque(admin, String(p.cheque_id), ["cleared"], { status: "returned", status_reason: `Receipt voided: ${action.reason}` }).catch(() => undefined);
      await afterMoneyMoved(admin, String(p.instalment_id), config, actor, now);
      await audit("payment_voided", { paymentId: action.paymentId, amount: num(p.amount), reason: action.reason });
      return { ok: true };
    }
    case "handover": {
      const { data, error } = await admin
        .from("amc_payments")
        .update({ handed_over_at: now.toISOString(), handed_over_to: action.handedOverTo })
        .eq("id", action.paymentId)
        .eq("contract_id", contractId)
        .eq("mode", "cash")
        .is("handed_over_at", null)
        .is("voided_at", null)
        .select("id");
      if (error) throw fail(error);
      if (!data?.length) throw new ContractError("Only cash not yet handed over can be handed over.", 409);
      await audit("cash_handed_over", { paymentId: action.paymentId, handedOverTo: action.handedOverTo });
      return { ok: true };
    }
    case "write_off":
    case "waive": {
      const i = await instalmentOf(admin, contractId, action.instalmentId);
      if (["received", "written_off", "waived"].includes(String(i.status))) throw new ContractError("This instalment is settled.", 409);
      const to = action.action === "write_off" ? "written_off" : "waived";
      const { data, error } = await admin
        .from("amc_instalments")
        .update({ status: to, status_reason: action.reason, status_changed_at: now.toISOString(), status_changed_by: actor.id, updated_at: now.toISOString() })
        .eq("id", action.instalmentId)
        .eq("status", String(i.status))
        .select("id");
      if (error) throw fail(error);
      if (!data?.length) throw new ContractError("This instalment changed a moment ago. Reload the page.", 409);
      await afterMoneyMoved(admin, action.instalmentId, config, actor, now);
      await audit(to === "written_off" ? "instalment_written_off" : "instalment_waived", { instalmentNo: i.instalment_no, reason: action.reason, outstanding: outstandingOf({ total: num(i.total), receivedAmount: num(i.received_amount), status: i.status as InstalmentStatus }) });
      return { ok: true };
    }
    case "override_gate": {
      if (c.status !== "pending_initial_payment") throw new ContractError("The contract is not waiting for its first payment.", 409);
      await setContractStatus(
        admin,
        contractId,
        "pending_initial_payment",
        "active",
        { gate_override_by: actor.id, gate_override_at: now.toISOString(), gate_override_reason: action.reason },
        actor,
        `Started before the first payment: ${action.reason}`,
      );
      await audit("initial_payment_gate_overridden", { reason: action.reason });
      await startedFollowUps(admin, c, actor, "Started on agreed terms", config);
      return { ok: true };
    }
    case "generate_schedule": {
      if (!["active", "pending_initial_payment", "on_hold"].includes(String(c.status)) || !c.start_date || !c.term_months) {
        throw new ContractError("A schedule is made for an activated contract with its commencement date and term.", 409);
      }
      const made = await createSchedule(admin, { contractId, commencementDate: String(c.start_date), termMonths: Number(c.term_months) }, actor, config, now);
      if (!made.migrated) throw new ContractError(NOT_MIGRATED, 503);
      if (!made.created) throw new ContractError("This contract already has a payment schedule.", 409);
      return { ok: true };
    }
    case "send_reminder": {
      const i = await instalmentOf(admin, contractId, action.instalmentId);
      const sent = await sendInstalmentReminder(admin, c, i, "manual", config, actor, now);
      return { ok: true, outcome: sent.outcome, message: sent.message, whatsapp: sent.whatsapp };
    }
  }
}

/** A proof of transfer is one of the contract's own documents. */
async function assertContractDocument(admin: Admin, contractId: string, documentId: string) {
  const { data } = await admin.from("amc_documents").select("id, level, entity_id").eq("id", documentId).maybeSingle<Row>();
  if (!data || data.level !== "contract" || String(data.entity_id) !== contractId) {
    throw new ContractError("Upload the proof to this contract's documents first.", 400);
  }
}

/* ------------------------------------------------------------------ */
/* Email 4 (instalment due / overdue)                                  */
/* ------------------------------------------------------------------ */

/**
 * Email 4 to the client, copying the owner and Finance, with the WhatsApp
 * text prepared for the coordinator (no payment link until Phase 15).
 * Logged in the send log; never throws for the caller.
 */
export async function sendInstalmentReminder(
  admin: Admin,
  c: Row,
  i: Row,
  kind: "due" | "overdue" | "manual",
  config: AmcConfig,
  actor: Actor,
  now = new Date(),
): Promise<{ outcome: "sent" | "failed" | "no_recipient"; message: string; whatsapp: string | null }> {
  const today = todayInDubai(now);
  const s = one(c.submission) ?? {};
  const customer = (s.customer ?? {}) as Row;
  const property = (s.property ?? {}) as Row;
  const status = i.status as InstalmentStatus;
  const owed = outstandingOf({ total: num(i.total), receivedAmount: num(i.received_amount), status }) || num(i.total);
  const late = String(i.due_date) < today;
  const values = {
    "Client name": str(customer.customerName) ?? String(c.customer_name ?? "") ?? "customer",
    "Contract no": reference(c),
    "Property address": str(property.propertyAddress) ?? String(c.property_label ?? ""),
    "Installment no": String(i.instalment_no),
    Amount: aed(owed),
    "Due state": late ? "was due" : "is due",
    "Due date": fmtDate(String(i.due_date)),
    "Payment line": late
      ? "It is now overdue. Please arrange payment by bank transfer or cheque, quoting the contract number. If you have already paid, please ignore this reminder."
      : "Please arrange payment by bank transfer or cheque, quoting the contract number.",
    "Payment link": "",
    "Coordinator name": "",
  };
  const ownerId = ownerOf(c);
  const { data: owner } = ownerId ? await admin.from("user_profile").select("full_name, email").eq("id", ownerId).maybeSingle<Row>() : { data: null };
  values["Coordinator name"] = str(owner?.full_name) ?? str(owner?.email) ?? "Yalla Fix It";
  const email = templateText("emailInstallmentReminder", config.templates)!;
  const whatsappText = fillTemplate(templateText("messageInstallmentDue", config.templates)!.body, values).trim();
  const to = String(customer.customerEmail ?? "").trim();
  const cc = [...new Set([String(owner?.email ?? ""), ...config.contracts.financeCcEmails].filter(Boolean))].filter((e) => e !== to);
  let outcome: "sent" | "failed" | "no_recipient" = "no_recipient";
  if (to) {
    try {
      const body = fillTemplate(email.body, values);
      const blocks = body.split(/\n{2,}/);
      await sendEmail({
        to,
        ...(cc.length ? { cc } : {}),
        subject: fillTemplate(email.subject ?? "", values),
        html: clientEmailHtml({
          eyebrow: "AMC payment",
          heading: late ? `Instalment ${String(i.instalment_no)} is overdue` : `Instalment ${String(i.instalment_no)} is due`,
          greeting: escapeEmailHtml(blocks[0] ?? ""),
          paragraphs: blocks.slice(1).map((b) => escapeEmailHtml(b).replace(/\n/g, "<br>")),
          details: [],
        }),
      });
      outcome = "sent";
    } catch (e) {
      outcome = "failed";
      console.error("[amc:payments] reminder email failed:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }
  if (s.id) {
    await recordSend(admin, {
      submissionId: String(s.id),
      versionNo: 1,
      document: "instalment_reminder",
      channel: "email",
      recipients: to ? [{ name: values["Client name"], address: to }] : [],
      cc,
      outcome,
      detail: `Instalment ${String(i.instalment_no)} (${kind})`,
      sentBy: actor.id,
    });
  }
  await admin
    .from("amc_instalments")
    .update({ reminder_count: Number(i.reminder_count ?? 0) + 1, last_reminder_at: now.toISOString() })
    .eq("id", String(i.id));
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: String(c.id),
    eventType: "instalment_reminder_sent",
    actorId: actor.id,
    actorLabel: actor.label ?? "Portal",
    origin: actor.id ? undefined : "system",
    payload: { instalmentNo: i.instalment_no, kind, outcome },
  });
  const phone = str(customer.customerPhone);
  return { outcome, message: whatsappText, whatsapp: phone ? whatsappUrl(phone, whatsappText) : null };
}

/* ------------------------------------------------------------------ */
/* The daily sweep (job "payments")                                    */
/* ------------------------------------------------------------------ */

const LIVE_CONTRACT_STATUSES = ["pending_initial_payment", "active", "on_hold", "expired"];

/**
 * Daily: every open instalment's status again; the client reminded (Email
 * 4) and the owner and Finance told when one falls due and when it goes
 * overdue, with the "Instalment overdue" to-do; held cheques whose date is
 * near; and a first payment that is late. Each is claimed with its stamp
 * before anyone is told, so overlapping runs tell once.
 */
export async function runPaymentSweep(admin: Admin, config: AmcConfig, now = new Date()) {
  const result = { checked: 0, due: 0, overdue: 0, chequeAlerts: 0, lateFirstPayments: 0, skipped: null as string | null };
  const today = todayInDubai(now);
  const system: Actor = { id: null, label: "Portal" };

  const { data: open, error } = await admin
    .from("amc_instalments")
    .select(`${INSTALMENT_COLUMNS}, contract:amc_contracts!amc_instalments_contract_id_fkey(${CONTRACT_FACTS})`)
    .not("status", "in", "(received,written_off,waived)")
    .lte("due_date", new Date(Date.parse(`${today}T00:00:00Z`) + (config.payments.dueReminderDaysBefore + 1) * 86_400_000).toISOString().slice(0, 10))
    .order("due_date")
    .limit(500);
  if (error) {
    if (notMigrated(error)) return { ...result, skipped: "not migrated" };
    throw new Error(error.message);
  }

  for (const raw of (open ?? []) as unknown as Row[]) {
    const c = one(raw.contract);
    if (!c || !LIVE_CONTRACT_STATUSES.includes(String(c.status))) continue;
    result.checked += 1;
    let after: InstalmentStatus;
    let row: Row;
    try {
      ({ after, row } = await recomputeInstalment(admin, String(raw.id), config, system, now));
    } catch (e) {
      console.error("[amc:payments] recompute failed:", e instanceof Error ? e.message : e);
      continue;
    }
    const claim = async (stamp: "due_notified_at" | "overdue_notified_at") => {
      const { data } = await admin.from("amc_instalments").update({ [stamp]: now.toISOString() }).eq("id", String(raw.id)).is(stamp, null).select("id");
      return (data ?? []).length > 0;
    };
    const who = recipients(c, config);
    const label = `instalment ${String(row.instalment_no)} of ${reference(c)}`;
    const owed = outstandingOf({ total: num(row.total), receivedAmount: num(row.received_amount), status: after });

    if ((after === "due" || after === "partially_received") && !row.due_notified_at && (await claim("due_notified_at"))) {
      await notifyUsers(admin, {
        event: "instalment_due",
        userIds: who,
        title: `Instalment due: ${reference(c)}`,
        body: `${String(c.customer_name ?? "")}: ${label}, AED ${aed(owed)}, is due on ${fmtDate(String(row.due_date))}.`,
        link: contractLink(String(c.id)),
        entityType: "contract",
        entityId: String(c.id),
        contractId: String(c.id),
        dedupeKey: `instalment_due:${String(raw.id)}`,
      });
      await sendInstalmentReminder(admin, c, row, "due", config, system, now);
      result.due += 1;
    }

    if ((after === "overdue" || after === "bounced") && !row.overdue_notified_at && (await claim("overdue_notified_at"))) {
      const days = Math.max(0, daysBetween(String(row.due_date), today));
      await notifyUsers(admin, {
        event: "instalment_overdue",
        userIds: who,
        title: `Instalment overdue: ${reference(c)}`,
        body: `${String(c.customer_name ?? "")}: ${label}, AED ${aed(owed)}, was due on ${fmtDate(String(row.due_date))} (${days} days).`,
        link: contractLink(String(c.id)),
        entityType: "contract",
        entityId: String(c.id),
        contractId: String(c.id),
        dedupeKey: `instalment_overdue:${String(raw.id)}`,
      });
      const owner = ownerOf(c);
      if (owner) {
        await openAmcTodo(
          admin,
          {
            kind: "installment_overdue",
            entityType: "instalment",
            entityId: String(raw.id),
            dedupeKey: `installment_overdue:${String(raw.id)}`,
            title: `Instalment overdue: ${reference(c)} #${String(row.instalment_no)}`,
            description: `${String(c.customer_name ?? "")}: AED ${aed(owed)} was due on ${fmtDate(String(row.due_date))}. Send a reminder, record the payment, a bounce or a replacement, or escalate.`,
            ownerId: owner,
            assigneeIds: who,
            dueAt: new Date(now.getTime() + 86_400_000).toISOString(),
            escalateAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
          },
          config,
        ).catch((e) => console.error("[amc:payments] overdue to-do not opened:", e instanceof Error ? e.message : e));
      }
      await sendInstalmentReminder(admin, c, row, "overdue", config, system, now);
      result.overdue += 1;
    }
  }

  /* Held cheques whose date is near (BRD 5.8: "alerts go out before a cheque date"). */
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + config.payments.chequeAlertDaysBefore * 86_400_000).toISOString().slice(0, 10);
  const { data: cheques } = await admin
    .from("amc_cheques")
    .select(`${CHEQUE_COLUMNS}, contract:amc_contracts!amc_cheques_contract_id_fkey(${CONTRACT_FACTS})`)
    .eq("status", "held")
    .is("date_alert_sent_at", null)
    .lte("cheque_date", horizon)
    .limit(200);
  for (const ch of (cheques ?? []) as unknown as Row[]) {
    const c = one(ch.contract);
    if (!c) continue;
    const { data: claimed } = await admin.from("amc_cheques").update({ date_alert_sent_at: now.toISOString() }).eq("id", String(ch.id)).is("date_alert_sent_at", null).select("id");
    if (!claimed?.length) continue;
    await notifyUsers(admin, {
      event: "cheque_date_near",
      userIds: recipients(c, config),
      title: `Cheque to deposit: ${reference(c)}`,
      body: `${String(c.customer_name ?? "")}: cheque ${String(ch.cheque_no)} (${String(ch.bank)}) for AED ${aed(num(ch.amount))} is dated ${fmtDate(String(ch.cheque_date))}.`,
      link: contractLink(String(c.id)),
      entityType: "contract",
      entityId: String(c.id),
      contractId: String(c.id),
      dedupeKey: `cheque_date_near:${String(ch.id)}`,
    });
    result.chequeAlerts += 1;
  }

  /* A first payment that is late (DEV-386): the owner and Finance, and the follow-up to-do (6.8 #2). */
  const lateBefore = new Date(now.getTime() - config.payments.lateFirstPaymentDays * 86_400_000).toISOString();
  const { data: waiting } = await admin
    .from("amc_contracts")
    .select(CONTRACT_FACTS)
    .eq("status", "pending_initial_payment")
    .is("initial_payment_late_notified_at", null)
    .lte("activated_at", lateBefore)
    .limit(200);
  for (const c of (waiting ?? []) as unknown as Row[]) {
    const { data: claimed } = await admin
      .from("amc_contracts")
      .update({ initial_payment_late_notified_at: now.toISOString() })
      .eq("id", String(c.id))
      .is("initial_payment_late_notified_at", null)
      .select("id");
    if (!claimed?.length) continue;
    const owner = ownerOf(c);
    await notifyUsers(admin, {
      event: "initial_payment_late",
      userIds: recipients(c, config),
      title: `First payment late: ${reference(c)}`,
      body: `${String(c.customer_name ?? "")}: no first instalment ${config.payments.lateFirstPaymentDays} days after activation. No visits are released until it is received.`,
      link: contractLink(String(c.id)),
      entityType: "contract",
      entityId: String(c.id),
      contractId: String(c.id),
      dedupeKey: `initial_payment_late:${String(c.id)}`,
    });
    if (owner) {
      await openAmcTodo(
        admin,
        {
          kind: "contract_follow_up",
          entityType: "contract",
          entityId: String(c.id),
          dedupeKey: `contract_follow_up:first_payment:${String(c.id)}`,
          title: `First instalment unpaid: ${reference(c)}`,
          description: `${String(c.customer_name ?? "")}: record the payment, or start the contract on agreed terms with a reason.`,
          ownerId: owner,
          assigneeIds: recipients(c, config),
          dueAt: new Date(now.getTime() + 86_400_000).toISOString(),
          escalateAt: new Date(now.getTime() + 5 * 86_400_000).toISOString(),
        },
        config,
      ).catch((e) => console.error("[amc:payments] first-payment to-do not opened:", e instanceof Error ? e.message : e));
    }
    result.lateFirstPayments += 1;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Finance views (DEV-383, 384)                                        */
/* ------------------------------------------------------------------ */

export interface ContractRef {
  id: string;
  contractNumber: string;
  customerName: string;
  customerId: string | null;
  propertyLabel: string;
  status: string;
}

const CONTRACT_REF = "id, contract_number, proposal_number, customer_name, customer_id, property_label, status";
const mapRef = (v: unknown): ContractRef | null => {
  const c = one(v);
  return c
    ? {
        id: String(c.id),
        contractNumber: String(c.contract_number ?? c.proposal_number ?? ""),
        customerName: String(c.customer_name ?? ""),
        customerId: str(c.customer_id),
        propertyLabel: String(c.property_label ?? ""),
        status: String(c.status),
      }
    : null;
};

/** Contracts matching a search, or one client's: ids to filter instalments and cheques by. */
async function contractIdsFor(admin: Admin, filter: { q?: string | null; clientId?: string | null }): Promise<string[] | null> {
  if (!filter.q && !filter.clientId) return null;
  let q = admin.from("amc_contracts").select("id").limit(500);
  if (filter.clientId) q = q.eq("customer_id", filter.clientId);
  const term = (filter.q ?? "").replace(/[,()"'%_*:\\]/g, " ").trim().slice(0, 100);
  if (term) q = q.or(`contract_number.ilike.%${term}%,proposal_number.ilike.%${term}%,customer_name.ilike.%${term}%,property_label.ilike.%${term}%`);
  const { data } = await q;
  return ((data ?? []) as Row[]).map((r) => String(r.id));
}

export type InstalmentFilter = "open" | "overdue" | "due" | "settled" | InstalmentStatus | null;

export async function listInstalments(
  admin: Admin,
  filter: { status?: InstalmentFilter; q?: string | null; clientId?: string | null; from?: number; to?: number },
  now = new Date(),
): Promise<{ migrated: boolean; instalments: Array<InstalmentRecord & { contract: ContractRef | null }>; total: number; summary: BalanceSummary }> {
  const today = todayInDubai(now);
  const ids = await contractIdsFor(admin, filter);
  const emptySummary = summarizeBalance([], today);
  if (ids && ids.length === 0) return { migrated: true, instalments: [], total: 0, summary: emptySummary };
  /* The statuses a filter covers; null = all. */
  const statuses: InstalmentStatus[] | null =
    filter.status === "open"
      ? ["not_due", "due", "partially_received", "overdue", "cheque_deposited", "bounced"]
      : filter.status === "settled"
        ? ["received", "written_off", "waived"]
        : filter.status === "overdue"
          ? ["overdue", "bounced"]
          : filter.status
            ? [filter.status]
            : null;
  const from = filter.from ?? 0;
  const to = filter.to ?? from + 24;
  let page = admin
    .from("amc_instalments")
    .select(`${INSTALMENT_COLUMNS}, contract:amc_contracts!amc_instalments_contract_id_fkey(${CONTRACT_REF})`, { count: "exact" })
    .order("due_date")
    .order("instalment_no")
    .range(from, to);
  if (ids) page = page.in("contract_id", ids);
  if (statuses) page = page.in("status", statuses);
  /* Balance and ageing over everything the filter covers (open money only), bounded. */
  let totals = admin.from("amc_instalments").select("total, received_amount, due_date, status").not("status", "in", "(received,written_off,waived)").limit(5000);
  if (ids) totals = totals.in("contract_id", ids);
  const [{ data, error, count }, { data: open }] = await Promise.all([page, totals]);
  if (error) {
    if (notMigrated(error)) return { migrated: false, instalments: [], total: 0, summary: emptySummary };
    throw fail(error);
  }
  const summary = summarizeBalance(
    ((open ?? []) as Row[]).map((r) => ({ total: num(r.total), receivedAmount: num(r.received_amount), dueDate: String(r.due_date), status: r.status as InstalmentStatus })),
    today,
  );
  return {
    migrated: true,
    instalments: ((data ?? []) as unknown as Row[]).map((r) => ({ ...mapInstalment(r, today), contract: mapRef(r.contract) })),
    total: count ?? 0,
    summary,
  };
}

export async function listCheques(
  admin: Admin,
  filter: { status?: ChequeStatus | null; q?: string | null; clientId?: string | null; from?: number; to?: number },
): Promise<{ migrated: boolean; cheques: Array<ChequeRecord & { contract: ContractRef | null; instalmentNo: number | null }>; total: number }> {
  const ids = await contractIdsFor(admin, filter);
  if (ids && ids.length === 0) return { migrated: true, cheques: [], total: 0 };
  const from = filter.from ?? 0;
  const to = filter.to ?? from + 24;
  let q = admin
    .from("amc_cheques")
    .select(
      `${CHEQUE_COLUMNS}, contract:amc_contracts!amc_cheques_contract_id_fkey(${CONTRACT_REF}), instalment:amc_instalments!amc_cheques_instalment_id_fkey(instalment_no)`,
      { count: "exact" },
    )
    .order("cheque_date")
    .range(from, to);
  if (ids) q = q.in("contract_id", ids);
  if (filter.status) q = q.eq("status", filter.status);
  const { data, error, count } = await q;
  if (error) {
    if (notMigrated(error)) return { migrated: false, cheques: [], total: 0 };
    throw fail(error);
  }
  return {
    migrated: true,
    cheques: ((data ?? []) as unknown as Row[]).map((r) => ({
      ...mapCheque(r),
      contract: mapRef(r.contract),
      instalmentNo: one(r.instalment) ? Number(one(r.instalment)!.instalment_no) : null,
    })),
    total: count ?? 0,
  };
}
