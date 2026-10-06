import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_EXPIRING_WINDOW_DAYS, shiftDays, todayInDubai } from "@/lib/amc/contracts";
import { dueExpiryThresholds } from "@/lib/amc/notifications";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { fetchAllRowsById } from "@/lib/server/amc/paging";
import {
  approverRecipients,
  notifyContractEvent,
  ownerRecipient,
  readNotificationSettings,
  type Recipient,
} from "@/lib/server/amc/notifications";

/**
 * The contract-expiry reminder engine.
 *
 * One sweep looks at every active contract whose end date is within the
 * largest configured threshold (60/30/15 days by default) and, for each
 * threshold that has come due, records a `contract_expiring` notification
 * for each configured recipient and channel. The dedupe key (contract +
 * threshold) with the recipient and channel makes it idempotent: running
 * it twice a day, or after a missed day, never repeats a reminder.
 *
 * Nothing runs it automatically today. A scheduled caller (a cron with the
 * internal signature) is refused while `reminder_auto_enabled` is off,
 * which is the default until the business confirms the thresholds,
 * recipients and channels. An approver can run it by hand, which records
 * in-app reminders (and emails only if email is a configured channel).
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;

export interface SweepResult {
  ran: boolean;
  reason?: string;
  today: string;
  contractsChecked: number;
  remindersCreated: number;
  emailsSent: number;
}

export async function runExpiryReminderSweep(
  admin: Admin,
  opts: { trigger: "automatic" | "manual"; actor: { id: string | null; label: string | null } | null; today?: string },
): Promise<SweepResult> {
  const today = opts.today ?? todayInDubai();
  const settings = await readNotificationSettings(admin);
  const empty = { today, contractsChecked: 0, remindersCreated: 0, emailsSent: 0 };
  if (opts.trigger === "automatic" && !settings.reminderAutoEnabled) {
    return { ran: false, reason: "Automatic reminders are switched off in AMC notification settings.", ...empty };
  }
  const thresholds = settings.reminderThresholds.filter((t) => Number.isInteger(t) && t > 0);
  if (thresholds.length === 0) return { ran: false, reason: "No reminder thresholds are configured.", ...empty };

  const horizon = shiftDays(today, Math.max(...thresholds, DEFAULT_EXPIRING_WINDOW_DAYS));
  const { data: contracts, error } = await fetchAllRowsById<Row>((afterId, size) => {
    let q = admin
      .from("amc_contracts")
      .select("id, end_date, amc_submissions!amc_contracts_submission_id_fkey(owner_id)")
      .eq("status", "active")
      .gte("end_date", today)
      .lte("end_date", horizon)
      .order("id")
      .limit(size);
    if (afterId) q = q.gt("id", afterId);
    return q;
  });
  if (error) throw new Error(error.message);

  /* The same approvers and extra addresses for every contract. */
  const approvers = settings.reminderRecipients.includes("approvers") ? await approverRecipients(admin) : [];
  const extra: Recipient[] = settings.reminderExtraEmails.map((email) => ({ userId: null, email, name: email }));
  const withEmail = settings.reminderChannels.includes("email");
  const inApp = settings.reminderChannels.includes("in_app");

  const result: SweepResult = { ran: true, ...empty, contractsChecked: contracts.length };
  for (const c of contracts) {
    const due = dueExpiryThresholds(String(c.end_date), today, thresholds);
    if (due.length === 0) continue;
    const joined = c.amc_submissions as Row | Row[] | null;
    const ownerId = ((Array.isArray(joined) ? joined[0] : joined)?.owner_id as string | null) ?? null;
    const owner = settings.reminderRecipients.includes("owner") ? await ownerRecipient(admin, ownerId) : [];
    /* In-app needs a portal user; email-only recipients get email only. */
    const recipients = [...owner, ...approvers].map((r) => (inApp ? r : { ...r, userId: null })).filter((r) => r.userId || (withEmail && r.email));
    const all = [...recipients, ...(withEmail ? extra : [])];
    if (all.length === 0) continue;

    const daysLeft = Math.round((Date.parse(`${c.end_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    /* Only the nearest due threshold is announced: a first run 20 days
       before the end sends the 30-day reminder, not the 60- and 30-day
       ones together. Each threshold is announced once (dedupe key). */
    const threshold = due[due.length - 1];
    const r = await notifyContractEvent(admin, {
      event: "contract_expiring",
      contractId: String(c.id),
      threshold,
      actor: opts.actor,
      recipients: all,
      emailEnabled: withEmail,
      facts: { daysLeft },
    });
    const created = r.created;
    result.emailsSent += r.emailed;
    if (created > 0) {
      result.remindersCreated += created;
      await recordAmcAudit(admin, {
        entityType: "contract",
        entityId: String(c.id),
        eventType: "renewal_reminder_created",
        actorId: opts.actor?.id ?? null,
        actorLabel: opts.actor?.label ?? null,
        origin: opts.actor?.id ? "portal" : "system",
        payload: { threshold, daysLeft, trigger: opts.trigger, notifications: created },
      });
    }
  }
  return result;
}
