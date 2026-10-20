"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, DatabaseZap, Loader2, RefreshCw } from "lucide-react";

import { SectionCard, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import type { FsmResourceStatus } from "@/lib/server/finance/fsm-sync/status";
import { cn } from "@/lib/utils";
import { reportingService } from "@/modules/reporting/reporting-service";

/**
 * How fresh the portal's copy of FSM is (P2). Reports read the copy, never
 * FSM directly, so each one says how old its data is and whether the last
 * sync failed. A failed sync never blanks a report; it shows the last good
 * data with this warning beside it.
 */

const LABELS: Record<string, string> = {
  estimates: "Quotations",
  work_orders: "Work orders",
  appointments: "Appointments",
};

/** Older than this, the copy is called stale. The sync runs every 15 minutes at go-live. */
const STALE_MS = 60 * 60 * 1000;

function describe(status: FsmResourceStatus): { tone: "ok" | "warn" | "bad"; text: string } {
  if (!status.backfillDone && !status.lastSuccessAt) return { tone: "warn", text: "Not loaded yet" };
  if (!status.backfillDone) return { tone: "warn", text: `Loading history (last step ${timeAgo(status.lastSuccessAt)})` };
  if (status.consecutiveFailures > 0) {
    return {
      tone: "bad",
      text: `Last sync failed${status.lastError ? `: ${status.lastError}` : ""}. Showing data from ${timeAgo(status.lastSuccessAt)}.`,
    };
  }
  const age = status.lastSuccessAt ? Date.now() - Date.parse(status.lastSuccessAt) : Infinity;
  return { tone: age > STALE_MS ? "warn" : "ok", text: `Updated ${timeAgo(status.lastSuccessAt)}` };
}

export function FsmFreshness() {
  const [resources, setResources] = useState<FsmResourceStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResources((await reportingService.fsmStatus()).resources);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load FSM sync status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SectionCard
      icon={<DatabaseZap />}
      title="Data from Zoho FSM"
      description="Reports and the invoicing queue read the portal's copy of FSM, kept up to date by a read-only sync. Nothing here is ever written to FSM."
      bodyClassName="border-t"
      action={
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      }
    >
      {error ? (
        <p className="text-destructive px-5 py-4 text-sm">{error}</p>
      ) : resources === null ? (
        <ListSkeleton rows={3} />
      ) : (
        <ul className="divide-y">
          {resources.map((status) => {
            const { tone, text } = describe(status);
            const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? AlertTriangle : Clock;
            return (
              <li key={status.resource} className="flex items-start gap-3 px-5 py-3.5">
                <Icon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    tone === "ok" && "text-success",
                    tone === "warn" && "text-warning",
                    tone === "bad" && "text-destructive",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {LABELS[status.resource] ?? status.resource}
                    {status.running ? <span className="text-muted-foreground ml-2 text-xs font-normal">syncing now</span> : null}
                  </p>
                  <p className="text-muted-foreground text-sm break-words">{text}</p>
                  {status.lastRun ? (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      Last run: {status.lastRun.kind}, {status.lastRun.status.replace("_", " ")},{" "}
                      {status.lastRun.recordsWritten} records, {status.lastRun.calls} FSM calls,{" "}
                      {timeAgo(status.lastRun.startedAt)}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
