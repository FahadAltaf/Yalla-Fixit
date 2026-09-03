"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  DoorClosed,
  FileImage,
  FileText,
  History,
  Pencil,
  PlayCircle,
  Plus,
  RotateCcw,
  Send,
  Tag,
  Trash2,
  UserCog,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import {
  DataRow,
  DataState,
  ListPager,
  ListSkeleton,
  SectionCard,
} from "./shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingAuditEvent } from "@/types/types";

/** Human-readable label + icon for each audited event type (BR-5). */
const EVENT_META: Record<string, { label: string; Icon: LucideIcon }> = {
  // Status changes, in the order the workflow walks them.
  task_in_progress: { label: "Inspection started on site", Icon: PlayCircle },
  task_submitted: { label: "Submitted for review", Icon: Send },
  task_in_review: { label: "Review started", Icon: ClipboardCheck },
  review_completed: { label: "Review complete — sent to approval", Icon: Send },
  reviewer_assigned: { label: "Reviewer assigned", Icon: UserCog },
  approval_manager_assigned: { label: "Approval manager assigned", Icon: UserCog },
  approval_escalated: { label: "Approval escalated — past 48h", Icon: AlertTriangle },
  task_approved: { label: "Inspection approved", Icon: CheckCircle2 },
  task_rejected: { label: "Sent back for correction", Icon: XCircle },
  report_delivered: { label: "Report delivered", Icon: FileText },
  round_created: { label: "De-snag round opened", Icon: RotateCcw },
  additional_visit_created: {
    label: "Additional visit scheduled",
    Icon: CalendarPlus,
  },
  floor_plan_added: { label: "Floor plan added", Icon: FileImage },
  catalogue_entry_created: { label: "Catalogue entry created", Icon: Tag },
  catalogue_entry_updated: { label: "Catalogue entry updated", Icon: Tag },
  catalogue_entry_retired: { label: "Catalogue entry retired", Icon: Tag },
  catalogue_entry_reactivated: {
    label: "Catalogue entry reactivated",
    Icon: Tag,
  },
  quotation_generated: { label: "Quotation generated", Icon: FileText },
  quotation_regenerated: { label: "Quotation regenerated", Icon: FileText },
  quotation_sent: { label: "Quotation sent to client", Icon: FileText },
  quotation_approved: { label: "Quotation approved", Icon: CheckCircle2 },
  quotation_rejected: { label: "Quotation rejected", Icon: XCircle },
  inspector_assigned: { label: "Inspector assigned", Icon: UserCog },
  // Edits captured on the device and replayed here by the sync route.
  snag_created: { label: "Snag captured", Icon: Plus },
  snag_updated: { label: "Snag edited", Icon: Pencil },
  snag_withdrawn: { label: "Snag withdrawn", Icon: Trash2 },
  snag_verified: { label: "Snag verified", Icon: CheckCircle2 },
  area_confirmed: { label: "Area confirmed", Icon: CheckCircle2 },
  area_access_changed: { label: "Area access recorded", Icon: DoorClosed },
  checklist_not_checked: {
    label: "Checklist item skipped",
    Icon: AlertTriangle,
  },
};

function metaFor(eventType: string) {
  return (
    EVENT_META[eventType] ?? {
      label: eventType.replace(/_/g, " "),
      Icon: History,
    }
  );
}

