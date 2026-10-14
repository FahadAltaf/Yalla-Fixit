import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FSM_BASE_URL,
  FsmConfigError,
  fsmFetch,
  fsmGetRecord,
  getFsmAccessToken,
} from "@/lib/server/zoho/fsm-client";
import { hasColumn } from "@/lib/server/snagging/columns";
import {
  SyncError,
  ensureContact,
  estimateAddress,
  fsmReason,
  fsmSyncEnabled,
  fsmSyncReady,
  lineKind,
  log,
  resolveServiceMap,
  serviceFor,
  syncQuotationToFsm,
} from "@/lib/server/snagging/fsm-quotation-sync";

/**
 * An approved snagging job in Zoho FSM, completed, with its report (SNG-189):
 * "The completed job is in FSM with the report attached, so finance can
 * invoice."
 *
 *   - its quotation is brought into FSM first (client and estimate);
 *   - the job is created as an FSM Work Order (Type "Inspection"), with the
 *     quotation's lines as its service lines, for the same contact;
 *   - the work order is completed. Snagging keeps its appointments in the
 *     portal (SNG-190), so there are none in FSM to complete it from, and the
 *     completion is forced ($force_complete);
 *   - the client report PDF is uploaded and attached to the work order. The
 *     server's PDF when one was generated on approval; otherwise the one the
 *     report page builds and hands over (attachReportPdf). A newer report
 *     version is attached when it appears.
 *
 * Like the quotation sync it never throws, logs every FSM call to
 * snagging_fsm_sync_log (against the job), records its state on the job,
 * and is off unless SNAGGING_FSM_SYNC=on.
 */

type Admin = SupabaseClient;
type Row = Record<string, any>;

const LOCK_MS = 3 * 60 * 1000;
const BUCKET = "snagging";
const DONE_STATUSES = /completed|closed/i;

export async function fsmJobSyncReady(admin: Admin): Promise<boolean> {
  return (await fsmSyncReady(admin)) && (await hasColumn(admin, "snagging_jobs", "fsm_work_order_id"));
}

