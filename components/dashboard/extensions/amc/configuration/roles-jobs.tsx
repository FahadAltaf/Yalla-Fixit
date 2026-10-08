"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Play, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { DataRow, SectionCard, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { getActionDisplayName, getResourceDisplayName } from "@/components/dashboard/permissions/constants";
import {
  amcPlatformService,
  type AmcJobRun,
  type AmcRoleTemplateStatus,
} from "@/modules/amc-platform/amc-platform-service";

/** BRD 6.7 role templates (one-click setup, admins only) and the AMC scheduled jobs. */
export function RolesAndJobs({ isAdmin, canRunJobs }: { isAdmin: boolean; canRunJobs: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <RoleTemplatesCard isAdmin={isAdmin} />
      <JobsCard canRun={canRunJobs} />
    </div>
  );
}

function RoleTemplatesCard({ isAdmin }: { isAdmin: boolean }) {
  const [templates, setTemplates] = useState<AmcRoleTemplateStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  /* Bumped to load again; the answer is set when it arrives, never synchronously inside the effect. */
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let gone = false;
    amcPlatformService.roleTemplates().then(
      (result) => {
        if (gone) return;
        setTemplates(result.templates);
        setError(null);
      },
      (e: unknown) => {
        if (!gone) setError(e instanceof Error ? e.message : "Could not load the AMC roles");
      },
    );
    return () => {
      gone = true;
    };
  }, [attempt]);
  const load = () => setAttempt((n) => n + 1);

  const toDo = (templates ?? []).filter((t) => !t.exists || t.missing > 0);

  /* The confirm runs the work itself, so it stays open and pending until the roles exist (or says why not). */
  const apply = async () => {
    const ok = await confirm({
      title: "Set up the AMC roles?",
      description: `Creates ${toDo.filter((t) => !t.exists).length} role(s) and adds missing permissions to ${toDo.filter((t) => t.exists).length}. Nothing anyone granted by hand is removed. People are not moved into these roles: assign them in Users.`,
      confirmText: "Set up roles",
      action: async () => {
        const result = await amcPlatformService.applyRoleTemplates();
        setTemplates(result.templates);
      },
    });
    if (ok) toast.success("AMC roles are set up. Assign people to them in Users.");
  };

  return (
    <SectionCard
      icon={<ShieldCheck />}
      title="AMC roles"
      description="BRD 4 and 6.7: the AMC team's roles as permission sets. Technicians work in the FSM app and need no AMC role; admins already have everything. Every role stays editable in Roles and Permissions."
      bodyClassName="border-t"
      action={
        isAdmin && toDo.length > 0 ? (
          <SubmitButton size="sm" icon={<UserPlus className="size-4" />} onClick={() => void apply()}>
            Set up AMC roles
          </SubmitButton>
        ) : null
      }
    >
      {dialog}
      {error ? (
        <div className="p-5">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : !templates ? (
        <div className="p-5">
          <ListSkeleton rows={6} />
        </div>
      ) : (
        <ul className="divide-y">
          {templates.map((t) => (
            <li key={t.key} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.name}</span>
                {t.exists && t.missing === 0 ? (
                  <Badge variant="secondary" className="bg-success/10 text-success border-0 font-medium">
                    Set up
                  </Badge>
                ) : t.exists ? (
                  <Badge variant="secondary" className="bg-warning/10 text-warning border-0 font-medium">
                    {t.missing} permission(s) missing
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-mist text-ink-soft border-0 font-medium">
                    Not created
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-1 text-sm">{t.description}</p>
              <p className="text-muted-foreground mt-2 text-xs">
                {t.grants
                  .map((g) => `${getResourceDisplayName(g.resource).replace(/ \(.*\)$/, "")}: ${g.actions.map(getActionDisplayName).join(", ")}`)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {!isAdmin ? <p className="text-muted-foreground border-t px-5 py-3 text-xs">Only an admin can set up roles.</p> : null}
    </SectionCard>
  );
}

/* Theme tones, the same ones every status badge in the product uses. */
const RUN_STATUS: Record<AmcJobRun["status"], { label: string; tone: string }> = {
  running: { label: "Running", tone: "bg-brand-50 text-brand" },
  succeeded: { label: "Succeeded", tone: "bg-success/10 text-success" },
  partial: { label: "Partly failed", tone: "bg-warning/10 text-warning" },
  failed: { label: "Failed", tone: "bg-danger/10 text-danger" },
};

function JobsCard({ canRun }: { canRun: boolean }) {
  const [data, setData] = useState<{ jobs: Array<{ key: string; label: string }>; runs: AmcJobRun[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await amcPlatformService.jobs());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the scheduled jobs");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const run = async () => {
    setRunning(true);
    try {
      const result = await amcPlatformService.runJobs();
      if (result.status === "succeeded") toast.success("AMC jobs ran.");
      else toast.error("Some AMC jobs failed; see the last run below.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run the AMC jobs");
    } finally {
      setRunning(false);
    }
  };

  return (
    <SectionCard
      icon={<Clock />}
      title="Scheduled jobs"
      description="Escalations and reminders. The external scheduler that runs the Snagging escalations calls these with the CRON_SECRET; Run now does the same immediately. Each job is safe to run twice."
      bodyClassName="border-t"
      action={
        canRun ? (
          <SubmitButton size="sm" variant="outline" pending={running} pendingLabel="Running…" icon={<Play className="size-4" />} onClick={() => void run()}>
            Run now
          </SubmitButton>
        ) : null
      }
    >
      {error ? (
        <div className="p-5">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : !data ? (
        <div className="p-5">
          <ListSkeleton rows={3} />
        </div>
      ) : (
        <div className="divide-y">
          <ul className="px-5 py-3 text-sm">
            {data.jobs.map((j) => (
              <li key={j.key} className="py-1">
                {j.label}
              </li>
            ))}
          </ul>
          {data.runs.length === 0 ? (
            <EmptyState icon={<Clock />} title="No runs yet" description="Each run, scheduled or started with Run now, is listed here with what it did." />
          ) : (
            <ul className="divide-y">
              {data.runs.map((r) => (
                <li key={r.id}>
                  <DataRow
                    icon={<Clock />}
                    title={
                      <span className="flex items-center gap-2">
                        <Badge variant="secondary" className={cn("border-0 font-medium", RUN_STATUS[r.status].tone)}>
                          {RUN_STATUS[r.status].label}
                        </Badge>
                        <span className="text-muted-foreground text-sm font-normal">{r.trigger === "manual" ? "Run now" : "Scheduled"}</span>
                      </span>
                    }
                    subtitle={
                      <span className="text-xs">
                        {Object.entries(r.summary ?? {})
                          .map(([key, v]) => `${key}: ${v.ok ? summarise(v.result) : `failed (${v.error ?? "error"})`}`)
                          .join(" · ")}
                      </span>
                    }
                    trailing={<span className="text-muted-foreground text-xs tabular-nums">{timeAgo(r.started_at)}</span>}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function summarise(result: Record<string, unknown> | undefined): string {
  if (!result) return "ok";
  if (result.ran === false && typeof result.reason === "string") return result.reason;
  return Object.entries(result)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `${k} ${v}`)
    .join(", ") || "ok";
}
