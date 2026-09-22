import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { hasResourceAction } from "@/lib/role-permissions";
import { canApproveAmc } from "@/components/dashboard/extensions/amc/amc-settings";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The internal half of the approval flow (FR5.1–FR5.3, FR5.9).
 *
 *   submit     owner   draft | sent_back  ->  awaiting_approval
 *   approve    approver    awaiting_approval  ->  approved
 *   send_back  approver    awaiting_approval  ->  sent_back (reason required)
 *
 * Nothing here reaches the client. FR5.1 is explicit: "Nothing goes to the
 * client before internal approval." Sending is phase 5, and only from
 * 'approved'.
 *
 * Two gates, deliberately different (FRD §4 vs FR5.3):
 *   - the email allowlist says who may touch the AMC module at all
 *   - role_access amc/approve says who may decide
 */

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), id: z.string().uuid() }),
  z.object({ action: z.literal("approve"), id: z.string().uuid() }),
  z.object({
    action: z.literal("send_back"),
    id: z.string().uuid(),
    /* FR5.2 — "send it back with a reason". A blank reason gives the owner
       nothing to act on, so it is required rather than merely prompted. */
    reason: z
      .string()
      .trim()
      .min(1, "Give a reason so the owner knows what to fix"),
  }),
]);

const SELECT =
  "id, owner_id, status, customer, final_price, submitted_at, decided_at, sent_back_reason";

export async function POST(req: NextRequest) {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile || !access.accessUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canUseAmc(access.accessUser)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = actionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { profile, accessUser } = access;
  const body = parsed.data;
  const admin = await createAdminServerClient();
  const actorLabel = profile.full_name ?? profile.email ?? null;

  const { data: existing, error: fetchError } = await admin
    .from("amc_submissions")
    .select(SELECT)
    .eq("id", body.id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  /* FR5.3: the approvers chosen in AMC Settings, or the role permission
     when none are chosen. */
  const canApprove = canApproveAmc(
    await readAmcSettings(admin),
    profile.email,
    hasResourceAction(accessUser, ResourceType.AMC, ActionType.APPROVE),
  );
  const isOwner = existing.owner_id === profile.id;
  const now = new Date().toISOString();

  let update: Record<string, unknown>;
  let eventType: string;

  if (body.action === "submit") {
    if (!isOwner) {
      return NextResponse.json(
        { error: "Only the owner can submit this proposal" },
        { status: 403 },
      );
    }
    /* FR3.4 — resubmitting after a send-back is allowed; resubmitting
       something already under review, or already sent, is not. */
    if (
      existing.status !== "draft" &&
      existing.status !== "sent_back" &&
      existing.status !== "proposal_rejected"
    ) {
      return NextResponse.json(
        {
          error: `A proposal that is ${existing.status.replace(/_/g, " ")} cannot be submitted for approval`,
        },
        { status: 409 },
      );
    }
    update = {
      status: "awaiting_approval",
      submitted_at: now,
      submitted_by: profile.id,
      /* Cleared so a resubmission does not still show the previous
         round's reason on the owner's screen. */
      sent_back_reason: null,
      decided_at: null,
      decided_by: null,
      /*
        The client asked for changes and this is the revised proposal. The
        link they have shows the old one, so it stops working now; the
        approved revision goes out with a new link. It also takes the
        current AMC Settings, like any proposal not yet sent (FR6.4).
      */
      ...(existing.status === "proposal_rejected"
        ? {
            proposal_token_hash: null,
            proposal_token_hint: null,
            proposal_token_expires_at: null,
            settings_snapshot: null,
          }
        : {}),
    };
    eventType =
      existing.status === "proposal_rejected"
        ? "resubmitted_after_client_changes"
        : "submitted_for_approval";
  } else {
    if (!canApprove) {
      return NextResponse.json(
        { error: "You do not have permission to approve AMC proposals" },
        { status: 403 },
      );
    }
    if (existing.status !== "awaiting_approval") {
      return NextResponse.json(
        {
          error: `A proposal that is ${existing.status.replace(/_/g, " ")} is not awaiting approval`,
        },
        { status: 409 },
      );
    }
    update =
      body.action === "approve"
        ? {
            status: "approved",
            decided_at: now,
            decided_by: profile.id,
            sent_back_reason: null,
          }
        : {
            status: "sent_back",
            decided_at: now,
            decided_by: profile.id,
            sent_back_reason: body.reason,
          };
    eventType = body.action === "approve" ? "approved" : "sent_back";
  }

  const { data, error } = await admin
    .from("amc_submissions")
    .update({ ...update, updated_at: now })
    .eq("id", body.id)
    /*
      Re-asserts the status we validated against. Two approvers opening the
      queue at the same moment cannot both decide: the second update matches
      no row and is reported as a conflict rather than silently overwriting
      the first decision.
    */
    .eq("status", existing.status)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      {
        error:
          "Someone else updated this proposal a moment ago. Reload and try again.",
      },
      { status: 409 },
    );
  }

  /* FR5.9 — every status change recorded with who, when and any reason. */
  await recordAmcAudit(admin, {
    entityType: "submission",
    entityId: body.id,
    eventType,
    actorId: profile.id,
    actorLabel,
    justification: body.action === "send_back" ? body.reason : null,
    payload: { from: existing.status, to: update.status },
  });

  return NextResponse.json({ submission: data });
}
