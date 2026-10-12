import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { whatsappUrl } from "@/lib/amc/approval-ladder";
import type { AmcConfig } from "@/lib/amc/config";
import { todayInDubai } from "@/lib/amc/contracts";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError, loadContract } from "@/lib/server/amc/contracts";
import { recordSend } from "@/lib/server/amc/proposal-share";
import { AMC_DOCUMENTS_BUCKET, renderPdf } from "@/lib/server/amc/signed-archive";
import { sendEmail } from "@/lib/server/send-email";

/**
 * The client report per contract (BRD v0.3 5.15; Phase 12: DEV-410), on
 * demand: the scope, the visits done with their dates and photos, the call
 * outs attended, additional work and its cost, allowances used and
 * remaining, and the visits still to come. The opening differs for
 * residential and commercial (AMC configuration → Client report). Sent by
 * email with the PDF attached, and prepared for WhatsApp with a link.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row | undefined) ?? null) : ((v as Row | null) ?? null));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso));
const money = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DONE = ["completed", "completed_with_additional_work", "partially_completed"];
const OPEN = ["not_scheduled", "scheduled", "rescheduled", "confirmed", "pending_access", "in_progress", "submitted"];

/** Quietly empty when a table is not migrated yet: the report shows what the database has. */
async function rows(q: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const { data, error } = await q;
  if (error) {
    console.warn("[amc:client-report] part skipped:", error.message);
    return [];
  }
  return (data ?? []) as Row[];
}

