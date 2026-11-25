import { createHash, randomUUID } from "node:crypto";
import type { FsmQuotationSkip } from "@/lib/amc/fsm-quotation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { whatsappUrl } from "@/lib/amc/approval-ladder";
import { approversForLevel, type AmcConfig } from "@/lib/amc/config";
import { TRADE_LABELS } from "@/lib/amc/client-profile";
import type { FieldStartKind } from "@/lib/amc/field-start";
import { reportDueAt, reportState, reviewReasons, submitProblems, LINE_OUTCOME_LABELS, OUTCOME_GROUPS, type JobSheetInput, type LineOutcome, type OutcomeGroup, type ReviewReason } from "@/lib/amc/job-sheets";
import type { VisitStatus } from "@/lib/amc/ppm";
import { initialOutcome, reachedClient, type SendChannel, type SendResult } from "@/lib/amc/send-channels";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { performWorkAction } from "@/lib/server/amc/additional-works";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { performCallOutAction, workPhotos } from "@/lib/server/amc/call-outs";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import type { JobSheetView } from "@/lib/server/amc/job-sheets";
import { propertyAssets } from "@/lib/server/amc/job-sheets";
import { alertCrew } from "@/lib/server/amc/crew-alerts";
import { notifyUsers } from "@/lib/server/amc/notifications";
import { recordSend } from "@/lib/server/amc/proposal-share";
import { buildServiceReportModel, serviceReportTitle, type ServiceReportFacts } from "@/lib/amc/service-report";
import { AMC_DOCUMENTS_BUCKET, renderAmcDocumentHtml, renderPdf } from "@/lib/server/amc/signed-archive";
import { closeAmcTodos, openAmcTodo } from "@/lib/server/amc/todos";
import { sendEmail } from "@/lib/server/send-email";

/*
  The job sheet of a call out or an additional work (18 Nov 2026, phase 2),
  the planned visit's sheet with one owner of another kind: the same table
  (amc_visit_job_sheets, call_out_id / additional_work_id), the same fields,
  review and service report. A call out or additional work has one piece of
  work, so one outcome (work_outcome) where a planned visit has one per
  trade; its photos stay in amc_work_photos. The page and the phone see the
  planned visit's JobSheetView, with the record as its single "line".

  Before 20261118100000 the owner columns are missing: the sheet reads as
  not set up (migrated: false) and nothing can be saved.
*/

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };
export type FieldSheetKind = FieldStartKind;

const OWNER: Record<FieldSheetKind, "call_out_id" | "additional_work_id"> = { call_out: "call_out_id", additional_work: "additional_work_id" };
const TABLE: Record<FieldSheetKind, string> = { call_out: "amc_call_outs", additional_work: "amc_additional_works" };
const NOUN: Record<FieldSheetKind, string> = { call_out: "call out", additional_work: "additional work" };
const NOT_READY = "Job sheets for call outs and additional work need the database update 20261118100000 first.";

const RECORD_COLUMNS: Record<FieldSheetKind, string> = {
  call_out: "id, call_out_no, contract_id, status, priority, trade, issue, scheduled_start, technician_ids, reported_at, started_at, report_document_id, report_sent_at, report_due_at",
  additional_work: "id, work_no, contract_id, status, trade, finding, scheduled_start, scheduled_for, technician_ids, created_at, started_at, report_document_id, report_sent_at, report_due_at",
};
const SHEET_COLUMNS =
  "id, call_out_id, additional_work_id, contract_id, status, arrived_at, completed_at, technician_ids, faults, consumables, additional_work, pending_works, quality_concern, quality_note, client_signature_name, client_signed_at, notes, review_required, review_reasons, submitted_at, submitted_by, reviewed_at, reviewed_by, review_comment, return_count, work_outcome, work_outcome_group, work_outcome_reason";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row | undefined) ?? null) : ((v as Row | null) ?? null));
const missing = (e: { code?: string; message?: string } | null | undefined) =>
  Boolean(e && (isMissingTable(e) || e.code === "42703" || e.code === "PGRST204" || /call_out_id|additional_work_id|work_outcome|report_document_id|started_at/.test(e.message ?? "")));
const fail = (e: { code?: string; message: string }) => (missing(e) ? new ContractError(NOT_READY, 503) : new ContractError(e.message, e.code === "23514" || e.code === "23505" ? 409 : 400));
const fmtDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso));

/** Who reviews: the named supervisors, else the level 1 approvers (as a planned visit's sheet). */
const supervisorsOf = (config: AmcConfig) => (config.scheduling.supervisorUserIds.length ? config.scheduling.supervisorUserIds : approversForLevel(config, 1));

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

