/*
  Run the daily report alerts (N7, N8, N13, N14) once, by hand: the same
  runReportAlerts the CRON_SECRET route calls. Delivery goes through the
  safety rail, so outside production in-app alerts reach only
  NOTIFY_INAPP_ALLOWLIST.

  Add --plan to only print what would be sent and closed, writing nothing.
  The plan always works out N14, even with no recipients set.

  Run:
    node --env-file=.env --env-file=.env.local --import ./tests/setup/register.mjs \
      scripts/reports/run-alerts.ts [--plan]
*/
import { planReportAlerts } from "@/lib/reports/alerts-plan";
import { findUnflagged } from "@/lib/reports/exceptions";
import { buildQuotationRows } from "@/lib/reports/quotations";
import { todayInZone } from "@/lib/scheduling/org-time";
import { runReportAlerts } from "@/lib/server/reports/alerts";
import { loadQuotationRecords, loadUnflaggedInputs } from "@/lib/server/reports/data";
import { computeCapacityFor } from "@/lib/server/reports/planning";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

async function main() {
  const admin = await createAdminServerClient();
  if (!process.argv.includes("--plan")) {
    console.log(JSON.stringify(await runReportAlerts(admin), null, 2));
    return;
  }
  const settings = await readReportingSettings(admin);
  const today = todayInZone();
  const quotations = buildQuotationRows(await loadQuotationRecords(admin), {
    today,
    limits: settings.quotations.ageingDaysByStatus,
    expiryWarningDays: settings.quotations.expiryWarningDays,
  });
  const afterDays = settings.exceptions.completedWithoutFlagAfterDays;
  const unflagged = findUnflagged({ ...(await loadUnflaggedInputs(admin)), today, afterDays });
  const { result: capacity } = await computeCapacityFor(admin, settings, { from: today, days: settings.capacity.horizonDays });
  const plan = planReportAlerts({ quotations, unflagged, open: [], unflaggedAfterDays: afterDays, overbooked: capacity.overbooked });
  console.log(
    JSON.stringify(
      {
        today,
        wouldSend: plan.send.map((s) => ({ event: s.event, to: s.to, body: s.body })),
        backlog: plan.backlog,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