export async function clientReportFacts(admin: Admin, contractId: string, config: AmcConfig) {
  const { contract, entitlements, ownerId } = await loadContract(admin, contractId);
  const [visits, callOuts, works, reservedRows, owner] = await Promise.all([
    rows(
      admin
        .from("amc_visits")
        .select("id, visit_no, status, window_start, window_end, target_date, closed_at, lines:amc_visit_lines!amc_visit_lines_visit_id_fkey(service_label, status), sheet:amc_visit_job_sheets(completed_at)")
        .eq("contract_id", contractId)
        .neq("status", "cancelled")
        .order("visit_no"),
    ),
    rows(admin.from("amc_call_outs").select("call_out_no, priority, issue, status, reported_at, attended_at, coverage, sla_met").eq("contract_id", contractId).neq("status", "cancelled").order("reported_at")),
    rows(admin.from("amc_additional_works").select("work_no, finding, status, total, created_at").eq("contract_id", contractId).order("created_at")),
    rows(admin.from("amc_contract_entitlements").select("id, reserved_quantity").eq("contract_id", contractId)),
    ownerId ? admin.from("user_profile").select("full_name, email, phone").eq("id", ownerId).maybeSingle<Row>() : Promise.resolve({ data: null }),
  ]);
  const reserved = new Map(reservedRows.map((r) => [String(r.id), Number(r.reserved_quantity ?? 0)]));
  const doneIds = visits.filter((v) => DONE.includes(String(v.status))).map((v) => String(v.id));
  const visitIds = new Set(doneIds);
  const photos = doneIds.length
    ? await rows(admin.from("amc_visit_photos").select("visit_id, kind, storage_path, created_at").in("visit_id", doneIds).in("kind", ["after", "before"]).order("created_at"))
    : [];
  /* Two photos per visit at most (an after photo first), signed for a week so the PDF and the link both render them. */
  const chosen = new Map<string, Row[]>();
  for (const p of photos.filter((x) => visitIds.has(String(x.visit_id))).sort((a, b) => (a.kind === "after" ? -1 : 0) - (b.kind === "after" ? -1 : 0))) {
    const list = chosen.get(String(p.visit_id)) ?? [];
    if (list.length < 2) list.push(p);
    chosen.set(String(p.visit_id), list);
  }
  const paths = [...chosen.values()].flat().map((p) => String(p.storage_path));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrls(paths, 7 * 86_400);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const category = contract.lifecycle?.template ?? (contract.unitType === "office" ? "commercial" : "residential");
  const customer = contract.customer as Row;
  return {
    contract: {
      id: contract.id,
      number: contract.lifecycle?.contractNumber ?? contract.proposalNumber,
      customerName: str(customer.customerName) ?? contract.customerName,
      customerEmail: str(customer.customerEmail),
      customerPhone: str(customer.customerPhone),
      propertyLabel: contract.propertyLabel,
      startDate: contract.startDate,
      endDate: contract.endDate,
      submissionId: contract.submissionId,
      category: category as "residential" | "commercial",
    },
    owner: owner.data ? { name: str((owner.data as Row).full_name) ?? str((owner.data as Row).email), email: str((owner.data as Row).email), phone: str((owner.data as Row).phone) } : null,
    ownerId,
    intro: category === "commercial" ? config.clientReport.commercialIntro : config.clientReport.residentialIntro,
    closing: config.clientReport.closing,
    scope: entitlements.map((e) => ({
      service: e.serviceLabel,
      type: e.entitlementType,
      included: e.includedQuantity,
      used: e.usedQuantity,
      booked: reserved.get(String(e.id)) ?? 0,
      remaining: e.includedQuantity === null ? null : Math.max(0, e.includedQuantity - e.usedQuantity - (reserved.get(String(e.id)) ?? 0)),
    })),
    visitsDone: visits
      .filter((v) => DONE.includes(String(v.status)))
      .map((v) => ({
        visitNo: Number(v.visit_no),
        date: str(one(v.sheet)?.completed_at) ?? str(v.closed_at) ?? String(v.target_date),
        status: String(v.status),
        services: ((v.lines ?? []) as Row[]).filter((l) => l.status !== "cancelled").map((l) => `${String(l.service_label)}${l.status === "completed" ? "" : ` (${String(l.status).replace(/_/g, " ")})`}`),
        photos: (chosen.get(String(v.id)) ?? []).map((p) => urls.get(String(p.storage_path))).filter((u): u is string => Boolean(u)),
      })),
    visitsRemaining: visits
      .filter((v) => OPEN.includes(String(v.status)))
      .map((v) => ({ visitNo: Number(v.visit_no), windowStart: String(v.window_start), windowEnd: String(v.window_end) })),
    callOuts: callOuts
      .filter((c) => c.attended_at)
      .map((c) => ({
        number: String(c.call_out_no),
        priority: String(c.priority),
        issue: String(c.issue),
        reportedAt: String(c.reported_at),
        attendedAt: String(c.attended_at),
        covered: c.coverage === "covered",
        slaMet: c.sla_met === null || c.sla_met === undefined ? null : Boolean(c.sla_met),
      })),
    additionalWork: works.map((w) => ({ number: String(w.work_no), finding: String(w.finding), status: String(w.status), total: Number(w.total ?? 0) })),
    asOf: todayInDubai(),
  };
}

export type ClientReport = Awaited<ReturnType<typeof clientReportFacts>>;

