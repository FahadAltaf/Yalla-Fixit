import type { SupabaseClient } from "@supabase/supabase-js";

import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { canApproveAmc } from "@/components/dashboard/extensions/amc/amc-settings";
import { AMENDMENT_LABELS, type AmendmentKind } from "@/lib/amc/amendments";
import { OPEN_CALL_OUT_STATUSES } from "@/lib/amc/call-outs";
import { todayInDubai } from "@/lib/amc/contracts";
import { visitPageHref } from "@/lib/amc/field-visits";
import { clientHref, clientsAccess } from "@/lib/clients/access";
import type { ComplianceItemStatus } from "@/lib/compliance/status";
import type { HomeTone } from "@/lib/home/summary";
import { REPORTS_ENABLED } from "@/lib/reports/enabled";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { pendingForApprover } from "@/lib/server/amc/approval-ladder";
import { readAmcConfig } from "@/lib/server/amc/config";
import { jobSheetSupervisors, reviewQueue } from "@/lib/server/amc/job-sheets";
import { listAmcJobRuns } from "@/lib/server/amc/jobs";
import { ppmMonth } from "@/lib/server/amc/ppm-month";
import { renewalsDue } from "@/lib/server/amc/renewals";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { siteVisitDeciders } from "@/lib/server/amc/site-visit-approvers";
import { reminderList } from "@/lib/server/compliance/employees";
import { readFsmSyncStatus } from "@/lib/server/finance/fsm-sync/status";
import { loadDisputes } from "@/lib/server/reports/compliance";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { ActionType, ResourceType, type User } from "@/types/types";

/**
 * The records behind a figure on the home dashboard (26 Nov 2026, the user:
 * "when click on stats ... open popup with proper pagination, then click on
 * it then show their page"). Each key is a figure's own key (or a chart bar:
 * "base:value"), allowed by the same permission as the figure, and filtered
 * the same way, so the list holds what the figure counted. Every row opens
 * its record's page.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Me = { id: string; email: string | null };

export type DrillRow = {
  id: string;
  title: string;
  subtitle: string | null;
  /** A date or time to show (ISO), when there is one. */
  when: string | null;
  status: string | null;
  tone: HomeTone;
  href: string;
};

export type DrillPage = {
  key: string;
  title: string;
  description: string;
  /** The module page that holds the whole list. */
  href: string;
  hrefLabel: string;
  rows: DrillRow[];
  total: number;
  page: number;
  pageSize: number;
};

type Ctx = {
  admin: Admin;
  me: Me;
  user: User;
  can: (resource: ResourceType, action?: ActionType) => boolean;
  today: string;
  month: string;
  param: string | null;
  amcApprover: () => Promise<boolean>;
};

type Drill = {
  title: (param: string | null) => string;
  description: string;
  href: (param: string | null) => string;
  hrefLabel: string;
  allowed: (ctx: Ctx) => boolean | Promise<boolean>;
  rows: (ctx: Ctx) => Promise<DrillRow[]>;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const label = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null);
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? ([] as unknown)) as T;
};
const SNAG_OPEN = "(approved,delivered,cancelled)";
const SNAG_TONE: Record<string, HomeTone> = { rejected: "bad", in_progress: "progress", assigned: "neutral", submitted: "review", in_review: "review" };
const PPM_TONE: Record<string, HomeTone> = { confirmed: "good", contacted: "progress", not_contacted: "bad" };
const COMPLIANCE_TONE: Partial<Record<ComplianceItemStatus, HomeTone>> = { expired: "bad", due_30: "progress", due_60: "neutral", due_90: "neutral" };

