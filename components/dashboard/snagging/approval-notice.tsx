"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, ClipboardCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataRow, SectionCard } from "@/components/dashboard/shared/kaizen";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingPendingApproval } from "@/types/types";

/**
 * What is waiting on you, at the top of Snagging.
 *
 * The same notice AMC Proposals carries, for the other half of the same
 * job: there, an approver sees proposals; here, a reviewer sees what to
 * check and an approval manager sees what to sign off. Both kinds can be
 * in one list at once -- on a job with no reviewer the manager does both
 * steps -- so each row says which of the two it is asking for rather
 * than leaving that to be worked out from a status badge.
 *
 * Nobody else sees anything. The endpoint answers with what the caller is
 * named on, so a colleague holding every permission in the product and
 * named on no job gets an empty list and nothing renders.
 */

/* Fired after a decision, so an open notice catches up at once. */
export const SNAGGING_APPROVALS_CHANGED = "snagging-approvals-changed";

const POLL_MS = 60_000;
/* Rows shown before folding; the rest are one click away on the queue. */
const SHOWN = 5;

function jobLink(id: string) {
  return `/snagging/${encodeURIComponent(id)}?tab=snags`;
}

/** What the row is asking of the reader, in that step's own word. */
function stepLabel(step: SnaggingPendingApproval["step"]) {
  return step === "review" ? "Review" : "Approve";
}

export function SnaggingApprovalNotice() {
  const router = useRouter();
  const [items, setItems] = useState<SnaggingPendingApproval[]>([]);
  /* Hidden until something new arrives, not for good. */
  const [dismissedIds, setDismissedIds] = useState<Set<string> | null>(null);
  const known = useRef<Set<string> | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await snaggingService.listPendingApprovals();
      const next = response.items ?? [];
      setItems(next);

      /* A toast only for work that arrives while the page is open; what
         was already waiting is in the notice itself. */
      const previous = known.current;
      known.current = new Set(next.map((item) => item.id));
      if (!previous) return;
      const fresh = next.filter((item) => !previous.has(item.id));
      if (fresh.length === 0) return;
      const first = fresh[0];
      toast.info(
        fresh.length === 1
          ? first.step === "review"
            ? "An inspection is ready for your review"
            : "An inspection is ready for your approval"
          : `${fresh.length} inspections are waiting on you`,
        {
          description:
            fresh.length === 1
              ? [first.unitLabel, first.buildingName].filter(Boolean).join(" · ")
              : undefined,
          action: {
            label: stepLabel(first.step),
            onClick: () => router.push(jobLink(first.id)),
          },
          duration: 10_000,
        },
      );
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
    window.addEventListener(SNAGGING_APPROVALS_CHANGED, onRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(SNAGGING_APPROVALS_CHANGED, onRefresh);
    };
  }, [refresh]);

  const hidden =
    dismissedIds !== null && items.every((item) => dismissedIds.has(item.id));
  if (items.length === 0 || hidden) return null;

  const waiting = items.length;
  const toReview = items.filter((item) => item.step === "review").length;
  const toApprove = waiting - toReview;

  /*
    What the card says it is for, in whichever role the reader is in.

    A reviewer and an approval manager both land here, and "waiting for
    your approval" is wrong for half of them: a reviewer is not being
    asked to approve anything, they are being asked to check it. Where
    somebody holds both kinds at once the two are counted separately,
    because they are two different pieces of work.
  */
  const summary =
    toReview > 0 && toApprove > 0
      ? `${toReview} to review, ${toApprove} to approve. Oldest first.`
      : toReview > 0
        ? toReview === 1
          ? "One inspection is with you to review."
          : `${toReview} inspections are with you to review, oldest first.`
        : toApprove === 1
          ? "One inspection is with you to approve."
          : `${toApprove} inspections are with you to approve, oldest first.`;

  return (
    <SectionCard
      icon={<ClipboardCheck />}
      title="Waiting on you"
      description={summary}
      className="border-brand/30"
      bodyClassName="border-t"
      action={
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="bg-brand/10 text-brand tabular-nums"
          >
            {waiting}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Hide for now"
            onClick={() => setDismissedIds(new Set(items.map((i) => i.id)))}
          >
            <X className="size-4" />
          </Button>
        </div>
      }
    >
      <ol className="divide-y">
        {items.slice(0, SHOWN).map((item) => {
          /*
            The clock the row is measured against: a job still to be
            reviewed has been waiting since it was submitted, one past
            the review since the reviewer let go of it.
          */
          const since =
            item.step === "review" ? item.submittedAt : item.reviewedAt;
          return (
            <li key={item.id}>
              <DataRow
                icon={
                  item.step === "review" ? (
                    <ClipboardCheck aria-hidden />
                  ) : (
                    <CheckCircle2 aria-hidden />
                  )
                }
                title={item.unitLabel || item.code || "Inspection"}
                subtitle={
                  <>
                    {[item.buildingName, item.clientName]
                      .filter(Boolean)
                      .join(" · ") || item.code}
                    {since ? (
                      <span>
                        {item.step === "review"
                          ? " · submitted "
                          : " · reviewed "}
                        {formatDistanceToNow(new Date(since), {
                          addSuffix: true,
                        })}
                      </span>
                    ) : null}
                  </>
                }
                trailing={
                  <div className="flex items-center gap-3">
                    {item.overdue ? (
                      <span className="bg-danger/10 text-danger inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold">
                        <AlertTriangle className="size-3.5" />
                        Overdue
                      </span>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        router.push(jobLink(item.id));
                      }}
                    >
                      {stepLabel(item.step)}
                    </Button>
                  </div>
                }
                onClick={() => router.push(jobLink(item.id))}
              />
            </li>
          );
        })}
      </ol>
      {waiting > SHOWN ? (
        <div className="border-t px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/snagging/review")}
          >
            See the other {waiting - SHOWN}
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}
