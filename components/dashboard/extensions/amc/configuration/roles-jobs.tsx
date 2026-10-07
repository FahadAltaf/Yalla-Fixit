"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Play, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { SectionCard, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
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
  const [applying, setApplying] = useState(false);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    setError(null);
    try {
      setTemplates((await amcPlatformService.roleTemplates()).templates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the AMC roles");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const toDo = (templates ?? []).filter((t) => !t.exists || t.missing > 0);

  const apply = async () => {
    const ok = await confirm({
      title: "Set up the AMC roles?",
      description: `Creates ${toDo.filter((t) => !t.exists).length} role(s) and adds missing permissions to ${toDo.filter((t) => t.exists).length}. Nothing anyone granted by hand is removed. People are not moved into these roles: assign them in Users.`,
      confirmText: "Set up roles",
    });
    if (!ok) return;
    setApplying(true);
    try {
      const result = await amcPlatformService.applyRoleTemplates();
      setTemplates(result.templates);
      toast.success("AMC roles are set up. Assign people to them in Users.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set up the AMC roles");
    } finally {
      setApplying(false);
    }
  };

  return (
    <SectionCard
      icon={<ShieldCheck />}
      title="AMC roles"
      description="BRD 4 and 6.7: the AMC team's roles as permission sets. Technicians work in the FSM app and need no AMC role; admins already have everything. Every role stays editable in Roles and Permissions."
      bodyClassName="border-t"
      action={
        isAdmin && toDo.length > 0 ? (
          <SubmitButton size="sm" pending={applying} pendingLabel="Setting up…" icon={<UserPlus className="size-4" />} onClick={() => void apply()}>
            Set up AMC roles
          </SubmitButton>
        ) : null
      }
    >
      {dialog}
      {error ? (
        <div className="p-5">
          <ErrorState message={error} onRetry={() => void load()} />
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
                  <Badge variant="secondary">Set up</Badge>
                ) : t.exists ? (
                  <Badge variant="outline">{t.missing} permission(s) missing</Badge>
                ) : (
                  <Badge variant="outline">Not created</Badge>
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

const RUN_STATUS: Record<AmcJobRun["status"], { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  running: { label: "Running", variant: "outline" },
  succeeded: { label: "Succeeded", variant: "secondary" },
  partial: { label: "Partly failed", variant: "destructive" },
  failed: { label: "Failed", variant: "destructive" },
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
            <p className="text-muted-foreground px-5 py-4 text-sm">No runs yet.</p>
          ) : (
            <ul className="divide-y">
              {data.runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <Badge variant={RUN_STATUS[r.status].variant}>{RUN_STATUS[r.status].label}</Badge>
                  <span className="text-muted-foreground">{r.trigger === "manual" ? "Run now" : "Scheduled"}</span>
                  <span className="tabular-nums">{timeAgo(r.started_at)}</span>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                    {Object.entries(r.summary ?? {})
                      .map(([key, v]) => `${key}: ${v.ok ? summarise(v.result) : `failed (${v.error ?? "error"})`}`)
                      .join(" · ")}
                  </span>
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
