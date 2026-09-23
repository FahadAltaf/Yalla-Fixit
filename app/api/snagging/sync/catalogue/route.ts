import { NextRequest } from "next/server";

import { handleSyncPull } from "@/lib/server/snagging/sync-pull";

/**
 * GET /api/snagging/sync/catalogue -- the defect catalogue, on its own.
 *
 * Asked for when a job is opened, for the capture sheet. Sent only when
 * the device has none (?include_catalogue=true) or it changed after
 * ?catalogue_since; otherwise `catalogue` is null. No jobs are read.
 */
export async function GET(req: NextRequest) {
  return handleSyncPull(req, { view: "catalogue" });
}