const ACCESS_WORDS: Record<string, string> = {
  accessible: "reachable",
  limited_access: "limited access",
  not_accessible: "no access",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * What the event happened to, for the title.
 *
 * Every entry used to read as its bare action -- eleven rows of "Area
 * confirmed" told a reviewer that eleven areas had been confirmed and
 * nothing about which, so the trail could not be checked against the
 * inspection. The subject is the difference between a log and a record.
 */
function subjectFor(event: SnaggingAuditEvent): string | null {
  const p = event.payload ?? {};

  if (event.entity_type === "area") return text(p.area_name);

  if (event.event_type === "checklist_not_checked") {
    return text(p.label) ?? text(p.code);
  }

  if (event.event_type.startsWith("snag_")) {
    return text(p.snag_code) ?? text(p.code);
  }

  if (event.event_type === "floor_plan_added") return text(p.label);

  if (
    event.event_type === "round_created" ||
    event.event_type === "additional_visit_created" ||
    event.event_type.startsWith("catalogue_entry_")
  ) {
    return text(p.code);
  }

  return null;
}

/** A one-line human summary pulled from the event's payload, when useful. */
function detailFor(event: SnaggingAuditEvent): string | null {
  const p = event.payload ?? {};
  if (event.event_type === "report_delivered") {
    return [p.channel, p.recipient].filter(Boolean).join(" · ") || null;
  }
  if (event.event_type === "task_rejected") {
    return typeof p.category === "string"
      ? p.category.replace(/_/g, " ")
      : null;
  }
  if (event.event_type === "approval_escalated") {
    const waited = typeof p.waiting_hours === "number" ? `${p.waiting_hours}h waiting` : null;
    const sent = typeof p.notified === "number" && p.notified > 0
      ? `${p.notified} notified`
      : "nobody to notify";
    return [waited, sent].filter(Boolean).join(" · ") || null;
  }
  // FR-6.04 — a status change reads as the move it was, not just its name.
  if (typeof p.from_status === "string" && typeof p.to_status === "string") {
    return `${p.from_status.replace(/_/g, " ")} → ${p.to_status.replace(/_/g, " ")}`;
  }
  if (event.entity_type === "area") {
    // "Area access recorded" says nothing on its own -- recorded as what?
    const state = text(p.access_state);
    return state ? (ACCESS_WORDS[state] ?? state.replace(/_/g, " ")) : null;
  }
  if (event.event_type === "checklist_not_checked") {
    return text(p.group_name);
  }
  if (event.event_type.startsWith("snag_")) {
    return (
      [text(p.severity), text(p.catalogue_code)].filter(Boolean).join(" · ") ||
      null
    );
  }
  return null;
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dubai",
  });
}

/**
 * The inspection's audit trail (BR-5): who did what, when. Read-only.
 */
export function AuditTimeline({ taskId }: { taskId: string }) {
  const [events, setEvents] = useState<SnaggingAuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Paged on the server: the trail is unbounded, so the alternative was a
  // hard limit that silently dropped the older half of a busy job.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [order, setOrder] = useState<"desc" | "asc">("desc");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await snaggingService.getAudit(taskId, {
        page,
        pageSize,
        order,
      });
      setEvents(result.data);
      setTotal(result.totalCount);
    } catch (e) {
      // A reviewer signing off has to tell "nothing happened yet" from
      // "the trail did not load" — this used to render as no card at all.
      setError(e instanceof Error ? e.message : "Could not load the history");
    } finally {
      setLoading(false);
    }
  }, [taskId, page, pageSize, order]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SectionCard
      title="History"
      icon={<History />}
      description="Every recorded action on this inspection"
      bodyClassName="border-t"
      action={
        <div className="flex items-center gap-1.5">
          {/* <span className="text-muted-foreground text-xs">Sort</span> */}
          <Select
            value={order}
            onValueChange={(value) => {
              setOrder(value as "desc" | "asc");
              // A different order makes page four a different four rows.
              setPage(0);
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-[130px]"
              aria-label="Sort history"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Newest first</SelectItem>
              <SelectItem value="asc">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    >
      {/* Only the alert needs the card's padding; the skeleton and the
          empty panel carry their own. */}
      <div className={error ? "p-5" : undefined}>
        <DataState
          loading={loading}
          error={error}
          onRetry={() => void load()}
          retrying={loading}
          errorTitle="Could not load the history"
          isEmpty={events.length === 0}
          skeleton={<ListSkeleton rows={4} />}
          empty={
            <EmptyState
              icon={<History className="size-6" />}
              title="Nothing recorded yet"
              description="Status changes, snag edits, approvals, rejections and deliveries appear here as they happen."
            />
          }
        >
          <ol className="divide-y">
            {events.map((event) => {
              const { label, Icon } = metaFor(event.event_type);
              const subject = subjectFor(event);
              const detail = detailFor(event);
              return (
                <li key={event.id}>
                  <DataRow
                    icon={<Icon aria-hidden />}
                    // The subject is part of the headline, not a footnote:
                    // it is what a reviewer scans the column for.
                    title={subject ? `${label} · ${subject}` : label}
                    subtitle={
                      <>
                        {event.actor_label ?? "System"}
                        {detail ? <span> · {detail}</span> : null}
                        {event.justification ? (
                          <span className="text-foreground/80">
                            {" "}
                            — “{event.justification}”
                          </span>
                        ) : null}
                      </>
                    }
                    trailing={
                      <span className="text-muted-foreground text-xs">
                        {formatWhen(event.created_at)}
                      </span>
                    }
                  />
                </li>
              );
            })}
          </ol>
        </DataState>

        {!loading && !error && events.length > 0 ? (
          <ListPager
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            noun="entries"
            className="border-t"
          />
        ) : null}
      </div>
    </SectionCard>
  );
}
