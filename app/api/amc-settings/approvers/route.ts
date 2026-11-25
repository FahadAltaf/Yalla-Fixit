import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminUser } from "@/lib/role-permissions";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { readAmcSettingsOverrides, writeAmcSettingsOverrides } from "@/lib/server/amc/settings";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/*
  PUT { approvers: string[] } -- the AMC approvers (all levels), by email
  (23 Nov 2026): set from AMC configuration -> Named people, saved alone so
  nothing else in AMC settings changes. Admins only, as AMC settings.
*/

const bodySchema = z.object({ approvers: z.array(z.string().trim().email().max(200)).max(50) }).strict();

export async function PUT(req: NextRequest) {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile || !access.accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminUser(access.accessUser)) return NextResponse.json({ error: "Only an administrator can change the AMC approvers." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const admin = await createAdminServerClient();
    const before = await readAmcSettingsOverrides(admin);
    const was = before.approval?.approvers ?? [];
    const approvers = [...new Set(parsed.data.approvers.map((e) => e.toLowerCase()))];
    await writeAmcSettingsOverrides(admin, { ...before, approval: { approvers } }, access.profile.id);
    const added = approvers.filter((e) => !was.map((w) => w.toLowerCase()).includes(e));
    const removed = was.filter((w) => !approvers.includes(w.toLowerCase()));
    if (added.length || removed.length) {
      await recordAmcAudit(admin, {
        entityType: "settings",
        eventType: "settings_updated",
        actorId: access.profile.id,
        actorLabel: access.profile.full_name ?? access.profile.email ?? null,
        payload: {
          changedKeys: ["approval.approvers"],
          changes: [...added.map((e) => `AMC approver added: ${e}`), ...removed.map((e) => `AMC approver removed: ${e}`)],
        },
      });
    }
    return NextResponse.json({ approvers });
  } catch (error) {
    console.error("AMC approvers PUT error:", error);
    return NextResponse.json({ error: "Could not save the AMC approvers" }, { status: 500 });
  }
}
