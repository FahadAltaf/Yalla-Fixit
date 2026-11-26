import type { SupabaseClient } from "@supabase/supabase-js";

import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { canApproveAmc } from "@/components/dashboard/extensions/amc/amc-settings";
import { OPEN_CALL_OUT_STATUSES } from "@/lib/amc/call-outs";
import { todayInDubai } from "@/lib/amc/contracts";
import { clientsAccess } from "@/lib/clients/access";
import { nonEmpty, type HomeChart, type HomeItem, type HomeSummary } from "@/lib/home/summary";
import { CHART_COLOR, PIPELINE_COLOR } from "@/lib/snagging/chart-palette";
import { REPORTS_ENABLED } from "@/lib/reports/enabled";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { pendingForApprover } from "@/lib/server/amc/approval-ladder";
import { readAmcConfig } from "@/lib/server/amc/config";
import { jobSheetSupervisors } from "@/lib/server/amc/job-sheets";
import { listAmcJobRuns } from "@/lib/server/amc/jobs";
import { ppmMonth } from "@/lib/server/amc/ppm-month";
import { renewalsDue } from "@/lib/server/amc/renewals";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { siteVisitDeciders } from "@/lib/server/amc/site-visit-approvers";
import { overviewKpis } from "@/lib/server/compliance/employees";
import { readFsmSyncStatus } from "@/lib/server/finance/fsm-sync/status";
import { loadDisputes } from "@/lib/server/reports/compliance";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { zohoFsmMode } from "@/lib/server/zoho/fsm-client";
import { ActionType, ResourceType, type User } from "@/types/types";

