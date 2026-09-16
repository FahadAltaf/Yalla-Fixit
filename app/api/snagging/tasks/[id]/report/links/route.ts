import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The client links issued for one inspection, and the ability to pull them
 * (FR-7.05).
 *
 * Revocation existed only as a side effect of re-delivering: minting a new
 * link retired the previous one, so a coordinator who wanted to stop a link
 * without sending another had no way to. This exposes both halves -- what is
 * out there, and taking it back.
 *
 * The raw token is never returned. Only its hint (the last six characters)
 * is stored in the clear, which is enough to tell two links apart in a list
 * and useless for opening one.
 */

type LinkRow = {
  id: string;
  token_hint: string | null;
  channel: string;
  recipient: string | null;
  version_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  opened_at: string | null;
  last_opened_at: string | null;
  open_count: number;
  created_at: string;
};

/** What a coordinator needs to answer "did they read it?". */
function describe(row: LinkRow, now: number) {
  const expired = Date.parse(row.expires_at) < now;
  const status = row.revoked_at
    ? "revoked"
    : expired
      ? "expired"
      : row.open_count > 0
        ? "opened"
        : "sent";
  return {
    id: row.id,
    hint: row.token_hint,
    channel: row.channel,
    recipient: row.recipient,
    version_id: row.version_id,
    status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    first_opened_at: row.opened_at,
    last_opened_at: row.last_opened_at,
    open_count: row.open_count,
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();
    const { data, error } = await admin
      .from("snagging_report_tokens")
      .select(
        "id, token_hint, channel, recipient, version_id, expires_at, revoked_at, opened_at, last_opened_at, open_count, created_at",
      )
      .eq("job_id", id)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const now = Date.now();
    return NextResponse.json({
      data: ((data ?? []) as LinkRow[]).map((row) => describe(row, now)),
    });
  } catch (error) {
    console.error("Report links GET error:", error);
    return NextResponse.json({ error: "Failed to load report links" }, { status: 500 });
  }
}

/**
 * Revokes a link, or every live link on the job.
 *
 * Revocation is immediate and permanent: the public route refuses any token
 * whose row carries `revoked_at`, so the next open fails even if the client
 * already has the URL. Reserved for the approve permission -- pulling a
 * document back from a client is a manager act, not an edit.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.APPROVE) &&
      !isAdminUser(accessUser)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const linkId = new URL(req.url).searchParams.get("linkId");
    const revokedAt = new Date().toISOString();

    const admin = await createAdminServerClient();
    let query = admin
      .from("snagging_report_tokens")
      .update({ revoked_at: revokedAt })
      .eq("job_id", id)
      // Already-revoked rows keep their original timestamp: when it was
      // pulled is part of the record.
      .is("revoked_at", null);
    if (linkId) query = query.eq("id", linkId);

    const { data, error } = await query.select("id, token_hint");
    if (error) throw new Error(error.message);

    const revoked = data ?? [];
    if (revoked.length > 0) {
      await recordAudit(admin, {
        entityType: "token",
        entityId: id,
        taskId: id,
        eventType: "report_link_revoked",
        actorId: profile.id,
        actorLabel: profile.full_name ?? profile.email,
        payload: {
          count: revoked.length,
          hints: revoked.map((row) => (row as { token_hint: string | null }).token_hint),
        },
      });
    }

    return NextResponse.json({ data: { revoked: revoked.length, revoked_at: revokedAt } });
  } catch (error) {
    console.error("Report link revoke error:", error);
    return NextResponse.json({ error: "Failed to revoke the report link" }, { status: 500 });
  }
}
