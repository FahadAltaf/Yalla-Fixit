"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingTask } from "@/types/types";

import {
  ErrorState,
  FieldsSkeleton,
  ListSkeleton,
  SectionSkeleton,
} from "./shared";

import { AuditTimeline } from "./audit-timeline";
import { ChecklistPanel } from "./checklist-panel";
import { FloorPlansAreasPanel } from "./floor-plans-areas-panel";
import { JobSetupPanel } from "./job-setup-panel";
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
  const router = useRouter();
  const [task, setTask] = useState<SnaggingTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTask(await snaggingService.getTask(taskId));
    } catch (err) {
      // A failed request and a genuinely missing inspection used to look
      // identical ("could not be found"), which sent people hunting for
      // a record that was there all along. They are separate states now.
      setTask(null);
      setError(err instanceof Error ? err.message : "Could not load the inspection");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-24" />
        <SectionSkeleton>
          <FieldsSkeleton fields={6} columns={3} />
        </SectionSkeleton>
        <SectionSkeleton>
          <ListSkeleton rows={6} />
        </SectionSkeleton>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <BackToJobs />
        <ErrorState
          title="Could not load this inspection"
          message={error}
          onRetry={() => void load()}
          retrying={loading}
        />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col gap-4">
        <BackToJobs />
        <Card className="p-0">
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="This inspection could not be found"
            description="It may have been cancelled, or the link may be out of date."
            action={{
              label: "Back to jobs",
              onClick: () => router.push("/snagging/jobs"),
              variant: "outline",
            }}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BackToJobs />

      <QuotationPanel task={task} onChanged={() => void load()} />

      <JobSetupPanel task={task} onChanged={() => void load()} />

      <ReviewPanel task={task} onChanged={() => void load()} />

      <ChecklistPanel task={task} />

      <FloorPlansAreasPanel taskId={task.id} />

      <AuditTimeline taskId={task.id} />
    </div>
  );
}

/** One back link, so every state on this screen keeps a way out. */
function BackToJobs() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
      <Link href="/snagging/jobs">
        <ArrowLeft className="size-4" />
        Jobs
      </Link>
    </Button>
  );
}