/** Inspections as popup rows: an inspector's own, one status, or every open one. */
async function snaggingRows(admin: Admin, filter: { inspectorId?: string; statuses?: string[]; status?: string | null; open?: boolean }): Promise<DrillRow[]> {
  let q = admin.from("snagging_jobs").select("id, code, status, unit_label, building_name, scheduled_date, submitted_at, updated_at");
  if (filter.inspectorId) q = q.eq("inspector_id", filter.inspectorId);
  if (filter.statuses) q = q.in("status", filter.statuses);
  if (filter.status) q = q.eq("status", filter.status);
  else if (filter.open) q = q.not("status", "in", SNAG_OPEN);
  const { data, error } = await (filter.inspectorId ? q.order("scheduled_date", { ascending: true }) : q.order("updated_at", { ascending: false })).limit(1000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    title: str(r.code) ?? "Inspection",
    subtitle: [str(r.unit_label), str(r.building_name)].filter(Boolean).join(", ") || null,
    when: str(r.scheduled_date) ?? str(r.submitted_at) ?? str(r.updated_at),
    status: label(str(r.status)),
    tone: SNAG_TONE[String(r.status)] ?? "neutral",
    href: `/snagging/${String(r.id)}`,
  }));
}

const DRILLS: Record<string, Drill> = {
  /* ------------------------------ approvals ------------------------------ */
  "amc-proposals": {
    title: () => "Proposals to approve",
    description: "Waiting for your approval, oldest first.",
    href: () => "/extensions/amc?status=awaiting_approval",
    hrefLabel: "Open proposals",
    allowed: ({ user }) => canUseAmc(user),
    rows: async ({ admin, me, amcApprover }) => {
      const approver = await amcApprover();
      const ladder = await pendingForApprover(admin, me.id, approver).catch(() => null);
      const mine = new Set(ladder?.submissionIds ?? []);
      const onLadder = new Set(ladder?.allPending ?? []);
      const rows = must<Row[]>(
        await admin.from("amc_submissions").select("id, proposal_number, customer, final_price, submitted_at").eq("status", "awaiting_approval").neq("owner_id", me.id).order("submitted_at", { ascending: true }).limit(500),
      ).filter((r) => mine.has(String(r.id)) || (approver && !onLadder.has(String(r.id))));
      return rows.map((r) => {
        const c = (r.customer ?? {}) as Row;
        return {
          id: String(r.id),
          title: str(r.proposal_number) ?? "Proposal",
          subtitle: [str(c.customerName) ?? str(c.name), r.final_price ? `AED ${Number(r.final_price).toLocaleString("en-AE")}` : null].filter(Boolean).join(" · ") || null,
          when: str(r.submitted_at),
          status: "Awaiting approval",
          tone: "review" as const,
          href: `/extensions/amc/${String(r.id)}`,
        };
      });
    },
  },
  "amc-amendments": {
    title: () => "Contract amendments to decide",
    description: "Asked for on a contract and waiting for an AMC approver.",
    href: () => "/extensions/amc-contracts",
    hrefLabel: "Open contracts",
    allowed: async ({ user, amcApprover }) => canUseAmc(user) && (await amcApprover()),
    rows: async ({ admin }) => {
      const rows = must<Row[]>(await admin.from("amc_contract_amendments").select("id, kind, reason, requested_at, contract_id").eq("status", "requested").order("requested_at", { ascending: true }).limit(500));
      const ids = [...new Set(rows.map((r) => String(r.contract_id)))];
      const contracts = ids.length ? must<Row[]>(await admin.from("amc_contracts").select("id, contract_number, customer_name").in("id", ids)) : [];
      const byId = new Map(contracts.map((c) => [String(c.id), c]));
      return rows.map((r) => {
        const c = byId.get(String(r.contract_id));
        return {
          id: String(r.id),
          title: `${AMENDMENT_LABELS[r.kind as AmendmentKind] ?? label(str(r.kind))} · ${str(c?.contract_number) ?? "Contract"}`,
          subtitle: [str(c?.customer_name), str(r.reason)].filter(Boolean).join(" · ") || null,
          when: str(r.requested_at),
          status: "Requested",
          tone: "review" as const,
          href: `/extensions/amc-contracts/${String(r.contract_id)}?tab=amendments`,
        };
      });
    },
  },
  "amc-site-visits": {
    title: () => "Site visit reports to approve",
    description: "Completed site visits waiting for their approver.",
    href: () => "/extensions/amc-contracts/assessments",
    hrefLabel: "Open site visits",
    allowed: ({ user }) => canUseAmc(user),
    rows: async ({ admin, me }) => {
      const [rows, deciders] = await Promise.all([
        admin.from("amc_assessments").select("id, assessment_number, customer_id, approver_id, completed_at").eq("status", "completed").is("approved_at", null).not("approver_id", "is", null).order("completed_at", { ascending: true }).limit(500),
        siteVisitDeciders(admin).catch(() => ({ ids: [] as string[] })),
      ]);
      const decider = deciders.ids.includes(me.id);
      const list = must<Row[]>(rows).filter((r) => decider || r.approver_id === me.id);
      const clientIds = [...new Set(list.map((r) => str(r.customer_id)).filter((v): v is string => Boolean(v)))];
      const clients = clientIds.length ? must<Row[]>(await admin.from("snagging_clients").select("id, name").in("id", clientIds)) : [];
      const names = new Map(clients.map((c) => [String(c.id), String(c.name)]));
      return list.map((r) => ({
        id: String(r.id),
        title: str(r.assessment_number) ?? "Site visit",
        subtitle: names.get(String(r.customer_id)) ?? null,
        when: str(r.completed_at),
        status: "Completed",
        tone: "review" as const,
        href: `/extensions/amc-contracts/assessments/${String(r.id)}`,
      }));
    },
  },
  "amc-job-reviews": {
    title: () => "Job sheets to review",
    description: "Submitted from the YFI app, oldest first.",
    href: () => "/extensions/amc-contracts/job-reviews",
    hrefLabel: "Open job reviews",
    allowed: async ({ user, can, admin, me }) => {
      if (!canUseAmc(user)) return false;
      if (can(ResourceType.AMC_VISITS, ActionType.APPROVE)) return true;
      const config = await readAmcConfig(admin).catch(() => null);
      return config ? jobSheetSupervisors(config).includes(me.id) : false;
    },
    rows: async ({ admin }) => {
      const { items } = await reviewQueue(admin);
      return items.map((i) => ({
        id: i.visitId,
        title: `${i.ref} · ${i.contractNumber}`,
        subtitle: [i.customerName, i.propertyLabel].filter(Boolean).join(" · ") || null,
        when: i.submittedAt,
        status: i.reviewRequired ? "Review required" : "Submitted",
        tone: i.reviewRequired ? ("bad" as const) : ("review" as const),
        href: i.href,
      }));
    },
  },
  "schedule-days": {
    title: () => "Schedule days to approve",
    description: "Days sent to you for approval.",
    href: () => "/scheduling",
    hrefLabel: "Open scheduling",
    allowed: ({ can }) => can(ResourceType.SCHEDULING) || can(ResourceType.SCHEDULING, ActionType.APPROVE),
    rows: async ({ admin, me }) => {
      const { data: profile } = await admin.from("user_profile").select("receives_schedule_approval_email").eq("id", me.id).maybeSingle<Row>();
      let q = admin.from("schedule_versions").select("id, schedule_date, submitted_at, submitted_by").eq("is_current", true).eq("status", "pending_approval").order("schedule_date", { ascending: true }).limit(200);
      q = profile?.receives_schedule_approval_email === true ? q.or(`requested_approver_id.eq.${me.id},requested_approver_id.is.null`) : q.eq("requested_approver_id", me.id);
      const rows = must<Row[]>(await q);
      const people = [...new Set(rows.map((r) => str(r.submitted_by)).filter((v): v is string => Boolean(v)))];
      const names = new Map(people.length ? must<Row[]>(await admin.from("user_profile").select("id, full_name, email").in("id", people)).map((u) => [String(u.id), str(u.full_name) ?? String(u.email)]) : []);
      return rows.map((r) => ({
        id: String(r.id),
        title: `Schedule for ${String(r.schedule_date)}`,
        subtitle: r.submitted_by ? `Sent by ${names.get(String(r.submitted_by)) ?? "someone"}` : null,
        when: str(r.submitted_at),
        status: "Pending approval",
        tone: "review" as const,
        href: `/scheduling?date=${String(r.schedule_date)}`,
      }));
    },
  },
  "snagging-signoffs": {
    title: () => "Inspections to review or approve",
    description: "Inspections where you are the named reviewer or approval manager.",
    href: () => "/snagging/review",
    hrefLabel: "Open review",
    allowed: ({ can }) => can(ResourceType.SNAGGING),
    rows: async ({ admin, me }) => {
      const rows = must<Row[]>(
        await admin.from("snagging_jobs").select("id, code, status, unit_label, building_name, reviewer_id, approval_manager_id, reviewed_at, submitted_at").in("status", ["submitted", "in_review"]).or(`reviewer_id.eq.${me.id},approval_manager_id.eq.${me.id}`).order("submitted_at", { ascending: true }).limit(500),
      ).filter((r) => (r.reviewed_at ? r.approval_manager_id === me.id : r.reviewer_id === me.id || (r.reviewer_id === null && r.approval_manager_id === me.id)));
      return rows.map((r) => ({
        id: String(r.id),
        title: str(r.code) ?? "Inspection",
        subtitle: [str(r.unit_label), str(r.building_name)].filter(Boolean).join(", ") || null,
        when: str(r.submitted_at),
        status: r.reviewed_at ? "To approve" : "To review",
        tone: "review" as const,
        href: `/snagging/${String(r.id)}`,
      }));
    },
  },
  "compliance-disputes": {
    title: () => "Check-in disputes to decide",
    description: "Raised this month and not decided yet.",
    href: () => "/reports/compliance",
    hrefLabel: "Open check-in compliance",
    allowed: async ({ admin, me }) => REPORTS_ENABLED && (await readReportingSettings(admin)).compliance.disputeReviewerUserIds.includes(me.id),
    rows: async ({ admin, month }) => {
      const { disputes } = await loadDisputes(admin, month);
      return disputes
        .filter((d) => !d.decision)
        .map((d) => ({
          id: d.id,
          title: `${label(d.kind) ?? "Check-in"} · ${d.date}`,
          subtitle: [d.appointmentNumber, d.raisedBy, d.reason].filter(Boolean).join(" · ") || null,
          when: d.raisedAt,
          status: "Open",
          tone: "review" as const,
          href: "/reports/compliance",
        }));
    },
  },

  /* -------------------------------- work -------------------------------- */
  todos: {
    title: () => "My to-dos",
    description: "Assigned to you and not done, the soonest deadline first.",
    href: () => "/todos",
    hrefLabel: "Open to-dos",
    allowed: ({ can }) => can(ResourceType.TODOS),
    rows: async ({ admin, me }) => {
      const links = must<Row[]>(await admin.from("todo_assignees").select("todo_id").eq("user_id", me.id).limit(2000));
      const ids = [...new Set(links.map((l) => String(l.todo_id)))];
      if (!ids.length) return [];
      const rows = must<Row[]>(await admin.from("todos").select("id, todo_key, title, status, deadline_at").in("id", ids).not("status", "in", "(done,canceled)").order("deadline_at", { ascending: true, nullsFirst: false }));
      const now = Date.now();
      return rows.map((t) => {
        const late = t.deadline_at && Date.parse(String(t.deadline_at)) < now;
        return {
          id: String(t.id),
          title: str(t.title) ?? "To-do",
          subtitle: str(t.todo_key),
          when: str(t.deadline_at),
          status: late ? "Overdue" : label(str(t.status)),
          tone: late ? ("bad" as const) : t.status === "in_progress" ? ("progress" as const) : ("neutral" as const),
          href: `/todos?todo=${encodeURIComponent(String(t.todo_key ?? t.id))}`,
        };
      });
    },
  },
  "ppm-month": {
    title: (p) => (p ? `PPM visits this month: ${label(p)}` : "PPM visits to confirm"),
    description: "This month's planned visits and where each stands with the client.",
    href: () => "/extensions/amc-contracts/ppm-month",
    hrefLabel: "Open PPM month",
    allowed: ({ user, can }) => canUseAmc(user) && (can(ResourceType.AMC_VISITS) || can(ResourceType.AMC_CONTRACTS) || can(ResourceType.AMC_OPERATIONS)),
    rows: async ({ admin, me, can, month, param }) => {
      const all = can(ResourceType.AMC_VISITS) || can(ResourceType.AMC_OPERATIONS);
      const { items } = await ppmMonth(admin, month, all ? null : me.id);
      return items
        .filter((i) => (param ? i.state === param : i.state !== "confirmed"))
        .map((i) => ({
          id: i.visitId,
          title: `${i.contractNumber} · visit ${i.visitNo}`,
          subtitle: [i.customerName, i.propertyLabel].filter(Boolean).join(" · ") || null,
          when: i.targetDate,
          status: label(i.state),
          tone: PPM_TONE[i.state] ?? "neutral",
          href: visitPageHref(i.visitId),
        }));
    },
  },
  "amc-call-outs": {
    title: () => "Open call outs",
    description: "Logged and not closed, the oldest first.",
    href: () => "/extensions/amc-contracts/call-outs",
    hrefLabel: "Open call outs",
    allowed: ({ user, can }) => canUseAmc(user) && can(ResourceType.AMC_CALL_OUTS),
    rows: async ({ admin }) => {
      const rows = must<Row[]>(
        await admin
          .from("amc_call_outs")
          .select("id, call_out_no, issue, status, priority, reported_at, contract:amc_contracts!amc_call_outs_contract_id_fkey(contract_number, customer_name)")
          .in("status", [...OPEN_CALL_OUT_STATUSES])
          .order("reported_at", { ascending: true })
          .limit(500),
      );
      return rows.map((r) => {
        const c = one(r.contract as Row | Row[] | null);
        return {
          id: String(r.id),
          title: `${str(r.call_out_no) ?? "Call out"} · ${str(c?.contract_number) ?? ""}`.replace(/ · $/, ""),
          subtitle: [str(c?.customer_name), str(r.issue)].filter(Boolean).join(" · ") || null,
          when: str(r.reported_at),
          status: label(str(r.status)),
          tone: r.priority === "emergency" || r.priority === "urgent" ? ("bad" as const) : ("neutral" as const),
          href: visitPageHref(String(r.id)),
        };
      });
    },
  },
  "amc-renewals": {
    title: () => "Contracts due for renewal",
    description: "Inside the renewal lead time, or ended without a renewal.",
    href: () => "/extensions/amc-contracts/renewals",
    hrefLabel: "Open renewals",
    allowed: ({ user, can }) => canUseAmc(user) && can(ResourceType.AMC_RENEWALS),
    rows: async ({ admin, me, amcApprover }) => {
      const config = await readAmcConfig(admin);
      const { rows } = await renewalsDue(admin, { userId: me.id, canApprove: await amcApprover() }, config);
      return rows
        .filter((r) => r.stage !== "settled")
        .map((r) => ({
          id: r.contractId,
          title: `${r.number} · ${r.customerName}`,
          subtitle: r.propertyLabel || null,
          when: r.endDate,
          status: r.daysLeft < 0 ? `Ended ${-r.daysLeft} days ago` : `${r.daysLeft} days left`,
          tone: r.daysLeft < 0 ? ("bad" as const) : ("progress" as const),
          href: `/extensions/amc-contracts/${r.contractId}?tab=renewal`,
        }));
    },
  },
  "snagging-mine": {
    title: () => "My inspections",
    description: "Assigned to you, in progress or sent back.",
    href: () => "/snagging/jobs",
    hrefLabel: "Open jobs",
    allowed: ({ can }) => can(ResourceType.SNAGGING),
    rows: ({ admin, me }) => snaggingRows(admin, { inspectorId: me.id, statuses: ["assigned", "in_progress", "rejected"] }),
  },
  "snagging-quotes": {
    title: () => "Quotations not answered",
    description: "Sent by you more than 48 hours ago, still waiting for the client.",
    href: () => "/snagging/quotations",
    hrefLabel: "Open quotations",
    allowed: ({ can }) => can(ResourceType.SNAGGING_QUOTATIONS),
    rows: async ({ admin, me }) => {
      const rows = must<Row[]>(
        await admin.from("snagging_quotations").select("id, quote_number, sent_to, total, sent_at").eq("status", "sent").eq("created_by", me.id).lt("sent_at", new Date(Date.now() - 2 * 86_400_000).toISOString()).order("sent_at", { ascending: true }).limit(500),
      );
      return rows.map((r) => ({
        id: String(r.id),
        title: str(r.quote_number) ?? "Quotation",
        subtitle: [str(r.sent_to), r.total ? `AED ${Number(r.total).toLocaleString("en-AE")}` : null].filter(Boolean).join(" · ") || null,
        when: str(r.sent_at),
        status: "Sent",
        tone: "progress" as const,
        href: `/snagging/quotations/${String(r.id)}`,
      }));
    },
  },
  "finance-queries": {
    title: () => "Queries waiting on you",
    description: "Open invoicing queries waiting on your side.",
    href: () => "/finance/queries",
    hrefLabel: "Open queries",
    allowed: ({ can }) => can(ResourceType.FINANCE_QUERIES),
    rows: async ({ admin, can }) => {
      const sides = [can(ResourceType.FINANCE_QUEUE, ActionType.EDIT) ? "finance" : null, can(ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE) ? "operations" : null].filter((s): s is string => Boolean(s));
      if (!sides.length) return [];
      const rows = must<Row[]>(
        await admin.schema("finance").from("query_threads").select("id, fsm_work_order_id, work_order_number, subject, waiting_on, created_at, last_comment_at").eq("status", "open").in("waiting_on", sides).order("created_at", { ascending: true }).limit(500),
      );
      return rows.map((r) => ({
        id: String(r.id),
        title: str(r.subject) ?? "Query",
        subtitle: str(r.work_order_number) ? `Work order ${String(r.work_order_number)}` : null,
        when: str(r.last_comment_at) ?? str(r.created_at),
        status: `Waiting on ${String(r.waiting_on)}`,
        tone: "progress" as const,
        href: str(r.fsm_work_order_id) ? `/finance/queue/${String(r.fsm_work_order_id)}` : "/finance/queries",
      }));
    },
  },
  "compliance-expiring": {
    title: (p) => (p ? `Documents: ${p === "due_30" ? "within 30 days" : p === "due_60" ? "within 60 days" : p === "due_90" ? "within 90 days" : label(p)}` : "Documents expiring"),
    description: "Emirates ID and passports of active manpower.",
    href: () => "/compliance/reminders",
    hrefLabel: "Open expiry reminders",
    allowed: ({ can }) => can(ResourceType.COMPLIANCE),
    rows: async ({ admin, today, param }) => {
      const wanted: ComplianceItemStatus[] = param ? [param as ComplianceItemStatus] : ["expired", "due_30"];
      const lists = await Promise.all(wanted.map((status) => reminderList(admin, { status }, today)));
      return lists.flat().map((r) => ({
        id: `${r.employee_id}:${r.item_key}`,
        title: r.full_name,
        subtitle: [r.item_label, r.site_label].filter(Boolean).join(" · ") || null,
        when: r.expiry,
        status: r.status === "expired" ? "Expired" : r.days !== null ? `${r.days} days left` : label(r.status),
        tone: COMPLIANCE_TONE[r.status] ?? "neutral",
        href: `/compliance/employees/${r.employee_id}`,
      }));
    },
  },

  /* ------------------------------ overview ------------------------------ */
  "amc-active": {
    title: () => "Contracts in force",
    description: "Active AMC contracts, the soonest to end first.",
    href: () => "/extensions/amc-contracts",
    hrefLabel: "Open contracts",
    allowed: ({ user, can }) => canUseAmc(user) && can(ResourceType.AMC_CONTRACTS),
    rows: async ({ admin }) => {
      const rows = must<Row[]>(await admin.from("amc_contracts").select("id, contract_number, customer_name, property_label, end_date").eq("status", "active").order("end_date", { ascending: true }).limit(1000));
      return rows.map((r) => ({
        id: String(r.id),
        title: `${str(r.contract_number) ?? "Contract"} · ${str(r.customer_name) ?? ""}`.replace(/ · $/, ""),
        subtitle: str(r.property_label),
        when: str(r.end_date),
        status: "Active",
        tone: "good" as const,
        href: `/extensions/amc-contracts/${String(r.id)}`,
      }));
    },
  },
  "snagging-open": {
    title: (p) => (p ? `Inspections: ${label(p)}` : "Inspections open"),
    description: "Not yet approved or delivered.",
    href: (p) => (p ? `/snagging/jobs?status=${p}` : "/snagging/jobs"),
    hrefLabel: "Open jobs",
    allowed: ({ can }) => can(ResourceType.SNAGGING_JOBS),
    rows: ({ admin, param }) => snaggingRows(admin, { status: param, open: true }),
  },
  "schedule-today": {
    title: (p) => (p ? `On the board: ${p}` : "On today's board"),
    description: "The jobs on the day's board.",
    href: (p) => `/scheduling${p ? `?date=${p}` : ""}`,
    hrefLabel: "Open the board",
    allowed: ({ can }) => can(ResourceType.SCHEDULING),
    rows: async ({ admin, today, param }) => {
      const day = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : today;
      const { data: version } = await admin.from("schedule_versions").select("id").eq("schedule_date", day).eq("is_current", true).maybeSingle<Row>();
      if (!version?.id) return [];
      const rows = must<Row[]>(await admin.from("schedule_entries").select("id, title, client_name, address, start_at, entry_type").eq("schedule_version_id", String(version.id)).order("start_at", { ascending: true }).limit(1000));
      return rows.map((r) => ({
        id: String(r.id),
        title: str(r.title) ?? str(r.client_name) ?? "Job",
        subtitle: [str(r.client_name), str(r.address)].filter(Boolean).join(" · ") || null,
        when: str(r.start_at),
        status: label(str(r.entry_type)),
        tone: "neutral" as const,
        href: `/scheduling?date=${day}`,
      }));
    },
  },
  clients: {
    title: () => "Clients in the portal",
    description: "AMC and Snagging clients, the newest first.",
    href: () => "/clients",
    hrefLabel: "Open clients",
    allowed: ({ user }) => clientsAccess(user).view,
    rows: async ({ admin }) => {
      const rows = must<Row[]>(await admin.from("snagging_clients").select("id, name, email, phone, company, created_at").order("created_at", { ascending: false }).limit(2000));
      return rows.map((r) => ({
        id: String(r.id),
        title: str(r.name) ?? "Client",
        subtitle: [str(r.company), str(r.email), str(r.phone)].filter(Boolean).join(" · ") || null,
        when: str(r.created_at),
        status: null,
        tone: "neutral" as const,
        href: clientHref(String(r.id)),
      }));
    },
  },
  "compliance-manpower": {
    title: () => "Expiry reminders",
    description: "Every reminder item for active manpower.",
    href: () => "/compliance/reminders",
    hrefLabel: "Open expiry reminders",
    allowed: ({ can }) => can(ResourceType.COMPLIANCE),
    rows: async ({ admin, today }) =>
      (await reminderList(admin, {}, today)).map((r) => ({
        id: `${r.employee_id}:${r.item_key}`,
        title: r.full_name,
        subtitle: [r.item_label, r.site_label].filter(Boolean).join(" · ") || null,
        when: r.expiry,
        status: label(r.status),
        tone: COMPLIANCE_TONE[r.status] ?? "neutral",
        href: `/compliance/employees/${r.employee_id}`,
      })),
  },

  /* ---------------------------- portal health ---------------------------- */
  "amc-daily-job": {
    title: () => "AMC daily job runs",
    description: "The most recent runs, newest first.",
    href: () => "/settings/amc/configuration?view=jobs",
    hrefLabel: "Open daily jobs",
    allowed: ({ user }) => isAdminUser(user),
    rows: async ({ admin }) =>
      ((await listAmcJobRuns(admin, 100)) as Row[]).map((r) => ({
        id: String(r.id),
        title: `${label(str(r.trigger)) ?? "Run"}`,
        subtitle: r.finished_at ? `Finished ${new Date(String(r.finished_at)).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}` : "Not finished",
        when: str(r.started_at),
        status: label(str(r.status)),
        tone: r.status === "succeeded" ? ("good" as const) : r.status === "running" ? ("progress" as const) : ("bad" as const),
        href: "/settings/amc/configuration?view=jobs",
      })),
  },
  users: {
    title: () => "Users",
    description: "Everyone in the portal, by name.",
    href: () => "/users",
    hrefLabel: "Open users",
    allowed: ({ user }) => isAdminUser(user),
    rows: async ({ admin }) => {
      const rows = must<Row[]>(await admin.from("user_profile").select("id, full_name, email, is_active, created_at, role:roles(name)").eq("hidden_from_lists", false).order("full_name").limit(5000));
      return rows.map((u) => ({
        id: String(u.id),
        title: str(u.full_name) ?? String(u.email ?? "User"),
        subtitle: [str(u.email), label(str(one(u.role as Row | Row[] | null)?.name as string | undefined))].filter(Boolean).join(" · ") || null,
        when: str(u.created_at),
        status: u.is_active === false ? "Switched off" : "Active",
        tone: u.is_active === false ? ("neutral" as const) : ("good" as const),
        href: "/users",
      }));
    },
  },
  "zoho-fsm": {
    title: () => "Zoho FSM sync",
    description: "Each resource the portal reads from FSM, and when it last synced.",
    href: () => "/finance/metrics",
    hrefLabel: "Open invoicing metrics",
    allowed: ({ user }) => isAdminUser(user),
    rows: async ({ admin }) =>
      ((await readFsmSyncStatus(admin).catch(() => ({ resources: [] }))).resources ?? []).map((r) => ({
        id: String(r.resource),
        title: label(String(r.resource)) ?? String(r.resource),
        subtitle: r.lastError,
        when: r.lastSuccessAt,
        status: r.consecutiveFailures ? `${r.consecutiveFailures} failed in a row` : "In sync",
        tone: r.consecutiveFailures ? ("bad" as const) : ("good" as const),
        href: "/finance/metrics",
      })),
  },
};

