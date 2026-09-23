import { NextRequest } from "next/server";

import { handleSyncPull } from "@/lib/server/snagging/sync-pull";

/**
 * Everything assigned, in one response: the shape app builds before the
 * per-screen routes (sync/jobs, sync/job/[id], sync/catalogue) still use.
 * See lib/server/snagging/sync-pull.
 */
export async function GET(req: NextRequest) {
  return handleSyncPull(req);
}
