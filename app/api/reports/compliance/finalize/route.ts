import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { actorOf } from "@/lib/server/finance/route-helpers";
import { createNotifier, supabaseNotificationStore } from "@/lib/server/notifications/notifier";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { sendHrReport } from "@/lib/server/reports/compliance-alerts";
import { ComplianceError, finalizeMonth } from "@/lib/server/reports/compliance";
import { loadTechnicians } from "@/lib/server/reports/data";
import { sendEmail } from "@/lib/server/send-email";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Finalise a month's compliance (BRD 5.2 B4; DEV-450): after the dispute
 * cut-off, the statements are frozen with the settings used and never
 * recalculated. Compliance Approve (a named person, not inherited by
 * administrators). Refused while a dispute is undecided. The final report
 * to HR and the managers (E3) goes out from the frozen statements.
 *
 * Body: { month: "YYYY-MM" }
 */
const bodySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();

export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.COMPLIANCE, ActionType.APPROVE);
  if (!gate.ok) return gate.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A month is required" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const statements = await finalizeMonth(admin, parsed.data.month, actorOf(gate.access.profile));
    /* E3 now; the daily run sends it later if this one fails. */
    let hrReport: string = "not sent";
    try {
      const settings = await readReportingSettings(admin);
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
      const notify = createNotifier({ store: supabaseNotificationStore(admin), sendEmail: (mail) => sendEmail(mail), appUrl });
      hrReport = await sendHrReport(admin, parsed.data.month, settings.compliance.hrRecipientUserIds, notify, appUrl, await loadTechnicians(admin));
    } catch (error) {
      console.error("Compliance E3 error:", error);
    }
    return NextResponse.json({ statements, hrReport });
  } catch (error) {
    if (error instanceof ComplianceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Compliance finalise error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was finalised." }, { status: 500 });
  }
}