export function clientReportHtml(r: ClientReport): string {
  const unit = (t: string) => (t === "hours" ? "hours" : "visits");
  const scope = r.scope
    .filter((s) => s.type !== "informational")
    .map(
      (s) =>
        `<tr><td>${esc(s.service)}</td><td class="n">${s.included === null ? "Unlimited" : `${s.included} ${unit(s.type)}`}</td><td class="n">${s.used}</td><td class="n">${s.booked || ""}</td><td class="n">${s.remaining === null ? "—" : s.remaining}</td></tr>`,
    )
    .join("");
  const visits = r.visitsDone
    .map(
      (v) =>
        `<div class="visit"><div class="vh"><strong>Visit ${v.visitNo}</strong> · ${esc(day(v.date))}${v.status === "completed" ? "" : ` · ${esc(v.status.replace(/_/g, " "))}`}</div><div class="muted">${esc(v.services.join(", "))}</div>${
          v.photos.length ? `<div class="photos">${v.photos.map((u) => `<img src="${esc(u)}"/>`).join("")}</div>` : ""
        }</div>`,
    )
    .join("");
  const calls = r.callOuts
    .map(
      (c) =>
        `<tr><td>${esc(c.number)}</td><td>${c.priority === "emergency" ? "Emergency" : "Non emergency"}</td><td>${esc(c.issue)}</td><td>${esc(day(c.attendedAt))}</td><td>${c.covered ? "Covered" : "Chargeable"}</td></tr>`,
    )
    .join("");
  const works = r.additionalWork
    .map((w) => `<tr><td>${esc(w.number)}</td><td>${esc(w.finding)}</td><td>${esc(w.status.replace(/_/g, " "))}</td><td class="n">${money(w.total)}</td></tr>`)
    .join("");
  const remaining = r.visitsRemaining.map((v) => `<li>Visit ${v.visitNo}: between ${esc(day(v.windowStart))} and ${esc(day(v.windowEnd))}</li>`).join("");
  const section = (title: string, body: string, empty: string) => `<h2>${esc(title)}</h2>${body || `<p class="muted">${esc(empty)}</p>`}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Client report ${esc(r.contract.number)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:32px;font-size:12px}
    h1{font-size:20px;margin:0 0 4px;color:#8b1d2c} h2{font-size:14px;margin:22px 0 8px;color:#8b1d2c}
    .muted{color:#6b7280} table{border-collapse:collapse;width:100%} th{text-align:left;color:#6b7280;font-weight:normal}
    th,td{border-bottom:1px solid #e5e7eb;padding:6px 8px;vertical-align:top} .n{text-align:right}
    .visit{border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;margin-bottom:8px;page-break-inside:avoid} .vh{margin-bottom:2px}
    .photos{display:flex;gap:6px;margin-top:6px} .photos img{width:160px;height:110px;object-fit:cover;border-radius:4px}
  </style></head><body>
    <h1>Service report for your AMC</h1>
    <div class="muted">Yalla Fix It · AMC ${esc(r.contract.number)} · ${esc(r.contract.propertyLabel)} · ${esc(day(r.contract.startDate))} to ${esc(day(r.contract.endDate))} · as of ${esc(day(r.asOf))}</div>
    <p>Dear ${esc(r.contract.customerName)},</p>
    <p>${esc(r.intro)}</p>
    ${section("Your plan and allowances", scope ? `<table><tr><th>Service</th><th class="n">Included</th><th class="n">Used</th><th class="n">Booked</th><th class="n">Remaining</th></tr>${scope}</table>` : "", "No counted services on this contract.")}
    ${section(`Visits completed (${r.visitsDone.length})`, visits, "No planned visit completed yet.")}
    ${section(`Visits remaining (${r.visitsRemaining.length})`, remaining ? `<ul>${remaining}</ul>` : "", "All planned visits are done.")}
    ${section(`Call outs attended (${r.callOuts.length})`, calls ? `<table><tr><th>No</th><th>Priority</th><th>Issue</th><th>Attended</th><th>Coverage</th></tr>${calls}</table>` : "", "No call outs so far.")}
    ${section(
      "Additional work",
      works
        ? `<table><tr><th>No</th><th>Finding</th><th>Status</th><th class="n">AED incl. VAT</th></tr>${works}</table><p class="muted">Total AED ${money(r.additionalWork.reduce((s, w) => s + w.total, 0))}</p>`
        : "",
      "No additional work.",
    )}
    <p style="margin-top:24px">${esc(r.closing)}</p>
    ${r.owner?.name ? `<p class="muted">${esc(r.owner.name)}${r.owner.phone ? ` · ${esc(r.owner.phone)}` : ""}${r.owner.email ? ` · ${esc(r.owner.email)}` : ""}</p>` : ""}
  </body></html>`;
}

