import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { approversForLevel, type AmcConfig } from "@/lib/amc/config";
import { fillTemplate, whatsappUrl } from "@/lib/amc/approval-ladder";
import { todayInDubai } from "@/lib/amc/contracts";
import {
  OUTCOME_GROUPS,
  closedStatus,
  noShowConsumesVisit,
  remainingTrades,
  reportDueAt,
  reportState,
  reviewReasons,
  submitProblems,
  type JobSheetInput,
  type LineOutcome,
  type OutcomeGroup,
  type ReviewReason,
} from "@/lib/amc/job-sheets";
import { templateText } from "@/lib/amc/message-templates";
import { PHOTO_EXTENSION, detectImageType, AMC_PHOTO_MAX_BYTES } from "@/lib/amc/photos";
import { addDays, firstWorkingDay, PLANNABLE_STATUSES, type VisitStatus } from "@/lib/amc/ppm";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError, isMissingTable, recordUsage } from "@/lib/server/amc/contracts";
import { notifyUsers } from "@/lib/server/amc/notifications";
import { recordSend } from "@/lib/server/amc/proposal-share";
import { AMC_DOCUMENTS_BUCKET, renderPdf } from "@/lib/server/amc/signed-archive";
import { closeAmcTodos, openAmcTodo } from "@/lib/server/amc/todos";
import { sendEmail } from "@/lib/server/send-email";

/**
 * Visit execution and closure on the server (Phase 10: DEV-402, 403, 404,
 * to-do 5). The job sheet is filled in the portal for now; the FSM job
 * sheet fills the same record in Phase 15. Submitting does not close the
 * visit: a supervisor closes it (or returns it), which consumes the
 * entitlement, plans the remaining trade, and sends the service report.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

const NOT_MIGRATED = "Job sheets are not set up on this database yet (migration 20261012110000).";
const notMigrated = (error: { code?: string } | null | undefined) =>
  isMissingTable(error) || error?.code === "42703" || error?.code === "PGRST204";
function fail(error: { code?: string; message: string }): ContractError {
  if (notMigrated(error)) return new ContractError(NOT_MIGRATED, 503);
  return new ContractError(error.message, error.code === "23514" || error.code === "23505" ? 409 : 400);
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row | undefined) ?? null) : ((v as Row | null) ?? null));
const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
const fmtDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso));
const fmtTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dubai" }).format(new Date(iso));
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const EDITABLE_VISIT: readonly VisitStatus[] = [...PLANNABLE_STATUSES, "in_progress"];
const PHOTOS_PER_VISIT = 40;

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

const VISIT_COLUMNS =
  "id, contract_id, visit_no, status, window_start, window_end, target_date, scheduled_start, scheduled_end, technician_ids, closed_at, report_document_id, report_sent_at, report_due_at, remainder_of_visit_id, " +
  "lines:amc_visit_lines!amc_visit_lines_visit_id_fkey(id, entitlement_id, service_id, service_label, occurrence, status, outcome_group, outcome_reason, retry_of_line_id, home_window_start, home_window_end), " +
  "contract:amc_contracts!amc_visits_contract_id_fkey(id, status, contract_number, proposal_number, customer_name, customer_id, property_label, property_id, customer, property, ppm_confirmed_at, ppm_window_days, submission:amc_submissions!amc_contracts_submission_id_fkey(id, owner_id))";

const SHEET_COLUMNS =
  "id, visit_id, contract_id, status, arrived_at, completed_at, technician_ids, faults, consumables, additional_work, pending_works, quality_concern, quality_note, client_signature_name, client_signed_at, notes, review_required, review_reasons, submitted_at, submitted_by, reviewed_at, reviewed_by, review_comment, return_count, source";

async function loadVisit(admin: Admin, visitId: string): Promise<{ visit: Row; contract: Row; ownerId: string | null; lines: Row[] }> {
  const { data, error } = await admin.from("amc_visits").select(VISIT_COLUMNS).eq("id", visitId).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Visit not found.", 404);
  const contract = one(data.contract) ?? {};
  return {
    visit: data,
    contract,
    ownerId: str(one(contract.submission)?.owner_id),
    lines: ((data.lines ?? []) as Row[]).filter((l) => l.status !== "cancelled"),
  };
}

async function loadSheet(admin: Admin, visitId: string): Promise<Row | null> {
  const { data, error } = await admin.from("amc_visit_job_sheets").select(SHEET_COLUMNS).eq("visit_id", visitId).maybeSingle<Row>();
  if (error) throw fail(error);
  return data ?? null;
}

/** Who reviews and closes job sheets: the named supervisors, else the level 1 approvers. */
export function jobSheetSupervisors(config: AmcConfig): string[] {
  return config.scheduling.supervisorUserIds.length ? config.scheduling.supervisorUserIds : approversForLevel(config, 1);
}
const supervisorsOf = jobSheetSupervisors;

/** The visit's contract owner, for the read check (null when the visit is not found). */
export async function visitOwner(admin: Admin, visitId: string): Promise<{ found: boolean; ownerId: string | null }> {
  const { data } = await admin
    .from("amc_visits")
    .select("id, contract:amc_contracts!amc_visits_contract_id_fkey(submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id))")
    .eq("id", visitId)
    .maybeSingle<Row>();
  if (!data) return { found: false, ownerId: null };
  return { found: true, ownerId: str(one(one(data.contract)?.submission)?.owner_id) };
}

/** The stored service report, for a short-lived link. */
export async function reportLink(admin: Admin, visitId: string): Promise<string | null> {
  const { data: visit } = await admin.from("amc_visits").select("report_document_id").eq("id", visitId).maybeSingle<Row>();
  const documentId = str(visit?.report_document_id);
  if (!documentId) return null;
  const { data: doc } = await admin.from("amc_documents").select("storage_path").eq("id", documentId).maybeSingle<Row>();
  if (!doc) return null;
  const { data } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrl(String(doc.storage_path), 300);
  return data?.signedUrl ?? null;
}

