import { NextRequest } from "next/server";

import { handleSyncPush } from "@/lib/server/snagging/sync-push";

/** Drains the device outbox (§6.3). See lib/server/snagging/sync-push. */
export async function POST(req: NextRequest) {
  return handleSyncPush(req);
}