/** The job's approved quotation: its own, or (a de-snag round) the one raised for it. */
async function jobQuotation(admin: Admin, jobId: string): Promise<Row | null> {
  const { data } = await admin
    .from("snagging_quotations")
    .select("id, quote_number, status, quote_kind, client_id, lines, total, tax_rate")
    .eq("job_id", jobId)
    .neq("quote_kind", "visit")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/** The newest report version with a stored PDF, for this job's report. */
async function latestReportPdf(admin: Admin, jobId: string) {
  const { data } = await admin
    .from("snagging_report_versions")
    .select("version, pdf_path")
    .eq("job_id", jobId)
    .not("pdf_path", "is", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { version: number; pdf_path: string } | null;
  if (!row?.pdf_path) return null;
  const { data: blob, error } = await admin.storage.from(BUCKET).download(row.pdf_path);
  if (error || !blob) return null;
  return { version: row.version, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

/** The newest report version number, whether or not it has a PDF. */
async function latestReportVersion(admin: Admin, jobId: string): Promise<number | null> {
  const { data } = await admin
    .from("snagging_report_versions")
    .select("version")
    .eq("job_id", jobId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { version: number } | null)?.version ?? null;
}

/* Upload to FSM's file store, then attach to the work order (Zoho:
   "Upload a file" and "Add an attachment"). */
async function attachToWorkOrder(token: string, workOrderId: string, fileName: string, bytes: Uint8Array) {
  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart], { type: "application/pdf" }), fileName);
  let upload: Response;
  try {
    upload = await fetch(`${FSM_BASE_URL}/files`, {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new SyncError(
      `The report could not be uploaded to FSM: ${error instanceof Error ? error.message : "network error"}`,
      "report_upload",
    );
  }
  const uploaded = await upload.json().catch(() => null);
  const fileId = uploaded?.data?.file_id ?? uploaded?.file_id;
  if (!upload.ok || !fileId) {
    throw new SyncError(fsmReason(uploaded, upload.status), "report_upload", uploaded);
  }
  const attach = await fsmFetch(
    token,
    `/Work_Orders/${encodeURIComponent(workOrderId)}/Attachments`,
    { method: "POST", body: JSON.stringify({ data: [{ File_Id: String(fileId), File_Name: fileName }] }) },
    { retry: false },
  );
  if (!attach.ok) throw new SyncError(fsmReason(attach.json, attach.status), "report_attach", attach.json);
}

async function workOrderTransition(
  token: string,
  workOrderId: string,
  pattern: RegExp,
  data?: Record<string, unknown>,
): Promise<{ done: boolean; reason?: string; detail?: unknown }> {
  const list = await fsmFetch(token, `/Work_Orders/${encodeURIComponent(workOrderId)}/actions/blueprint/transitions`);
  if (!list.ok) return { done: false, reason: fsmReason(list.json, list.status), detail: list.json };
  const transitions = (list.json?.transitions ?? []) as Row[];
  const match = transitions.find((t) => t.enabled !== false && pattern.test(String(t.name ?? "")));
  if (!match) {
    return {
      done: false,
      reason: `FSM offers no "complete" from status "${list.json?.process_info?.field_value ?? "unknown"}"`,
      detail: transitions.map((t) => t.name),
    };
  }
  const res = await fsmFetch(token, `/Work_Orders/${encodeURIComponent(workOrderId)}/actions/blueprint`, {
    method: "PUT",
    body: JSON.stringify({ blueprint: [{ transition_id: String(match.id), ...(data ? { data } : {}) }] }),
  });
  return res.ok ? { done: true } : { done: false, reason: fsmReason(res.json, res.status), detail: res.json };
}

async function readWorkOrder(token: string, id: string): Promise<Row | null> {
  const res = await fsmGetRecord<Row>(token, "Work_Orders", id);
  return res.ok ? (res.record ?? null) : null;
}

/**
 * Brings FSM in line with one approved job. `pdf` is a report the caller
 * already has (the report page's), attached in place of the server's.
 */
export async function syncJobToFsm(
  admin: Admin,
  jobId: string,
  options: { actorId?: string | null; pdf?: { bytes: Uint8Array; version: number | null } } = {},
): Promise<{ ok: boolean; message: string }> {
  if (!fsmSyncEnabled()) return { ok: false, message: "Zoho FSM sync is switched off (SNAGGING_FSM_SYNC)." };
  if (!(await fsmJobSyncReady(admin))) {
    return { ok: false, message: "The Zoho FSM sync migration has not been applied yet." };
  }
  const actorId = options.actorId ?? null;

  const now = new Date();
  const { data: claimed } = await admin
    .from("snagging_jobs")
    .update({ fsm_lock_until: new Date(now.getTime() + LOCK_MS).toISOString(), fsm_dirty: false })
    .eq("id", jobId)
    .or(`fsm_lock_until.is.null,fsm_lock_until.lt.${now.toISOString()}`)
    .select("id");
  if (!claimed || claimed.length === 0) {
    await admin.from("snagging_jobs").update({ fsm_dirty: true }).eq("id", jobId);
    return { ok: true, message: "A sync is already running; it will include this." };
  }
  try {
    let result = await syncJobOnce(admin, jobId, actorId, options.pdf);
    const { data } = await admin.from("snagging_jobs").select("fsm_dirty").eq("id", jobId).maybeSingle();
    if ((data as Row | null)?.fsm_dirty) {
      await admin.from("snagging_jobs").update({ fsm_dirty: false }).eq("id", jobId);
      result = await syncJobOnce(admin, jobId, actorId);
    }
    return result;
  } finally {
    await admin.from("snagging_jobs").update({ fsm_lock_until: null }).eq("id", jobId);
  }
}

async function syncJobOnce(
  admin: Admin,
  jobId: string,
  actorId: string | null,
  pdf?: { bytes: Uint8Array; version: number | null },
): Promise<{ ok: boolean; message: string }> {
  const { data: jobRow } = await admin
    .from("snagging_jobs")
    .select(
      "id, code, status, client_id, property_id, unit_label, building_name, fsm_work_order_id, fsm_work_order_number, fsm_status, fsm_report_version",
    )
    .eq("id", jobId)
    .maybeSingle();
  const job = jobRow as Row | null;
  if (!job) return { ok: false, message: "Job not found" };
  if (job.status !== "approved" && job.status !== "delivered") {
    return { ok: false, message: "Only an approved inspection is sent to FSM as a completed job." };
  }

  try {
    const token = await getFsmAccessToken(admin);
    const quote = await jobQuotation(admin, jobId);
    if (!quote) {
      throw new SyncError("This job has no quotation, so FSM has no client or lines to bill. Raise it from a quotation.", "work_order_build");
    }

    // The client and the estimate first: the work order bills the same contact.
    const quoteSync = await syncQuotationToFsm(admin, quote.id, { actorId });
    if (!quoteSync.ok) {
      throw new SyncError(`The quotation could not be brought into FSM first: ${quoteSync.message}`, "work_order_build");
    }

    let workOrderId = job.fsm_work_order_id as string | null;
    let status = job.fsm_status as string | null;

    if (!workOrderId) {
      const [{ data: client }, { data: property }] = await Promise.all([
        admin
          .from("snagging_clients")
          .select("id, name, email, phone, company, fsm_contact_id, fsm_company_id")
          .eq("id", quote.client_id ?? job.client_id)
          .maybeSingle(),
        job.property_id
          ? admin.from("snagging_properties").select("unit_label, building_name, community").eq("id", job.property_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (!client) throw new SyncError("The job has no client to send to FSM", "work_order_build");
      const contact = await ensureContact(admin, token, client as Row, property as Row | null, quote.id, actorId);
      const contactRecord = (await fsmGetRecord(token, "Contacts", contact.contactId)).record ?? null;
      const services = await resolveServiceMap(admin, token, { quotationId: quote.id, jobId, actorId });
      const lines = (quote.lines ?? []) as { description: string; qty: number; unit_price: number }[];
      const where = [job.unit_label, job.building_name].filter(Boolean).join(", ");
      const serviceAddress = estimateAddress(contactRecord?.Service_Address, "Service");
      const billingAddress = estimateAddress(contactRecord?.Billing_Address, "Billing");

      const body = {
        data: [
          {
            Summary: `${job.code} · Snagging inspection${where ? ` · ${where}` : ""} · ${quote.quote_number}`.slice(0, 250),
            Type: "Inspection",
            Contact: contact.contactId,
            Company: contact.companyId ?? null,
            ...(serviceAddress ? { Service_Address: { id: serviceAddress.id } } : {}),
            ...(billingAddress ? { Billing_Address: { id: billingAddress.id } } : {}),
            Service_Line_Items: lines.map((line, index) => {
              return {
                Service: serviceFor(services, lineKind(line.description)),
                Description: line.description,
                Quantity: Number(line.qty) || 1,
                List_Price: Number(line.unit_price) || 0,
                Sequence: index + 1,
              };
            }),
          },
        ],
      };
      const created = await fsmFetch(token, "/Work_Orders", { method: "POST", body: JSON.stringify(body) }, { retry: false });
      if (!created.ok) throw new SyncError(fsmReason(created.json, created.status), "work_order_create", created.json);
      workOrderId = String(created.json?.data?.Work_Orders?.[0]?.id ?? "");
      if (!workOrderId) throw new SyncError("FSM created the work order but sent no id back", "work_order_create", created.json);
      const record = await readWorkOrder(token, workOrderId);
      status = (record?.Status as string | undefined) ?? null;
      await admin
        .from("snagging_jobs")
        .update({
          fsm_work_order_id: workOrderId,
          fsm_work_order_number: (record?.Name as string | undefined) ?? null,
          fsm_status: status,
        })
        .eq("id", jobId);
      await log(admin, {
        quotationId: quote.id,
        jobId,
        action: "work_order_create",
        status: "success",
        recordId: workOrderId,
        message: `Work order ${record?.Name ?? workOrderId} created in FSM`,
        actorId,
      });
    }

    // Completed: forced, as snagging keeps its appointments in the portal.
    if (!status || !DONE_STATUSES.test(status)) {
      const done = await workOrderTransition(token, workOrderId, /^complete/i, {
        $force_complete: true,
        Notes: `Inspection ${job.code} approved in the portal.`,
      });
      await log(admin, {
        quotationId: quote.id,
        jobId,
        action: "work_order_complete",
        status: done.done ? "success" : "failed",
        recordId: workOrderId,
        message: done.done ? "Work order completed in FSM" : done.reason,
        detail: done.detail,
        actorId,
      });
      if (!done.done) throw new SyncError(done.reason ?? "FSM could not complete the work order", "work_order_complete");
      status = ((await readWorkOrder(token, workOrderId))?.Status as string | undefined) ?? status;
    }

    // The report, for finance: the newest version not attached yet.
    const attachedVersion = (job.fsm_report_version as number | null) ?? 0;
    const report =
      pdf ??
      (await (async () => {
        const stored = await latestReportPdf(admin, jobId);
        return stored && stored.version > attachedVersion ? stored : null;
      })());
    let reportNote = "";
    if (report && (report.version === null || report.version > attachedVersion || pdf)) {
      const fileName = `${job.code}-snagging-report${report.version ? `-v${report.version}` : ""}.pdf`;
      await attachToWorkOrder(token, workOrderId, fileName, report.bytes);
      const version = report.version ?? (await latestReportVersion(admin, jobId)) ?? attachedVersion + 1;
      await admin.from("snagging_jobs").update({ fsm_report_version: version }).eq("id", jobId);
      await log(admin, {
        quotationId: quote.id,
        jobId,
        action: "report_attach",
        status: "success",
        recordId: workOrderId,
        message: `Report ${fileName} attached to the work order`,
        actorId,
      });
    } else if (!attachedVersion) {
      reportNote = " The report is not attached yet: attach it from the report page.";
      await log(admin, {
        quotationId: quote.id,
        jobId,
        action: "report_attach",
        status: "skipped",
        recordId: workOrderId,
        message: "No report PDF on the server yet. Attach it from the job's report page.",
        actorId,
      });
    }

    await admin
      .from("snagging_jobs")
      .update({ fsm_status: status, fsm_synced_at: new Date().toISOString(), fsm_error: null })
      .eq("id", jobId);
    return { ok: true, message: `Completed in FSM as work order ${job.fsm_work_order_number ?? workOrderId}.${reportNote}` };
  } catch (err) {
    const message =
      err instanceof FsmConfigError
        ? "The Zoho FSM connection is not set up (no OAuth token)."
        : err instanceof Error
          ? err.message
          : "FSM sync failed";
    await admin.from("snagging_jobs").update({ fsm_error: message }).eq("id", jobId);
    await log(admin, {
      quotationId: null,
      jobId,
      action: err instanceof SyncError ? err.action : "job_sync",
      status: "failed",
      message,
      detail: err instanceof SyncError ? err.detail : undefined,
      actorId,
    });
    return { ok: false, message };
  }
}

/** Asks for the job's sync once the caller has its answer. A no-op when off. */
export function queueJobFsmSync(admin: Admin, jobId: string, actorId?: string | null) {
  if (!fsmSyncEnabled()) return;
  const run = () =>
    syncJobToFsm(admin, jobId, { actorId }).catch((err) => console.error("FSM job sync failed:", err));
  try {
    after(run);
  } catch {
    void run();
  }
}
