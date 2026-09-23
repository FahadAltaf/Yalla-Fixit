import { NextRequest } from "next/server";

import { handleSyncPull } from "@/lib/server/snagging/sync-pull";

/**
 * GET /api/snagging/sync/jobs -- the job list, as cards.
 *
 * Only what a card shows and which tab it sits in: the job row, its visit
 * state and its rooms done / total. No rooms, defects, photos, checklist,
 * plans or catalogue -- a job's contents come from /sync/job/[id] when it
 * is opened.
 *
 *   ?list=active          Today and Upcoming (the default)
 *   ?list=done&limit=30   Done, newest first; &before=<next_before> for more
 *   ?since=<server_time>  every card that changed, whichever tab
 */
export async function GET(req: NextRequest) {
  return handleSyncPull(req, { view: "list" });
}
