"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingTask, SnaggingTaskSummary } from "@/types/types";

import { ReviewPanel } from "./review-panel";
import { PageHeading, timeAgo } from "./shared";

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

  const loadQueue = useCallback(async () => {
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
      toast.error(error instanceof Error ? error.message : "Could not load the queue");
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  const loadTask = useCallback(async (id: string) => {
    setLoadingTask(true);
    try {
      setTask(await snaggingService.getTask(id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the inspection");
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
          ) : queue.length === 0 ? (
            <div className="text-muted-foreground px-4 py-10 text-center text-sm">
              <ClipboardCheck className="mx-auto mb-2 size-6" />
              Nothing waiting.
            </div>
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
                      <span className="text-muted-foreground font-mono text-xs">{row.code}</span>
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
                        <span>{timeAgo(row.submitted_at)}</span>
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
          ) : task ? (
            <ReviewPanel task={task} onChanged={() => void onChanged()} />
          ) : (
            <Card className="p-10 text-center">
              <p className="text-muted-foreground">
                Nothing to review. Select an inspection when one arrives.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