export interface JobSheetView {
  migrated: boolean;
  visit: {
    id: string;
    contractId: string;
    contractNumber: string;
    customerName: string;
    propertyLabel: string;
    visitNo: number;
    status: VisitStatus;
    windowStart: string;
    windowEnd: string;
    targetDate: string;
    scheduledStart: string | null;
    technicianIds: string[];
    reportDocumentId: string | null;
    reportSentAt: string | null;
    reportDueAt: string | null;
    reportState: ReturnType<typeof reportState>;
    remainderOfVisitId: string | null;
  };
  sheet: {
    status: "draft" | "submitted" | "returned" | "closed" | null;
    arrivedAt: string | null;
    completedAt: string | null;
    technicianIds: string[];
    faults: string | null;
    consumables: Array<{ item: string; quantity: number; unit: string | null }>;
    additionalWork: Array<{ description: string; trade: string | null }>;
    pendingWorks: Array<{ description: string; reason: string }>;
    qualityConcern: boolean;
    qualityNote: string | null;
    clientSignatureName: string | null;
    notes: string | null;
    reviewRequired: boolean;
    reviewReasons: ReviewReason[];
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewComment: string | null;
    returnCount: number;
  };
  lines: Array<{ id: string; serviceLabel: string; occurrence: number; outcome: LineOutcome | null; outcomeGroup: OutcomeGroup | null; outcomeReason: string | null; retry: boolean }>;
  checklist: Array<{ id: string; lineId: string | null; assetId: string | null; label: string; result: string; note: string | null }>;
  photos: Array<{ id: string; kind: string; lineId: string | null; assetId: string | null; caption: string | null; url: string | null; createdAt: string }>;
  assets: Array<{ id: string; label: string; trade: string }>;
}

const outcomeOf = (status: unknown): LineOutcome | null =>
  status === "completed" || status === "partially_completed" || status === "not_completed" ? status : null;