async function loadRecord(admin: Admin, kind: FieldSheetKind, id: string): Promise<{ record: Row; contract: Row; ownerId: string | null }> {
  const { data, error } = await admin.from(TABLE[kind]).select(RECORD_COLUMNS[kind]).eq("id", id).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError(kind === "call_out" ? "Call out not found." : "Additional work not found.", 404);
  const { data: contract } = await admin
    .from("amc_contracts")
    .select("id, status, contract_number, proposal_number, customer_name, customer_id, property_label, property_id, customer, submission:amc_submissions!amc_contracts_submission_id_fkey(id, owner_id)")
    .eq("id", String(data.contract_id))
    .maybeSingle<Row>();
  const c = contract ?? {};
  return { record: data, contract: c, ownerId: str(one(c.submission)?.owner_id) };
}

async function loadSheet(admin: Admin, kind: FieldSheetKind, id: string): Promise<Row | null> {
  const { data, error } = await admin.from("amc_visit_job_sheets").select(SHEET_COLUMNS).eq(OWNER[kind], id).maybeSingle<Row>();
  if (error) throw fail(error);
  return data ?? null;
}

const refOf = (kind: FieldSheetKind, r: Row) => String(kind === "call_out" ? r.call_out_no : r.work_no);
const workLabel = (kind: FieldSheetKind, r: Row) => {
  const trade = str(r.trade);
  const tradeLabel = trade ? (TRADE_LABELS[trade as keyof typeof TRADE_LABELS] ?? trade) : null;
  const what = str(kind === "call_out" ? r.issue : r.finding);
  const short = what ? (what.length > 80 ? `${what.slice(0, 77)}…` : what) : null;
  return [kind === "call_out" ? "Call out" : "Additional work", tradeLabel, short].filter(Boolean).join(" · ");
};
const dayOf = (kind: FieldSheetKind, r: Row) =>
  (str(r.scheduled_start) ?? (kind === "additional_work" ? str(r.scheduled_for) : null) ?? str(kind === "call_out" ? r.reported_at : r.created_at) ?? new Date().toISOString()).slice(0, 10);

export type FieldJobSheetView = JobSheetView & { visit: JobSheetView["visit"] & { kind: FieldSheetKind; label: string; ref: string } };

