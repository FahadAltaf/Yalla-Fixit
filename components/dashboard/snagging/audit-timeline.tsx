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
import { DataRow, DataState, ListSkeleton, SectionCard } from "./shared";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingAuditEvent } from "@/types/types";

/** Human-readable label + icon for each audited event type (BR-5). */
const EVENT_META: Record<string, { label: string; Icon: LucideIcon }> = {
  // Status changes, in the order the workflow walks them.
  task_in_progress: { label: "Inspection started on site", Icon: PlayCircle },
  task_submitted: { label: "Submitted for review", Icon: Send },
  task_in_review: { label: "Review started", Icon: ClipboardCheck },
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
  if (
    event.event_type === "round_created" ||
    event.event_type === "additional_visit_created"
  ) {
    return typeof p.code === "string" ? p.code : null;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents(await snaggingService.getAudit(taskId));
    } catch (e) {
      // A reviewer signing off has to tell "nothing happened yet" from
      // "the trail did not load" — this used to render as no card at all.
      setError(e instanceof Error ? e.message : "Could not load the history");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SectionCard
      title="History"
      icon={<History />}
      description="Every recorded action on this inspection"
      bodyClassName="border-t"
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
              const detail = detailFor(event);
              return (
                <li key={event.id}>
                  <DataRow
                    icon={<Icon aria-hidden />}
                    title={label}
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
      </div>
    </SectionCard>
  );
}
