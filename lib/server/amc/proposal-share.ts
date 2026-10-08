import type { SupabaseClient } from "@supabase/supabase-js";

import type { AmcSettings } from "@/components/dashboard/extensions/amc/amc-settings";
import { fillTemplate, whatsappUrl } from "@/lib/amc/approval-ladder";
import type { AmcConfig } from "@/lib/amc/config";
import { firstInstalment } from "@/lib/amc/contract-lifecycle";
import { templateText } from "@/lib/amc/message-templates";
import { grandTotalFromFinal } from "@/lib/amc/pricing";
import { paymentPlanLabel, planFromLegacyTerms, type CustomPlan, type PaymentPlan } from "@/lib/amc/proposal-rules";
import { isMissingTable } from "@/lib/server/amc/contracts";
import { notifyUsers } from "@/lib/server/amc/notifications";

/**
 * Sharing a proposal (BRD 5.6, 6.1 Email 1, 6.3): the email and WhatsApp
 * texts from the templates in AMC configuration, and the send log
 * (channel, recipients, version, user, time).
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const money = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ShareFacts {
  subject: string;
  /** Email 1 body, filled. */
  body: string;
  /** The WhatsApp text, filled. */
  message: string;
}

/**
 * The texts for one share: Email 1 and the WhatsApp message, with the
 * proposal's version, services, visits, price incl. VAT, plan, validity,
 * link and the coordinator's details. A renewal opens with its old
 * contract's expiry (BRD 6.1).
 */
export async function proposalShareTexts(
  admin: Admin,
  row: Row,
  input: { settings: AmcSettings; config: AmcConfig; link: string; validUntil: string | null; versionNo: number; owner: { name: string; phone: string | null } },
): Promise<ShareFacts> {
  const customer = (row.customer ?? {}) as Row;
  const property = (row.property ?? {}) as Row;
  const services = ((row.services ?? []) as Array<{ serviceId: string; included: boolean; frequency: number }>).filter((s) => s.included);
  const labels = services.map((s) => input.settings.services.find((d) => d.id === s.serviceId)?.label ?? s.serviceId);
  const ppm = services.filter((s) => input.settings.services.find((d) => d.id === s.serviceId)?.frequencyType === "ppm");
  const visits = ppm.reduce((sum, s) => sum + Number(s.frequency || 0), 0);
  const plan = (row.payment_plan as PaymentPlan | null) ?? planFromLegacyTerms(customer.paymentTerms as string | undefined);

  let renewalLine: string | null = null;
  if (row.renewal_of_contract_id) {
    const { data } = await admin.from("amc_contracts").select("proposal_number, end_date").eq("id", String(row.renewal_of_contract_id)).maybeSingle<Row>();
    if (data?.end_date) renewalLine = `Your contract ${String(data.proposal_number ?? "")} expires on ${fmtDate(String(data.end_date))}.`;
  }

  const values = {
    "Prospect name": String(customer.customerName ?? "").trim() || "customer",
    "Renewal line": renewalLine,
    "Proposal no": String(row.proposal_number ?? ""),
    Version: `V${input.versionNo}`,
    Property: String(property.propertyDetail ?? property.propertyAddress ?? ""),
    "Property address": String(property.propertyAddress ?? property.propertyDetail ?? ""),
    "Service list": labels.join(", "),
    "Service Parameters list": labels.join(", "),
    "Visit count": visits,
    "Final price": money(grandTotalFromFinal(Number(row.final_price ?? 0))),
    "Payment plan": paymentPlanLabel(plan, (row.payment_plan_custom as CustomPlan | null) ?? null),
    "Validity date": input.validUntil ? fmtDate(input.validUntil) : "",
    "Approval link": input.link,
    "Coordinator name": input.owner.name,
    "Coordinator phone": input.owner.phone || input.settings.provider.contactNo,
  };
  const email = templateText("emailProposalShared", input.config.templates)!;
  const whatsapp = templateText("messageProposalShared", input.config.templates)!;
  return {
    subject: fillTemplate(email.subject ?? "", values),
    body: fillTemplate(email.body, values),
    message: fillTemplate(whatsapp.body, values),
  };
}

/** The prepared WhatsApp messages, one per contact with a usable number. */
export function whatsappMessages(recipients: Array<{ name: string; address: string }>, text: string) {
  return recipients.map((r) => ({ name: r.name, address: r.address, text, url: whatsappUrl(r.address, text) }));
}

export interface SendLogEntry {
  submissionId: string;
  versionNo: number;
  /* instalment_reminder: Email 4 (Phase 7); visit_*: the appointment messages (Phase 9, 20261008120000). */
  document: "proposal" | "contract" | "instalment_reminder" | "visit_confirmation" | "visit_reminder";
  channel: "email" | "whatsapp" | "link" | "sms";
  recipients: Array<{ name: string; address: string }>;
  cc?: string[];
  outcome: "sent" | "prepared" | "link_created" | "failed" | "no_recipient";
  tokenHint?: string | null;
  detail?: string | null;
  sentBy: string | null;
}

/** Records a send. Best effort: before 20261007150000 the audit trail is the record. */
export async function recordSend(admin: Admin, entry: SendLogEntry): Promise<void> {
  const { error } = await admin.from("amc_send_log").insert({
    submission_id: entry.submissionId,
    version_no: entry.versionNo,
    document: entry.document,
    channel: entry.channel,
    recipients: entry.recipients,
    cc: entry.cc ?? [],
    outcome: entry.outcome,
    token_hint: entry.tokenHint ?? null,
    detail: entry.detail?.slice(0, 300) ?? null,
    sent_by: entry.sentBy,
  });
  if (error && !isMissingTable(error)) console.error("[amc:share] send not logged:", error.message);
}

