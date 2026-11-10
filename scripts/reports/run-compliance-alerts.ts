/*
  Run the compliance messages (N9, N10, N11, E2, E3) once, by hand: the same
  runComplianceAlerts the CRON_SECRET route calls. Delivery goes through the
  safety rail, so outside production in-app messages reach only
  NOTIFY_INAPP_ALLOWLIST and email is redirected or blocked.

  Add --plan to only print what would be sent, writing nothing.

  Run:
    node --env-file=.env --env-file=.env.local --import ./tests/setup/register.mjs \
      scripts/reports/run-compliance-alerts.ts [--plan]
*/
import { complianceMonthPhase } from "@/lib/reports/compliance";
import { planComplianceAlerts } from "@/lib/reports/compliance-disputes";
import { addDaysToDateString, todayInZone } from "@/lib/scheduling/org-time";
import { workOutMonth } from "@/lib/server/reports/compliance";
import { runComplianceAlerts } from "@/lib/server/reports/compliance-alerts";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

async function main() {
  const admin = await createAdminServerClient();
  if (!process.argv.includes("--plan")) {
    console.log(JSON.stringify(await runComplianceAlerts(admin), null, 2));
    return;
  }
  const settings = await readReportingSettings(admin);
  const today = todayInZone();
  const current = today.slice(0, 7);
  const previous = addDaysToDateString(`${current}-01`, -1).slice(0, 7);
  const phase = complianceMonthPhase(previous, today, settings.compliance.disputeCutoffDay);
  const work = await workOutMonth(admin, current);
  const people = new Map(
    [...work.roster.values()].map((t) => [
      t.fsmId,
      {
        fsmId: t.fsmId,
        name: t.name,
        userId: t.userProfileId,
        email: t.email,
        teamLeaderUserId: t.teamLeaderId ? (work.roster.get(t.teamLeaderId)?.userProfileId ?? null) : null,
      },
    ]),
  );
  const plan = planComplianceAlerts({
    today,
    now: new Date().toISOString(),
    thresholdPercent: settings.compliance.thresholdPercent,
    people,
    current: { month: current, results: [...work.results.values()] },
    previous: null,
    closedMonth: phase.phase === "final" ? previous : null,
    supervisorUserIds: settings.compliance.belowThresholdRecipientUserIds,
  });
  const linked = [...work.roster.values()].filter((t) => t.userProfileId).length;
  console.log(
    JSON.stringify(
      {
        today,
        month: current,
        threshold: settings.compliance.thresholdPercent,
        techniciansMeasured: work.results.size,
        techniciansWithPortalAccount: linked,
        n9: plan.misses.length,
        n9Unreachable: plan.unreachable,
        n10: plan.belowThreshold.length,
        n10Sample: plan.belowThreshold.slice(0, 3).map((m) => m.body),
        n9Sample: plan.misses.slice(0, 3).map((m) => m.body),
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
