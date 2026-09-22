"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ClipboardCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { amcSubmissionsService } from "@/modules/amc-submissions";
import { formatCurrencyAED } from "@/utils/format-currency";

import type { AmcPendingApproval } from "./amc-types";

/**
 * The approver's notice on AMC Proposals (FR5.1–FR5.3), in the same place
 * and style as the "Sent back by the approver" notice. It polls the
 * approval queue, lists what is waiting, and links each request to its
 * details on the submissions list.
 *
 * Only approvers see it: for anyone else the endpoint returns
 * canApprove: false and nothing renders.
 */

/* Fired when the queue changes, so an open submissions list reloads, and
   by the list after a decision, so the notice catches up at once. */
export const AMC_APPROVALS_CHANGED = "amc-approvals-changed";

const POLL_MS = 60_000;
/* Rows shown before "Show all"; the rest are one click away on the list. */
const SHOWN = 3;

export function reviewLink(id: string) {
  return `/extensions?section=amc-proposals&view=submissions&review=${encodeURIComponent(id)}`;
}

export function AmcApprovalNotice({
  onShowAll,
}: {
  /* Opens the submissions list filtered to what is waiting. */
  onShowAll: () => void;
}) {
  const router = useRouter();
  const [canApprove, setCanApprove] = useState(false);
  const [items, setItems] = useState<AmcPendingApproval[]>([]);
  /* Hidden until something new arrives, not for good. */
  const [dismissedIds, setDismissedIds] = useState<Set<string> | null>(null);
  const known = useRef<Set<string> | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await amcSubmissionsService.listPendingApprovals();
      setCanApprove(response.canApprove);
      setItems(response.items);

      /* A toast only for requests that arrive while the page is open; the
         ones already waiting are in the notice itself. */
      const previous = known.current;
      known.current = new Set(response.items.map((item) => item.id));
      if (!previous) return;
      const fresh = response.items.filter((item) => !previous.has(item.id));
      if (fresh.length === 0) return;
      toast.info(
        fresh.length === 1
          ? "New AMC proposal to approve"
          : `${fresh.length} new AMC proposals to approve`,
        {
          description:
            fresh.length === 1
              ? `${fresh[0].customerName}${fresh[0].ownerName ? `, from ${fresh[0].ownerName}` : ""}`
              : undefined,
          action: {
            label: "Review",
            onClick: () => router.push(reviewLink(fresh[0].id)),
          },
          duration: 10_000,
        },
      );
      window.dispatchEvent(new Event(AMC_APPROVALS_CHANGED));
    } catch {
      /* A failed poll is retried on the next tick; nothing to show. */
    } finally {
      inFlight.current = false;
    }
  }, [router]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onRefresh = () => void refresh();
    window.addEventListener("focus", onRefresh);
    window.addEventListener(AMC_APPROVALS_CHANGED, onRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(AMC_APPROVALS_CHANGED, onRefresh);
    };
  }, [refresh]);

  const hidden =
    dismissedIds !== null && items.every((item) => dismissedIds.has(item.id));
  if (!canApprove || items.length === 0 || hidden) return null;

  return (
    <Alert className="border-primary/25 bg-primary/5 px-4 py-3">
      <ClipboardCheck className="text-primary size-4" />
      <AlertTitle className="text-primary pr-8">
        {items.length === 1
          ? "1 proposal waiting for your approval"
          : `${items.length} proposals waiting for your approval`}
      </AlertTitle>
      <AlertDescription className="text-foreground/80">
        <ul className="mt-1 w-full divide-y">
          {items.slice(0, SHOWN).map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate font-medium">
                  {item.customerName}
                  {item.proposalNumber ? (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      ({item.proposalNumber})
                    </span>
                  ) : null}
                </p>
                <p className="text-muted-foreground text-xs">
                  {[
                    item.ownerName ? `From ${item.ownerName}` : null,
                    formatCurrencyAED(item.finalPrice),
                    item.submittedAt
                      ? formatDistanceToNow(new Date(item.submittedAt), {
                          addSuffix: true,
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => router.push(reviewLink(item.id))}
              >
                Review
              </Button>
            </li>
          ))}
        </ul>
        {items.length > SHOWN ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={onShowAll}
          >
            Show all {items.length}
          </Button>
        ) : null}
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 size-7"
        aria-label="Hide for now"
        onClick={() => setDismissedIds(new Set(items.map((item) => item.id)))}
      >
        <X className="size-4" />
      </Button>
    </Alert>
  );
}
