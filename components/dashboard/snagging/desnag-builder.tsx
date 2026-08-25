"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, PlayCircle, SearchX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingSnag, SnaggingTask } from "@/types/types";

import { EmptyState } from "@/components/ui/empty-state";

import {
  DataState,
  HeadingSkeleton,
  ListSkeleton,
  PageHeading,
  SectionSkeleton,
  SeverityBadge,
  SnagIndex,
  SNAG_STATUS_LABELS,
  SubmitButton,
  useConfirm,
} from "./shared";

/**
 * The de-snag round builder.
 *
 * A round re-inspects what the developer claims to have fixed, so this
 * screen is a selection: which outstanding snags carry forward as
 * verification items. Low-severity snags are unticked by default,
 * because a client rarely pays for a re-walk of cosmetic items, but
 * they stay in the list so the reviewer can add them back when the
 * client asked for a full re-walk.
 */

const CARRY_FORWARD = new Set([
  "open",
  "pending_verification",
  "verified_poor_quality",
  "verified_not_done",
]);

export default function DesnagBuilder({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [task, setTask] = useState<SnaggingTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await snaggingService.getTask(taskId);
      setTask(loaded);
      // Default selection: everything outstanding except low severity.
      const preselect = new Set(
        (loaded.snags ?? [])
          .filter((snag) => CARRY_FORWARD.has(snag.status) && snag.severity !== "low")
          .map((snag) => snag.id),
      );
      setSelected(preselect);
    } catch (err) {
      // A failed load left this screen showing "could not be found",
      // which reads as "the job was deleted" rather than "try again".
      setError(err instanceof Error ? err.message : "Could not load the inspection");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const candidates = useMemo(
    () => (task?.snags ?? []).filter((snag) => CARRY_FORWARD.has(snag.status)),
    [task],
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function open() {
    if (!task) {
      toast.error("The inspection is still loading — try again in a moment");
      return;
    }

    // Opening a round creates a new job and navigates away from this
    // selection, so the count is stated back before it is committed.
    const ok = await confirm({
      title: `Open round ${task.round_number + 1}?`,
      description: `${selected.size} snag(s) carry forward from ${task.code} as verification items in a new round. The new round opens straight away and you leave this screen.`,
      confirmText: `Open round ${task.round_number + 1}`,
    });
    if (!ok) return;

    setSubmitting(true);
    try {
      const round = await snaggingService.openRound(task.id, {
        snag_ids: [...selected],
      });
      toast.success(`Round ${round.round_number} opened with ${round.carried_snags} snag(s)`);
      router.push(`/snagging/${round.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the round");
      setSubmitting(false);
    }
  }

  const nextRound = (task?.round_number ?? 0) + 1;

  return (
    <div className="flex flex-col gap-6">
      {loading ? (
        <HeadingSkeleton />
      ) : (
        <PageHeading
          eyebrow="Re-inspection"
          title="De-snag round"
          description="Carry open snags forward for verification on site."
        />
      )}

      <DataState
        loading={loading}
        error={error}
        onRetry={() => void load()}
        retrying={loading}
        errorTitle="Could not load the inspection"
        isEmpty={!task}
        skeleton={
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <SectionSkeleton>
              <ListSkeleton rows={6} />
            </SectionSkeleton>
            <SectionSkeleton className="self-start">
              <ListSkeleton rows={3} />
            </SectionSkeleton>
          </div>
        }
        empty={
          <Card className="p-0">
            <EmptyState
              icon={<SearchX className="size-6" />}
              title="This inspection could not be found"
              description="It may have been cancelled, or the link may point at a job that no longer exists."
            />
          </Card>
        }
      >
        {task ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Card className="gap-0 p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <h2 className="text-lg">
                    Carry forward from {task.code} · round {task.round_number}
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Selected snags become verification items in round {nextRound}. The inspector
                    records one verdict each.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected(new Set())}
                    disabled={selected.size === 0}
                  >
                    Clear all
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected(new Set(candidates.map((snag) => snag.id)))}
                  >
                    Select all
                  </Button>
                </div>
              </div>

              {candidates.length === 0 ? (
                <div className="border-t">
                  <EmptyState
                    icon={<CheckCircle2 className="size-6" />}
                    title="Nothing outstanding on this property"
                    description="Every snag from the last round is closed or withdrawn, so there is nothing left to re-inspect."
                  />
                </div>
              ) : (
                <ul className="border-t">
                  {candidates.map((snag, index) => (
                    <SnagRow
                      key={snag.id}
                      snag={snag}
                      index={index + 1}
                      checked={selected.has(snag.id)}
                      onToggle={() => toggle(snag.id)}
                    />
                  ))}
                </ul>
              )}
            </Card>

            <Card className="gap-0 self-start p-5">
              <p className="eyebrow">Round {nextRound}</p>
              <h2 className="mt-2 text-xl">New de-snag round</h2>

              <dl className="mt-4 space-y-3 text-sm">
                <Row label="Parent job" value={task.code} />
                <Row label="Round number" value={String(nextRound)} />
                <Row label="Carried" value={`${selected.size} of ${candidates.length} snags`} />
              </dl>

              <div className="mt-5 border-t pt-4">
                <p className="eyebrow mb-3">Verdicts the inspector can record</p>
                <ul className="space-y-2 text-sm">
                  {(
                    [
                      ["verified_closed", "bg-success"],
                      ["verified_poor_quality", "bg-warning"],
                      ["verified_not_done", "bg-danger"],
                    ] as const
                  ).map(([verdict, dot]) => (
                    <li key={verdict} className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${dot}`} aria-hidden />
                      <span className="font-medium">{SNAG_STATUS_LABELS[verdict]}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <SubmitButton
                className="mt-5 w-full"
                onClick={() => void open()}
                disabled={selected.size === 0}
                pending={submitting}
                pendingLabel={`Opening round ${nextRound}…`}
                icon={<PlayCircle className="size-4" />}
              >
                {`Open round ${nextRound}`}
              </SubmitButton>
              <p className="text-muted-foreground mt-3 text-xs">
                Low severity snags are unticked by default. Add them back if the client asked for a
                full re-walk.
              </p>
            </Card>
          </div>
        ) : null}
      </DataState>

      {dialog}
    </div>
  );
}

function SnagRow({
  snag,
  index,
  checked,
  onToggle,
}: {
  snag: SnaggingSnag;
  index: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 border-b px-5 py-3 last:border-b-0",
        checked && "bg-brand-50/60",
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        aria-label={`Carry ${snag.snag_code}`}
      />
      <SnagIndex index={index} severity={snag.severity} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {[snag.area?.name ?? snag.area_label, snag.element_label, snag.defect_label]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="text-muted-foreground font-mono text-xs">{snag.snag_code}</p>
      </div>
      <SeverityBadge severity={snag.severity} />
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
