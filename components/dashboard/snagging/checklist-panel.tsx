"use client";

import { CheckCircle2, Circle, MinusCircle, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { SnaggingChecklistItem, SnaggingTask } from "@/types/types";

import { SectionCard } from "./shared";

/**
 * The job checklist and its progress (N6). Read-only here — the inspector
 * answers each item on the mobile app; this shows the office how far the
 * mandatory list has been worked through.
 */
export function ChecklistPanel({ task }: { task: SnaggingTask }) {
  const items = task.checklist ?? [];
  if (items.length === 0) return null;

  const answered = items.filter((i) => i.status !== "pending").length;
  const mandatory = items.filter((i) => i.mandatory);
  const mandatoryDone = mandatory.filter((i) => i.status !== "pending").length;

  const groups = new Map<string, SnaggingChecklistItem[]>();
  for (const item of items) {
    const list = groups.get(item.group_name) ?? [];
    list.push(item);
    groups.set(item.group_name, list);
  }

  return (
    <SectionCard
      title="Inspection checklist"
      description={`${answered}/${items.length} answered · ${mandatoryDone}/${mandatory.length} mandatory`}
      bodyClassName="border-t"
    >
      <div className="divide-y">
        {[...groups.entries()].map(([group, list]) => (
          <div key={group} className="px-5 py-3">
            <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
              {group}
            </p>
            <ul className="space-y-1.5">
              {list.map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-sm">
                  <StatusIcon status={item.status} />
                  <span className="min-w-0 flex-1">
                    {item.label}
                    {item.mandatory ? <span className="text-destructive"> *</span> : null}
                    {item.status === "not_checked" && item.reason ? (
                      <span className="text-muted-foreground"> — {item.reason}</span>
                    ) : null}
                  </span>
                  <StatusBadge status={item.status} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function StatusIcon({ status }: { status: SnaggingChecklistItem["status"] }) {
  if (status === "passed") return <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" />;
  if (status === "failed") return <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />;
  if (status === "not_checked") return <MinusCircle className="text-warning mt-0.5 size-4 shrink-0" />;
  return <Circle className="text-muted-foreground mt-0.5 size-4 shrink-0" />;
}

function StatusBadge({ status }: { status: SnaggingChecklistItem["status"] }) {
  const map = {
    passed: { label: "Passed", cls: "bg-success/10 text-success" },
    failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
    not_checked: { label: "Not checked", cls: "bg-warning/10 text-warning" },
    pending: { label: "Pending", cls: "bg-muted text-muted-foreground" },
  }[status];
  return (
    <Badge variant="secondary" className={`shrink-0 border-0 ${map.cls}`}>
      {map.label}
    </Badge>
  );
}
