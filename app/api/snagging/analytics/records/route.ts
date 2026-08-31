import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  inRange,
  loadInspectorNames,
  loadJobsTouchingRange,
  loadReviewQueue,
  minutesBetween,
  queueBucketOf,
  resolveRange,
  type AnalyticsJob,
  type DateRange,
} from "@/lib/server/snagging/analytics";
import { DELIVERY_SLA_HOURS } from "@/lib/server/snagging/workflow";
import { TASK_STATUS_LABELS } from "@/lib/snagging/status-labels";
import {
  ActionType,
  ResourceType,
  type SnaggingAnalyticsDrilldown,
  type SnaggingAnalyticsGranularity,
  type SnaggingAnalyticsMetric,
  type SnaggingTaskStatus,
} from "@/types/types";

/**
 * The records behind one figure on the analytics page (FR-10.06).
 *
 * Every number on that page is an aggregate, and an aggregate nobody can
 * open is a number nobody can act on: "eleven overdue" is a statistic,
 * eleven job codes is a morning's work. This returns the rows, and the
 * columns that explain them — a duration for a time metric, a rejection
 * count for first-time approval — so the table on screen and the file it
 * exports say the same thing.
 *
 * The rows are derived from the same query layer the summary reads
 * through, so a card and its drill-down cannot disagree.
 */

type Column = SnaggingAnalyticsDrilldown["columns"][number];
type Row = SnaggingAnalyticsDrilldown["rows"][number];
/** The metric-specific half of a row; the identity half is added around it. */
type ExtraCells = Record<string, string | number | null>;

const METRICS: SnaggingAnalyticsMetric[] = [
  "status",
  "review_queue",
  "completed",
  "time_on_site",
  "submit_to_approval",
  "first_time_approval",
  "delivered_sla",
  "overdue_approvals",
  "developer",
  "inspector",
];

const QUEUE_BUCKET_LABELS: Record<string, string> = {
  under_24h: "waiting under 24 hours",
  h24_48: "waiting 24 to 48 hours",
  over_48h: "waiting over 48 hours",
};

/** Columns every drill-down opens with: which job, and where. */
const IDENTITY_COLUMNS: Column[] = [
  { key: "code", label: "Job" },
  { key: "unit", label: "Unit" },
  { key: "status", label: "Status" },
];

export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = req.nextUrl.searchParams;
    const metric = params.get("metric") as SnaggingAnalyticsMetric | null;
    if (!metric || !METRICS.includes(metric)) {
      return NextResponse.json({ error: "Unknown metric" }, { status: 400 });
    }

    const value = params.get("value");
    const range = resolveRange(params.get("from"), params.get("to"));
    const granularity = (params.get("granularity") ?? "day") as SnaggingAnalyticsGranularity;

    const admin = await createAdminServerClient();

    // The two live worklists read the queue; everything else is scoped
    // to the period, exactly as the summary computes them.
    const usesQueue = metric === "review_queue" || metric === "overdue_approvals";
    const [jobs, queue] = await Promise.all([
      usesQueue ? Promise.resolve([] as AnalyticsJob[]) : loadJobsTouchingRange(admin, range),
      usesQueue ? loadReviewQueue(admin) : Promise.resolve([] as AnalyticsJob[]),
    ]);

    const built = build(metric, value, usesQueue ? queue : jobs, range, granularity);
    const names = await loadInspectorNames(
      admin,
      [...new Set(built.jobs.map((job) => job.inspector_id).filter((id): id is string => !!id))],
    );

    const drilldown: SnaggingAnalyticsDrilldown = {
      metric,
      title: built.title,
      description: built.description,
      columns: [...IDENTITY_COLUMNS, ...built.columns],
      rows: built.jobs.map((job) => ({
        ...identityOf(job),
        ...built.extra(job, names),
      })),
      totalCount: built.jobs.length,
    };

    return NextResponse.json({ data: drilldown });
  } catch (error) {
    console.error("Snagging analytics records error:", error);
    return NextResponse.json({ error: "Failed to load the records" }, { status: 500 });
  }
}

