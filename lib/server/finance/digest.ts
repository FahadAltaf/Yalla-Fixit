import type { SupabaseClient } from "@supabase/supabase-js";

import {
  aed,
  digestDue,
  digestInAppText,
  digestSubject,
  dubaiClock,
  planDigest,
  type DigestItem,
} from "@/lib/finance/digest-plan";
import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";
import { createNotifier, supabaseNotificationStore, type NotifyResult } from "@/lib/server/notifications/notifier";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { sendEmail } from "@/lib/server/send-email";
import { readAllRows } from "@/lib/server/snagging/read-all";

/**
 * Sends the daily digest (lib/finance/digest-plan.ts says what and when).
 *
 * At most once a day: each notification's dedupe key carries the Dubai
 * date, so a second run that day writes and sends nothing. Delivery goes
 * through the notifier and its safety rail, so outside production the
 * email reaches only NOTIFY_REDIRECT_TO and in-app only the allowlist.
 */

export type DigestRunResult =
  | { sent: false; reason: string }
  | { sent: true; date: string; newItems: number; outstanding: number; aged: number; e1: NotifyResult; n2: number };

async function lastDigestAt(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin
    .from("portal_notifications")
    .select("created_at")
    .eq("event", "finance.digest")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.created_at as string | null) ?? null;
}

function emailBody(plan: Extract<ReturnType<typeof planDigest>, { send: true }>, appUrl: string): string {
  const rows = plan.newItems
    .map((i) => {
      const link = `${appUrl}/finance/queue/${i.id}`;
      return `<tr>
        <td style="padding:6px 8px;border-top:1px solid #e5e7eb"><a href="${escapeEmailHtml(link)}">FQ-${i.number}</a></td>
        <td style="padding:6px 8px;border-top:1px solid #e5e7eb">${escapeEmailHtml(i.quotationNumber ?? "—")}</td>
        <td style="padding:6px 8px;border-top:1px solid #e5e7eb">${escapeEmailHtml(i.clientName ?? "—")}</td>
        <td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right">${escapeEmailHtml(aed(i.value))}</td>
        <td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right">${i.completionPercent === null ? "—" : `${i.completionPercent}%`}</td>
      </tr>`;
    })
    .join("");
  const table = plan.newItems.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">
        <tr style="color:#6b7280;text-align:left"><th style="padding:6px 8px">Item</th><th style="padding:6px 8px">Quotation</th>
        <th style="padding:6px 8px">Client</th><th style="padding:6px 8px;text-align:right">Value</th>
        <th style="padding:6px 8px;text-align:right">Completion</th></tr>${rows}</table>`
    : "<p>No new items since the last digest.</p>";
  const aged = plan.aged.length
    ? `<p><strong>${plan.aged.length} item(s) pending longer than the agreed limit:</strong> ${plan.aged
        .slice(0, 10)
        .map((a) => escapeEmailHtml(`FQ-${a.number} (${a.daysPending} days)`))
        .join(", ")}${plan.aged.length > 10 ? "…" : ""}</p>`
    : "";
  return clientEmailHtml({
    eyebrow: "Finance",
    heading: `Ready to invoice, ${plan.date}`,
    paragraphs: [table, aged].filter(Boolean),
    details: [
      { label: "New since the last digest", value: `${plan.newItems.length} (${aed(plan.newValue)})` },
      { label: "Awaiting action", value: `${plan.outstanding.count} (${aed(plan.outstanding.value)})` },
    ],
    cta: { label: "Open the queue", url: `${appUrl}/finance/queue` },
  });
}

export async function runDigest(
  admin: SupabaseClient,
  options: { now?: Date; ignoreTime?: boolean } = {},
): Promise<DigestRunResult> {
  const now = options.now ?? new Date();
  const settings = await readReportingSettings(admin);
  if (!options.ignoreTime && !digestDue(now, settings.finance.digestTimeLocal)) {
    return { sent: false, reason: `before the digest time (${settings.finance.digestTimeLocal} Dubai)` };
  }
  const recipientIds = settings.finance.digestRecipientUserIds;
  if (recipientIds.length === 0) return { sent: false, reason: "no digest recipients set (Reporting Settings)" };

  const items = await readAllRows<Record<string, unknown>>(
    (from, to) =>
      admin
        .schema("finance")
        .from("queue_list")
        .select("id, number, status, status_changed_at, entered_at, value, quotation_number, work_order_number, client_name, completion_percent")
        .order("number")
        .range(from, to),
    "digest items",
  );
  const plan = planDigest({
    items: items.map<DigestItem>((r) => ({
      id: r.id as string,
      number: Number(r.number),
      status: r.status as string,
      statusChangedAt: r.status_changed_at as string,
      enteredAt: r.entered_at as string,
      value: Number(r.value),
      quotationNumber: (r.quotation_number as string | null) ?? null,
      workOrderNumber: (r.work_order_number as string | null) ?? null,
      clientName: (r.client_name as string | null) ?? null,
      completionPercent: r.completion_percent === null ? null : Number(r.completion_percent),
    })),
    now,
    lastDigestAt: await lastDigestAt(admin),
    agedAfterDays: settings.finance.agedAfterDays,
  });
  if (!plan.send) return { sent: false, reason: plan.reason };

  const { data: people, error } = await admin
    .from("user_profile")
    .select("id, email, is_active")
    .in("id", recipientIds);
  if (error) throw new Error(error.message);
  const recipients = (people ?? [])
    .filter((p) => p.is_active !== false)
    .map((p) => ({ userId: p.id as string, email: (p.email as string | null) ?? null }));

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
  const notify = createNotifier({
    store: supabaseNotificationStore(admin),
    sendEmail: (input) => sendEmail(input),
    appUrl,
  });
  const date = dubaiClock(now).date;

  /* E1 (email) and N1 (in-app): one notification, both channels. */
  const e1 = await notify({
    event: "finance.digest",
    dedupeKey: `digest:${date}`,
    recipients,
    channels: ["email", "in_app"],
    title: digestSubject(plan),
    body: digestInAppText(plan),
    html: emailBody(plan, appUrl),
    link: "/finance/queue",
  });

  /* Every channel already had today's digest: nothing new went out. */
  const claimed = e1.inApp.delivered + e1.inApp.suppressed + e1.email.sent + e1.email.failed + e1.email.suppressed;
  if (claimed === 0 && e1.inApp.duplicate + e1.email.duplicate > 0) {
    return { sent: false, reason: `already sent today (${date})` };
  }

  /* N2, in-app, once per item per stretch in Pending; closes when its status changes. */
  let n2 = 0;
  for (const item of plan.aged) {
    const result = await notify({
      event: "finance.item_aged",
      entityType: "finance_queue_item",
      entityId: item.id,
      dedupeKey: `aged:${item.id}:${item.statusChangedAt}`,
      recipients: recipients.map((r) => ({ userId: r.userId })),
      channels: ["in_app"],
      title: `FQ-${item.number} pending for ${item.daysPending} days`,
      body: `${item.quotationNumber ?? item.workOrderNumber ?? `FQ-${item.number}`} for ${item.clientName ?? "the client"} pending for ${item.daysPending} days.`,
      link: `/finance/queue/${item.id}`,
    });
    n2 += result.inApp.delivered + result.inApp.suppressed;
  }

  return {
    sent: true,
    date,
    newItems: plan.newItems.length,
    outstanding: plan.outstanding.count,
    aged: plan.aged.length,
    e1,
    n2,
  };
}
