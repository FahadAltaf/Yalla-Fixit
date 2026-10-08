"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, ClipboardCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataRow, SectionCard } from "@/components/dashboard/shared/kaizen";
import { amcSubmissionsService } from "@/modules/amc-submissions";
import { formatCurrencyAED } from "@/utils/format-currency";

import { grandTotalOf } from "./amc-pricing";
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
/*
  Rows shown before folding; the rest are one click away on the list.

  Five rather than three. Three was chosen when the queue was a
  footnote; an approver with four waiting had one of them hidden
  behind a link, which is the one case the notice exists for.
*/
const SHOWN = 5;

/* The proposal's own page, where the approver reads it and decides. */
export function reviewLink(id: string) {
  return `/extensions/amc/${encodeURIComponent(id)}`;
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

  const waiting = items.length;

  return (
    /*
      The queue, as a card rather than an alert.

      It was an Alert: a tinted strip with a title and a list crammed into
      its description slot, so four proposals read as one long warning
      instead of four things to do. A queue is a list of work, and the
      product already has a shape for that -- the same card and the same
      row the job page and the home page use -- so an approver reads it
      the way they read every other list in the portal.
    */
    <SectionCard
      icon={<ClipboardCheck />}
      title="Waiting for your approval"
      description={
        waiting === 1
          ? "One proposal is with you."
          : `${waiting} proposals are with you, oldest first.`
      }
      className="border-brand/30"
      bodyClassName="border-t"
      action={
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-brand-50 text-brand border-0 font-medium tabular-nums">
            {waiting}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Hide for now"
            onClick={() => setDismissedIds(new Set(items.map((item) => item.id)))}
          >
            <X className="size-4" />
          </Button>
        </div>
      }
    >
      <ol className="divide-y">
        {items.slice(0, SHOWN).map((item) => (
          <li key={item.id}>
            <DataRow
              icon={<ClipboardCheck aria-hidden />}
              title={item.customerName || "Unnamed client"}
              subtitle={
                <>
                  {item.proposalNumber || "No number"}
                  {item.ownerName ? <span> · from {item.ownerName}</span> : null}
                  {item.submittedAt ? (
                    <span>
                      {" · "}
                      {formatDistanceToNow(new Date(item.submittedAt), {
                        addSuffix: true,
                      })}
                    </span>
                  ) : null}
                </>
              }
              trailing={
                /* The figure and the action together: an approver decides
                   on the amount, so it belongs beside the button rather
                   than buried in the line underneath. */
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium tabular-nums">
                    {formatCurrencyAED(grandTotalOf(item.finalPrice))}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(event) => {
                      event.stopPropagation();
                      router.push(reviewLink(item.id));
                    }}
                  >
                    Review
                  </Button>
                </div>
              }
              onClick={() => router.push(reviewLink(item.id))}
            />
          </li>
        ))}
      </ol>
      {waiting > SHOWN ? (
        <div className="border-t px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onShowAll}>
            See the other {waiting - SHOWN}
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}