/** The sheet as the page and the phone show a planned visit's. */
export async function fieldJobSheetView(admin: Admin, kind: FieldSheetKind, id: string, now = new Date(), linkSeconds = 600): Promise<FieldJobSheetView> {
  let notSetUp = false;
  let { record, contract } = { record: {} as Row, contract: {} as Row };
  try {
    ({ record, contract } = await loadRecord(admin, kind, id));
  } catch (e) {
    if (!(e instanceof ContractError && e.status === 503)) throw e;
    /* Before the report columns: the record without them. */
    notSetUp = true;
    const base = RECORD_COLUMNS[kind].replace(", started_at, report_document_id, report_sent_at, report_due_at", "");
    const { data } = await admin.from(TABLE[kind]).select(base).eq("id", id).maybeSingle<Row>();
    if (!data) throw new ContractError(kind === "call_out" ? "Call out not found." : "Additional work not found.", 404);
    record = data;
    const { data: c } = await admin.from("amc_contracts").select("id, contract_number, proposal_number, customer_name, property_label, property_id").eq("id", String(data.contract_id)).maybeSingle<Row>();
    contract = c ?? {};
  }
  const sheet = notSetUp
    ? null
    : await loadSheet(admin, kind, id).catch((e: unknown) => {
        if (e instanceof ContractError && e.status === 503) {
          notSetUp = true;
          return null;
        }
        throw e;
      });
  const day = dayOf(kind, record);
  const ref = refOf(kind, record);
  const view: FieldJobSheetView = {
    migrated: !notSetUp,
    visit: {
      id,
      kind,
      ref,
      label: `${NOUN[kind]} ${ref}`,
      contractId: String(record.contract_id),
      contractNumber: String(contract.contract_number ?? contract.proposal_number ?? ""),
      customerName: String(contract.customer_name ?? ""),
      propertyLabel: String(contract.property_label ?? ""),
      visitNo: 1,
      status: String(record.status) as VisitStatus,
      windowStart: day,
      windowEnd: day,
      targetDate: day,
      scheduledStart: str(record.scheduled_start),
      technicianIds: strings(record.technician_ids),
      reportDocumentId: str(record.report_document_id),
      reportSentAt: str(record.report_sent_at),
      reportDueAt: str(record.report_due_at),
      reportState: reportState(str(record.report_due_at), str(record.report_sent_at), now),
      remainderOfVisitId: null,
    },
    sheet: {
      status: null,
      arrivedAt: null,
      completedAt: null,
      technicianIds: strings(record.technician_ids),
      faults: null,
      consumables: [],
      additionalWork: [],
      pendingWorks: [],
      qualityConcern: false,
      qualityNote: null,
      clientSignatureName: null,
      notes: null,
      reviewRequired: false,
      reviewReasons: [],
      submittedAt: null,
      reviewedAt: null,
      reviewComment: null,
      returnCount: 0,
    },
    lines: [
      {
        id,
        serviceLabel: workLabel(kind, record),
        occurrence: 1,
        outcome: (str(sheet?.work_outcome) as LineOutcome | null) ?? null,
        outcomeGroup: (str(sheet?.work_outcome_group) as OutcomeGroup | null) ?? null,
        outcomeReason: str(sheet?.work_outcome_reason),
        retry: false,
      },
    ],
    checklist: [],
    photos: [],
    assets: [],
  };
  const [assets, photos, checklistRead] = await Promise.all([
    propertyAssets(admin, str(contract.property_id)),
    workPhotos(admin, kind === "call_out" ? { callOutId: id } : { additionalWorkId: id }, linkSeconds),
    sheet ? admin.from("amc_visit_checklist_items").select("*").eq("job_sheet_id", String(sheet.id)).order("sort_order") : null,
  ]);
  view.assets = assets;
  view.photos = photos.map((p) => ({ id: p.id, kind: p.kind, category: p.category, lineId: null, assetId: null, caption: p.caption, url: p.url, createdAt: p.createdAt }));
  if (!sheet) return view;
  view.sheet = {
    status: sheet.status as JobSheetView["sheet"]["status"],
    arrivedAt: str(sheet.arrived_at),
    completedAt: str(sheet.completed_at),
    technicianIds: strings(sheet.technician_ids),
    faults: str(sheet.faults),
    consumables: (sheet.consumables ?? []) as JobSheetView["sheet"]["consumables"],
    additionalWork: (sheet.additional_work ?? []) as JobSheetView["sheet"]["additionalWork"],
    pendingWorks: (sheet.pending_works ?? []) as JobSheetView["sheet"]["pendingWorks"],
    qualityConcern: Boolean(sheet.quality_concern),
    qualityNote: str(sheet.quality_note),
    clientSignatureName: str(sheet.client_signature_name),
    notes: str(sheet.notes),
    reviewRequired: Boolean(sheet.review_required),
    reviewReasons: strings(sheet.review_reasons) as ReviewReason[],
    submittedAt: str(sheet.submitted_at),
    reviewedAt: str(sheet.reviewed_at),
    reviewComment: str(sheet.review_comment),
    returnCount: Number(sheet.return_count ?? 0),
  };
  view.checklist = ((checklistRead?.data ?? []) as Row[]).map((c) => ({
    id: String(c.id),
    lineId: null,
    assetId: str(c.asset_id),
    label: String(c.label),
    category: str(c.category),
    result: String(c.result),
    note: str(c.note),
  }));
  return view;
}

/* ------------------------------------------------------------------ */
/* Saving and submitting                                               */
/* ------------------------------------------------------------------ */

/* What can still be filled in: a call out until it is resolved (or closed), an additional work until it is completed. */
const EDITABLE: Record<FieldSheetKind, readonly string[]> = { call_out: ["logged", "scheduled", "attended", "pending_works", "quoted"], additional_work: ["scheduled"] };

async function ensureSheet(admin: Admin, kind: FieldSheetKind, record: Row, actor: Actor): Promise<Row> {
  const existing = await loadSheet(admin, kind, String(record.id));
  if (existing) return existing;
  const { data, error } = await admin
    .from("amc_visit_job_sheets")
    .insert({ [OWNER[kind]]: String(record.id), contract_id: String(record.contract_id), status: "draft", technician_ids: strings(record.technician_ids), created_by: actor.id })
    .select(SHEET_COLUMNS)
    .single<Row>();
  if (error) throw fail(error);
  return data;
}

