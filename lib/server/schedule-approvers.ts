import { Resend } from "resend";
import type { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

// Who receives the "a day needs approval" email — NOT everyone who can
// approve, but the active users explicitly flagged with
// receives_schedule_approval_email. Turn the flag on for the account(s) that
// should be notified.
export async function getApproverRecipients(admin: Admin): Promise<Array<{ email: string; name: string }>> {
  const { data: users } = await admin
    .from("user_profile")
    .select("email, full_name")
    .eq("receives_schedule_approval_email", true)
    .eq("is_active", true);

  return (users ?? [])
    .filter((u: { email: string | null }) => Boolean(u.email))
    .map((u: { email: string; full_name: string | null }) => ({ email: u.email, name: u.full_name ?? u.email }));
}

// Best-effort email that a day needs approval. Never throws: a mail failure
// must not block submission. If `approverId` is given, only that person is
// emailed (E1: the submitter chose them); otherwise every flagged approver.
export async function notifyApproversOfSubmission(
  admin: Admin,
  opts: { date: string; submitterName: string; approverId?: string | null },
): Promise<{ sent: number }> {
  try {
    const apiKey = process.env.NEXT_PUBLIC_RESEND_API_KEY;
    const from = process.env.NEXT_PUBLIC_EMAIL_FROM;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "";
    if (!apiKey || !from) return { sent: 0 };

    let recipients = await getApproverRecipients(admin);
    if (opts.approverId) {
      const { data: chosen } = await admin
        .from("user_profile")
        .select("email, full_name")
        .eq("id", opts.approverId)
        .eq("is_active", true)
        .maybeSingle();
      recipients = chosen?.email ? [{ email: chosen.email, name: chosen.full_name ?? chosen.email }] : [];
    }
    if (recipients.length === 0) return { sent: 0 };

    const link = appUrl ? `${appUrl.replace(/\/$/, "")}/scheduling?date=${opts.date}` : "";
    const html = `
      <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;color:#1a1d1b">
        <h2 style="margin:0 0 8px">A schedule needs your approval</h2>
        <p style="margin:0 0 12px">
          <strong>${escapeHtml(opts.submitterName)}</strong> submitted the schedule for
          <strong>${escapeHtml(opts.date)}</strong> for approval.
        </p>
        ${link ? `<p style="margin:0 0 16px"><a href="${link}" style="color:#16544a">Open the schedule to review &rarr;</a></p>` : ""}
        <p style="margin:0;color:#6b7280;font-size:13px">Yalla Fixit &middot; Scheduling</p>
      </div>`;

    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to: recipients.map((r) => r.email),
      subject: `Schedule approval needed — ${opts.date}`,
      html,
    } as Parameters<typeof resend.emails.send>[0]);

    return { sent: recipients.length };
  } catch (error) {
    console.error("[notifyApproversOfSubmission] non-fatal:", error);
    return { sent: 0 };
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
