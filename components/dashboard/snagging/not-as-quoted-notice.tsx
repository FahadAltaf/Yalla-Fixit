"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService, type SnaggingNotAsQuotedJob } from "@/modules/snagging";
import { ActionType, ResourceType } from "@/types/types";

import { SubmitButton } from "./shared";

/* Shown in full up to this many; the rest behind "Show all". */
const VISIBLE = 3;

/**
 * The jobs held up because the property is not as quoted (SNG-100), above
 * the jobs list, in the words and colours the job page's own strip uses.
 *
 * Each job's quotation is void until a revised one, priced as found, is
 * approved by the client; the inspection cannot be approved meanwhile.
 * Renders nothing when no job is in that state.
 */
export function NotAsQuotedNotice({
  onLoaded,
}: {
  /* The jobs it found, so the table can tag their rows. */
  onLoaded?: (jobIds: Set<string>) => void;
}) {
  const router = useRouter();
  const { userProfile } = useAuth();
  const canCreate = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.CREATE);
  const [jobs, setJobs] = useState<SnaggingNotAsQuotedJob[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [revising, setRevising] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    snaggingService
      .listNotAsQuotedJobs()
      .then((list) => {
        if (cancelled) return;
        setJobs(list ?? []);
        onLoaded?.(new Set((list ?? []).map((job) => job.jobId)));
      })
      // An alert that cannot load is left out; the job page still says it.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // onLoaded is a setter from the parent; reading once on mount is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (jobs.length === 0) return null;
  const shown = showAll ? jobs : jobs.slice(0, VISIBLE);

  async function raiseRevised(job: SnaggingNotAsQuotedJob) {
    setRevising(job.jobId);
    try {
      const revised = await snaggingService.quotationAction(job.jobId, "revise");
      toast.success(`Revised quotation ${revised.quote_number} raised`, {
        description: "Check it, then send it to the client. The inspection can be approved once they approve it.",
      });
      router.push(`/snagging/quotations/${revised.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not raise the revised quotation");
      setRevising(null);
    }
  }

  return (
    <div className="border-danger/30 bg-danger/5 overflow-hidden rounded-xl border">
      <div className="divide-danger/20 divide-y">
        {shown.map((job) => (
          <div
            key={job.jobId}
            className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <p className="text-danger flex items-start gap-1.5 text-sm font-medium">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Property not as quoted · quotation {job.quotation.quote_number} is void
                  {job.place || job.clientName ? (
                    <span className="text-foreground font-normal">
                      {" "}
                      · {[job.clientName, job.place].filter(Boolean).join(", ")}
                    </span>
                  ) : null}
                </span>
              </p>
              {job.quotation.void_reason ? (
                <p className="text-muted-foreground mt-1 text-sm">{job.quotation.void_reason}</p>
              ) : null}
              <p className="text-muted-foreground mt-1 text-sm">
                {job.revised
                  ? `Revised quotation ${job.revised.quote_number} is ${job.revised.status}. This inspection can be approved once the client approves it.`
                  : "Raise a revised quotation, priced as found, and send it to the client. This inspection can be approved once they approve it."}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/snagging/${job.jobId}`}>
                  Open job
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              {job.revised ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/snagging/quotations/${job.revised.id}`}>
                    <FileText className="size-4" />
                    Open revised quotation
                  </Link>
                </Button>
              ) : canCreate ? (
                <SubmitButton
                  size="sm"
                  onClick={() => void raiseRevised(job)}
                  pending={revising === job.jobId}
                  pendingLabel="Raising…"
                  disabled={revising !== null}
                  icon={<FileText className="size-4" />}
                >
                  Raise revised quotation
                </SubmitButton>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {jobs.length > VISIBLE ? (
        <div className="border-danger/20 border-t px-5 py-2">
          <Button variant="link" size="sm" className="text-danger h-auto p-0" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${jobs.length} jobs not as quoted`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