/** Renders the report (PDF when this host can print, else HTML) and stores it as a contract document. */
async function storeReport(admin: Admin, r: ClientReport, actor: Actor) {
  const html = clientReportHtml(r);
  const pdf = await renderPdf(html);
  const bytes = pdf ?? new TextEncoder().encode(html);
  const ext = pdf ? "pdf" : "html";
  const mime = pdf ? "application/pdf" : "text/html";
  const documentId = randomUUID();
  const path = `documents/contract/${r.contract.id}/${documentId}.${ext}`;
  const { error: upload } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (upload) throw new ContractError(`Could not store the report: ${upload.message}`, 500);
  const title = `Client report ${r.asOf}`;
  const { data: versions } = await admin.from("amc_documents").select("version").eq("level", "contract").eq("entity_id", r.contract.id).eq("title", title);
  await admin.from("amc_documents").insert({
    id: documentId,
    level: "contract",
    entity_id: r.contract.id,
    category: "Client report",
    title,
    version: Math.max(0, ...((versions ?? []) as Row[]).map((v) => Number(v.version))) + 1,
    storage_path: path,
    file_name: `client-report-${r.contract.number}-${r.asOf}.${ext}`,
    mime_type: mime,
    size_bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    uploaded_by: actor.id,
  });
  const { data: link } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrl(path, 14 * 86_400);
  return { documentId, pdf, link: link?.signedUrl ?? null };
}

/** Email (PDF attached) to the client, owner copied; the WhatsApp text with the link comes back prepared. */
export async function sendClientReport(admin: Admin, contractId: string, actor: Actor, config: AmcConfig, to?: string | null) {
  const r = await clientReportFacts(admin, contractId, config);
  const stored = await storeReport(admin, r, actor);
  const recipient = (to ?? r.contract.customerEmail ?? "").trim();
  const cc = [r.owner?.email].filter((e): e is string => Boolean(e) && e !== recipient);
  let outcome: "sent" | "failed" | "no_recipient" = "no_recipient";
  if (recipient) {
    try {
      await sendEmail({
        to: recipient,
        ...(cc.length ? { cc } : {}),
        subject: `Your AMC service report: ${r.contract.number}`,
        html: clientEmailHtml({
          eyebrow: "AMC service report",
          heading: "Your AMC so far",
          greeting: `Dear ${r.contract.customerName},`,
          paragraphs: [escapeEmailHtml(r.intro), escapeEmailHtml("The full report is attached."), escapeEmailHtml(r.closing)],
          details: [
            { label: "Visits completed", value: String(r.visitsDone.length) },
            { label: "Visits remaining", value: String(r.visitsRemaining.length) },
            { label: "Call outs attended", value: String(r.callOuts.length) },
          ],
          ...(stored.pdf || !stored.link ? {} : { cta: { label: "Open the report", url: stored.link } }),
        }),
        ...(stored.pdf
          ? { attachment: { filename: `client-report-${r.contract.number}.pdf`, content: Buffer.from(stored.pdf).toString("base64"), contentType: "application/pdf" } }
          : {}),
      });
      outcome = "sent";
    } catch (e) {
      outcome = "failed";
      console.error("[amc:client-report] email failed:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }
  await recordSend(admin, {
    submissionId: r.contract.submissionId,
    versionNo: 1,
    document: "client_report",
    channel: "email",
    recipients: recipient ? [{ name: r.contract.customerName, address: recipient }] : [],
    cc,
    outcome,
    detail: `Client report as of ${r.asOf}`,
    sentBy: actor.id,
  });
  await recordAmcAudit(admin, { entityType: "contract", entityId: contractId, eventType: "client_report_sent", actorId: actor.id, actorLabel: actor.label, payload: { outcome, documentId: stored.documentId } });
  const message = `Dear ${r.contract.customerName}, here is the service report for your AMC ${r.contract.number}: ${r.visitsDone.length} visits done, ${r.visitsRemaining.length} to come, ${r.callOuts.length} call outs attended.${stored.link ? ` ${stored.link}` : ""}`;
  return { outcome, documentId: stored.documentId, message, whatsapp: r.contract.customerPhone ? whatsappUrl(r.contract.customerPhone, message) : null };
}