/**
 * The home dashboard for one person (26 Nov 2026), read on the server with
 * the admin client. Each part runs only when the person holds the
 * permission its own page asks for, and on its own: one that fails is named
 * in `unavailable` and the rest still show.
 *
 * The figures mirror the lists they open (the same statuses and the same
 * "who decides" rules), so a count never promises what the page does not
 * show.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Me = { id: string; email: string | null };

const DAY = 86_400_000;
const OPEN_TODO = "(done,canceled)";

const daysAgo = (iso: string | null | undefined, now: Date) => (iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY)) : null);
const oldest = (label: string, iso: string | null | undefined, now: Date) => {
  const d = daysAgo(iso, now);
  return d === null ? null : d === 0 ? `${label} today` : `${label} ${d} day${d === 1 ? "" : "s"} ago`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function buildHomeSummary(admin: Admin, me: Me, user: User, now = new Date()): Promise<HomeSummary> {
  const can = (resource: ResourceType, action: ActionType = ActionType.VIEW) => hasResourceAction(user, resource, action);
  const isAdmin = isAdminUser(user);
  const today = todayInDubai(now);
  const month = today.slice(0, 7);
  const amc = canUseAmc(user);

  const approvals: HomeItem[] = [];
  const work: HomeItem[] = [];
  const overview: HomeItem[] = [];
  const health: HomeItem[] = [];
  const charts: HomeChart[] = [];
  const unavailable: string[] = [];
  let approverRights = false;

  /* Shared reads, once. */
  const amcConfig = amc ? readAmcConfig(admin).catch(() => null) : Promise.resolve(null);
  const amcApprover = amc
    ? readAmcSettings(admin)
        .then((s) => canApproveAmc(s, me.email, can(ResourceType.AMC, ActionType.APPROVE)))
        .catch(() => false)
    : Promise.resolve(false);

  const part = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      console.error(`[home] ${name} not read:`, error instanceof Error ? error.message : error);
      unavailable.push(name);
    }
  };

  await Promise.all([
    /* ------------------------------ approvals ------------------------------ */

    /* AMC proposals: the queue the approver's bell reads (app/api/amc-submissions/pending-approvals). */
    amc
      ? part("AMC proposals", async () => {
          const approver = await amcApprover;
          const ladder = await pendingForApprover(admin, me.id, approver).catch(() => null);
          const mine = new Set(ladder?.submissionIds ?? []);
          const onLadder = new Set(ladder?.allPending ?? []);
          if (approver || mine.size) approverRights = true;
          if (!approver && mine.size === 0) return;
          const { data, error } = await admin
            .from("amc_submissions")
            .select("id, submitted_at")
            .eq("status", "awaiting_approval")
            .neq("owner_id", me.id)
            .order("submitted_at", { ascending: true })
            .limit(200);
          if (error) throw new Error(error.message);
          const rows = ((data ?? []) as Row[]).filter((r) => mine.has(String(r.id)) || (approver && !onLadder.has(String(r.id))));
          approvals.push({
            key: "amc-proposals",
            module: "amc",
            title: "Proposals to approve",
            detail: oldest("Oldest sent", rows[0]?.submitted_at as string | undefined, now),
            count: rows.length,
            tone: "review",
            href: "/extensions/amc?status=awaiting_approval",
          });
        })
      : null,

    /* AMC amendments: decided by an AMC approver (lib/server/amc/amendments.ts). */
    amc
      ? part("AMC amendments", async () => {
          if (!(await amcApprover)) return;
          const { data, error } = await admin.from("amc_contract_amendments").select("contract_id, requested_at").eq("status", "requested").order("requested_at", { ascending: true }).limit(200);
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as Row[];
          const contracts = [...new Set(rows.map((r) => String(r.contract_id)))];
          approvals.push({
            key: "amc-amendments",
            module: "amc",
            title: "Contract amendments to decide",
            detail: rows.length ? `${plural(contracts.length, "contract")} · ${oldest("oldest asked", rows[0]?.requested_at as string, now)}` : null,
            count: rows.length,
            tone: "review",
            href: contracts.length === 1 ? `/extensions/amc-contracts/${contracts[0]}?tab=amendments` : "/extensions/amc-contracts",
          });
        })
      : null,

    /* AMC site visits: completed, waiting for their approver (the configured chain, or the one named on the visit). */
    amc
      ? part("AMC site visits", async () => {
          const [{ data, error }, deciders] = await Promise.all([
            admin.from("amc_assessments").select("id, approver_id, completed_at").eq("status", "completed").is("approved_at", null).not("approver_id", "is", null).limit(500),
            siteVisitDeciders(admin).catch(() => ({ ids: [] as string[] })),
          ]);
          if (error) throw new Error(error.message);
          const decider = deciders.ids.includes(me.id);
          if (decider) approverRights = true;
          const rows = ((data ?? []) as Row[]).filter((r) => decider || r.approver_id === me.id);
          approvals.push({ key: "amc-site-visits", module: "amc", title: "Site visit reports to approve", detail: null, count: rows.length, tone: "review", href: "/extensions/amc-contracts/assessments" });
        })
      : null,

    /* AMC job sheets: the supervisor's review (BRD 5.12). */
    amc
      ? part("AMC job reviews", async () => {
          const config = await amcConfig;
          const supervisor = can(ResourceType.AMC_VISITS, ActionType.APPROVE) || (config ? jobSheetSupervisors(config).includes(me.id) : false);
          if (!supervisor) return;
          approverRights = true;
          const { count, error } = await admin.from("amc_visit_job_sheets").select("id", { count: "exact", head: true }).eq("status", "submitted");
          if (error) throw new Error(error.message);
          approvals.push({ key: "amc-job-reviews", module: "amc", title: "Job sheets to review", detail: "Submitted from the YFI app", count: count ?? 0, tone: "review", href: "/extensions/amc-contracts/job-reviews" });
        })
      : null,

    /* Scheduling: a day sent to this person, or to everyone flagged to approve days. */
    can(ResourceType.SCHEDULING, ActionType.APPROVE) || can(ResourceType.SCHEDULING)
      ? part("Scheduling approvals", async () => {
          const { data: profile } = await admin.from("user_profile").select("receives_schedule_approval_email").eq("id", me.id).maybeSingle<Row>();
          const flagged = profile?.receives_schedule_approval_email === true;
          if (can(ResourceType.SCHEDULING, ActionType.APPROVE) || flagged) approverRights = true;
          let q = admin.from("schedule_versions").select("schedule_date").eq("is_current", true).eq("status", "pending_approval").order("schedule_date", { ascending: true }).limit(60);
          q = flagged ? q.or(`requested_approver_id.eq.${me.id},requested_approver_id.is.null`) : q.eq("requested_approver_id", me.id);
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          const days = (data ?? []) as Row[];
          approvals.push({
            key: "schedule-days",
            module: "scheduling",
            title: "Schedule days to approve",
            detail: days.length ? `First: ${String(days[0].schedule_date)}` : null,
            count: days.length,
            tone: "review",
            href: days.length ? `/scheduling?date=${String(days[0].schedule_date)}` : "/scheduling",
          });
        })
      : null,

    /* Snagging: inspections where this person is the named reviewer or approval manager (per job, not per role). */
    can(ResourceType.SNAGGING)
      ? part("Snagging sign-offs", async () => {
          const { data, error } = await admin
            .from("snagging_jobs")
            .select("id, reviewer_id, approval_manager_id, reviewed_at, submitted_at")
            .in("status", ["submitted", "in_review"])
            .or(`reviewer_id.eq.${me.id},approval_manager_id.eq.${me.id}`)
            .limit(500);
          if (error) throw new Error(error.message);
          const rows = ((data ?? []) as Row[]).filter((r) =>
            r.reviewed_at ? r.approval_manager_id === me.id : r.reviewer_id === me.id || (r.reviewer_id === null && r.approval_manager_id === me.id),
          );
          if (rows.length) approverRights = true;
          const reviews = rows.filter((r) => !r.reviewed_at).length;
          approvals.push({
            key: "snagging-signoffs",
            module: "snagging",
            title: "Inspections to review or approve",
            detail: rows.length ? `${plural(reviews, "to review", "to review")} · ${plural(rows.length - reviews, "to approve", "to approve")}` : null,
            count: rows.length,
            tone: "review",
            href: "/snagging/review",
          });
        })
      : null,

    /* Check-in disputes: the named reviewers decide them (Settings -> Reporting). */
    REPORTS_ENABLED
      ? part("Compliance disputes", async () => {
          const settings = await readReportingSettings(admin);
          if (!settings.compliance.disputeReviewerUserIds.includes(me.id)) return;
          approverRights = true;
          const { disputes } = await loadDisputes(admin, month);
          const open = disputes.filter((d) => !d.decision).length;
          approvals.push({ key: "compliance-disputes", module: "compliance", title: "Check-in disputes to decide", detail: "This month", count: open, tone: "review", href: "/reports/compliance" });
        })
      : null,

    /* -------------------------------- work -------------------------------- */

    /* To-dos assigned to this person and not done (AMC's follow-ups are to-dos too). */
    can(ResourceType.TODOS)
      ? part("To-dos", async () => {
          const { data: links, error: linkError } = await admin.from("todo_assignees").select("todo_id").eq("user_id", me.id).limit(2000);
          if (linkError) throw new Error(linkError.message);
          const ids = [...new Set(((links ?? []) as Row[]).map((l) => String(l.todo_id)))];
          if (!ids.length) return;
          const { data, error } = await admin.from("todos").select("id, deadline_at").in("id", ids).not("status", "in", OPEN_TODO);
          if (error) throw new Error(error.message);
          const open = (data ?? []) as Row[];
          const overdue = open.filter((t) => t.deadline_at && Date.parse(String(t.deadline_at)) < now.getTime()).length;
          const dueToday = open.filter((t) => t.deadline_at && todayInDubai(new Date(String(t.deadline_at))) === today).length;
          work.push({
            key: "todos",
            module: "todos",
            title: "My to-dos",
            detail: overdue ? `${overdue} overdue${dueToday ? ` · ${dueToday} due today` : ""}` : dueToday ? `${dueToday} due today` : "Assigned to you, open",
            count: open.length,
            tone: overdue ? "bad" : dueToday ? "progress" : "neutral",
            href: "/todos",
          });
        })
      : null,

    /* PPM visits this month still to confirm with the client (DEV-492): all, or the coordinator's own. */
    amc && (can(ResourceType.AMC_VISITS) || can(ResourceType.AMC_CONTRACTS) || can(ResourceType.AMC_OPERATIONS))
      ? part("PPM month", async () => {
          const all = can(ResourceType.AMC_VISITS) || can(ResourceType.AMC_OPERATIONS);
          const { items } = await ppmMonth(admin, month, all ? null : me.id);
          const pending = items.filter((i) => i.state !== "confirmed");
          const notContacted = pending.filter((i) => i.state === "not_contacted").length;
          if (items.length) {
            const by = (state: string) => items.filter((i) => i.state === state).length;
            charts.push({
              key: "ppm-month",
              module: "amc",
              title: "PPM visits this month",
              description: all ? "Every planned visit this month, by where it stands with the client." : "Your contracts' planned visits this month.",
              layout: "horizontal",
              unit: "Visits",
              points: [
                { key: "not_contacted", label: "Not contacted", value: by("not_contacted"), color: CHART_COLOR.attention, drill: "ppm-month:not_contacted" },
                { key: "contacted", label: "Contacted", value: by("contacted"), color: CHART_COLOR.progress, drill: "ppm-month:contacted" },
                { key: "confirmed", label: "Confirmed", value: by("confirmed"), color: CHART_COLOR.good, drill: "ppm-month:confirmed" },
              ],
            });
          }
          work.push({
            key: "ppm-month",
            module: "amc",
            title: "PPM visits to confirm",
            detail: notContacted ? `${notContacted} not contacted yet this month` : "Contacted, waiting for the client",
            count: pending.length,
            tone: notContacted ? "progress" : "neutral",
            href: "/extensions/amc-contracts/ppm-month",
          });
        })
      : null,

    /* Open call outs (logged until closed). */
    amc && can(ResourceType.AMC_CALL_OUTS)
      ? part("AMC call outs", async () => {
          const { count, error } = await admin.from("amc_call_outs").select("id", { count: "exact", head: true }).in("status", [...OPEN_CALL_OUT_STATUSES]);
          if (error) throw new Error(error.message);
          work.push({ key: "amc-call-outs", module: "amc", title: "Open call outs", detail: "Logged and not closed", count: count ?? 0, tone: "neutral", href: "/extensions/amc-contracts/call-outs" });
        })
      : null,

    /* Contracts due for renewal (inside the lead time) or ended without one. */
    amc && can(ResourceType.AMC_RENEWALS)
      ? part("AMC renewals", async () => {
          const config = await amcConfig;
          if (!config) return;
          const { rows } = await renewalsDue(admin, { userId: me.id, canApprove: await amcApprover }, config, now);
          const due = rows.filter((r) => r.stage !== "settled");
          const expired = due.filter((r) => r.daysLeft < 0).length;
          work.push({
            key: "amc-renewals",
            module: "amc",
            title: "Contracts due for renewal",
            detail: expired ? `${expired} already ended without a renewal` : `Within ${config.renewals.leadDays} days of their end`,
            count: due.length,
            tone: expired ? "bad" : "progress",
            href: "/extensions/amc-contracts/renewals",
          });
        })
      : null,

    /* Snagging: the inspector's own jobs, and what was sent back to them. */
    can(ResourceType.SNAGGING)
      ? part("Snagging jobs", async () => {
          const { data, error } = await admin.from("snagging_jobs").select("status, scheduled_date").eq("inspector_id", me.id).in("status", ["assigned", "in_progress", "rejected"]).limit(1000);
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as Row[];
          const sentBack = rows.filter((r) => r.status === "rejected").length;
          const late = rows.filter((r) => r.status !== "rejected" && r.scheduled_date && String(r.scheduled_date) < today).length;
          work.push({
            key: "snagging-mine",
            module: "snagging",
            title: "My inspections",
            detail: sentBack ? `${sentBack} sent back to you` : late ? `${late} past their date` : "Assigned or in progress",
            count: rows.length,
            tone: sentBack || late ? "bad" : "neutral",
            href: "/snagging/jobs",
          });
        })
      : null,

    /* Snagging quotations this person sent that the client has not answered in 48 hours. */
    can(ResourceType.SNAGGING_QUOTATIONS)
      ? part("Snagging quotations", async () => {
          const { count, error } = await admin
            .from("snagging_quotations")
            .select("id", { count: "exact", head: true })
            .eq("status", "sent")
            .eq("created_by", me.id)
            .lt("sent_at", new Date(now.getTime() - 2 * DAY).toISOString());
          if (error) throw new Error(error.message);
          work.push({ key: "snagging-quotes", module: "snagging", title: "Quotations not answered", detail: "Sent over 48 hours ago", count: count ?? 0, tone: "progress", href: "/snagging/quotations" });
        })
      : null,

    /* Invoicing: the queries waiting on this person's side. */
    /* Ready to invoice reads Zoho FSM live, so it is not counted here (its old queue table is retired). */
    can(ResourceType.FINANCE_QUERIES)
      ? part("Invoicing queries", async () => {
          const sides = [can(ResourceType.FINANCE_QUEUE, ActionType.EDIT) ? "finance" : null, can(ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE) ? "operations" : null].filter((s): s is string => Boolean(s));
          if (!sides.length) return;
          const { count, error } = await admin.schema("finance").from("query_threads").select("id", { count: "exact", head: true }).eq("status", "open").in("waiting_on", sides);
          if (error) throw new Error(error.message);
          work.push({ key: "finance-queries", module: "invoicing", title: "Queries waiting on you", detail: sides.length === 2 ? "Finance and Operations" : sides[0] === "finance" ? "Finance side" : "Operations side", count: count ?? 0, tone: "progress", href: "/finance/queries" });
        })
      : null,

    /* Compliance: identity documents expired or within 30 days. */
    can(ResourceType.COMPLIANCE)
      ? part("Compliance", async () => {
          const k = await overviewKpis(admin, today);
          const expired = k.emirates_id.expired + k.passport.expired;
          const soon = k.emirates_id.due_30 + k.passport.due_30;
          work.push({
            key: "compliance-expiring",
            module: "compliance",
            title: "Documents expiring",
            detail: expired ? `${expired} expired · ${soon} within 30 days` : "Within 30 days (Emirates ID, passport)",
            count: expired + soon,
            tone: expired ? "bad" : "progress",
            href: "/compliance/reminders",
          });
          overview.push({ key: "compliance-manpower", module: "compliance", title: "Expiry reminders", detail: `For ${k.active} active manpower`, count: k.reminder_items, tone: "neutral", href: "/compliance/reminders" });
          const sum = (st: "expired" | "due_30" | "due_60" | "due_90") => k.emirates_id[st] + k.passport[st];
          charts.push({
            key: "compliance-expiry",
            module: "compliance",
            title: "Identity documents by expiry",
            description: "Emirates ID and passports of active manpower.",
            layout: "horizontal",
            unit: "Documents",
            points: [
              { key: "expired", label: "Expired", value: sum("expired"), color: CHART_COLOR.attention, drill: "compliance-expiring:expired" },
              { key: "due_30", label: "Within 30 days", value: sum("due_30"), color: CHART_COLOR.progress, drill: "compliance-expiring:due_30" },
              { key: "due_60", label: "Within 60 days", value: sum("due_60"), color: CHART_COLOR.neutral, drill: "compliance-expiring:due_60" },
              { key: "due_90", label: "Within 90 days", value: sum("due_90"), color: CHART_COLOR.neutralSoft, drill: "compliance-expiring:due_90" },
            ],
          });
        })
      : null,

    /* ------------------------------ overview ------------------------------ */

    amc && can(ResourceType.AMC_CONTRACTS)
      ? part("AMC contracts", async () => {
          const { count, error } = await admin.from("amc_contracts").select("id", { count: "exact", head: true }).eq("status", "active");
          if (error) throw new Error(error.message);
          overview.push({ key: "amc-active", module: "amc", title: "Contracts in force", detail: "Active AMC contracts", count: count ?? 0, tone: "neutral", href: "/extensions/amc-contracts" });
        })
      : null,

    can(ResourceType.SNAGGING_JOBS)
      ? part("Snagging overview", async () => {
          const { data, error } = await admin.from("snagging_jobs").select("status").not("status", "in", "(approved,delivered,cancelled)").limit(10000);
          if (error) throw new Error(error.message);
          const statuses = ((data ?? []) as Row[]).map((r) => String(r.status));
          overview.push({ key: "snagging-open", module: "snagging", title: "Inspections open", detail: "Not yet approved or delivered", count: statuses.length, tone: "neutral", href: "/snagging/jobs" });
          const stages: Array<[string, string, string]> = [
            ["assigned", "Assigned", PIPELINE_COLOR.assigned],
            ["in_progress", "In progress", PIPELINE_COLOR.in_progress],
            ["submitted", "Submitted", PIPELINE_COLOR.submitted],
            ["in_review", "In review", PIPELINE_COLOR.in_review],
            ["rejected", "Sent back", CHART_COLOR.attention],
          ];
          if (statuses.length) {
            charts.push({
              key: "snagging-pipeline",
              module: "snagging",
              title: "Inspection pipeline",
              description: "Where every open inspection is sitting.",
              layout: "horizontal",
              unit: "Inspections",
              points: stages.map(([key, label, color]) => ({ key, label, value: statuses.filter((st) => st === key).length, color, drill: `snagging-open:${key}` })),
            });
          }
        })
      : null,

    can(ResourceType.SCHEDULING)
      ? part("Scheduling today", async () => {
          const days = Array.from({ length: 7 }, (_, i) => todayInDubai(new Date(now.getTime() + i * DAY)));
          const { data: versions, error } = await admin.from("schedule_versions").select("id, schedule_date, status").in("schedule_date", days).eq("is_current", true);
          if (error) throw new Error(error.message);
          const byDay = new Map(((versions ?? []) as Row[]).map((v) => [String(v.schedule_date), v]));
          const ids = [...byDay.values()].map((v) => String(v.id));
          const entries = ids.length ? (((await admin.from("schedule_entries").select("schedule_version_id").in("schedule_version_id", ids).limit(20000)).data ?? []) as Row[]) : [];
          const jobsOn = (day: string) => {
            const v = byDay.get(day);
            return v ? entries.filter((e) => String(e.schedule_version_id) === String(v.id)).length : 0;
          };
          const todayVersion = byDay.get(today);
          const status = todayVersion?.status ? String(todayVersion.status).replace(/_/g, " ") : "not started";
          overview.push({ key: "schedule-today", module: "scheduling", title: "On today's board", detail: `Day status: ${status}`, count: jobsOn(today), tone: "neutral", href: `/scheduling?date=${today}` });
          const dayLabel = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
          charts.push({
            key: "schedule-week",
            module: "scheduling",
            title: "The next seven days",
            description: "Jobs on the board for each day. Open a day to see its jobs.",
            layout: "vertical",
            unit: "Jobs",
            points: days.map((d, i) => ({ key: d, label: dayLabel(d), value: jobsOn(d), color: i === 0 ? CHART_COLOR.brand : CHART_COLOR.neutral, drill: `schedule-today:${d}` })),
          });
        })
      : null,

    clientsAccess(user).view
      ? part("Clients", async () => {
          const { count, error } = await admin.from("snagging_clients").select("id", { count: "exact", head: true });
          if (error) throw new Error(error.message);
          overview.push({ key: "clients", module: "clients", title: "Clients in the portal", detail: "AMC and Snagging", count: count ?? 0, tone: "neutral", href: "/clients" });
        })
      : null,

    /* ---------------------------- portal health ---------------------------- */

    isAdmin
      ? part("Portal health", async () => {
          const [runs, users, fsm] = await Promise.all([
            listAmcJobRuns(admin, 20),
            admin.from("user_profile").select("is_active").eq("hidden_from_lists", false).limit(5000),
            readFsmSyncStatus(admin).catch(() => null),
          ]);
          const recent = (runs as Row[]).filter((r) => Date.parse(String(r.started_at)) > now.getTime() - 7 * DAY);
          const failed = recent.filter((r) => r.status === "failed" || r.status === "partial").length;
          const last = (runs as Row[])[0];
          const stale = !last || Date.parse(String(last.started_at)) < now.getTime() - 26 * 3600_000;
          health.push({
            key: "amc-daily-job",
            module: "admin",
            title: "AMC daily job",
            detail: last ? `Last run ${String(last.status)}, ${oldest("started", String(last.started_at), now)?.replace("started ", "")}${stale ? " (more than a day ago)" : ""}` : "Has not run yet",
            count: failed + (stale ? 1 : 0),
            tone: failed || stale ? "bad" : "good",
            href: "/settings/amc/configuration?view=jobs",
          });
          const people = (users.data ?? []) as Row[];
          const inactive = people.filter((p) => p.is_active === false).length;
          health.push({
            key: "users",
            module: "admin",
            title: "Users",
            detail: `${people.length - inactive} active · ${inactive} switched off`,
            count: people.length - inactive,
            tone: "neutral",
            href: "/users",
          });
          const mode = zohoFsmMode();
          const failing = (fsm?.resources ?? []).filter((r) => r.consecutiveFailures > 0);
          health.push({
            key: "zoho-fsm",
            module: "admin",
            title: "Zoho FSM",
            detail:
              mode === "off"
                ? "Switched off on this server"
                : failing.length
                  ? `Sync failing: ${failing.map((r) => r.lastError ?? r.resource).join("; ").slice(0, 140)}`
                  : mode === "read"
                    ? "Read only on this server; in sync"
                    : "Reading and writing; in sync",
            count: failing.length,
            tone: mode === "off" || failing.length ? "bad" : "good",
            href: "/finance/metrics",
          });
        })
      : null,
  ]);

  const order = (keys: string[]) => (a: HomeItem, b: HomeItem) => keys.indexOf(a.key) - keys.indexOf(b.key);
  return {
    role: {
      name: user.roles?.name ?? null,
      isAdmin,
      isApprover: approverRights || approvals.some((a) => a.count > 0),
    },
    charts: charts.sort((a, b) => ["snagging-pipeline", "ppm-month", "schedule-week", "compliance-expiry"].indexOf(a.key) - ["snagging-pipeline", "ppm-month", "schedule-week", "compliance-expiry"].indexOf(b.key)),
    approvals: nonEmpty(approvals),
    work: nonEmpty(work),
    overview: overview.sort(order(["amc-active", "snagging-open", "schedule-today", "clients", "compliance-manpower"])),
    admin: isAdmin ? health : null,
    unavailable,
    generatedAt: now.toISOString(),
  };
}
