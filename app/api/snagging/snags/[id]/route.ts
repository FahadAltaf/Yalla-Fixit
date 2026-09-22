import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { hasReviewNote, hasVerdictNote } from "@/lib/server/snagging/columns";
import { ActionType, ResourceType } from "@/types/types";

/** Long enough for a paragraph on site; short enough to stay a note. */
const MAX_NOTE = 2000;

/**
 * PATCH /api/snagging/snags/[id] — corrects a snag's note, or the comment
 * the inspector gave with its de-snag verdict, from the portal; or leaves
 * the inspector a note. Body: { note }, { verdict_note } or { review_note }.
 *
 * `review_note` is the reviewer or approver talking to the inspector. It
 * is shown on the phone and never printed on the client's report, so it
 * is kept apart from the inspector's own note.
 *
 * The inspector writes the note on site, often one-handed and in a hurry,
 * and it goes into the client's report word for word. A reviewer can now
 * fix the wording without sending the whole job back. Only the note: the
 * defect, severity and photos are the inspector's findings and change
 * through the phone.
 *
 * `updated_at` is stamped so the inspector's phone picks the new wording up
 * on its next pull. If the phone is holding an unsent edit to the same
 * snag, its push still lands afterwards (sync is last-write-wins); the
 * audit entry keeps both texts.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    // Which of the two texts this edits.
    const field =
      body && "review_note" in body
        ? "review_note"
        : body && "verdict_note" in body
          ? "verdict_note"
          : "note";
    const value = body?.[field];
    if (!body || !(field in body) || (value !== null && typeof value !== "string")) {
      return NextResponse.json({ error: "Send the note as text." }, { status: 400 });
    }
    const note = typeof value === "string" ? value.trim() : "";
    if (note.length > MAX_NOTE) {
      return NextResponse.json(
        { error: `A note can be up to ${MAX_NOTE} characters.` },
        { status: 400 },
      );
    }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();

    if (field === "verdict_note" && !(await hasVerdictNote(admin))) {
      return NextResponse.json(
        { error: "Verdict comments are not available until the database is updated." },
        { status: 409 },
      );
    }
    if (field === "review_note" && !(await hasReviewNote(admin))) {
      return NextResponse.json(
        { error: "Notes to the inspector are not available until the database is updated." },
        { status: 409 },
      );
    }

    const { data: snag, error: snagError } = await admin
      .from("snagging_snags")
      .select<string, { id: string; job_id: string; snag_code: string } & Record<string, string | null>>(
        `id, job_id, snag_code, ${field}`,
      )
      .eq("id", id)
      .maybeSingle();
    if (snagError) throw new Error(snagError.message);
    if (!snag) return NextResponse.json({ error: "Snag not found" }, { status: 404 });

    const next = note || null;
    if ((snag[field] ?? null) === next) {
      // Nothing changed: no write, no audit entry.
      return NextResponse.json({ data: { id: snag.id, [field]: next } });
    }

    const now = new Date().toISOString();
    const { error } = await admin
      .from("snagging_snags")
      .update({
        [field]: next,
        // Who left the note and when, shown with it on the phone.
        ...(field === "review_note"
          ? { review_note_by: next ? profile.id : null, review_note_at: next ? now : null }
          : {}),
        // Stamped so the inspector's phone picks it up on its next pull.
        updated_at: now,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);

    await recordAudit(admin, {
      entityType: "snag",
      entityId: snag.id,
      taskId: snag.job_id,
      eventType: "snag_updated",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email ?? null,
      origin: "portal",
      payload: {
        snag_code: snag.snag_code,
        field,
        before: snag[field] ?? null,
        after: next,
      },
    });

    return NextResponse.json({ data: { id: snag.id, [field]: next } });
  } catch (error) {
    console.error("Snag PATCH error:", error);
    return NextResponse.json({ error: "Failed to save the note" }, { status: 500 });
  }
}
