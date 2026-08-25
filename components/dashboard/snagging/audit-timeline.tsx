"use client";

import { useEffect, useState } from "react";
import {
  CalendarPlus,
  CheckCircle2,
  FileImage,
  FileText,
  History,
  RotateCcw,
  Tag,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { SectionCard } from "./shared";
import { snaggingService } from "@/modules/snagging";
import type { SnaggingAuditEvent } from "@/types/types";

/** Human-readable label + icon for each audited event type (BR-5). */
const EVENT_META: Record<string, { label: string; Icon: LucideIcon }> = {
  task_approved: { label: "Inspection approved", Icon: CheckCircle2 },
  task_rejected: { label: "Sent back for correction", Icon: XCircle },
  report_delivered: { label: "Report delivered", Icon: FileText },
  round_created: { label: "De-snag round opened", Icon: RotateCcw },
  additional_visit_created: { label: "Additional visit scheduled", Icon: CalendarPlus },
  floor_plan_added: { label: "Floor plan added", Icon: FileImage },
  catalogue_entry_created: { label: "Catalogue entry created", Icon: Tag },
  catalogue_entry_updated: { label: "Catalogue entry updated", Icon: Tag },
  catalogue_entry_retired: { label: "Catalogue entry retired", Icon: Tag },
  catalogue_entry_reactivated: { label: "Catalogue entry reactivated", Icon: Tag },
  quotation_generated: { label: "Quotation generated", Icon: FileText },
  quotation_regenerated: { label: "Quotation regenerated", Icon: FileText },
  quotation_sent: { label: "Quotation sent to client", Icon: FileText },
  quotation_approved: { label: "Quotation approved", Icon: CheckCircle2 },
  quotation_rejected: { label: "Quotation rejected", Icon: XCircle },
};

function metaFor(eventType: string) {
  return EVENT_META[eventType] ?? { label: eventType.replace(/_/g, " "), Icon: History };
}

/** A one-line human summary pulled from the event's payload, when useful. */
function detailFor(event: SnaggingAuditEvent): string | null {
  const p = event.payload ?? {};
  if (event.event_type === "report_delivered") {
    return [p.channel, p.recipient].filter(Boolean).join(" · ") || null;
  }
  if (event.event_type === "task_rejected") {
    return typeof p.category === "string" ? p.category.replace(/_/g, " ") : null;
  }
  if (event.event_type === "round_created" || event.event_type === "additional_visit_created") {
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

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await snaggingService.getAudit(taskId);
        if (active) setEvents(data);
      } catch {
        // A missing trail should never break the job view.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [taskId]);

  if (!loading && events.length === 0) return null;

  return (
    <SectionCard
      title="History"
      description="Every recorded action on this inspection"
      bodyClassName="border-t"
    >
      <ol className="divide-y">
        {events.map((event) => {
          const { label, Icon } = metaFor(event.event_type);
          const detail = detailFor(event);
          return (
            <li key={event.id} className="flex items-start gap-3 px-5 py-3">
              <span className="bg-muted text-muted-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">{label}</span>
                  <span className="text-muted-foreground text-xs">{formatWhen(event.created_at)}</span>
                </div>
                <div className="text-muted-foreground text-sm">
                  {event.actor_label ?? "System"}
                  {detail ? <span> · {detail}</span> : null}
                  {event.justification ? (
                    <span className="text-foreground/80"> — “{event.justification}”</span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}