/** One page of a figure's records; null when the key is unknown or not this person's to see. */
export async function homeDrill(
  admin: Admin,
  me: Me,
  user: User,
  rawKey: string,
  opts: { page: number; pageSize: number; q?: string | null },
): Promise<DrillPage | null> {
  const [base, ...rest] = rawKey.split(":");
  const param = rest.length ? rest.join(":") : null;
  const drill = DRILLS[base];
  if (!drill) return null;
  const today = todayInDubai();
  let approver: Promise<boolean> | null = null;
  const ctx: Ctx = {
    admin,
    me,
    user,
    can: (resource, action = ActionType.VIEW) => hasResourceAction(user, resource, action),
    today,
    month: today.slice(0, 7),
    param,
    amcApprover: () =>
      (approver ??= canUseAmc(user)
        ? readAmcSettings(admin)
            .then((s) => canApproveAmc(s, me.email, hasResourceAction(user, ResourceType.AMC, ActionType.APPROVE)))
            .catch(() => false)
        : Promise.resolve(false)),
  };
  if (!(await drill.allowed(ctx))) return null;
  const all = await drill.rows(ctx);
  const term = (opts.q ?? "").trim().toLowerCase();
  const matched = term ? all.filter((r) => [r.title, r.subtitle, r.status].some((v) => v?.toLowerCase().includes(term))) : all;
  const pageSize = Math.min(Math.max(opts.pageSize, 5), 50);
  const page = Math.max(0, opts.page);
  return {
    key: rawKey,
    title: drill.title(param),
    description: drill.description,
    href: drill.href(param),
    hrefLabel: drill.hrefLabel,
    rows: matched.slice(page * pageSize, page * pageSize + pageSize),
    total: matched.length,
    page,
    pageSize,
  };
}

/** The figures that open a list (every figure on the dashboard). */
export const DRILL_KEYS = Object.keys(DRILLS);