export async function jobSheetView(admin: Admin, visitId: string, now = new Date()): Promise<JobSheetView> {
  const { visit, contract, lines } = await loadVisit(admin, visitId);
  let sheet: Row | null;
  try {
    sheet = await loadSheet(admin, visitId);
  } catch (error) {
    if (error instanceof ContractError && error.status === 503) {
      return emptyView(visit, contract, lines, false, now);
    }
    throw error;
  }
  const view = { ...emptyView(visit, contract, lines, true, now), assets: await propertyAssets(admin, str(contract.property_id)) };
  if (!sheet) return view;
  const [{ data: checklist }, { data: photos }] = await Promise.all([
    admin.from("amc_visit_checklist_items").select("id, visit_line_id, asset_id, label, result, note, sort_order").eq("job_sheet_id", String(sheet.id)).order("sort_order"),
    admin.from("amc_visit_photos").select("id, kind, visit_line_id, asset_id, caption, storage_path, created_at").eq("job_sheet_id", String(sheet.id)).order("created_at"),
  ]);
  const photoRows = (photos ?? []) as Row[];
  const urls = new Map<string, string>();
  if (photoRows.length) {
    const { data: signed } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrls(photoRows.map((p) => String(p.storage_path)), 600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return {
    ...view,
    sheet: {
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
    },
    checklist: ((checklist ?? []) as Row[]).map((c) => ({
      id: String(c.id),
      lineId: str(c.visit_line_id),
      assetId: str(c.asset_id),
      label: String(c.label),
      result: String(c.result),
      note: str(c.note),
    })),
    photos: photoRows.map((p) => ({
      id: String(p.id),
      kind: String(p.kind),
      lineId: str(p.visit_line_id),
      assetId: str(p.asset_id),
      caption: str(p.caption),
      url: urls.get(String(p.storage_path)) ?? null,
      createdAt: String(p.created_at),
    })),
    assets: view.assets,
  };
}

function emptyView(visit: Row, contract: Row, lines: Row[], migrated: boolean, now: Date): JobSheetView {
  return {
    migrated,
    visit: {
      id: String(visit.id),
      contractId: String(visit.contract_id),
      contractNumber: String(contract.contract_number ?? contract.proposal_number ?? ""),
      customerName: String(contract.customer_name ?? ""),
      propertyLabel: String(contract.property_label ?? ""),
      visitNo: Number(visit.visit_no),
      status: visit.status as VisitStatus,
      windowStart: String(visit.window_start),
      windowEnd: String(visit.window_end),
      targetDate: String(visit.target_date),
      scheduledStart: str(visit.scheduled_start),
      technicianIds: strings(visit.technician_ids),
      reportDocumentId: str(visit.report_document_id),
      reportSentAt: str(visit.report_sent_at),
      reportDueAt: str(visit.report_due_at),
      reportState: reportState(str(visit.report_due_at), str(visit.report_sent_at), now),
      remainderOfVisitId: str(visit.remainder_of_visit_id),
    },
    sheet: {
      status: null,
      arrivedAt: null,
      completedAt: null,
      technicianIds: strings(visit.technician_ids),
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
    lines: lines.map((l) => ({
      id: String(l.id),
      serviceLabel: String(l.service_label),
      occurrence: Number(l.occurrence),
      outcome: outcomeOf(l.status),
      outcomeGroup: (str(l.outcome_group) as OutcomeGroup | null) ?? null,
      outcomeReason: str(l.outcome_reason),
      retry: Boolean(l.retry_of_line_id),
    })),
    checklist: [],
    photos: [],
    assets: [],
  };
}

/** The property's assets, for the checklist per asset. */
export async function propertyAssets(admin: Admin, propertyId: string | null) {
  if (!propertyId) return [];
  const { data } = await admin.from("amc_property_assets").select("id, asset_type, trade, location, status").eq("property_id", propertyId).neq("status", "retired");
  return ((data ?? []) as Row[]).map((a) => ({ id: String(a.id), label: [str(a.asset_type), str(a.location)].filter(Boolean).join(" · "), trade: String(a.trade) }));
}

/* ------------------------------------------------------------------ */
/* Saving and submitting                                               */
/* ------------------------------------------------------------------ */

/** Creates the job sheet if there is none; returns it. */
async function ensureSheet(admin: Admin, visit: Row, actor: Actor): Promise<Row> {
  const existing = await loadSheet(admin, String(visit.id));
  if (existing) return existing;
  const { data, error } = await admin
    .from("amc_visit_job_sheets")
    .insert({ visit_id: String(visit.id), contract_id: String(visit.contract_id), technician_ids: strings(visit.technician_ids), created_by: actor.id })
    .select(SHEET_COLUMNS)
    .single<Row>();
  if (error) throw fail(error);
  return data;
}

export async function saveJobSheet(admin: Admin, visitId: string, input: JobSheetInput, actor: Actor, config: AmcConfig, submit: boolean) {
  const { visit, contract, ownerId, lines } = await loadVisit(admin, visitId);
  if (!EDITABLE_VISIT.includes(visit.status as VisitStatus)) {
    throw new ContractError(`Visit ${String(visit.visit_no)} is ${String(visit.status).replace(/_/g, " ")}: its job sheet cannot be changed.`, 409);
  }
  const sheet = await ensureSheet(admin, visit, actor);
  if (sheet.status !== "draft" && sheet.status !== "returned") throw new ContractError("The job sheet is with the supervisor.", 409);
  const lineIds = new Set(lines.map((l) => String(l.id)));
  const byLine = new Map(input.lines.filter((l) => lineIds.has(l.lineId)).map((l) => [l.lineId, l]));
  const now = new Date().toISOString();

  /* Each trade's outcome lives on its line. */
  for (const l of lines) {
    const v = byLine.get(String(l.id));
    const outcome = v?.outcome ?? null;
    const { error } = await admin
      .from("amc_visit_lines")
      .update({
        status: outcome ?? "pending",
        outcome_group: outcome && outcome !== "completed" ? (v?.outcomeGroup ?? (outcome === "partially_completed" ? "partial" : null)) : null,
        outcome_reason: outcome && outcome !== "completed" ? v?.outcomeReason ?? null : null,
        completed_at: outcome === "completed" ? input.completedAt ?? now : null,
        updated_at: now,
      })
      .eq("id", String(l.id));
    if (error) {
      if (error.code === "23514") throw new ContractError("A trade not completed (or partly) needs its reason group.", 400);
      throw fail(error);
    }
  }

  const { error: checklistDelete } = await admin.from("amc_visit_checklist_items").delete().eq("job_sheet_id", String(sheet.id));
  if (checklistDelete) throw fail(checklistDelete);
  if (input.checklist.length) {
    const { error } = await admin.from("amc_visit_checklist_items").insert(
      input.checklist.map((c, i) => ({
        job_sheet_id: String(sheet.id),
        visit_line_id: c.lineId && lineIds.has(c.lineId) ? c.lineId : null,
        asset_id: c.assetId ?? null,
        label: c.label,
        result: c.result,
        note: c.note,
        sort_order: i,
      })),
    );
    if (error) throw fail(error);
  }

  const fields: Row = {
    arrived_at: input.arrivedAt ?? null,
    completed_at: input.completedAt ?? null,
    technician_ids: input.technicianIds.length ? input.technicianIds : strings(visit.technician_ids),
    faults: input.faults,
    consumables: input.consumables,
    additional_work: input.additionalWork,
    pending_works: input.pendingWorks,
    quality_concern: input.qualityConcern,
    quality_note: input.qualityNote,
    client_signature_name: input.clientSignatureName,
    client_signed_at: input.clientSignatureName ? (str(sheet.client_signed_at) ?? input.completedAt ?? now) : null,
    notes: input.notes,
    updated_at: now,
  };

  let reasons: ReviewReason[] = [];
  if (submit) {
    const { data: photos } = await admin.from("amc_visit_photos").select("kind").eq("job_sheet_id", String(sheet.id));
    const facts = {
      pendingWorks: input.pendingWorks,
      qualityConcern: input.qualityConcern,
      additionalWork: input.additionalWork,
      lines: lines.map((l) => ({ outcome: byLine.get(String(l.id))?.outcome ?? null })),
      photos: ((photos ?? []) as Row[]).map((p) => ({ kind: p.kind as "before" | "after" | "fault" | "other" })),
      clientSignatureName: input.clientSignatureName,
    };
    const linesExplained = lines.every((l) => {
      const v = byLine.get(String(l.id));
      return !v?.outcome || v.outcome === "completed" || v.outcome === "partially_completed" || Boolean(v.outcomeGroup);
    });
    const problems = submitProblems({ ...facts, arrivedAt: input.arrivedAt ?? null, completedAt: input.completedAt ?? null, linesExplained });
    if (problems.length) throw new ContractError(`Before submitting: ${problems.join("; ")}.`, 400);
    reasons = reviewReasons(facts);
    Object.assign(fields, {
      status: "submitted",
      submitted_at: now,
      submitted_by: actor.id,
      review_required: reasons.length > 0,
      review_reasons: reasons,
    });
  }
  const { error } = await admin.from("amc_visit_job_sheets").update(fields).eq("id", String(sheet.id));
  if (error) throw fail(error);

  /* The visit follows: in progress once someone arrived, submitted with the sheet. */
  const visitChanges: Row = { updated_at: now };
  if (submit) Object.assign(visitChanges, { status: "submitted", report_due_at: reportDueAt(String(input.completedAt)) });
  else if (input.arrivedAt && PLANNABLE_STATUSES.includes(visit.status as VisitStatus)) visitChanges.status = "in_progress";
  await admin.from("amc_visits").update(visitChanges).eq("id", visitId);

  if (submit) {
    const supervisors = supervisorsOf(config);
    const label = `${String(contract.contract_number ?? "")} visit ${String(visit.visit_no)}`;
    const reasonText = reasons.length ? ` Review needed: ${reasons.map((r) => r.replace(/_/g, " ")).join(", ")}.` : "";
    if (supervisors.length) {
      await openAmcTodo(
        admin,
        {
          kind: "job_closure_review",
          entityType: "visit",
          entityId: visitId,
          dedupeKey: `job_closure_review:${visitId}:${Number(sheet.return_count ?? 0)}`,
          title: `Review job sheet: ${label}`,
          description: `${String(contract.customer_name ?? "")}, ${String(contract.property_label ?? "")}.${reasonText} Close it (sends the service report) or return it with a comment.`,
          ownerId: ownerId ?? supervisors[0],
          assigneeIds: supervisors,
          dueAt: new Date(Date.now() + 8 * 3_600_000).toISOString(),
          escalateAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        },
        config,
      ).catch((e) => console.error("[amc:job-sheets] review to-do not opened:", e instanceof Error ? e.message : e));
    }
    await notifyUsers(admin, {
      event: "job_sheet_awaiting_review",
      userIds: supervisors,
      title: `Job sheet awaiting review: ${label}`,
      body: `${String(contract.customer_name ?? "")}.${reasonText}`,
      link: `/extensions/amc-contracts/${String(visit.contract_id)}?tab=schedule&visit=${visitId}`,
      entityType: "visit",
      entityId: visitId,
      contractId: String(visit.contract_id),
      dedupeKey: `job_sheet_awaiting_review:${visitId}:${Number(sheet.return_count ?? 0)}`,
    });
    await recordAmcAudit(admin, { entityType: "contract", entityId: String(visit.contract_id), eventType: "job_sheet_submitted", actorId: actor.id, actorLabel: actor.label, payload: { visitNo: visit.visit_no, reviewReasons: reasons } });
  }
  return { ok: true as const, reviewReasons: reasons };
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

export async function addVisitPhoto(
  admin: Admin,
  visitId: string,
  input: { bytes: Uint8Array; kind: "before" | "after" | "fault" | "other"; lineId?: string | null; assetId?: string | null; caption?: string | null },
  actor: Actor,
) {
  const { visit } = await loadVisit(admin, visitId);
  if (!EDITABLE_VISIT.includes(visit.status as VisitStatus)) throw new ContractError("This visit's photos are kept as they are.", 409);
  const sheet = await ensureSheet(admin, visit, actor);
  if (sheet.status !== "draft" && sheet.status !== "returned") throw new ContractError("The job sheet is with the supervisor.", 409);
  if (input.bytes.byteLength === 0) throw new ContractError("The file is empty.", 400);
  if (input.bytes.byteLength > AMC_PHOTO_MAX_BYTES) throw new ContractError("A photo can be at most 10 MB.", 400);
  const type = detectImageType(input.bytes);
  if (!type) throw new ContractError("Only JPEG, PNG or WebP photos can be added.", 400);
  const { count } = await admin.from("amc_visit_photos").select("id", { count: "exact", head: true }).eq("job_sheet_id", String(sheet.id));
  if ((count ?? 0) >= PHOTOS_PER_VISIT) throw new ContractError(`A visit holds at most ${PHOTOS_PER_VISIT} photos.`, 409);
  const id = randomUUID();
  const path = `visits/${visitId}/${id}.${PHOTO_EXTENSION[type]}`;
  const { error: upload } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).upload(path, input.bytes, { contentType: type, upsert: false });
  if (upload) throw new ContractError(`Could not store the photo: ${upload.message}`, 500);
  const { error } = await admin.from("amc_visit_photos").insert({
    id,
    job_sheet_id: String(sheet.id),
    visit_id: visitId,
    visit_line_id: input.lineId ?? null,
    asset_id: input.assetId ?? null,
    kind: input.kind,
    storage_path: path,
    content_type: type,
    byte_size: input.bytes.byteLength,
    file_sha256: createHash("sha256").update(input.bytes).digest("hex"),
    caption: input.caption ?? null,
    uploaded_by: actor.id,
  });
  if (error) {
    await admin.storage.from(AMC_DOCUMENTS_BUCKET).remove([path]);
    throw fail(error);
  }
  return { id };
}

export async function removeVisitPhoto(admin: Admin, visitId: string, photoId: string) {
  const sheet = await loadSheet(admin, visitId);
  if (!sheet || (sheet.status !== "draft" && sheet.status !== "returned")) throw new ContractError("Photos of a submitted job sheet are kept.", 409);
  const { data, error } = await admin.from("amc_visit_photos").select("id, storage_path, visit_id").eq("id", photoId).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data || String(data.visit_id) !== visitId) throw new ContractError("Photo not found.", 404);
  const { error: delError } = await admin.from("amc_visit_photos").delete().eq("id", photoId);
  if (delError) throw fail(delError);
  await admin.storage.from(AMC_DOCUMENTS_BUCKET).remove([String(data.storage_path)]);
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/* Review: return or close (DEV-402, 403)                              */
/* ------------------------------------------------------------------ */

export async function returnJobSheet(admin: Admin, visitId: string, comment: string, actor: Actor) {
  const { visit, contract, ownerId } = await loadVisit(admin, visitId);
  const sheet = await loadSheet(admin, visitId);
  if (!sheet || sheet.status !== "submitted") throw new ContractError("Only a submitted job sheet can be returned.", 409);
  const now = new Date().toISOString();
  const { error } = await admin
    .from("amc_visit_job_sheets")
    .update({ status: "returned", review_comment: comment, return_count: Number(sheet.return_count ?? 0) + 1, updated_at: now })
    .eq("id", String(sheet.id))
    .eq("status", "submitted");
  if (error) throw fail(error);
  await admin.from("amc_visits").update({ status: "in_progress", updated_at: now }).eq("id", visitId);
  await closeAmcTodos(admin, { entityType: "visit", entityId: visitId, kind: "job_closure_review" }, { status: "done", reason: "Returned" }).catch(() => 0);
  await notifyUsers(admin, {
    event: "job_sheet_returned",
    userIds: [ownerId, str(sheet.submitted_by)].filter((id): id is string => Boolean(id)),
    title: `Job sheet returned: ${String(contract.contract_number ?? "")} visit ${String(visit.visit_no)}`,
    body: comment,
    link: `/extensions/amc-contracts/${String(visit.contract_id)}?tab=schedule&visit=${visitId}`,
    entityType: "visit",
    entityId: visitId,
    contractId: String(visit.contract_id),
    dedupeKey: `job_sheet_returned:${visitId}:${Number(sheet.return_count ?? 0) + 1}`,
  });
  await recordAmcAudit(admin, { entityType: "contract", entityId: String(visit.contract_id), eventType: "job_sheet_returned", actorId: actor.id, actorLabel: actor.label, payload: { visitNo: visit.visit_no, comment } });
  return { ok: true as const };
}

/**
 * The earlier attempts of this line, newest first (the retry chain): the
 * one before is what the no-show rule compares with, and any delivered
 * attempt means the occurrence is already counted.
 */
async function earlierAttempts(admin: Admin, line: Row) {
  const out: Array<{ status: string; group: OutcomeGroup | null; reason: string | null }> = [];
  let id = str(line.retry_of_line_id);
  for (let hop = 0; id && hop < 10; hop += 1) {
    const { data } = await admin.from("amc_visit_lines").select("status, outcome_group, outcome_reason, retry_of_line_id").eq("id", id).maybeSingle<Row>();
    if (!data) break;
    out.push({ status: String(data.status), group: (str(data.outcome_group) as OutcomeGroup | null) ?? null, reason: str(data.outcome_reason) });
    id = str(data.retry_of_line_id);
  }
  return out;
}

export async function closeJobSheet(admin: Admin, visitId: string, comment: string | null, actor: Actor, config: AmcConfig) {
  const { visit, contract, ownerId, lines } = await loadVisit(admin, visitId);
  const sheet = await loadSheet(admin, visitId);
  if (!sheet || sheet.status !== "submitted") throw new ContractError("Only a submitted job sheet can be closed.", 409);
  const outcomes = lines.map((l) => ({ line: l, outcome: outcomeOf(l.status) }));
  if (outcomes.some((o) => !o.outcome)) throw new ContractError("Every trade needs an outcome before closing.", 409);
  const status = closedStatus(outcomes.map((o) => ({ outcome: o.outcome! })), ((sheet.additional_work ?? []) as unknown[]).length);
  const now = new Date().toISOString();
  const completedOn = str(sheet.completed_at) ?? now;
  const actorForUsage = { id: actor.id ?? "", label: actor.label };

  /* Done work consumes the visit; two client no-shows in a row consume it too (BRD 5.11). */
  const consumed = new Set<string>();
  for (const o of outcomes) {
    const earlier = await earlierAttempts(admin, o.line);
    /* A retry finishing a partly done trade: the occurrence is already counted. */
    if (earlier.some((a) => a.status === "completed" || a.status === "partially_completed")) continue;
    const consumes =
      o.outcome === "completed" || o.outcome === "partially_completed"
        ? "Visit delivered"
        : noShowConsumesVisit(
              { group: (str(o.line.outcome_group) as OutcomeGroup | null) ?? null, reason: str(o.line.outcome_reason) },
              earlier[0] ?? null,
              config.scheduling.noShowsConsumeVisit,
            )
          ? `${config.scheduling.noShowsConsumeVisit} no-shows in a row`
          : null;
    if (!consumes) continue;
    consumed.add(String(o.line.id));
    try {
      await recordUsage(
        admin,
        String(visit.contract_id),
        { entitlementId: String(o.line.entitlement_id), kind: "consumption", quantity: 1, occurredAt: completedOn, notes: `PPM visit ${String(visit.visit_no)}: ${consumes}` },
        actorForUsage,
      );
    } catch (e) {
      /* An allowance already used up, or an informational service: the visit still closes. */
      console.warn("[amc:job-sheets] usage not recorded:", e instanceof Error ? e.message : e);
    }
  }

  const { error: sheetError } = await admin
    .from("amc_visit_job_sheets")
    .update({ status: "closed", reviewed_at: now, reviewed_by: actor.id, review_comment: comment, updated_at: now })
    .eq("id", String(sheet.id))
    .eq("status", "submitted");
  if (sheetError) throw fail(sheetError);
  const { error: visitError } = await admin.from("amc_visits").update({ status, closed_at: now, closed_by: actor.id, updated_at: now }).eq("id", visitId);
  if (visitError) throw fail(visitError);
  await closeAmcTodos(admin, { entityType: "visit", entityId: visitId, kind: "job_closure_review" }, { status: "done", reason: "Closed" }).catch(() => 0);

  /* The remaining trade is planned again on a new visit; the done work is not reopened (BRD 5.11). */
  const remaining = remainingTrades(outcomes.map((o) => ({ ...o, outcome: o.outcome!, consumed: consumed.has(String(o.line.id)) })));
  let remainderVisitId: string | null = null;
  if (remaining.length) remainderVisitId = await planRemainder(admin, visit, contract, remaining.map((r) => r.line), actor, config);

  /* The service report when work was delivered (Email 3, within 48 hours). */
  let report: Awaited<ReturnType<typeof sendServiceReport>> | null = null;
  if (status !== "not_completed") {
    report = await sendServiceReport(admin, visitId, actor, config).catch((e) => {
      console.error("[amc:job-sheets] service report failed:", e instanceof Error ? e.message : e);
      return null;
    });
  }
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: String(visit.contract_id),
    eventType: "visit_closed",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { visitNo: visit.visit_no, status, consumed: [...consumed], remainderVisitId, reportOutcome: report?.outcome ?? null },
  });
  if (ownerId && ownerId !== actor.id) {
    await notifyUsers(admin, {
      event: "visit_closed",
      userIds: [ownerId],
      title: `Visit closed: ${String(contract.contract_number ?? "")} visit ${String(visit.visit_no)}`,
      body: `${String(contract.customer_name ?? "")}: ${status.replace(/_/g, " ")}.${remainderVisitId ? " The remaining trade was planned again." : ""}`,
      link: `/extensions/amc-contracts/${String(visit.contract_id)}?tab=schedule`,
      entityType: "visit",
      entityId: visitId,
      contractId: String(visit.contract_id),
      dedupeKey: `visit_closed:${visitId}`,
    });
  }
  return { ok: true as const, status, remainderVisitId, report };
}

async function planRemainder(admin: Admin, visit: Row, contract: Row, lines: Row[], actor: Actor, config: AmcConfig): Promise<string> {
  const today = todayInDubai();
  const windowDays = Number(contract.ppm_window_days) || config.scheduling.serviceWindowDays;
  /* Inside the original window when it is still open; else a fresh window from tomorrow. */
  const start = String(visit.window_end) >= today ? (String(visit.window_start) > today ? String(visit.window_start) : addDays(today, 1)) : addDays(today, 1);
  const end = String(visit.window_end) >= start ? String(visit.window_end) : addDays(start, windowDays - 1);
  const target = firstWorkingDay(start, end, { weekendDays: config.calendar.weekendDays, holidays: config.calendar.holidays });
  const { data: last } = await admin.from("amc_visits").select("visit_no").eq("contract_id", String(visit.contract_id)).order("visit_no", { ascending: false }).limit(1);
  const visitNo = Number((last?.[0] as Row | undefined)?.visit_no ?? 0) + 1;
  const { data: created, error } = await admin
    .from("amc_visits")
    .insert({
      contract_id: String(visit.contract_id),
      visit_no: visitNo,
      status: contract.ppm_confirmed_at ? "scheduled" : "not_scheduled",
      cycle_start: start,
      cycle_end: end,
      window_start: start,
      window_end: end,
      target_date: target,
      source: "remainder",
      remainder_of_visit_id: String(visit.id),
      created_by: actor.id,
    })
    .select("id")
    .single<Row>();
  if (error) throw fail(error);
  const { error: lineError } = await admin.from("amc_visit_lines").insert(
    lines.map((l) => ({
      visit_id: String(created.id),
      contract_id: String(visit.contract_id),
      entitlement_id: String(l.entitlement_id),
      service_id: String(l.service_id),
      service_label: String(l.service_label),
      occurrence: Number(l.occurrence),
      retry_of_line_id: String(l.id),
      home_cycle_start: start,
      home_cycle_end: end,
      home_window_start: start,
      home_window_end: end,
      home_target_date: target,
    })),
  );
  if (lineError) throw fail(lineError);
  await admin.from("amc_visit_changes").insert({
    contract_id: String(visit.contract_id),
    visit_id: String(created.id),
    change_type: "added",
    to_date: target,
    reason: `Remaining trade from visit ${String(visit.visit_no)}`,
    detail: { from: Number(visit.visit_no), services: lines.map((l) => String(l.service_label)) },
    actor_id: actor.id,
    actor_label: actor.label,
  });
  return String(created.id);
}

/* ------------------------------------------------------------------ */
/* The service report and Email 3 (DEV-404)                            */
/* ------------------------------------------------------------------ */

async function reportFacts(admin: Admin, visitId: string) {
  const { visit, contract, ownerId, lines } = await loadVisit(admin, visitId);
  const sheet = await loadSheet(admin, visitId);
  if (!sheet) throw new ContractError("The visit has no job sheet.", 409);
  const [{ data: checklist }, { data: photos }, { data: all }, { data: ents }, { data: owner }] = await Promise.all([
    admin.from("amc_visit_checklist_items").select("label, result, note, sort_order").eq("job_sheet_id", String(sheet.id)).order("sort_order"),
    admin.from("amc_visit_photos").select("kind, caption, storage_path").eq("job_sheet_id", String(sheet.id)).order("created_at"),
    admin.from("amc_visits").select("status").eq("contract_id", String(visit.contract_id)).neq("status", "cancelled"),
    admin.from("amc_contract_entitlements").select("service_id, call_out_class, entitlement_type, included_quantity, used_quantity").eq("contract_id", String(visit.contract_id)),
    ownerId ? admin.from("user_profile").select("full_name, email").eq("id", ownerId).maybeSingle<Row>() : Promise.resolve({ data: null }),
  ]);
  const visits = (all ?? []) as Row[];
  const done = visits.filter((v) => v.status === "completed" || v.status === "completed_with_additional_work" || v.status === "partially_completed").length;
  /* Email 3: "Free non emergency visits used: {Used} of {Allowed}" -- the non-emergency call-out allowance. */
  const nonEmergency = ((ents ?? []) as Row[]).filter((e) => e.call_out_class === "non_emergency" || e.service_id === "non-emergency");
  return {
    visit,
    contract,
    ownerId,
    owner: owner as Row | null,
    sheet,
    lines,
    checklist: (checklist ?? []) as Row[],
    photos: (photos ?? []) as Row[],
    total: visits.length,
    completed: done,
    remaining: Math.max(0, visits.length - done - visits.filter((v) => v.status === "not_completed").length),
    used: nonEmergency.reduce((s, e) => s + Number(e.used_quantity ?? 0), 0),
    allowed: nonEmergency.reduce((s, e) => s + Number(e.included_quantity ?? 0), 0),
  };
}

function reportHtml(f: Awaited<ReturnType<typeof reportFacts>>, photoUrls: Map<string, string>): string {
  const s = f.sheet;
  const customer = (f.contract.customer ?? {}) as Row;
  const row = (k: string, v: string | null) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v ?? "—")}</td></tr>`;
  const lineRows = f.lines
    .map((l) => {
      const group = str(l.outcome_group) as OutcomeGroup | null;
      const why = group ? `${OUTCOME_GROUPS[group].label}${str(l.outcome_reason) ? `: ${str(l.outcome_reason)}` : ""}` : "";
      return `<tr><td>${escapeHtml(String(l.service_label))}</td><td>${escapeHtml(String(l.status).replace(/_/g, " "))}</td><td>${escapeHtml(why)}</td></tr>`;
    })
    .join("");
  const checklist = f.checklist.length
    ? `<h2>Checklist</h2><table class="grid"><tr><th>Item</th><th>Result</th><th>Note</th></tr>${f.checklist
        .map((c) => `<tr><td>${escapeHtml(String(c.label))}</td><td>${escapeHtml(String(c.result).replace(/_/g, " "))}</td><td>${escapeHtml(str(c.note) ?? "")}</td></tr>`)
        .join("")}</table>`
    : "";
  const list = (title: string, items: string[]) => (items.length ? `<h2>${escapeHtml(title)}</h2><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "");
  const photos = f.photos.length
    ? `<h2>Photos</h2><div class="photos">${f.photos
        .map((p) => {
          const url = photoUrls.get(String(p.storage_path));
          return url ? `<figure><img src="${escapeHtml(url)}"/><figcaption>${escapeHtml(String(p.kind))}${str(p.caption) ? ` · ${escapeHtml(str(p.caption)!)}` : ""}</figcaption></figure>` : "";
        })
        .join("")}</div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Service report</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:32px;font-size:12px}
    h1{font-size:20px;margin:0 0 4px;color:#8b1d2c} h2{font-size:14px;margin:20px 0 6px;color:#8b1d2c}
    .muted{color:#6b7280} table{border-collapse:collapse;width:100%} th{text-align:left;color:#6b7280;font-weight:normal;width:30%;padding:4px 8px 4px 0;vertical-align:top}
    td{padding:4px 8px 4px 0;vertical-align:top} .grid th,.grid td{border-bottom:1px solid #e5e7eb;padding:6px 8px;width:auto}
    .photos{display:flex;flex-wrap:wrap;gap:8px} figure{margin:0;width:31%} img{width:100%;height:150px;object-fit:cover;border-radius:4px} figcaption{color:#6b7280;font-size:10px}
  </style></head><body>
    <h1>Service report</h1>
    <div class="muted">Yalla Fix It · AMC ${escapeHtml(String(f.contract.contract_number ?? ""))} · visit ${escapeHtml(String(f.visit.visit_no))} of ${f.total}</div>
    <h2>Visit</h2><table>
      ${row("Client", str(customer.customerName) ?? String(f.contract.customer_name ?? ""))}
      ${row("Property", String(f.contract.property_label ?? ""))}
      ${row("Arrived", s.arrived_at ? `${fmtDay(String(s.arrived_at))} ${fmtTime(String(s.arrived_at))}` : null)}
      ${row("Completed", s.completed_at ? `${fmtDay(String(s.completed_at))} ${fmtTime(String(s.completed_at))}` : null)}
      ${row("Signed by the client", str(s.client_signature_name))}
    </table>
    <h2>Work</h2><table class="grid"><tr><th>Service</th><th>Outcome</th><th>Reason</th></tr>${lineRows}</table>
    ${checklist}
    ${str(s.faults) ? `<h2>Faults found</h2><p>${escapeHtml(str(s.faults)!)}</p>` : ""}
    ${list("Consumables used", ((s.consumables ?? []) as Row[]).map((c) => `${String(c.item)} × ${String(c.quantity)}${str(c.unit) ? ` ${str(c.unit)}` : ""}`))}
    ${list("Additional work found (quoted separately)", ((s.additional_work ?? []) as Row[]).map((a) => String(a.description)))}
    ${list("Pending works", ((s.pending_works ?? []) as Row[]).map((p) => `${String(p.description)} (${String(p.reason)})`))}
    ${photos}
    <p class="muted" style="margin-top:24px">Visits this contract year: ${f.completed} done, ${f.remaining} remaining.</p>
  </body></html>`;
}

