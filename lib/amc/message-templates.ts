import { z } from "zod";

/**
 * The default texts of the AMC emails (BRD 6.1) and WhatsApp / SMS
 * messages (BRD 6.3). Editable in AMC configuration (templates section);
 * these defaults apply until someone saves a change.
 *
 * Emails 1-3 are the BRD's own wording. Email 4 (instalment due/overdue)
 * and the eight messages are in the BRD's companion workbook, which has not
 * been shared with development, so these are DRAFTS to replace with the
 * workbook text.
 */

export type AmcTemplateKind = "email" | "message";

export interface AmcTemplateDefinition {
  id: string;
  kind: AmcTemplateKind;
  label: string;
  /** BRD reference. */
  source: string;
  draft: boolean;
  subject?: string;
  body: string;
}

export const AMC_TEMPLATE_DEFINITIONS: AmcTemplateDefinition[] = [
  {
    id: "emailProposalShared",
    kind: "email",
    label: "Email 1: Proposal shared",
    source: "BRD 6.1",
    draft: false,
    subject: "Yalla Fix It AMC proposal {Proposal no} {Version} for {Property}",
    body: [
      "Dear {Prospect name},",
      "{Renewal line}",
      "Please find attached proposal {Proposal no} {Version} for {Property address}: {Service list}, {Visit count} visits a year, AED {Final price} including VAT. Payment: {Payment plan}. Valid until {Validity date}.",
      "To approve, reject or ask for a change, use this link: {Approval link}. You can also reply here or message {Coordinator phone}.",
      "Kind regards,\n{Coordinator name}, Yalla Fix It, 800-PERFECT",
    ].join("\n\n"),
  },
  {
    id: "emailContractForSignature",
    kind: "email",
    label: "Email 2: Contract for signature",
    source: "BRD 6.1",
    draft: false,
    subject: "Your Yalla Fix It AMC contract {Contract no} is ready to sign",
    body: [
      "Dear {Client name},",
      "Thank you for approving proposal {Proposal no}. Your contract {Contract no} for {Property address} is ready to sign: {Signing link}.",
      "Period {Start date} to {End date}. Value AED {Value} including VAT. Payment: {Payment plan}. The first installment of AED {First amount} is due on signing, and the first visit is scheduled once it is received.",
      "Kind regards,\n{Coordinator name}, Yalla Fix It",
    ].join("\n\n"),
  },
  {
    id: "emailServiceReport",
    kind: "email",
    label: "Email 3: Service report",
    source: "BRD 6.1",
    draft: false,
    subject: "Service report: {Service} visit {Seq} of {Total} at {Property}, {Visit date}",
    body: [
      "Dear {Client name},",
      "Our team completed the {Service} visit on {Visit date}. The report is attached with the checklist, before and after photos and technician notes.",
      "Visits this contract year: {Completed} done, {Remaining} remaining. Free non emergency visits used: {Used} of {Allowed}.",
      "{Additional work line}",
      "Kind regards,\n{Coordinator name}, Yalla Fix It",
    ].join("\n\n"),
  },
  {
    id: "emailInstallmentReminder",
    kind: "email",
    label: "Email 4: Installment due or overdue",
    source: "BRD 5.8, 6.1 (workbook text pending)",
    draft: true,
    subject: "Yalla Fix It AMC {Contract no}: installment {Installment no} {Due state}",
    body: [
      "Dear {Client name},",
      "Installment {Installment no} of your AMC contract {Contract no} for {Property address}, AED {Amount} including VAT, {Due state} on {Due date}.",
      "{Payment line}",
      "Kind regards,\n{Coordinator name}, Yalla Fix It",
    ].join("\n\n"),
  },
  {
    id: "messageProposalShared",
    kind: "message",
    label: "WhatsApp: Proposal shared",
    source: "BRD 5.6, 6.3 (workbook text pending)",
    draft: true,
    body: "Dear {Prospect name}, your Yalla Fix It AMC proposal {Proposal no} {Version} for {Property} is ready: AED {Final price} incl. VAT. Approve, reject or ask for a change here: {Approval link}",
  },
  {
    id: "messageContractReady",
    kind: "message",
    label: "WhatsApp: Contract ready to sign",
    source: "BRD 6.3 (workbook text pending)",
    draft: true,
    body: "Dear {Client name}, your Yalla Fix It AMC contract {Contract no} is ready to sign: {Signing link}",
  },
  {
    id: "messageAppointmentConfirmation",
    kind: "message",
    label: "WhatsApp: Appointment confirmation request",
    source: "BRD 5.11, 6.3 (workbook text pending)",
    draft: true,
    body: "Dear {Client name}, your {Service} visit at {Property} is due between {Window start} and {Window end}. Can we come on {Proposed date} at {Proposed time}? Please reply to confirm or suggest another time.",
  },
  {
    id: "messageAppointmentReminder",
    kind: "message",
    label: "WhatsApp: Appointment reminder (day before)",
    source: "BRD 5.11, 6.3 (workbook text pending)",
    draft: true,
    body: "Reminder: Yalla Fix It will visit {Property} tomorrow, {Visit date}, at {Visit time} for {Service}.",
  },
  {
    id: "messageCallOutAcknowledgement",
    kind: "message",
    label: "WhatsApp: Call out acknowledgement",
    source: "BRD 5.13, 6.3 (workbook text pending)",
    draft: true,
    body: "Dear {Client name}, we have logged your call out {Call out no} for {Property} ({Priority}). {Coverage line} We will be in touch shortly.",
  },
  {
    id: "messageInstallmentDue",
    kind: "message",
    label: "WhatsApp: Installment due",
    source: "BRD 5.8, 6.3 (workbook text pending)",
    draft: true,
    body: "Dear {Client name}, installment {Installment no} of AED {Amount} for AMC {Contract no} is due on {Due date}. {Payment link}",
  },
  {
    id: "messageServiceReport",
    kind: "message",
    label: "WhatsApp: Service report link",
    source: "BRD 5.12, 6.3 (workbook text pending)",
    draft: true,
    body: "Dear {Client name}, the report of your {Service} visit on {Visit date} is ready: {Report link}",
  },
  {
    id: "messageRenewalProposal",
    kind: "message",
    label: "WhatsApp: Renewal proposal",
    source: "BRD 5.16, 6.3 (workbook text pending)",
    draft: true,
    body: "Dear {Client name}, your AMC contract {Old contract no} expires on {Expiry date}. Your renewal proposal {Proposal no} is ready: {Approval link}",
  },
];

export const AMC_TEMPLATE_IDS = AMC_TEMPLATE_DEFINITIONS.map((t) => t.id);

const templateOverride = z
  .object({
    subject: z.string().trim().min(1).max(300).optional(),
    body: z.string().trim().min(1).max(5000),
  })
  .strict();

/** Saved changes only: { templateId: { subject?, body } }. */
export const templatesConfigSchema = z
  .record(z.string(), templateOverride)
  .refine((v) => Object.keys(v).every((k) => AMC_TEMPLATE_IDS.includes(k)), { message: "Unknown template" });

export type AmcTemplatesConfig = z.infer<typeof templatesConfigSchema>;

/** The template in force: the saved text if any, else the default. */
export function templateText(id: string, saved: AmcTemplatesConfig): { subject?: string; body: string } | null {
  const def = AMC_TEMPLATE_DEFINITIONS.find((t) => t.id === id);
  if (!def) return null;
  const override = saved[id];
  return { subject: override?.subject ?? def.subject, body: override?.body ?? def.body };
}