export async function saveFieldJobSheet(admin: Admin, kind: FieldSheetKind, id: string, input: JobSheetInput, actor: Actor, config: AmcConfig, submit: boolean) {
  const { record, contract, ownerId } = await loadRecord(admin, kind, id);
  const ref = refOf(kind, record);
  if (!str(record.started_at)) throw new ContractError(`The office has not started this ${NOUN[kind]} yet. Ask them to start it, then fill in the job sheet.`, 409);
  if (!EDITABLE[kind].includes(String(record.status))) throw new ContractError(`${ref} is ${String(record.status).replace(/_/g, " ")}: its job sheet cannot be changed.`, 409);
  const sheet = await ensureSheet(admin, kind, record, actor);
  if (sheet.status !== "draft" && sheet.status !== "returned") throw new ContractError("The job sheet is with the supervisor.", 409);
  const now = new Date().toISOString();
  const line = input.lines.find((l) => l.lineId === id) ?? input.lines[0] ?? null;
  const outcome = line?.outcome ?? null;

  const { error: checklistDelete } = await admin.from("amc_visit_checklist_items").delete().eq("job_sheet_id", String(sheet.id));
  if (checklistDelete) throw fail(checklistDelete);
  if (input.checklist.length) {
    const rows = input.checklist.map((c, i) => ({ job_sheet_id: String(sheet.id), visit_line_id: null, asset_id: c.assetId ?? null, label: c.label, category: c.category ?? null, result: c.result, note: c.note, sort_order: i }));
    let { error } = await admin.from("amc_visit_checklist_items").insert(rows);
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      ({ error } = await admin.from("amc_visit_checklist_items").insert(rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "category")))));
    }
    if (error) throw fail(error);
  }

  const fields: Row = {
    arrived_at: input.arrivedAt ?? null,
    completed_at: input.completedAt ?? null,
    technician_ids: input.technicianIds.length ? input.technicianIds : strings(record.technician_ids),
    faults: input.faults,
    consumables: input.consumables,
    additional_work: input.additionalWork,
    pending_works: input.pendingWorks,
    quality_concern: input.qualityConcern,
    quality_note: input.qualityNote,
    client_signature_name: input.clientSignatureName,
    client_signed_at: input.clientSignatureName ? (str(sheet.client_signed_at) ?? input.completedAt ?? now) : null,
    notes: input.notes,
    work_outcome: outcome,
    work_outcome_group: outcome && outcome !== "completed" ? (line?.outcomeGroup ?? (outcome === "partially_completed" ? "partial" : null)) : null,
    work_outcome_reason: outcome && outcome !== "completed" ? (line?.outcomeReason ?? null) : null,
    updated_at: now,
  };

  let reasons: ReviewReason[] = [];
  if (submit) {
    const photos = await workPhotos(admin, kind === "call_out" ? { callOutId: id } : { additionalWorkId: id }, 60);
    const facts = {
      pendingWorks: input.pendingWorks,
      qualityConcern: input.qualityConcern,
      additionalWork: input.additionalWork,
      lines: [{ outcome }],
      photos: photos.map(() => ({ kind: "other" as const })),
      clientSignatureName: input.clientSignatureName,
    };
    const linesExplained = !outcome || outcome === "completed" || outcome === "partially_completed" || Boolean(line?.outcomeGroup);
    const problems = submitProblems({ ...facts, arrivedAt: input.arrivedAt ?? null, completedAt: input.completedAt ?? null, linesExplained }).map((p) => p.replace("every trade", "the work").replace("A trade", "Work"));
    if (problems.length) throw new ContractError(`Before submitting: ${problems.join("; ")}.`, 400);
    reasons = reviewReasons(facts);
    Object.assign(fields, { status: "submitted", submitted_at: now, submitted_by: actor.id, review_required: reasons.length > 0, review_reasons: reasons });
  }
  const { error } = await admin.from("amc_visit_job_sheets").update(fields).eq("id", String(sheet.id));
  if (error) throw fail(error);

  /* The record follows: a call out is attended once someone arrived, and resolved (or pending works) with the sheet. */
  if (kind === "call_out") {
    const status = String(record.status);
    if (input.arrivedAt && (status === "logged" || status === "scheduled")) {
      await performCallOutAction(admin, id, { action: "attend", attendedAt: input.arrivedAt }, actor, config);
    }
    if (submit) {
      const minutes = input.arrivedAt && input.completedAt ? Math.max(0, Math.round((Date.parse(input.completedAt) - Date.parse(input.arrivedAt)) / 60_000)) : null;
      await performCallOutAction(
        admin,
        id,
        {
          action: "record",
          outcome: input.pendingWorks.length ? "pending_works" : "resolved",
          diagnosis: input.faults,
          resolution: input.notes,
          partsNeeded: input.consumables.length ? input.consumables.map((c) => `${c.quantity}${c.unit ? ` ${c.unit}` : ""} ${c.item}`).join(", ").slice(0, 1000) : null,
          minutesOnSite: minutes !== null ? Math.min(minutes, 24 * 60) : null,
          pendingWorks: input.pendingWorks.filter((p) => p.reason.trim()),
        },
        actor,
        config,
      );
    }
  }
  if (submit && input.completedAt) {
    await admin.from(TABLE[kind]).update({ report_due_at: reportDueAt(input.completedAt, config.sla.serviceReportHours) }).eq("id", id);
  }

  if (submit) {
    const supervisors = supervisorsOf(config);
    const label = `${String(contract.contract_number ?? "")} ${NOUN[kind]} ${ref}`;
    const link = kind === "call_out" ? `/extensions/amc-contracts/visits/${id}?tab=job_sheet` : `/extensions/amc-contracts/additional-works/${id}?tab=job_sheet`;
    const reasonText = reasons.length ? ` Review needed: ${reasons.map((r) => r.replace(/_/g, " ")).join(", ")}.` : "";
    if (supervisors.length) {
      await openAmcTodo(
        admin,
        {
          kind: "job_closure_review",
          entityType: kind,
          entityId: id,
          dedupeKey: `job_closure_review:${kind}:${id}:${Number(sheet.return_count ?? 0)}`,
          title: `Review job sheet: ${label}`,
          description: `${String(contract.customer_name ?? "")}, ${String(contract.property_label ?? "")}.${reasonText} Close it (sends the service report) or return it with a comment.`,
          ownerId: ownerId ?? supervisors[0],
          assigneeIds: supervisors,
          dueAt: new Date(Date.now() + 8 * 3_600_000).toISOString(),
          escalateAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        },
        config,
      ).catch((e) => console.error("[amc:field-job-sheets] review to-do not opened:", e instanceof Error ? e.message : e));
    }
    await notifyUsers(admin, {
      event: "job_sheet_awaiting_review",
      userIds: supervisors,
      title: `Job sheet awaiting review: ${label}`,
      body: `${String(contract.customer_name ?? "")}.${reasonText}`,
      link,
      entityType: kind,
      entityId: id,
      contractId: String(record.contract_id),
      dedupeKey: `job_sheet_awaiting_review:${kind}:${id}:${Number(sheet.return_count ?? 0)}`,
    });
    await recordAmcAudit(admin, { entityType: kind, entityId: id, eventType: "job_sheet_submitted", actorId: actor.id, actorLabel: actor.label, payload: { ref, reviewReasons: reasons } });
  }
  return { ok: true as const, reviewReasons: reasons };
}

