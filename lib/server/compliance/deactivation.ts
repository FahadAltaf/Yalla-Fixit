// Deactivation request (FRD D11 as amended by Sami, 27 Oct 2026).
//
// Deactivating a technician is done in Zoho FSM, never in the portal. The
// Deactivate action on a linked employee therefore changes nothing here: it
// emails the people who can do it in FSM (a settings list; Sami and Sharon
// at go-live) and the UI tells the user that. The request is audited.
// Identity numbers never appear in the email (NFR-4).

import type { SupabaseClient } from "@supabase/supabase-js";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { sendEmail } from "@/lib/server/send-email";
import { getAppUrl } from "@/lib/supabase/supabase-helpers";
import type { EmployeeRecord } from "@/lib/compliance/types";
import { EMPLOYMENT_STATUS_LABEL } from "@/lib/compliance/statuses";
import type { ComplianceActor } from "./access";
import { recordComplianceAudit } from "./audit";
import { readSettings, resolveUserRecipients } from "./settings";

export type DeactivationRequestResult =
  | { sent: true; recipients: string[] }
  | { sent: false; reason: "no_recipients" | "not_linked" | "already_inactive" };

export async function requestDeactivation(
  admin: SupabaseClient,
  actor: ComplianceActor,
  employee: EmployeeRecord,
  note: string | null,
): Promise<DeactivationRequestResult> {
  if (!employee.technician) return { sent: false, reason: "not_linked" };
  if (!employee.technician.is_active) return { sent: false, reason: "already_inactive" };

  const settings = await readSettings(admin);
  const recipients = await resolveUserRecipients(admin, settings.deactivation_request_user_ids);
  if (!recipients.length) return { sent: false, reason: "no_recipients" };

  const appUrl = await getAppUrl();
  const recordUrl = `${appUrl}/compliance/employees/${employee.id}`;
  const html = clientEmailHtml({
    eyebrow: "Manpower compliance",
    heading: "Deactivation requested in FSM",
    greeting: "Hello,",
    paragraphs: [
      `${escapeEmailHtml(actor.label)} has asked for <strong>${escapeEmailHtml(employee.full_name)}</strong> to be deactivated. Technicians are deactivated in Zoho FSM, not in the portal, so the compliance record will change to Inactive once FSM shows the technician inactive.`,
      note ? `Note from ${escapeEmailHtml(actor.label)}: ${escapeEmailHtml(note)}` : "",
    ].filter(Boolean),
    details: [
      { label: "Employee ID", value: employee.maher_id },
      { label: "Name", value: employee.full_name },
      { label: "FSM technician", value: employee.technician.display_name },
      { label: "Current status", value: EMPLOYMENT_STATUS_LABEL[employee.employment_status] },
      { label: "Requested by", value: actor.label },
    ],
    cta: { label: "Open the compliance record", url: recordUrl },
    footnote: "Sent by the Yalla Fixit portal because this employee is linked to an FSM technician.",
  });

  // Audit first: a failed audit must not have already produced an email that a
  // retry would send again.
  await recordComplianceAudit(admin, actor, {
    entity_type: "employee",
    entity_id: employee.id,
    employee_id: employee.id,
    event_type: "edit",
    field: "deactivation_request",
    new_value: { recipients: recipients.map((r) => r.name), note },
  });

  await sendEmail({
    to: recipients.map((r) => r.email),
    subject: `Deactivate in FSM: ${employee.full_name} (${employee.maher_id})`,
    html,
  });

  return { sent: true, recipients: recipients.map((r) => r.name) };
}