function identityOf(job: AnalyticsJob): Row {
  const round =
    job.visit_type === "desnag"
      ? ` · de-snag round ${job.round_number ?? ""}`.trimEnd()
      : job.visit_type === "additional"
        ? " · additional visit"
        : "";
  return {
    id: job.id,
    code: `${job.code}${round}`,
    unit: [job.unit_label, job.building_name].filter(Boolean).join(", ") || "—",
    status: TASK_STATUS_LABELS[job.status as SnaggingTaskStatus] ?? job.status,
  };
}

type Built = {
  title: string;
  description: string;
  columns: Column[];
  jobs: AnalyticsJob[];
  extra: (job: AnalyticsJob, names: Map<string, string>) => ExtraCells;
};

function build(
  metric: SnaggingAnalyticsMetric,
  value: string | null,
  source: AnalyticsJob[],
  range: DateRange,
  granularity: SnaggingAnalyticsGranularity,
): Built {
  const period = `${range.from} to ${range.to}`;

  switch (metric) {
    case "status": {
      const label = TASK_STATUS_LABELS[value as SnaggingTaskStatus] ?? value ?? "All";
      return {
        title: `${label} jobs`,
        description: `Raised ${period}.`,
        columns: [
          { key: "developer", label: "Developer" },
          { key: "raised", label: "Raised" },
        ],
        jobs: source.filter((job) => inRange(job.created_at, range) && job.status === value),
        extra: (job) => ({
          developer: job.developer_name ?? "—",
          raised: date(job.created_at),
        }),
      };
    }

    case "review_queue":
    case "overdue_approvals": {
      const bucket = metric === "overdue_approvals" ? "over_48h" : value;
      const jobs = source.filter((job) => !bucket || queueBucketOf(job.submitted_at) === bucket);
      return {
        title: metric === "overdue_approvals" ? "Approvals past 48 hours" : "Waiting on review",
        description:
          metric === "overdue_approvals"
            ? "Submitted more than 48 hours ago and still not approved. Live, not filtered by the dates above."
            : `Submitted and ${QUEUE_BUCKET_LABELS[bucket ?? ""] ?? "waiting"}. Live, not filtered by the dates above.`,
        columns: [
          { key: "submitted", label: "Submitted" },
          { key: "waiting", label: "Waiting", align: "right" },
        ],
        jobs,
        extra: (job) => ({
          submitted: dateTime(job.submitted_at),
          waiting: duration(minutesBetween(job.submitted_at, new Date().toISOString())),
        }),
      };
    }

    case "completed": {
      const jobs = source.filter(
        (job) =>
          inRange(job.approved_at, range) &&
          (!value || periodKeyOf(job.approved_at as string, granularity) === value),
      );
      return {
        title: "Jobs completed",
        description: value
          ? "Counted at approval, in the period selected on the chart."
          : `Counted at approval, ${period}.`,
        columns: [
          { key: "approved", label: "Approved" },
          { key: "turnaround", label: "Submit to approval", align: "right" },
        ],
        jobs,
        extra: (job) => ({
          approved: dateTime(job.approved_at),
          turnaround: duration(minutesBetween(job.submitted_at, job.approved_at)),
        }),
      };
    }

    case "time_on_site": {
      const jobs = source.filter(
        (job) =>
          inRange(job.submitted_at, range) &&
          minutesBetween(job.started_at, job.submitted_at) !== null,
      );
      return {
        title: "Time on site",
        description: `Arrival to submission, for walks submitted ${period}.`,
        columns: [
          { key: "started", label: "Started" },
          { key: "submitted", label: "Submitted" },
          { key: "onSite", label: "On site", align: "right" },
        ],
        jobs,
        extra: (job) => ({
          started: dateTime(job.started_at),
          submitted: dateTime(job.submitted_at),
          onSite: duration(minutesBetween(job.started_at, job.submitted_at)),
        }),
      };
    }

    case "submit_to_approval": {
      const jobs = source.filter(
        (job) =>
          inRange(job.approved_at, range) &&
          minutesBetween(job.submitted_at, job.approved_at) !== null,
      );
      return {
        title: "Submit to approval",
        description: `How long the office took, for jobs approved ${period}.`,
        columns: [
          { key: "submitted", label: "Submitted" },
          { key: "approved", label: "Approved" },
          { key: "turnaround", label: "Turnaround", align: "right" },
        ],
        jobs,
        extra: (job) => ({
          submitted: dateTime(job.submitted_at),
          approved: dateTime(job.approved_at),
          turnaround: duration(minutesBetween(job.submitted_at, job.approved_at)),
        }),
      };
    }

    case "first_time_approval": {
      const approved = source.filter((job) => inRange(job.approved_at, range));
      const wantReturned = value === "returned";
      const jobs = value
        ? approved.filter((job) => ((job.rejection_count ?? 0) > 0) === wantReturned)
        : approved;
      return {
        title: wantReturned ? "Sent back before approval" : "Approved first time",
        description: `Approved ${period}.`,
        columns: [
          { key: "returns", label: "Times returned", align: "right" },
          { key: "approved", label: "Approved" },
        ],
        jobs,
        extra: (job) => ({
          returns: job.rejection_count ?? 0,
          approved: dateTime(job.approved_at),
        }),
      };
    }

    case "delivered_sla": {
      const delivered = source.filter(
        (job) => inRange(job.delivered_at, range) && job.approved_at !== null,
      );
      const wantLate = value === "late";
      const jobs = value
        ? delivered.filter((job) => {
            const minutes = minutesBetween(job.approved_at, job.delivered_at);
            const late = minutes === null || minutes > DELIVERY_SLA_HOURS * 60;
            return late === wantLate;
          })
        : delivered;
      return {
        title: wantLate ? "Delivered outside 24 hours" : "Delivered within 24 hours",
        description: `Approval to delivery, for reports sent ${period}.`,
        columns: [
          { key: "approved", label: "Approved" },
          { key: "delivered", label: "Delivered" },
          { key: "elapsed", label: "Approval to delivery", align: "right" },
        ],
        jobs,
        extra: (job) => ({
          approved: dateTime(job.approved_at),
          delivered: dateTime(job.delivered_at),
          elapsed: duration(minutesBetween(job.approved_at, job.delivered_at)),
        }),
      };
    }

    case "developer": {
      return {
        title: value ?? "Developer",
        description: `Units inspected ${period}.`,
        columns: [
          { key: "raised", label: "Raised" },
          { key: "submitted", label: "Submitted" },
        ],
        jobs: source.filter(
          (job) => inRange(job.created_at, range) && (job.developer_name?.trim() ?? "") === value,
        ),
        extra: (job) => ({
          raised: date(job.created_at),
          submitted: dateTime(job.submitted_at),
        }),
      };
    }

    case "inspector": {
      return {
        title: "Inspections",
        description: `Assigned ${period}. Time on site is arrival to submission; a blank means the walk is not submitted yet.`,
        columns: [
          { key: "inspector", label: "Inspector" },
          { key: "raised", label: "Raised" },
          { key: "onSite", label: "On site", align: "right" },
        ],
        jobs: source.filter((job) => inRange(job.created_at, range) && job.inspector_id === value),
        extra: (job, names) => ({
          inspector: (job.inspector_id && names.get(job.inspector_id)) || "Unassigned",
          raised: date(job.created_at),
          onSite: duration(minutesBetween(job.started_at, job.submitted_at)),
        }),
      };
    }
  }
}

/**
 * Same week rule as the summary chart, restated here rather than
 * imported so a chart click and its list cannot land in different weeks.
 */
function periodKeyOf(iso: string, granularity: SnaggingAnalyticsGranularity): string {
  if (granularity === "month") return iso.slice(0, 7);
  if (granularity === "day") return iso.slice(0, 10);
  const date = new Date(iso);
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function date(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}

function dateTime(value: string | null): string {
  return value ? value.slice(0, 16).replace("T", " ") : "—";
}

function duration(minutes: number | null): string {
  if (minutes === null) return "—";
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  if (hours < 48) {
    const rest = whole % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