/* ------------------------------------------------------------------ */
/* Review: return or close                                             */
/* ------------------------------------------------------------------ */

export async function returnFieldJobSheet(admin: Admin, kind: FieldSheetKind, id: string, comment: string, actor: Actor) {
  const { record, contract, ownerId } = await loadRecord(admin, kind, id);
  const sheet = await loadSheet(admin, kind, id);
  if (!sheet || sheet.status !== "submitted") throw new ContractError("Only a submitted job sheet can be returned.", 409);
  const now = new Date().toISOString();
  const { error } = await admin
    .from("amc_visit_job_sheets")
    .update({ status: "returned", review_comment: comment, return_count: Number(sheet.return_count ?? 0) + 1, updated_at: now })
    .eq("id", String(sheet.id))
    .eq("status", "submitted");
  if (error) throw fail(error);
  /* A call out goes back to attended, so the crew can fix the record. */
  if (kind === "call_out" && (record.status === "resolved" || record.status === "pending_works")) {
    await admin.from("amc_call_outs").update({ status: "attended", updated_at: now }).eq("id", id);
  }
  await closeAmcTodos(admin, { entityType: kind, entityId: id, kind: "job_closure_review" }, { status: "done", reason: "Returned" }).catch(() => 0);
  const ref = refOf(kind, record);
  /* On the technician's phone too (as Snagging's sent-back visit). */
  const submitter = str(sheet.submitted_by);
  if (submitter) {
    await alertCrew(admin, { kind, id, type: "visit_sent_back", actorId: actor.id, userIds: [submitter], title: `Job sheet returned: ${ref}`, body: comment });
  }
  await notifyUsers(admin, {
    event: "job_sheet_returned",
    userIds: [ownerId, str(sheet.submitted_by)].filter((u): u is string => Boolean(u)),
    title: `Job sheet returned: ${String(contract.contract_number ?? "")} ${NOUN[kind]} ${ref}`,
    body: comment,
    link: kind === "call_out" ? `/extensions/amc-contracts/visits/${id}?tab=job_sheet` : `/extensions/amc-contracts/additional-works/${id}?tab=job_sheet`,
    entityType: kind,
    entityId: id,
    contractId: String(record.contract_id),
    dedupeKey: `job_sheet_returned:${kind}:${id}:${Number(sheet.return_count ?? 0) + 1}`,
  });
  await recordAmcAudit(admin, { entityType: kind, entityId: id, eventType: "job_sheet_returned", actorId: actor.id, actorLabel: actor.label, payload: { ref, comment } });
  return { ok: true as const };
}

