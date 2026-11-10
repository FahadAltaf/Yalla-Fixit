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
  log,
  convertEstimate,
  quotationAddress,
  resolveServiceMap,
  serviceLineItems,
  serviceTaxes,
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
  /*
    FSM keeps attachments on a note: the uploaded file goes onto the work
    order as a note carrying it ("Create a Note": $attachments takes the
    file ids). There is no attachment call on the work order itself.
  */
  const attach = await fsmFetch(
    token,
    `/Work_Orders/${encodeURIComponent(workOrderId)}/Notes`,
    {
      method: "POST",
      body: JSON.stringify({
        data: [
          {
            Note_Title: "Snagging inspection report",
            Note_Content: `The client report for this inspection: ${fileName}`,
            $attachments: [String(fileId)],
          },
        ],
      }),
    },
    { retry: false },
  );
  if (!attach.ok) throw new SyncError(fsmReason(attach.json, attach.status), "report_attach", attach.json);
}

/* One blueprint step on a record (Zoho: "List transitions", then a PUT with the transition's id). */
async function blueprintTransition(
  token: string,
  module: "Work_Orders" | "Service_Appointments",
  recordId: string,
  pattern: RegExp,
  data?: Record<string, unknown>,
  label = "complete",
): Promise<{ done: boolean; reason?: string; detail?: unknown }> {
  const path = `/${module}/${encodeURIComponent(recordId)}/actions/blueprint`;
  const list = await fsmFetch(token, `${path}/transitions`);
  if (!list.ok) return { done: false, reason: fsmReason(list.json, list.status), detail: list.json };
  const transitions = (list.json?.transitions ?? []) as Row[];
  const match = transitions.find((t) => t.enabled !== false && pattern.test(String(t.name ?? "")));
  if (!match) {
    return {
      done: false,
      reason: `FSM offers no "${label}" from status "${list.json?.process_info?.field_value ?? "unknown"}"`,
      detail: transitions.map((t) => t.name),
    };
  }
  const res = await fsmFetch(token, path, {
    method: "PUT",
    body: JSON.stringify({ blueprint: [{ transition_id: String(match.id), ...(data ? { data } : {}) }] }),
  });
  return res.ok ? { done: true } : { done: false, reason: fsmReason(res.json, res.status), detail: res.json };
}

function workOrderTransition(token: string, workOrderId: string, pattern: RegExp, data?: Record<string, unknown>) {
  return blueprintTransition(token, "Work_Orders", workOrderId, pattern, data);
}

type Technician = { resourceId: string; name: string; email: string; active: boolean };

/** FSM's technicians (users with a service resource), with whether FSM lets them work. */
async function fsmTechnicians(token: string): Promise<Technician[]> {
  const out: Technician[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = await fsmFetch(token, `/users?page=${page}&per_page=200`);
    if (!res.ok) break;
    for (const u of (res.json?.users ?? []) as Row[]) {
      if (!u.Service_Resources?.id) continue;
      out.push({
        resourceId: String(u.Service_Resources.id),
        name: String(u.full_name ?? u.Service_Resources.Name ?? u.email ?? ""),
        email: String(u.email ?? "").toLowerCase(),
        /* An inactive user's appointment can be dispatched, but FSM refuses Start Work on it. */
        active: u.client_status === "Active" && u.Service_Resources.isActive !== false,
      });
    }
    if (!res.json?.info?.more_records) break;
  }
  return out;
}

/**
 * The FSM technician an inspection's appointment is booked to: the
 * inspector's own, matched on their email, when FSM lets them work; else
 * the one the office books portal-made inspections to
 * (SNAGGING_FSM_SERVICE_RESOURCE_ID); else why there is none.
 */
function resourceForInspector(
  technicians: Technician[],
  inspector: { email: string | null; name: string | null },
): { resourceId: string } | { reason: string } {
  const own = inspector.email ? technicians.find((t) => t.email === inspector.email!.trim().toLowerCase()) : undefined;
  if (own?.active) return { resourceId: own.resourceId };
  const fallback = process.env.SNAGGING_FSM_SERVICE_RESOURCE_ID?.trim();
  if (fallback) return { resourceId: fallback };
  const who = inspector.name ?? "The inspector";
  return {
    reason: own
      ? `${who}'s FSM user (${own.name}, ${own.email}) is inactive, and FSM does not let an inactive technician start work`
      : `${who} has no technician in FSM (matched on ${inspector.email ?? "no email"})`,
  };
}

