"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingTask } from "@/types/types";

import { AuditTimeline } from "./audit-timeline";
import { ChecklistPanel } from "./checklist-panel";
import { QuotationPanel } from "./quotation-panel";
import { ReviewPanel } from "./review-panel";

/**
 * A single inspection, opened from the jobs table or a dashboard link.
 *
 * It reuses the review panel so the record reads the same whether a
 * manager reached it from the queue or an ops lead reached it from the
 * list. The only difference here is the back link to the jobs table.
 */
export default function InspectionDetail({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<SnaggingTask | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTask(await snaggingService.getTask(taskId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the inspection");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!task) {
    return (
      <Card className="p-10 text-center">
        <p className="text-muted-foreground">This inspection could not be found.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/snagging/jobs">Back to jobs</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/snagging/jobs">
          <ArrowLeft className="size-4" />
          Jobs
        </Link>
      </Button>

      <QuotationPanel task={task} onChanged={() => void load()} />

      <ReviewPanel task={task} onChanged={() => void load()} />

      <ChecklistPanel task={task} />

      <AuditTimeline taskId={task.id} />
    </div>
  );
}