/**
 * Close: the call out is closed (its allowance settled, as its own Close
 * does) or the additional work completed, the sheet closed, and the service
 * report sent the way picked, when work was delivered.
 */
export async function closeFieldJobSheet(
  admin: Admin,
  kind: FieldSheetKind,
  id: string,
  comment: string | null,
  actor: Actor,
  config: AmcConfig,
  send: SendChannel = "email",
  browserPdf: Uint8Array | null = null,
  fsmQuotationNo: string | null = null,
  hoursUsed: number | null = null,
  fsmQuotationSkip: FsmQuotationSkip | null = null,
) {
  const { record } = await loadRecord(admin, kind, id);
  const sheet = await loadSheet(admin, kind, id);
  if (!sheet || sheet.status !== "submitted") throw new ContractError("Only a submitted job sheet can be closed.", 409);
  const ref = refOf(kind, record);
  /* The record first: a call out with open additional work refuses to close, and the sheet stays submitted. */
  /* DEV-508: the FSM quotation number typed in the close dialog goes on first; a chargeable one refuses without it. */
  const fsm = fsmQuotationNo?.trim() ? { fsmQuotationNo: fsmQuotationNo.trim() } : fsmQuotationSkip ? { fsmQuotationSkip } : {};
  /* DEV-495: a handyman job's team-hours, recorded by the coordinator here. */
  const hours = hoursUsed !== null ? { hoursUsed } : {};
  if (kind === "call_out") await performCallOutAction(admin, id, { action: "close", note: comment, ...fsm, ...hours }, actor, config);
  else await performWorkAction(admin, id, { action: "complete", completedAt: str(sheet.completed_at) ?? undefined, ...fsm }, actor, config);
  const now = new Date().toISOString();
  const { error } = await admin
    .from("amc_visit_job_sheets")
    .update({ status: "closed", reviewed_at: now, reviewed_by: actor.id, review_comment: comment, updated_at: now })
    .eq("id", String(sheet.id))
    .eq("status", "submitted");
  if (error) throw fail(error);
  await closeAmcTodos(admin, { entityType: kind, entityId: id, kind: "job_closure_review" }, { status: "done", reason: "Closed" }).catch(() => 0);
  /* A report on every close, a work not completed included (DEV-404, 20 Nov 2026 review). */
  const report: Awaited<ReturnType<typeof sendFieldServiceReport>> | null = await sendFieldServiceReport(admin, kind, id, actor, config, send, browserPdf).catch((e) => {
    console.error("[amc:field-job-sheets] service report failed:", e instanceof Error ? e.message : e);
    return null;
  });
  await recordAmcAudit(admin, { entityType: kind, entityId: id, eventType: "job_sheet_closed", actorId: actor.id, actorLabel: actor.label, payload: { ref, reportOutcome: report?.outcome ?? null } });
  return { ok: true as const, status: kind === "call_out" ? "closed" : "completed", remainderVisitId: null, report };
}

/* ------------------------------------------------------------------ */
/* The service report                                                  */
/* ------------------------------------------------------------------ */

/**
 * The report's facts (18 Nov 2026): what the portal draws on screen and as
 * the PDF, and what the server prints when no PDF comes from the browser.
 */
