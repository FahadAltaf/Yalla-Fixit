import { NextResponse } from "next/server";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { complianceRights } from "@/lib/server/compliance/access";
import { ok } from "@/lib/server/compliance/http";

/* The caller's compliance rights, so the UI can hide what the API would refuse (FR-9). */
export async function GET() {
  const { profile, accessUser } = await getAuthenticatedUserAccess();
  if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return ok(complianceRights(accessUser));
}
