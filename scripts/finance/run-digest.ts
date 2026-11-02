/*
  Run the daily Ready-to-Invoice digest once, by hand: the same runDigest
  the CRON_SECRET route calls. Delivery goes through the safety rail, so
  outside production email reaches only NOTIFY_REDIRECT_TO (or nobody) and
  in-app only NOTIFY_INAPP_ALLOWLIST.

  Run:
    node --env-file=.env --env-file=.env.local --import ./tests/setup/register.mjs \
      scripts/finance/run-digest.ts [--ignore-time]
*/
import { runDigest } from "@/lib/server/finance/digest";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

async function main() {
  const admin = await createAdminServerClient();
  const result = await runDigest(admin, { ignoreTime: process.argv.includes("--ignore-time") });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