export async function fieldReportFacts(admin: Admin, kind: FieldSheetKind, id: string): Promise<ServiceReportFacts> {
  const { record, contract } = await loadRecord(admin, kind, id);
  const sheet = await loadSheet(admin, kind, id);
  if (!sheet || (sheet.status !== "closed" && sheet.status !== "submitted")) throw new ContractError("The job sheet is not submitted yet.", 409);
  const [{ data: checklist }, photos] = await Promise.all([
    admin.from("amc_visit_checklist_items").select("*").eq("job_sheet_id", String(sheet.id)).order("sort_order"),
    workPhotos(admin, kind === "call_out" ? { callOutId: id } : { additionalWorkId: id }, 3600),
  ]);
  const customer = (contract.customer ?? {}) as Row;
  const outcome = str(sheet.work_outcome) as LineOutcome | null;
  const group = str(sheet.work_outcome_group) as OutcomeGroup | null;
  const photoLabel = (kind: string) => (kind === "finding" ? "Finding" : kind.replace(/^\w/, (c) => c.toUpperCase()));
  return {
    kind,
    ref: refOf(kind, record),
    contractNumber: String(contract.contract_number ?? contract.proposal_number ?? ""),
    customerName: str(customer.customerName) ?? String(contract.customer_name ?? ""),
    propertyLabel: String(contract.property_label ?? ""),
    work: workLabel(kind, record).replace(/^(Call out|Additional work)( · )?/, "") || null,
    arrivedAt: str(sheet.arrived_at),
    completedAt: str(sheet.completed_at),
    outcome: outcome ? `${LINE_OUTCOME_LABELS[outcome]}${group ? ` (${OUTCOME_GROUPS[group].label}${str(sheet.work_outcome_reason) ? `: ${String(sheet.work_outcome_reason)}` : ""})` : ""}` : null,
    signedBy: str(sheet.client_signature_name),
    lines: [],
    findings: str(sheet.faults),
    notes: str(sheet.notes),
    checklist: ((checklist ?? []) as Row[]).map((c) => ({ label: String(c.label), result: String(c.result), note: str(c.note) })),
    materials: ((sheet.consumables ?? []) as Array<{ item: string; quantity: number; unit: string | null }>).map((c) => `${c.quantity}${c.unit ? ` ${c.unit}` : ""} ${c.item}`),
    pending: ((sheet.pending_works ?? []) as Array<{ description: string; reason: string }>).map((p) => `${p.description} (${p.reason})`),
    further: ((sheet.additional_work ?? []) as Array<{ description: string }>).map((a) => a.description),
    photos: photos.filter((p) => p.url).slice(0, 12).map((p) => ({ url: p.url!, label: photoLabel(p.kind), caption: p.caption })),
    closing: null,
  };
}

/**
 * The report is stored, then emailed (PDF attached), prepared for WhatsApp
 * (the text only: the coordinator downloads the PDF and attaches it), or its
 * link handed back to copy. The PDF is the one the browser built from the
 * same facts when it sent one; else the server prints the same model.
 */