/**
 * Renders the report (PDF when this host can print, else HTML), stores it
 * as the visit's document, and sends Email 3 with the PDF attached (and
 * prepares the WhatsApp text with a link). report_sent_at is set when the
 * email goes; the 48-hour clock runs until then.
 */
export async function sendServiceReport(admin: Admin, visitId: string, actor: Actor, config: AmcConfig) {
  const f = await reportFacts(admin, visitId);
  const photoUrls = new Map<string, string>();
  if (f.photos.length) {
    const { data: signed } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrls(f.photos.map((p) => String(p.storage_path)), 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) photoUrls.set(s.path, s.signedUrl);
  }
  const html = reportHtml(f, photoUrls);
  const pdf = await renderPdf(html);
  const bytes = pdf ?? new TextEncoder().encode(html);
  const mime = pdf ? "application/pdf" : "text/html";
  const ext = pdf ? "pdf" : "html";
  const documentId = randomUUID();
  const path = `documents/visit/${visitId}/${documentId}.${ext}`;
  const { error: upload } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (upload) throw new ContractError(`Could not store the report: ${upload.message}`, 500);
  const title = `Service report, visit ${String(f.visit.visit_no)}`;
  const { data: versions } = await admin.from("amc_documents").select("version").eq("level", "visit").eq("entity_id", visitId).eq("category", "Service report").eq("title", title);
  const version = Math.max(0, ...((versions ?? []) as Row[]).map((v) => Number(v.version))) + 1;
  const { error: docError } = await admin.from("amc_documents").insert({
    id: documentId,
    level: "visit",
    entity_id: visitId,
    customer_id: str(f.contract.customer_id),
    category: "Service report",
    title,
    version,
    storage_path: path,
    file_name: `service-report-${String(f.contract.contract_number ?? "amc")}-visit-${String(f.visit.visit_no)}.${ext}`,
    mime_type: mime,
    size_bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    uploaded_by: actor.id,
  });
  if (docError) throw fail(docError);
  await admin.from("amc_visits").update({ report_document_id: documentId }).eq("id", visitId);

  const customer = (f.contract.customer ?? {}) as Row;
  const additional = ((f.sheet.additional_work ?? []) as Row[]).map((a) => String(a.description));
  const visitDate = f.sheet.completed_at ? fmtDay(String(f.sheet.completed_at)) : fmtDay(new Date().toISOString());
  const values = {
    "Client name": str(customer.customerName) ?? str(f.contract.customer_name) ?? "customer",
    Service: f.lines.map((l) => String(l.service_label)).join(", "),
    Seq: String(f.visit.visit_no),
    Total: String(f.total),
    Property: String(f.contract.property_label ?? ""),
    "Visit date": visitDate,
    Completed: String(f.completed),
    Remaining: String(f.remaining),
    Used: String(f.used),
    Allowed: String(f.allowed),
    "Additional work line": additional.length ? `Our technician noted ${additional.join("; ")}. A quotation will follow for your approval.` : "",
    "Coordinator name": str(f.owner?.full_name) ?? str(f.owner?.email) ?? "Yalla Fix It",
    "Report link": "",
  };
  const { data: link } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrl(path, 14 * 86_400);
  values["Report link"] = link?.signedUrl ?? "";
  const email = templateText("emailServiceReport", config.templates)!;
  const whatsappText = fillTemplate(templateText("messageServiceReport", config.templates)!.body, values).trim();
  const to = String(customer.customerEmail ?? "").trim();
  const cc = [str(f.owner?.email)].filter((e): e is string => Boolean(e) && e !== to);
  let outcome: "sent" | "failed" | "no_recipient" = "no_recipient";
  if (to) {
    try {
      const body = fillTemplate(email.body, values);
      const blocks = body.split(/\n{2,}/).filter((b) => b.trim());
      await sendEmail({
        to,
        ...(cc.length ? { cc } : {}),
        subject: fillTemplate(email.subject ?? "", values),
        html: clientEmailHtml({
          eyebrow: "AMC service report",
          heading: `Visit ${String(f.visit.visit_no)} of ${String(f.total)}: report`,
          greeting: blocks[0] ?? "",
          paragraphs: blocks.slice(1).map((b) => escapeEmailHtml(b).replace(/\n/g, "<br>")),
          details: [],
          ...(pdf ? {} : link?.signedUrl ? { cta: { label: "Open the report", url: link.signedUrl } } : {}),
        }),
        ...(pdf ? { attachment: { filename: `service-report-visit-${String(f.visit.visit_no)}.pdf`, content: Buffer.from(pdf).toString("base64"), contentType: "application/pdf" } } : {}),
      });
      outcome = "sent";
    } catch (e) {
      outcome = "failed";
      console.error("[amc:job-sheets] Email 3 failed:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }
  if (outcome === "sent") await admin.from("amc_visits").update({ report_sent_at: new Date().toISOString() }).eq("id", visitId);
  const submissionId = str(one(f.contract.submission)?.id);
  if (submissionId) {
    await recordSend(admin, {
      submissionId,
      versionNo: 1,
      document: "service_report",
      channel: "email",
      recipients: to ? [{ name: values["Client name"], address: to }] : [],
      cc,
      outcome,
      detail: `Visit ${String(f.visit.visit_no)} service report`,
      sentBy: actor.id,
    });
  }
  const phone = str(customer.customerPhone);
  return { outcome, documentId, message: whatsappText, whatsapp: phone ? whatsappUrl(phone, whatsappText) : null };
}

/* ------------------------------------------------------------------ */
/* The review queue                                                    */
/* ------------------------------------------------------------------ */

export async function reviewQueue(admin: Admin, now = new Date()) {
  const { data, error } = await admin
    .from("amc_visit_job_sheets")
    .select(`id, visit_id, contract_id, submitted_at, review_required, review_reasons, return_count, visit:amc_visits!amc_visit_job_sheets_visit_id_fkey(visit_no, report_due_at, report_sent_at, contract:amc_contracts!amc_visits_contract_id_fkey(contract_number, customer_name, property_label))`)
    .eq("status", "submitted")
    .order("submitted_at")
    .limit(200);
  if (error) {
    if (notMigrated(error)) return { migrated: false, items: [] };
    throw fail(error);
  }
  return {
    migrated: true,
    items: ((data ?? []) as unknown as Row[]).map((r) => {
      const v = one(r.visit) ?? {};
      const c = one(v.contract) ?? {};
      return {
        visitId: String(r.visit_id),
        contractId: String(r.contract_id),
        contractNumber: String(c.contract_number ?? ""),
        customerName: String(c.customer_name ?? ""),
        propertyLabel: String(c.property_label ?? ""),
        visitNo: Number(v.visit_no ?? 0),
        submittedAt: String(r.submitted_at),
        reviewRequired: Boolean(r.review_required),
        reviewReasons: strings(r.review_reasons) as ReviewReason[],
        returnCount: Number(r.return_count ?? 0),
        reportState: reportState(str(v.report_due_at), str(v.report_sent_at), now),
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* The daily sweep (job "job_sheets")                                  */
/* ------------------------------------------------------------------ */

/**
 * Job sheet not submitted some hours after the visit was due to end, and
 * the service report at risk of missing its 48 hours (BRD 6.2). Each is
 * claimed with its stamp first, so overlapping runs tell once.
 */
export async function runJobSheetSweep(admin: Admin, config: AmcConfig, now = new Date()) {
  const result = { notSubmitted: 0, reportsAtRisk: 0, skipped: null as string | null };
  const supervisors = supervisorsOf(config);
  const graceBefore = new Date(now.getTime() - config.scheduling.jobSheetGraceHours * 3_600_000).toISOString();
  const { data: overdue, error } = await admin
    .from("amc_visits")
    .select("id, contract_id, visit_no, scheduled_end, contract:amc_contracts!amc_visits_contract_id_fkey(contract_number, customer_name, submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id))")
    .in("status", [...EDITABLE_VISIT])
    .lt("scheduled_end", graceBefore)
    .is("job_sheet_overdue_notified_at", null)
    .limit(300);
  if (error) {
    if (notMigrated(error)) return { ...result, skipped: "not migrated" };
    throw new Error(error.message);
  }
  for (const v of (overdue ?? []) as unknown as Row[]) {
    const { data: claimed } = await admin.from("amc_visits").update({ job_sheet_overdue_notified_at: now.toISOString() }).eq("id", String(v.id)).is("job_sheet_overdue_notified_at", null).select("id");
    if (!claimed?.length) continue;
    const c = one(v.contract) ?? {};
    await notifyUsers(admin, {
      event: "job_sheet_not_submitted",
      userIds: [str(one(c.submission)?.owner_id), ...supervisors].filter((id): id is string => Boolean(id)),
      title: `Job sheet not submitted: ${String(c.contract_number ?? "")} visit ${String(v.visit_no)}`,
      body: `${String(c.customer_name ?? "")}: the visit was due to end ${fmtDay(String(v.scheduled_end))} ${fmtTime(String(v.scheduled_end))}.`,
      link: `/extensions/amc-contracts/${String(v.contract_id)}?tab=schedule&visit=${String(v.id)}`,
      entityType: "visit",
      entityId: String(v.id),
      contractId: String(v.contract_id),
      dedupeKey: `job_sheet_not_submitted:${String(v.id)}`,
    });
    result.notSubmitted += 1;
  }

  const warnBy = new Date(now.getTime() + 12 * 3_600_000).toISOString();
  const { data: risky } = await admin
    .from("amc_visits")
    .select("id, contract_id, visit_no, report_due_at, contract:amc_contracts!amc_visits_contract_id_fkey(contract_number, customer_name, submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id))")
    .is("report_sent_at", null)
    .not("report_due_at", "is", null)
    .lte("report_due_at", warnBy)
    .is("report_at_risk_notified_at", null)
    .neq("status", "not_completed")
    .limit(300);
  for (const v of (risky ?? []) as unknown as Row[]) {
    const { data: claimed } = await admin.from("amc_visits").update({ report_at_risk_notified_at: now.toISOString() }).eq("id", String(v.id)).is("report_at_risk_notified_at", null).select("id");
    if (!claimed?.length) continue;
    const c = one(v.contract) ?? {};
    const late = String(v.report_due_at) < now.toISOString();
    await notifyUsers(admin, {
      event: "service_report_at_risk",
      userIds: [str(one(c.submission)?.owner_id), ...supervisors].filter((id): id is string => Boolean(id)),
      title: `${late ? "Service report late" : "Service report due soon"}: ${String(c.contract_number ?? "")} visit ${String(v.visit_no)}`,
      body: `${String(c.customer_name ?? "")}: due by ${fmtDay(String(v.report_due_at))} ${fmtTime(String(v.report_due_at))} (contract clause 1.2: within 48 hours of the visit).`,
      link: `/extensions/amc-contracts/${String(v.contract_id)}?tab=schedule&visit=${String(v.id)}`,
      entityType: "visit",
      entityId: String(v.id),
      contractId: String(v.contract_id),
      dedupeKey: `service_report_at_risk:${String(v.id)}`,
    });
    result.reportsAtRisk += 1;
  }
  return result;
}
