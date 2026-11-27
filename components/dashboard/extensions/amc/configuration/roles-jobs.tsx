"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, CircleAlert, Clock, Play, ShieldCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { DataRow, SectionCard, timeAgo } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { getActionDisplayName, getResourceDisplayName } from "@/components/dashboard/permissions/constants";
import {
  amcPlatformService,
  type AmcJobRun,
  type AmcRoleTemplateStatus,
} from "@/modules/amc-platform/amc-platform-service";
import type { AmcRunRecipient } from "@/lib/server/amc/jobs";

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
      description="The AMC team's roles as permission sets. Technicians work in the YFI mobile app and need no AMC role; admins already have everything. Every role stays editable in Roles and Permissions."
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
                  .map((g) => `${getResourceDisplayName(g.resource).replace(/ \(.*\)$/, "")}: ${g.actions.map((action) => getActionDisplayName(action, g.resource)).join(", ")}`)
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

/** The last runs of the daily jobs, and Run now (DEV-485: shown on the Daily jobs tab). */
export function JobsCard({ canRun }: { canRun: boolean }) {
  const [data, setData] = useState<{ jobs: Array<{ key: string; label: string }>; runs: AmcJobRun[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /* The run whose details are open (26 Nov 2026): what each job did, in words. */
  const [openRun, setOpenRun] = useState<AmcJobRun | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await amcPlatformService.jobs());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the scheduled jobs");
    }
  }, []);
  useEffect(() => void load(), [load]);

  /* Asked first (11 Nov 2026): it acts at once, so it is confirmed like every other step. */
  const run = () =>
    void confirm({ title: "Run every AMC job now?", description: "Runs every daily job at once, not only the ones switched on for the morning: overdue to-dos escalate and due reminders go to the team. Client emails stay held while they are off. Running a job twice does no harm.", confirmText: "Run now" }).then((ok) => {
      if (ok) void runNow();
    });
  const runNow = async () => {
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
      title="Last runs"
      description="Each run, from the morning schedule or Run now, with what every job did. If no scheduled run shows after 06:00, the scheduler is not calling."
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
          {data.runs.length === 0 ? (
            <EmptyState icon={<Clock />} title="No runs yet" description="Each run, scheduled or started with Run now, is listed here with what it did." />
          ) : (
            <ul className="divide-y">
              {data.runs.map((r) => (
                <li
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  title="See what each job did"
                  className="hover:bg-muted/40 focus-visible:bg-muted/40 cursor-pointer outline-none"
                  onClick={() => setOpenRun(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenRun(r);
                    }
                  }}
                >
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
                    trailing={
                      <span className="text-muted-foreground flex items-center gap-1 text-xs tabular-nums">
                        {timeAgo(r.started_at)}
                        <ChevronRight className="size-4" />
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {confirmDialog}
      <RunDetailsDialog run={openRun} jobs={data?.jobs ?? []} onClose={() => setOpenRun(null)} />
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* One run in full (26 Nov 2026)                                        */
/* ------------------------------------------------------------------ */

/* Each job's short name; its full description comes from the server's list. */
const JOB_NAMES: Record<string, string> = {
  todo_escalations: "To-do escalations",
  enquiry_follow_ups: "Enquiry follow-ups",
  enquiry_idle: "Idle enquiries",
  proposal_validity: "Proposals about to lapse",
  unsigned_contracts: "Unsigned contracts",
  contract_expiry_status: "Contract expiry status",
  payments: "Payments and cheques",
  ppm_overdue: "PPM visits overdue",
  visits: "PPM visits",
  job_sheets: "Job sheets and service reports",
  call_outs: "Call out SLA",
  renewals: "Renewals and expiry notices",
  expiry_reminders: "Contract expiry reminders",
};

/* Each figure in words. A figure the server adds later still shows, its name spelt out. */
const FIGURE_NAMES: Record<string, string> = {
  confirmationsDue: "PPM confirmation to-dos due",
  confirmationReminders: "Confirmation reminders repeated",
  accessAlerts: "Access alerts",
  crewReminders: "Crew reminders sent",
  clientReminders: "Client reminders sent",
  clientRemindersHeld: "Client reminders held (client emails are off)",
  crewRemindersSkipped: "Crew reminders",
  expired: "Contracts marked expired",
  expiring: "Contracts expiring",
  contractsChecked: "Contracts checked",
  notices: "Expiry notices sent",
  reminders: "Reminders sent",
  remindersCreated: "Reminders created",
  internalReminders: "Reminders to the team",
  escalations: "Escalations",
  escalated: "Escalated",
  renewed: "Contracts renewed",
  lapsed: "Contracts lapsed",
  terminated: "Contracts terminated",
  followUps: "Follow-ups due",
  idle: "Idle enquiries flagged",
  due: "Due",
  overdue: "Overdue",
  chequeAlerts: "Cheque alerts",
  lateFirstPayments: "Late first payments",
  receivedAmount: "Received (AED)",
  notSubmitted: "Job sheets not submitted",
  reportsAtRisk: "Service reports at risk",
  atRisk: "SLA at risk",
  missed: "SLA missed",
  sent: "Sent",
  reminded: "Reminded",
  checked: "Checked",
  total: "Total",
};

const spell = (key: string) => {
  const words = key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const fullDateTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso));

function tookLabel(start: string, end: string | null): string | null {
  if (!end) return null;
  const s = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/**
 * What one run did, job by job (26 Nov 2026, the user): each job's name and
 * what it covers, whether it went through, and its figures in words, the
 * ones that did something first. A skipped job says why.
 */
function RunDetailsDialog({ run, jobs, onClose }: { run: AmcJobRun | null; jobs: Array<{ key: string; label: string }>; onClose: () => void }) {
  const entries = Object.entries(run?.summary ?? {});
  /* Who the run told, read from the notifications it created (26 Nov 2026). */
  const [told, setTold] = useState<{ runId: string; list: AmcRunRecipient[] | null; error: string | null } | null>(null);
  const runId = run?.id ?? null;
  useEffect(() => {
    if (!runId) return;
    let stale = false;
    amcPlatformService.runRecipients(runId).then(
      (r) => !stale && setTold({ runId, list: r.recipients, error: null }),
      (e) => !stale && setTold({ runId, list: null, error: e instanceof Error ? e.message : "Could not load who was told" }),
    );
    return () => {
      stale = true;
    };
  }, [runId]);
  const recipients = told && told.runId === runId ? told : null;
  const failed = entries.filter(([, v]) => !v.ok).length;
  const took = run ? tookLabel(run.started_at, run.finished_at) : null;
  return (
    <Dialog open={run !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {run ? (
          <>
            <DialogHeader className="border-b px-6 pt-5 pb-4">
              <div className="flex items-start gap-3">
                <span className="bg-brand-50 text-brand border-brand/20 flex size-10 shrink-0 items-center justify-center rounded-lg border">
                  <Clock className="size-5" />
                </span>
                <div className="min-w-0 space-y-1 text-left">
                  <DialogTitle className="flex flex-wrap items-center gap-2">
                    {run.trigger === "manual" ? "Run now" : "Scheduled run"}
                    <Badge variant="secondary" className={cn("border-0 font-medium", RUN_STATUS[run.status].tone)}>
                      {RUN_STATUS[run.status].label}
                    </Badge>
                  </DialogTitle>
                  <DialogDescription>
                    {fullDateTime(run.started_at)} (Dubai){took ? ` · took ${took}` : ""} · {entries.length} job{entries.length === 1 ? "" : "s"}
                    {failed ? `, ${failed} failed` : ""}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="grid max-h-[65vh] gap-3 overflow-y-auto px-6 py-5">
              <section className="overflow-hidden rounded-lg border">
                <header className="bg-muted/30 flex items-start gap-3 border-b px-4 py-3">
                  <span className="text-muted-foreground mt-0.5 shrink-0 [&_svg]:size-4">
                    <Users />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Who was told</p>
                    <p className="text-muted-foreground text-xs">The notices this run created, by person and how they went out.</p>
                  </div>
                </header>
                <div className="px-4 py-3 text-sm">
                  {!recipients ? (
                    <ListSkeleton rows={2} />
                  ) : recipients.error ? (
                    <p className="text-danger">{recipients.error}</p>
                  ) : !recipients.list?.length ? (
                    <p className="text-muted-foreground">Nobody: this run created no notices.</p>
                  ) : (
                    <ul className="divide-y">
                      {recipients.list.map((r) => (
                        <li key={`${r.name}|${r.channel}|${r.status}`} className="flex flex-wrap items-start gap-3 py-2.5">
                          <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                            {r.name
                              .split(/\s+/)
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((w) => w[0]!.toUpperCase())
                              .join("")}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">{r.name}</p>
                            {r.email ? <p className="text-muted-foreground truncate text-xs">{r.email}</p> : null}
                            {r.examples.length ? (
                              <p className="text-muted-foreground mt-0.5 text-xs">
                                {r.examples.join(" · ")}
                                {r.count > r.examples.length ? ` and ${r.count - r.examples.length} more` : ""}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-sm font-semibold tabular-nums">{r.count}</span>
                            <Badge variant="secondary" className={cn("border-0 font-medium", r.channel === "email" ? "bg-brand-50 text-brand" : "bg-mist text-ink-soft")}>
                              {r.channel === "email" ? "Email" : "In the portal"}
                              {r.status && !["delivered", "sent"].includes(r.status) ? ` · ${r.status.replace(/_/g, " ")}` : ""}
                            </Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {entries.length === 0 ? (
                <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">This run has no job results.</p>
              ) : (
                entries.map(([key, v]) => {
                  const result = (v.result ?? {}) as Record<string, unknown>;
                  const numbers = Object.entries(result).filter(([, x]) => typeof x === "number") as Array<[string, number]>;
                  const notes = Object.entries(result).filter(([k, x]) => typeof x === "string" && k !== "skipped" && k !== "reason") as Array<[string, string]>;
                  const skipped = typeof result.skipped === "string" ? result.skipped : result.ran === false && typeof result.reason === "string" ? result.reason : null;
                  const busy = numbers.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
                  const quiet = numbers.filter(([, n]) => n === 0);
                  const description = jobs.find((j) => j.key === key)?.label;
                  return (
                    <section key={key} className="overflow-hidden rounded-lg border">
                      <header className="bg-muted/30 flex items-start gap-3 border-b px-4 py-3">
                        <span className={cn("mt-0.5 shrink-0 [&_svg]:size-4", v.ok ? "text-success" : "text-danger")}>{v.ok ? <CheckCircle2 /> : <CircleAlert />}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{JOB_NAMES[key] ?? spell(key)}</p>
                          {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
                        </div>
                        {!v.ok ? (
                          <Badge variant="secondary" className="bg-danger/10 text-danger shrink-0 border-0 font-medium">
                            Failed
                          </Badge>
                        ) : busy.length ? (
                          <Badge variant="secondary" className="bg-success/10 text-success shrink-0 border-0 font-medium">
                            {(() => {
                              const n = busy.reduce((sum, [, x]) => sum + x, 0);
                              return `${n} item${n === 1 ? "" : "s"}`;
                            })()}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-mist text-ink-soft shrink-0 border-0 font-medium">
                            Nothing due
                          </Badge>
                        )}
                      </header>
                      <div className="grid gap-2 px-4 py-3 text-sm">
                        {!v.ok ? <p className="text-danger">{v.error ?? "The job failed."}</p> : null}
                        {skipped ? <p className="text-muted-foreground">Skipped: {skipped}</p> : null}
                        {busy.length ? (
                          <dl className="grid gap-1.5 sm:grid-cols-2">
                            {busy.map(([k, n]) => (
                              <div key={k} className="flex items-baseline justify-between gap-3 rounded-md border px-3 py-1.5">
                                <dt>{FIGURE_NAMES[k] ?? spell(k)}</dt>
                                <dd className="font-semibold tabular-nums">{n}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                        {quiet.length ? (
                          <p className="text-muted-foreground text-xs">
                            None: {quiet.map(([k]) => (FIGURE_NAMES[k] ?? spell(k)).toLowerCase()).join(", ")}.
                          </p>
                        ) : null}
                        {notes.map(([k, text]) => (
                          <p key={k} className="text-muted-foreground text-xs">
                            {FIGURE_NAMES[k] ?? spell(k)}: {text}.
                          </p>
                        ))}
                      </div>
                    </section>
                  );
                })
              )}
            </div>

            <DialogFooter className="m-0 rounded-none border-t px-6 py-4">
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function summarise(result: Record<string, unknown> | undefined): string {
  if (!result) return "ok";
  if (result.ran === false && typeof result.reason === "string") return result.reason;
  if (typeof result.held === "string") return result.held;
  return Object.entries(result)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `${k} ${v}`)
    .join(", ") || "ok";
}