export async function sendFieldServiceReport(
  admin: Admin,
  kind: FieldSheetKind,
  id: string,
  actor: Actor,
  _config: AmcConfig,
  channel: SendChannel = "email",
  browserPdf: Uint8Array | null = null,
): Promise<SendResult & { documentId: string }> {
  const { record, contract } = await loadRecord(admin, kind, id);
  const sheet = await loadSheet(admin, kind, id);
  if (!sheet || (sheet.status !== "closed" && sheet.status !== "submitted")) throw new ContractError("The job sheet is not submitted yet.", 409);
  const ref = refOf(kind, record);
  const facts = await fieldReportFacts(admin, kind, id);
  const html = renderAmcDocumentHtml(serviceReportTitle(facts), buildServiceReportModel(facts), "");
  const pdf = browserPdf ?? (await renderPdf(html));
  const bytes = pdf ?? new TextEncoder().encode(html);
  const mime = pdf ? "application/pdf" : "text/html";
  const ext = pdf ? "pdf" : "html";
  const documentId = randomUUID();
  const path = `documents/${kind}/${id}/${documentId}.${ext}`;
  const { error: upload } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (upload) throw new ContractError(`Could not store the report: ${upload.message}`, 500);
  const title = `Service report, ${NOUN[kind]} ${ref}`;
  const { data: versions } = await admin.from("amc_documents").select("version").eq("level", kind).eq("entity_id", id).eq("category", "Service report").eq("title", title);
  const { error: docError } = await admin.from("amc_documents").insert({
    id: documentId,
    level: kind,
    entity_id: id,
    customer_id: str(contract.customer_id),
    category: "Service report",
    title,
    version: Math.max(0, ...((versions ?? []) as Row[]).map((v) => Number(v.version))) + 1,
    storage_path: path,
    file_name: `service-report-${ref}.${ext}`,
    mime_type: mime,
    size_bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    uploaded_by: actor.id,
  });
  if (docError) throw fail(docError);
  await admin.from(TABLE[kind]).update({ report_document_id: documentId }).eq("id", id);

  const customer = (contract.customer ?? {}) as Row;
  const name = str(customer.customerName) ?? str(contract.customer_name) ?? "customer";
  const { data: link } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrl(path, 14 * 86_400);
  const day = str(sheet.completed_at) ? fmtDay(String(sheet.completed_at)) : fmtDay(new Date().toISOString());
  /* No link in the text (18 Nov 2026): the PDF is attached to the WhatsApp message by hand. */
  const message = `Dear ${name}, please find attached the service report for the ${NOUN[kind]} ${ref} at ${String(contract.property_label ?? "your property")} on ${day}. Yalla Fix It`;
  const to = String(customer.customerEmail ?? "").trim();
  const phone = str(customer.customerPhone);
  let outcome = initialOutcome(channel);
  if (channel === "email" && to) {
    try {
      await sendEmail({
        to,
        subject: `Yalla Fix It service report: ${NOUN[kind]} ${ref}`,
        html: clientEmailHtml({
          eyebrow: "AMC service report",
          heading: `Service report: ${NOUN[kind]} ${ref}`,
          greeting: `Dear ${escapeEmailHtml(name)},`,
          paragraphs: [escapeEmailHtml(`The report of the ${NOUN[kind]} at ${String(contract.property_label ?? "your property")} on ${day} is attached.`)],
          details: [],
          ...(pdf ? {} : link?.signedUrl ? { cta: { label: "Open the report", url: link.signedUrl } } : {}),
        }),
        ...(pdf ? { attachment: { filename: `service-report-${ref}.pdf`, content: Buffer.from(pdf).toString("base64"), contentType: "application/pdf" } } : {}),
      });
      outcome = "sent";
    } catch (e) {
      outcome = "failed";
      console.error("[amc:field-job-sheets] report email failed:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }
  /* DEV-404: only an email that went stops the clock; WhatsApp or a link is marked sent by the coordinator. */
  if (reachedClient(outcome)) await admin.from(TABLE[kind]).update({ report_sent_at: new Date().toISOString() }).eq("id", id);
  const submissionId = str(one(contract.submission)?.id);
  if (submissionId) {
    await recordSend(admin, {
      submissionId,
      versionNo: 1,
      document: "service_report",
      channel,
      recipients: channel === "email" ? (to ? [{ name, address: to }] : []) : channel === "whatsapp" && phone ? [{ name, address: phone }] : [],
      outcome,
      detail: `${NOUN[kind]} ${ref} service report`,
      sentBy: actor.id,
    });
  }
  return {
    outcome,
    documentId,
    message,
    whatsapp: phone ? whatsappUrl(phone, message) : null,
    link: link?.signedUrl ?? null,
    file: link?.signedUrl ? { url: link.signedUrl, name: `service-report-${ref}.${ext}` } : null,
  };
}

/** DEV-404: the coordinator sent the report themselves and says so; that stops the clock. */
export async function markFieldReportSent(admin: Admin, kind: FieldSheetKind, id: string, input: { channel: "whatsapp" | "link" | "other"; note: string | null }, actor: Actor) {
  const { data: r, error } = await admin.from(TABLE[kind]).select("id, report_document_id, report_sent_at").eq("id", id).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!r) throw new ContractError(kind === "call_out" ? "Call out not found." : "Additional work not found.", 404);
  if (!str(r.report_document_id)) throw new ContractError("There is no service report yet: send it first.", 409);
  if (str(r.report_sent_at)) throw new ContractError("The service report is already marked sent.", 409);
  const now = new Date().toISOString();
  const { data: claimed } = await admin.from(TABLE[kind]).update({ report_sent_at: now }).eq("id", id).is("report_sent_at", null).select("id");
  if (!claimed?.length) throw new ContractError("The service report is already marked sent.", 409);
  await recordAmcAudit(admin, { entityType: kind, entityId: id, eventType: "service_report_marked_sent", actorId: actor.id, actorLabel: actor.label, justification: input.note, payload: { channel: input.channel } });
  return { ok: true as const, reportSentAt: now };
}

/** The stored report, for a short-lived link. */
export async function fieldReportLink(admin: Admin, kind: FieldSheetKind, id: string): Promise<string | null> {
  const { data } = await admin.from(TABLE[kind]).select("report_document_id").eq("id", id).maybeSingle<Row>();
  const documentId = str(data?.report_document_id);
  if (!documentId) return null;
  const { data: doc } = await admin.from("amc_documents").select("storage_path").eq("id", documentId).maybeSingle<Row>();
  if (!doc) return null;
  const { data: signed } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrl(String(doc.storage_path), 300);
  return signed?.signedUrl ?? null;
}
