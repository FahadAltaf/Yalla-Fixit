"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ClipboardCheck } from "lucide-react";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingTask, SnaggingTaskSummary } from "@/types/types";

import { ReviewPanel } from "./review-panel";
import { ErrorState, PageHeading, timeAgo } from "./shared";

/**
 * The review queue as a workspace: the waiting list on the left, the
 * selected inspection on the right.
 *
 * A reviewer works a stack, not a single record, so keeping the queue
 * in view lets them clear it without bouncing back to a list between
 * each one. The queue reorders itself as decisions land, and the next
 * item is selected automatically when the current one leaves.
 */
export default function ReviewWorkspace() {
  const [queue, setQueue] = useState<SnaggingTaskSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [task, setTask] = useState<SnaggingTask | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingTask, setLoadingTask] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setQueueError(null);
    try {
      const response = await snaggingService.listTasks(
        { queue: "approval", status: "submitted,in_review" },
        0,
        50,
      );
      const rows = response.data ?? [];
      setQueue(rows);
      setSelectedId((current) => {
        if (current && rows.some((row) => row.id === current)) return current;
        return rows[0]?.id ?? null;
      });
    } catch (error) {
      // Held on screen rather than toasted away: an empty-looking queue
      // must never be mistaken for "nothing is waiting for review".
      setQueueError(error instanceof Error ? error.message : "Could not load the queue");
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  const loadTask = useCallback(async (id: string) => {
    setLoadingTask(true);
    setTaskError(null);
    try {
      setTask(await snaggingService.getTask(id));
    } catch (error) {
      setTask(null);
      setTaskError(error instanceof Error ? error.message : "Could not load the inspection");
    } finally {
      setLoadingTask(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (selectedId) void loadTask(selectedId);
    else setTask(null);
  }, [selectedId, loadTask]);

  // After a decision, the task leaves the queue; refresh both so the
  // next item slides into view.
  const onChanged = useCallback(async () => {
    await loadQueue();
    if (selectedId) await loadTask(selectedId);
  }, [loadQueue, loadTask, selectedId]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Approvals"
        title="Review inspection"
        description="Walk the snags, then approve or send it back with a reason."
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="gap-0 self-start p-0">
          <p className="eyebrow px-4 pt-4 pb-2">Queue · {queue.length}</p>
          {loadingQueue ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : queueError ? (
            <div className="p-4">
              <ErrorState
                title="Could not load the queue"
                message={queueError}
                onRetry={() => void loadQueue()}
              />
            </div>
          ) : queue.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="size-6" />}
              title="Nothing waiting"
              description="Submitted inspections appear here, oldest first."
              className="px-4 py-10"
            />
          ) : (
            <ul className="border-t">
              {queue.map((row) => {
                const active = row.id === selectedId;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className={cn(
                        "w-full border-b border-l-2 px-4 py-3 text-left transition-colors last:border-b-0",
                        active
                          ? "border-l-brand bg-brand-50"
                          : "hover:bg-mist-soft border-l-transparent",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground font-mono text-xs">{row.code}</span>
                        {row.escalated ? (
                          <span className="bg-danger/10 text-danger inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                            <AlertTriangle className="size-3" />
                            Overdue
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block font-medium">{row.unit_label}</span>
                      <span className="text-muted-foreground block text-xs">
                        {[row.building_name, row.client_name].filter(Boolean).join(" · ")}
                      </span>
                      <span className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                        {row.high_severity_count > 0 ? (
                          <span className="text-danger font-medium">
                            {row.high_severity_count} high
                          </span>
                        ) : null}
                        <span className={cn(row.escalated && "text-danger font-medium")}>
                          {timeAgo(row.submitted_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div>
          {loadingTask && !task ? (
            <div className="space-y-4">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-96 w-full" />
            </div>
          ) : taskError ? (
            <ErrorState
              title="Could not load this inspection"
              message={taskError}
              onRetry={() => selectedId && void loadTask(selectedId)}
              retrying={loadingTask}
            />
          ) : task ? (
            <ReviewPanel task={task} onChanged={() => void onChanged()} />
          ) : (
            <Card className="p-0">
              <EmptyState
                icon={<ClipboardCheck className="size-6" />}
                title="Nothing to review"
                description="Pick an inspection from the queue, or wait for the next one to arrive."
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
