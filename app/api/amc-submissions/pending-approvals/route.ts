import { NextResponse } from "next/server";

import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { canApproveAmc } from "@/components/dashboard/extensions/amc/amc-settings";
import type {
  AmcPendingApproval,
  AmcPendingApprovalsResponse,
} from "@/components/dashboard/extensions/amc/amc-types";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The approver's queue for the header bell (FR5.1–FR5.3): every proposal
 * waiting for approval that the caller did not submit themselves.
 *
 * The bell polls this on every page, so anyone who is not an approver gets
 * an empty queue rather than an error.
 */
const EMPTY: AmcPendingApprovalsResponse = { canApprove: false, items: [] };

export async function GET() {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile || !access.accessUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canUseAmc(access.accessUser)) return NextResponse.json(EMPTY);

  const admin = await createAdminServerClient();
  const canApprove = canApproveAmc(
    await readAmcSettings(admin),
    access.profile.email,
    hasResourceAction(access.accessUser, ResourceType.AMC, ActionType.APPROVE),
  );
  if (!canApprove) return NextResponse.json(EMPTY);

  const { data, error } = await admin
    .from("amc_submissions")
    .select(
      "id, owner_id, customer, proposal_number, final_price, submitted_at",
    )
    .eq("status", "awaiting_approval")
    .neq("owner_id", access.profile.id)
    .order("submitted_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const ownerIds = [...new Set(rows.map((row) => String(row.owner_id)))];
  const names = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners } = await admin
      .from("user_profile")
      .select("id, full_name, email")
      .in("id", ownerIds);
    for (const owner of owners ?? []) {
      names.set(
        String(owner.id),
        ((owner.full_name as string | null) ?? "").trim() ||
          String(owner.email ?? ""),
      );
    }
  }

  const items: AmcPendingApproval[] = rows.map((row) => {
    const customer = (row.customer ?? {}) as { customerName?: string };
    return {
      id: String(row.id),
      customerName: customer.customerName?.trim() || "Unnamed customer",
      proposalNumber: String(row.proposal_number ?? ""),
      ownerName: names.get(String(row.owner_id)) ?? "",
      finalPrice: Number(row.final_price ?? 0),
      submittedAt: (row.submitted_at as string | null) ?? null,
    };
  });

  return NextResponse.json({ canApprove, items });
}
