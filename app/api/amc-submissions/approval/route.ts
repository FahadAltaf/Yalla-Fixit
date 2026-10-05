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
import {
  STALE_CLIENT_DECISION_FIELDS,
  checkInternalTransition,
} from "@/lib/amc/workflow";
import { submittableProblem } from "@/lib/server/amc/pricing";

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
 *   - AMC view or approve permission says who may use the module at all
 *   - the AMC Settings approver list, or role_access amc/approve when the
 *     list is empty, says who may decide
 *
 * The transition rules, including whether a creator may approve their own
 * proposal, live in lib/amc/workflow.ts.
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
/* Submit also needs the rows, to check every ticked service is priced. */
const SELECT_WITH_SERVICES = `${SELECT}, services`;

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
    .select(body.action === "submit" ? SELECT_WITH_SERVICES : SELECT)
    .eq("id", body.id)
    .maybeSingle<{
      id: string;
      owner_id: string;
      status: string;
      services?: Array<{ serviceId: string; included: boolean; basePrice?: number | null }>;
    }>();

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

  /* FR3.4, FR5.2, FR5.3: who may move it, and from where. */
  const check = checkInternalTransition({
    action: body.action,
    from: existing.status,
    isOwner,
    canApprove,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  if (body.action === "submit") {
    /* FR2.12 on the server: the form checks this too, but a request can
       skip the form. */
    const problem = submittableProblem(existing.services ?? []);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
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
            /* The client's answer was to the old version. */
            ...STALE_CLIENT_DECISION_FIELDS,
          }
        : {}),
    };
    eventType =
      existing.status === "proposal_rejected"
        ? "resubmitted_after_client_changes"
        : "submitted_for_approval";
  } else {
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

  /* The partial row selected above; services are internal to the check. */
  const { services: _services, ...submission } = data as Record<string, unknown>;
  void _services;
  return NextResponse.json({ submission });
}
