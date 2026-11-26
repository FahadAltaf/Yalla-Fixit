import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { todayInDubai } from "@/lib/amc/contracts";
import { parseTracker, trackerSummary } from "@/lib/amc/tracker-import";
import { hasResourceAction } from "@/lib/role-permissions";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { importTrackerContracts, previewTrackerImport } from "@/lib/server/amc/tracker-import";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * DEV-486: import the department's contract tracker (CSV).
 *   mode "preview"  reads the file and the portal, writes nothing
 *   mode "import"   writes contracts `from` .. `from + count` (oldest first);
 *                   the screen calls it until `next` is null
 * For AMC Configuration (Edit). Never writes Zoho FSM, never messages a client.
 */
const schema = z
  .object({
    csv: z.string().min(10).max(2_000_000),
    mode: z.enum(["preview", "import"]),
    from: z.number().int().min(0).optional(),
    count: z.number().int().min(1).max(20).optional(),
    owners: z.record(z.string(), z.string().uuid()).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { accessUser } = await getAuthenticatedUserAccess();
  if (!hasResourceAction(accessUser, ResourceType.AMC_CONFIG, ActionType.EDIT)) {
    return NextResponse.json({ error: "Importing contracts needs AMC Configuration (Edit)." }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const body = parsed.data;
  const today = todayInDubai();
  const tracker = parseTracker(body.csv, today);
  if (!tracker.contracts.length) return NextResponse.json({ error: tracker.problems[0] ?? "No contracts found in the file.", problems: tracker.problems }, { status: 400 });
  try {
    if (body.mode === "preview") {
      return NextResponse.json({ summary: trackerSummary(tracker), problems: tracker.problems, ...(await previewTrackerImport(gate.admin, tracker)) });
    }
    const result = await importTrackerContracts(
      gate.admin,
      tracker,
      { from: body.from ?? 0, count: body.count ?? 8, owners: body.owners ?? {}, today },
      { id: gate.userId, label: gate.label },
      await readAmcConfig(gate.admin),
    );
    return NextResponse.json(result);
  } catch (error) {
    return contractErrorResponse(error, "Could not import the contracts");
  }
}