/**
 * Completes a work order the way this FSM account completes one: through
 * its service appointment (SNG-189). The work order has no "Complete" of its
 * own from New; the appointment is dispatched, started and completed, and
 * completing it with $complete_wo completes the work order (Zoho: "Complete
 * Work for Service Appointment").
 *
 * The inspection's appointment is made when the work order has none: on the
 * day of the inspection, for the inspector's FSM service resource, covering
 * every service line. One already on the work order is used instead, so a
 * retry carries on from where the last attempt stopped.
 */
async function completeThroughAppointment(
  token: string,
  workOrderId: string,
  job: Row,
  inspector: { email: string | null; name: string | null },
): Promise<{ done: boolean; reason?: string; detail?: unknown; appointment?: string }> {
  const wo = await readWorkOrder(token, workOrderId);
  if (!wo) return { done: false, reason: "The work order could not be read from FSM" };

  const live = ((wo.Appointments_X_Services ?? []) as Row[]).find(
    (axs) => axs.Service_Appointment?.id && axs.is_line_item_active !== false && !/cancel/i.test(String(axs.SLI_Status ?? "")),
  );
  let appointmentId = live ? String(live.Service_Appointment.id) : null;
  let appointmentName = live ? ((live.Service_Appointment.name as string | undefined) ?? null) : null;
  const technicians = await fsmTechnicians(token);

  if (appointmentId) {
    /*
      An appointment already on the work order (an earlier attempt, or the
      office's own) carries on from where it stopped. One booked to a
      technician FSM no longer lets work cannot be started, and FSM only
      says "Error occured while processing blueprint actions": the reason
      is said instead, and the office reassigns it in FSM before Retry.
    */
    const appointment = (await fsmGetRecord<Row>(token, "Service_Appointments", appointmentId)).record ?? null;
    const leadId = String(appointment?.Lead?.id ?? "");
    const lead = technicians.find((t) => t.resourceId === leadId);
    const started = /in progress|completed/i.test(String(appointment?.Status ?? ""));
    if (lead && !lead.active && !started) {
      return {
        done: false,
        appointment: appointmentName ?? appointmentId,
        reason: `appointment ${appointmentName ?? appointmentId} is booked to ${lead.name} (${lead.email}), whose FSM user is inactive, and FSM does not let an inactive technician start work. Reassign it in FSM to an active technician, then Retry`,
      };
    }
  }

  if (!appointmentId) {
    const pick = resourceForInspector(technicians, inspector);
    if ("reason" in pick) {
      return { done: false, reason: `${pick.reason}, so no appointment was made to complete the work order` };
    }
    const resource = pick.resourceId;
    const lineIds = ((wo.Service_Line_Items ?? []) as Row[]).map((line) => String(line.id)).filter(Boolean);
    if (lineIds.length === 0) return { done: false, reason: "The work order has no service lines to put on an appointment" };
    /* The day it was inspected (its appointment, else when it was submitted), in Dubai. */
    const day = new Date(String(job.appointment_at ?? job.submitted_at ?? new Date().toISOString()));
    const date = job.appointment_at || job.submitted_at
      ? new Date(day.getTime() + 4 * 3600_000).toISOString().slice(0, 10)
      : String(job.scheduled_date ?? day.toISOString().slice(0, 10));
    const created = await fsmFetch(
      token,
      "/Service_Appointments",
      {
        method: "POST",
        body: JSON.stringify({
          data: [
            {
              Summary: `${job.code} · Snagging inspection`.slice(0, 250),
              Schedule_Type: "All Day",
              Appointment_Date: date,
              Due_Date: date,
              Scheduled_Duration: 2 * 3600,
              $Service_Line_Items: lineIds,
              $Service_Resources: [resource],
              $allow_overlapping: true,
            },
          ],
        }),
      },
      { retry: false },
    );
    if (!created.ok) return { done: false, reason: `The appointment could not be made: ${fsmReason(created.json, created.status)}`, detail: created.json };
    appointmentId = String(created.json?.data?.[0]?.id ?? "");
    if (!appointmentId) return { done: false, reason: "FSM made the appointment but sent no id back", detail: created.json };
    /* The create answer carries no name (AP-1234); it is read back for the log. */
    appointmentName =
      (created.json?.data?.[0]?.Name as string | undefined) ??
      ((await fsmGetRecord<Row>(token, "Service_Appointments", appointmentId)).record?.Name as string | undefined) ??
      null;
  }

  /* Each step only when FSM offers it, so an appointment already dispatched or started carries on. */
  const steps: Array<[RegExp, string, Record<string, unknown> | undefined]> = [
    [/^dispatch/i, "dispatch", undefined],
    [/^start/i, "start work", undefined],
    [/^complete/i, "complete work", { $complete_wo: true, $complete_pc_li: true }],
  ];
  let last: { done: boolean; reason?: string; detail?: unknown } = { done: false };
  for (const [pattern, label, data] of steps) {
    last = await blueprintTransition(token, "Service_Appointments", appointmentId, pattern, data, label);
    /* A step that is not offered was already taken (or is not part of this account's flow). */
    if (!last.done && !/offers no/i.test(String(last.reason ?? ""))) break;
  }
  /* Whatever the last step said, the work order's own status is the answer. */
  const after = await readWorkOrder(token, workOrderId);
  if (DONE_STATUSES.test(String(after?.Status ?? ""))) return { done: true, appointment: appointmentName ?? appointmentId };
  return { ...last, done: false, appointment: appointmentName ?? appointmentId };
}

