import { NextRequest, NextResponse } from "next/server";

import { emailService } from "@/lib/email-service";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { mintReportToken } from "@/lib/server/snagging/report-token";
import { assertTransition } from "@/lib/server/snagging/workflow";
import { deliverReportSchema } from "@/modules/snagging/schemas";
import { ActionType, ResourceType, SnaggingTaskStatus } from "@/types/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Delivers the client report over a tokenised link (K1-K3, FR-5.04-06).
 *
 * Marking an approved inspection delivered mints a fresh public link
 * (revoking any earlier one for the job) and, for the email channel,
 * sends it to the client. The link is random and stored only as a hash;
 * the report behind it is rendered fresh on each open with short-lived
 * signed photos, so nothing sensitive lives in the URL. Delivery is a
 * manager act, so it checks the same `approve` permission as sign-off.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.APPROVE)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const parsed = deliverReportSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;
    const recipient = input.recipient.trim();

    const admin = await createAdminServerClient();
    const { data: job, error: loadError } = await admin
      .from("snagging_jobs")
      .select("id, code, status, unit_label, building_name")
      .eq("id", id)
      .maybeSingle();

    if (loadError) throw new Error(loadError.message);
    if (!job) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

    // Deliver from approved (the lifecycle move); allow re-running once
    // delivered to reissue or resend the link without changing status.
    const alreadyDelivered = job.status === "delivered";
    if (!alreadyDelivered) {
      try {
        assertTransition(job.status as SnaggingTaskStatus, "delivered");
      } catch (transitionError) {
        return NextResponse.json({ error: (transitionError as Error).message }, { status: 409 });
      }
    }

    const deliveredAt = new Date().toISOString();

    if (!alreadyDelivered) {
      const { error: updateError } = await admin
        .from("snagging_jobs")
        .update({
          status: "delivered",
          delivered_at: deliveredAt,
          delivery_channel: input.channel,
          delivery_recipient: recipient,
        })
        .eq("id", id)
        .eq("status", "approved");
      if (updateError) throw new Error(updateError.message);
    } else {
      await admin
        .from("snagging_jobs")
        .update({ delivery_channel: input.channel, delivery_recipient: recipient })
        .eq("id", id);
    }

    // One live link per job: retire earlier ones before minting a new one.
    await admin
      .from("snagging_report_tokens")
      .update({ revoked_at: deliveredAt })
      .eq("job_id", id)
      .is("revoked_at", null);

    const token = mintReportToken();
    const expiresAt = new Date(
      Date.now() + (input.expires_in_days ?? 30) * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { error: tokenError } = await admin.from("snagging_report_tokens").insert({
      job_id: id,
      token_hash: token.hash,
      token_hint: token.hint,
      channel: input.channel,
      recipient,
      expires_at: expiresAt,
      created_by: profile.id,
    });
    if (tokenError) throw new Error(tokenError.message);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const reportUrl = `${baseUrl}/report/${token.raw}`;

    // Email the link, best-effort: a failed send must not undo delivery,
    // and the coordinator still gets the link back to send by hand.
    let emailSent = false;
    if (input.channel === "email" && EMAIL_RE.test(recipient)) {
      try {
        await emailService.sendEmail({
          to: recipient,
          subject: `Your snagging inspection report — ${job.unit_label ?? job.code}`,
          html: reportEmailHtml({
            unit: [job.unit_label, job.building_name].filter(Boolean).join(", ") || job.code,
            reportUrl,
            expiresAt,
          }),
        });
        emailSent = true;
      } catch (emailError) {
        console.error("Snagging report email failed:", emailError);
      }
    }

    await recordAudit(admin, {
      entityType: "task",
      entityId: id,
      taskId: id,
      eventType: "report_delivered",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email,
      payload: { code: job.code, channel: input.channel, recipient, token_hint: token.hint, emailSent },
    });

    return NextResponse.json({
      data: {
        id,
        status: "delivered",
        delivered_at: deliveredAt,
        channel: input.channel,
        recipient,
        report_url: reportUrl,
        expires_at: expiresAt,
        email_sent: emailSent,
      },
    });
  } catch (error) {
    console.error("Snagging deliver error:", error);
    return NextResponse.json({ error: "Failed to deliver report" }, { status: 500 });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reportEmailHtml(opts: { unit: string; reportUrl: string; expiresAt: string }): string {
  const expires = new Date(opts.expiresAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:0 auto">
    <div style="font-size:20px;font-weight:800;color:#0f766e">YALLA FIXIT</div>
    <div style="font-size:12px;color:#6b7280;margin-bottom:20px">Property Care · Snagging</div>
    <p>Your snagging inspection report for <strong>${escapeHtml(opts.unit)}</strong> is ready.</p>
    <p>
      <a href="${escapeHtml(opts.reportUrl)}"
         style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;
                padding:11px 20px;border-radius:8px;font-weight:700">
        View your report
      </a>
    </p>
    <p style="font-size:12px;color:#6b7280">
      This private link is available until ${escapeHtml(expires)}. Please do not share it.
    </p>
  </div>`;
}
