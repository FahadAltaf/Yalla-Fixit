import { NextRequest } from "next/server";
import { z } from "zod";
import { ActionType, ResourceType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireCompliance } from "@/lib/server/compliance/access";
import { recordComplianceAudit } from "@/lib/server/compliance/audit";
import { readSettings, resolveUserRecipients, writeSettings } from "@/lib/server/compliance/settings";
import { ok, parseBody, serverError } from "@/lib/server/compliance/http";

/*
  Module settings (FRD FR-8, FR-10, D11): overdue reminder cadence, HR-owned
  field groups (enforced in phase 5b) and who receives deactivation requests.
*/
const patchSchema = z.object({
  overdue_repeat_days: z.number().int().min(1).max(90).optional(),
  deactivation_request_user_ids: z.array(z.string().uuid()).max(20).optional(),
});

export async function GET() {
  const g = await requireCompliance(ActionType.VIEW, ResourceType.COMPLIANCE_SETTINGS);
  if (g.error) return g.error;
  try {
    const admin = await createAdminServerClient();
    const settings = await readSettings(admin);
    const recipients = await resolveUserRecipients(admin, settings.deactivation_request_user_ids);
    return ok({ ...settings, deactivation_request_recipients: recipients });
  } catch (error) {
    return serverError("read settings", error);
  }
}

export async function PATCH(req: NextRequest) {
  const g = await requireCompliance(ActionType.EDIT, ResourceType.COMPLIANCE_SETTINGS);
  if (g.error) return g.error;
  const body = await parseBody(req, patchSchema);
  if ("response" in body) return body.response;
  try {
    const admin = await createAdminServerClient();
    const { before, after } = await writeSettings(admin, body.data, g.actor.id);
    await recordComplianceAudit(admin, g.actor, { entity_type: "settings", entity_id: "1", event_type: "edit", old_value: before, new_value: after });
    const recipients = await resolveUserRecipients(admin, after.deactivation_request_user_ids);
    return ok({ ...after, deactivation_request_recipients: recipients });
  } catch (error) {
    return serverError("write settings", error);
  }
}