/**
 * The work order already made for this job: among the contact's work
 * orders, newest first, the one whose Estimate links back to the estimate,
 * or one the portal made without that link (see the create below), which
 * it names starting with the job's code.
 */
async function workOrderOfEstimate(
  token: string,
  contactId: string,
  estimateId: string | null,
  jobCode: string | null,
): Promise<Row | null> {
  const res = await fsmFetch(
    token,
    `/Contacts/${encodeURIComponent(contactId)}/Work_Orders?per_page=50`,
  );
  if (!res.ok) return null;
  const rows = ((res.json?.data ?? []) as Row[]).sort((a, b) =>
    String(b.Created_Time ?? "").localeCompare(String(a.Created_Time ?? "")),
  );
  const prefix = jobCode ? `${jobCode} ·` : null;
  for (const row of rows.slice(0, 10)) {
    if (prefix && String(row.Summary ?? "").startsWith(prefix)) return row;
    if (!estimateId) continue;
    const full = row.Estimate?.id ? row : await readWorkOrder(token, String(row.id));
    if (String(full?.Estimate?.id ?? "") === estimateId) return row;
    if (prefix && String(full?.Summary ?? "").startsWith(prefix)) return row;
  }
  return null;
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
      "id, code, status, client_id, property_id, unit_label, building_name, inspector_id, appointment_at, submitted_at, scheduled_date, fsm_work_order_id, fsm_work_order_number, fsm_status, fsm_report_version",
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
    /* What FSM says now (an appointment, or the office, moves it on), not what was read when it was made. */
    if (workOrderId) status = ((await readWorkOrder(token, workOrderId))?.Status as string | undefined) ?? status;

    if (!workOrderId) {
      const [{ data: client }, { data: property }, { data: quoteFsm }] = await Promise.all([
        admin
          .from("snagging_clients")
          .select("id, name, email, phone, company, fsm_contact_id, fsm_company_id")
          .eq("id", quote.client_id ?? job.client_id)
          .maybeSingle(),
        job.property_id
          ? admin.from("snagging_properties").select("unit_label, building_name, community").eq("id", job.property_id).maybeSingle()
          : Promise.resolve({ data: null }),
        admin.from("snagging_quotations").select("fsm_estimate_id").eq("id", quote.id).maybeSingle(),
      ]);
      if (!client) throw new SyncError("The job has no client to send to FSM", "work_order_build");
      const contact = await ensureContact(admin, token, client as Row, property as Row | null, quote.id, actorId);
      const estimateId = ((quoteFsm as Row | null)?.fsm_estimate_id as string | null) ?? null;

      /*
        The work order is made the way the office makes one, and linked to
        the approved estimate, which is what finance invoices from: the
        estimate is marked "Converted to Work Order" (its "Convert To Work
        Order" step only changes its status through the API), and the work
        order is created carrying the estimate in its Estimate field.

        A work order already linked to the estimate (a retry after it was
        made) is used rather than a second one.
      */
      const existing = await workOrderOfEstimate(token, contact.contactId, estimateId, (job.code as string | null) ?? null);
      if (existing) {
        workOrderId = String(existing.id);
      } else {
        if (estimateId) {
          const converted = await convertEstimate(token, estimateId, `Inspection ${job.code} approved in the portal.`);
          // Not offered once it is already converted: nothing to log then.
          if (converted.done || !/convert/i.test(String(converted.reason ?? ""))) {
            await log(admin, {
              quotationId: quote.id,
              jobId,
              action: "work_order_convert",
              status: converted.done ? "success" : "skipped",
              recordId: estimateId,
              message: converted.done
                ? `Estimate ${quote.quote_number} marked converted to work order in FSM`
                : `Estimate not marked converted: ${converted.reason}`,
              detail: converted.detail,
              actorId,
            });
          }
        }

        const contactRecord = (await fsmGetRecord(token, "Contacts", contact.contactId)).record ?? null;
        const services = await resolveServiceMap(admin, token, { quotationId: quote.id, jobId, actorId });
        const taxes = await serviceTaxes(token, services);
        const where = [job.unit_label, job.building_name].filter(Boolean).join(", ");
        // The unit inspected, when FSM has it (added there first if new); else the contact default.
        const jobAddress = await quotationAddress(admin, token, contact.contactId, job.property_id, actorId);
        const serviceAddress = estimateAddress(jobAddress ?? contactRecord?.Service_Address, "Service");
        // No billing address on the contact: bill the service address, as on the estimate.
        const billingAddress = estimateAddress(
          contactRecord?.Billing_Address ?? jobAddress ?? contactRecord?.Service_Address,
          "Billing",
        );

        const body = {
          data: [
            {
              Summary: `${job.code} · Snagging inspection${where ? ` · ${where}` : ""} · ${quote.quote_number}`.slice(0, 250),
              Type: "Inspection",
              Contact: contact.contactId,
              Company: contact.companyId ?? null,
              ...(estimateId ? { Estimate: estimateId } : {}),
              ...(contactRecord?.Email ? { Email: contactRecord.Email } : {}),
              // FSM requires Phone, as on the estimate.
              ...(contactRecord?.Phone || contactRecord?.Mobile
                ? { Phone: contactRecord.Phone ?? contactRecord.Mobile }
                : {}),
              ...(serviceAddress ? { Service_Address: { id: serviceAddress.id } } : {}),
              ...(billingAddress ? { Billing_Address: { id: billingAddress.id } } : {}),
              ...(jobAddress?.Territory?.id ? { Territory: String(jobAddress.Territory.id) } : {}),
              // With the unit and the VAT, as on the estimate: without the tax FSM refuses it.
              Service_Line_Items: serviceLineItems(quote, services, taxes),
            },
          ],
        };
        let created = await fsmFetch(token, "/Work_Orders", { method: "POST", body: JSON.stringify(body) }, { retry: false });
        /*
          FSM can refuse to link a work order to its estimate, answering
          "The record is in waiting for approval" although the estimate is
          approved and converted (seen on 18052, 15 Oct 2026: the same work
          order went through the moment the Estimate link was left out, and
          no rule or record in the account was waiting for anything). The
          work order is what finance invoices from, so it is made without
          the link rather than not at all: same contact, address, lines and
          total, and the quotation number in its summary. Logged, so the
          activity says why the link is missing.
        */
        if (
          !created.ok &&
          estimateId &&
          /waiting for approval/i.test(fsmReason(created.json, created.status))
        ) {
          const unlinked = { data: [{ ...body.data[0] }] };
          delete (unlinked.data[0] as Row).Estimate;
          created = await fsmFetch(token, "/Work_Orders", { method: "POST", body: JSON.stringify(unlinked) }, { retry: false });
          if (created.ok) {
            /* The link is what finance invoices from (SNG-189): asked for again on the work order now that it exists. */
            const newId = String(created.json?.data?.Work_Orders?.[0]?.id ?? "");
            const linked = newId
              ? await fsmFetch(
                  token,
                  `/Work_Orders/${encodeURIComponent(newId)}`,
                  { method: "PUT", body: JSON.stringify({ data: [{ Estimate: estimateId }] }) },
                  { retry: false },
                )
              : null;
            await log(admin, {
              quotationId: quote.id,
              jobId,
              action: "work_order_unlinked",
              status: linked?.ok ? "success" : "failed",
              recordId: estimateId,
              message: linked?.ok
                ? `FSM would not link the work order to estimate ${quote.quote_number} when creating it; the link was added to the work order afterwards`
                : `FSM would not link the work order to estimate ${quote.quote_number} ("waiting for approval"${linked ? `; again afterwards: ${fsmReason(linked.json, linked.status)}` : ""}), so it has no link; the quotation number is in its summary`,
              detail: linked?.json,
              actorId,
            });
          }
        }
        if (!created.ok) throw new SyncError(fsmReason(created.json, created.status), "work_order_create", created.json);
        workOrderId = String(created.json?.data?.Work_Orders?.[0]?.id ?? "");
        if (!workOrderId) throw new SyncError("FSM created the work order but sent no id back", "work_order_create", created.json);
      }

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
        message: existing
          ? estimateId && String(record?.Estimate?.id ?? "") === estimateId
            ? `Work order ${record?.Name ?? workOrderId} found, linked to estimate ${quote.quote_number}`
            : `Work order ${record?.Name ?? workOrderId} found for this job (not linked to estimate ${quote.quote_number})`
          : `Work order ${record?.Name ?? workOrderId} created in FSM${estimateId ? ` from estimate ${quote.quote_number}` : ""}`,
        actorId,
      });
    }

    /*
      Completed in FSM. The work order's own "Complete" when FSM offers it;
      otherwise the way this account completes one, through its service
      appointment (SNG-189): snagging books its visits in the portal
      (SNG-190), so the inspection's appointment is made here, on the day
      it was inspected, and dispatched, started and completed with the
      work order. A step FSM refuses is logged as failed with its reason,
      and Retry on the job's Zoho FSM tab runs it again (SNG-191).
    */
    let completion: { done: boolean; reason?: string } = { done: true };
    if (!status || !DONE_STATUSES.test(status)) {
      let done: { done: boolean; reason?: string; detail?: unknown; appointment?: string } = await workOrderTransition(
        token,
        workOrderId,
        /^complete/i,
        { $force_complete: true, Notes: `Inspection ${job.code} approved in the portal.` },
      );
      if (!done.done && /offers no/i.test(String(done.reason ?? ""))) {
        const { data: inspectorRow } = job.inspector_id
          ? await admin.from("user_profile").select("full_name, email").eq("id", job.inspector_id).maybeSingle()
          : { data: null };
        const inspector = (inspectorRow as { full_name: string | null; email: string | null } | null) ?? null;
        done = await completeThroughAppointment(token, workOrderId, job, {
          email: inspector?.email ?? null,
          name: inspector?.full_name ?? null,
        });
      }
      completion = done;
      await log(admin, {
        quotationId: quote.id,
        jobId,
        action: "work_order_complete",
        status: done.done ? "success" : "failed",
        recordId: workOrderId,
        message: done.done
          ? `Work order completed in FSM${done.appointment ? ` through appointment ${done.appointment}` : ""}`
          : `Not completed in FSM: ${done.reason}${done.appointment ? ` (appointment ${done.appointment})` : ""}. Retry once it is fixed.`,
        detail: done.detail,
        actorId,
      });
      if (done.done) status = ((await readWorkOrder(token, workOrderId))?.Status as string | undefined) ?? status;
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

    /* A work order left open is the job's open sync problem, so the tab offers Retry for it. */
    const completionError = completion.done ? null : `The work order is not completed in FSM: ${completion.reason}`;
    await admin
      .from("snagging_jobs")
      .update({ fsm_status: status, fsm_synced_at: new Date().toISOString(), fsm_error: completionError })
      .eq("id", jobId);
    const number = ((await readWorkOrder(token, workOrderId))?.Name as string | undefined) ?? workOrderId;
    return {
      ok: completion.done,
      message: `In FSM as work order ${number} (${status ?? "status unknown"}).${completionError ? ` ${completionError}.` : ""}${reportNote}`,
    };
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
export function queueJobFsmSync(
  admin: Admin,
  jobId: string,
  actorId?: string | null,
  /** A report just stored for the job: attached even when its version is already on the work order. */
  pdf?: { bytes: Uint8Array; version: number | null },
) {
  if (!fsmSyncEnabled()) return;
  const run = () =>
    syncJobToFsm(admin, jobId, { actorId, pdf }).catch((err) => console.error("FSM job sync failed:", err));
  try {
    after(run);
  } catch {
    void run();
  }
}
