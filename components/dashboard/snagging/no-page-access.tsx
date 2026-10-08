import { ShieldAlert } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

/**
 * What a Snagging page shows to somebody who may not open it.
 *
 * The permission used to stop at the sidebar: the page simply skipped
 * its server-side read and rendered anyway, and the table then asked the
 * API for itself. Typing /snagging/jobs got you every client's jobs
 * whatever your role said -- the menu was the only thing the permission
 * had ever controlled.
 *
 * So the page stops here instead. Said plainly rather than redirected,
 * because a page that silently bounces somewhere else reads as a broken
 * link, and the person needs to know who to ask.
 */
export function NoPageAccess({ page }: { page: string }) {
  return (
    <EmptyState
      icon={<ShieldAlert className="size-5" />}
      title={`You do not have access to ${page}`}
      description="Your role does not include this page. Ask an administrator if you need it."
    />
  );
}