export interface SendLogRow {
  id: string;
  versionNo: number;
  document: string;
  channel: string;
  recipients: Array<{ name: string; address: string }>;
  cc: string[];
  outcome: string;
  sentBy: string | null;
  sentAt: string;
}

export async function listSendLog(admin: Admin, submissionId: string): Promise<{ entries: SendLogRow[]; migrated: boolean }> {
  const { data, error } = await admin
    .from("amc_send_log")
    .select("id, version_no, document, channel, recipients, cc, outcome, sent_at, sender:user_profile!amc_send_log_sent_by_fkey(full_name, email)")
    .eq("submission_id", submissionId)
    .order("sent_at", { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingTable(error)) return { entries: [], migrated: false };
    throw new Error(error.message);
  }
  return {
    entries: ((data ?? []) as unknown as Row[]).map((r) => {
      const by = r.sender as Row | null;
      return {
        id: String(r.id),
        versionNo: Number(r.version_no),
        document: String(r.document),
        channel: String(r.channel),
        recipients: (Array.isArray(r.recipients) ? r.recipients : []) as Array<{ name: string; address: string }>,
        cc: (r.cc as string[] | null) ?? [],
        outcome: String(r.outcome),
        sentBy: (by?.full_name as string | null) || (by?.email as string | null) || null,
        sentAt: String(r.sent_at),
      };
    }),
    migrated: true,
  };
}


/**
 * Proposals with the client whose validity ends within `days` (BRD 6.2:
 * validity expiring): the owner hears once per validity date. The
 * notification's own key makes repeats harmless.
 */
export async function runProposalValiditySweep(admin: Admin, now = new Date(), days = 3): Promise<{ expiring: number; skipped: string | null }> {
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + days);
  const { data, error } = await admin
    .from("amc_submissions")
    .select("id, owner_id, proposal_number, customer, valid_until")
    .eq("status", "proposal_sent")
    .gte("valid_until", today)
    .lte("valid_until", until.toISOString().slice(0, 10))
    .limit(200);
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") return { expiring: 0, skipped: "not migrated" };
    throw new Error(error.message);
  }
  let expiring = 0;
  for (const row of (data ?? []) as Row[]) {
    const validUntil = String(row.valid_until);
    const sent = await notifyUsers(admin, {
      event: "proposal_validity_expiring",
      userIds: [String(row.owner_id)],
      title: `Proposal ${String(row.proposal_number ?? "")} is valid until ${fmtDate(validUntil)}`,
      body: `${String(((row.customer ?? {}) as Row).customerName ?? "")} has not answered yet. Follow up, or revise it before it lapses.`,
      link: `/extensions/amc/${String(row.id)}`,
      entityType: "submission",
      entityId: String(row.id),
      submissionId: String(row.id),
      dedupeKey: `proposal_validity_expiring:${String(row.id)}:${validUntil}`,
    });
    if (sent) expiring += 1;
  }
  return { expiring, skipped: null };
}

/**
 * Email 2 and the WhatsApp "contract ready" message (BRD 6.1, 6.3): the
 * contract number, period, value incl. VAT, plan, the first instalment and
 * the signing link.
 */
export async function contractShareTexts(
  admin: Admin,
  row: Row,
  input: { config: AmcConfig; link: string; owner: { name: string } },
): Promise<ShareFacts & { contractNumber: string | null }> {
  const customer = (row.customer ?? {}) as Row;
  const property = (row.property ?? {}) as Row;
  const { data: contract } = await admin
    .from("amc_contracts")
    .select("contract_number, start_date, end_date, grand_total")
    .eq("submission_id", String(row.id))
    .maybeSingle<Row>();
  const plan = (row.payment_plan as PaymentPlan | null) ?? planFromLegacyTerms(customer.paymentTerms as string | undefined);
  const custom = (row.payment_plan_custom as CustomPlan | null) ?? null;
  const finalPrice = Number(row.final_price ?? 0);
  const values = {
    "Client name": String(customer.customerName ?? "").trim() || "customer",
    "Proposal no": String(row.proposal_number ?? ""),
    "Contract no": String(contract?.contract_number ?? row.proposal_number ?? ""),
    "Property address": String(property.propertyAddress ?? property.propertyDetail ?? ""),
    "Signing link": input.link,
    "Start date": contract?.start_date ? fmtDate(String(contract.start_date)) : String(customer.startDate ?? ""),
    "End date": contract?.end_date ? fmtDate(String(contract.end_date)) : String(customer.endDate ?? ""),
    Value: money(contract?.grand_total ? Number(contract.grand_total) : grandTotalFromFinal(finalPrice)),
    "Payment plan": paymentPlanLabel(plan, custom),
    "First amount": money(firstInstalment(plan, custom, finalPrice)),
    "Coordinator name": input.owner.name,
  };
  const email = templateText("emailContractForSignature", input.config.templates)!;
  const message = templateText("messageContractReady", input.config.templates)!;
  return {
    subject: fillTemplate(email.subject ?? "", values),
    body: fillTemplate(email.body, values),
    message: fillTemplate(message.body, values),
    contractNumber: (contract?.contract_number as string | null) ?? null,
  };
}
