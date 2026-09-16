import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessAmcContracts } from "@/components/dashboard/extensions/amc/amc-constants";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { snapshotAmcSettings } from "@/lib/server/amc/settings";
import { linkTokenExpiry, mintLinkToken } from "@/lib/server/link-token";
import { sendEmail } from "@/lib/server/send-email";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";

/**
 * Sending a document to the client (FR5.4, FR5.6).
 *
 *   proposal   approved           ->  proposal_sent
 *   contract   proposal_approved  ->  contract_sent
 *
 * The status gate is the whole of FR5.1: a proposal that has not been
 * approved internally cannot be sent, and a contract cannot be sent before
 * the client has approved the proposal. Neither is a UI convention — both
 * are checked here.
 *
 * `deliver: "link"` mints the token and returns the URL without sending
 * anything, which is FR5.4's "copy the link to send over WhatsApp".
 */

const sendSchema = z.object({
  id: z.string().uuid(),
  document: z.enum(["proposal", "contract"]),
  deliver: z.enum(["email", "link"]).default("email"),
});

/** Which status a document may be sent from, and what it becomes. */
const TRANSITIONS = {
  proposal: { from: "approved", to: "proposal_sent" },
  contract: { from: "proposal_approved", to: "contract_sent" },
} as const;

const SELECT =
  "id, owner_id, status, customer, proposal_number, final_price, settings_snapshot";

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    ""
  ).replace(/\/$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(req: NextRequest) {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canAccessAmcContracts(access.profile.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = sendSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { profile } = access;
  const { id, document, deliver } = parsed.data;
  const transition = TRANSITIONS[document];
  const admin = await createAdminServerClient();

  const { data: existing, error: fetchError } = await admin
    .from("amc_submissions")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.owner_id !== profile.id) {
    return NextResponse.json(
      { error: "Only the owner can send this document" },
      { status: 403 },
    );
  }
  if (existing.status !== transition.from) {
    return NextResponse.json(
      {
        error:
          document === "proposal"
            ? "This proposal has not been approved internally yet."
            : "The client has not approved the proposal yet.",
      },
      { status: 409 },
    );
  }

  /*
    FR6.4 — freeze the text before the document leaves the building. Taken
    once only (the helper filters on settings_snapshot IS NULL), so
    re-sending a proposal cannot re-freeze it against wording that has
    changed since the client first saw it.
  */
  await snapshotAmcSettings(admin, id);

  const token = mintLinkToken();
  const expiresAt = linkTokenExpiry();
  const now = new Date().toISOString();
  const prefix = document === "proposal" ? "proposal" : "contract";

  const { data, error } = await admin
    .from("amc_submissions")
    .update({
      status: transition.to,
      [`${prefix}_token_hash`]: token.hash,
      [`${prefix}_token_hint`]: token.hint,
      [`${prefix}_token_expires_at`]: expiresAt,
      [`${prefix}_sent_at`]: now,
      updated_at: now,
    })
    .eq("id", id)
    /* Re-asserted, so two tabs sending at once cannot both mint a token
       and leave the second one's link as the only working copy. */
    .eq("status", transition.from)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Someone else updated this proposal a moment ago. Reload and try again." },
      { status: 409 },
    );
  }

  const customer = (existing.customer ?? {}) as {
    customerName?: string;
    customerEmail?: string;
  };
  const link = `${appUrl()}/amc/${token.raw}`;

  let emailed = false;
  if (deliver === "email") {
    const to = customer.customerEmail?.trim();
    if (!to) {
      /*
        The status change and the token are already committed, so this is
        reported rather than rolled back: the link is valid and the team
        can copy it. Failing the whole request would leave a sent document
        the system thinks was never sent.
      */
      return NextResponse.json(
        {
          submission: data,
          link,
          emailed: false,
          warning:
            "No customer email on this proposal — the link was created but nothing was sent. Copy the link instead.",
        },
        { status: 200 },
      );
    }

    try {
      await sendEmail({
        to,
        subject:
          document === "proposal"
            ? `Your AMC proposal ${existing.proposal_number ?? ""}`.trim()
            : `Your AMC contract ${existing.proposal_number ?? ""}`.trim(),
        html: `
          <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;color:#17120e">
            <p>Dear ${escapeHtml(customer.customerName ?? "customer")},</p>
            <p>
              ${
                document === "proposal"
                  ? "Your annual maintenance contract proposal is ready to review."
                  : "Thank you for approving the proposal. Your contract is ready to sign."
              }
            </p>
            <p style="margin:20px 0">
              <a href="${link}" style="background:#0e7c70;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none">
                ${document === "proposal" ? "Review the proposal" : "Review and sign"}
              </a>
            </p>
            <p style="color:#6e655b;font-size:13px">
              This link is personal to you and expires in 30 days.
            </p>
            <p style="color:#6e655b;font-size:13px">Yalla Fix It</p>
          </div>`,
      });
      emailed = true;
    } catch (mailError) {
      console.error("AMC send email failed:", mailError);
      return NextResponse.json({
        submission: data,
        link,
        emailed: false,
        warning:
          "The document was marked as sent and the link is valid, but the email could not be delivered. Copy the link and send it another way.",
      });
    }
  }

  /* FR5.9 — the raw token is never audited; the hint identifies the link
     without being usable. */
  await recordAmcAudit(admin, {
    entityType: "submission",
    entityId: id,
    eventType: document === "proposal" ? "proposal_sent" : "contract_sent",
    actorId: profile.id,
    actorLabel: profile.full_name ?? profile.email ?? null,
    payload: {
      document,
      deliver,
      emailed,
      tokenHint: token.hint,
      expiresAt,
      to: deliver === "email" ? customer.customerEmail ?? null : null,
    },
  });

  return NextResponse.json({ submission: data, link, emailed });
}
