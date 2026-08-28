"use client";

import {
  CheckCircle2,
  Circle,
  ClipboardList,
  MinusCircle,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { SnaggingChecklistItem, SnaggingTask } from "@/types/types";

import { SectionCard, StatCard, StatCardGrid, SubHeading } from "./shared";

/**
 * The job checklist and its progress (N6). Read-only here — the
 * inspector answers each item on the mobile app; this shows the office
 * how far the mandatory list has been worked through.
 *
 * Progress leads, because that is the question a reviewer opens this tab
 * with. The list underneath answers the follow-up: which ones, and what
 * did they say.
 */
export function ChecklistPanel({ task }: { task: SnaggingTask }) {
  const items = task.checklist ?? [];

  const answered = items.filter((item) => item.status !== "pending").length;
  const mandatory = items.filter((item) => item.mandatory);
  const mandatoryDone = mandatory.filter(
    (item) => item.status !== "pending",
  ).length;
  const failed = items.filter((item) => item.status === "failed").length;

  const groups = new Map<string, SnaggingChecklistItem[]>();
  for (const item of items) {
    const list = groups.get(item.group_name) ?? [];
    list.push(item);
    groups.set(item.group_name, list);
  }

  return (
    <SectionCard
      title="Inspection checklist"
      icon={<ClipboardList />}
      description="The mandatory list the inspector works through on site."
      bodyClassName="border-t"
    >
      {items.length === 0 ? (
        // Used to render nothing at all, which reads as a broken tab
        // rather than as a job that has no checklist attached.
        <div className="p-5">
          <EmptyState
            icon={<ClipboardList />}
            title="No checklist on this job"
            description="A checklist is attached when the job is set up. Nothing was attached to this one, so there is nothing for the inspector to answer."
          />
        </div>
      ) : (
        <>
          {/*
            The same stat card as every other page. A checklist tab is not
            a reason to invent a fourth way of drawing a number.
          */}
          <div className="border-b p-5">
            <StatCardGrid columns={3}>
              <StatCard
                label="Answered"
                value={`${answered} / ${items.length}`}
                headline={
                  answered === items.length
                    ? "Complete"
                    : "Still working through"
                }
                caption={`${percent(answered, items.length)}% of the list`}
                tone={answered === items.length ? "good" : "progress"}
              />
              <StatCard
                label="Mandatory"
                value={`${mandatoryDone} / ${mandatory.length}`}
                headline={
                  mandatory.length === 0
                    ? "None marked mandatory"
                    : mandatoryDone === mandatory.length
                      ? "All answered"
                      : "Must be answered before sign-off"
                }
                caption={`${percent(mandatoryDone, mandatory.length)}% of the mandatory items`}
                tone={
                  mandatory.length && mandatoryDone < mandatory.length
                    ? "bad"
                    : "good"
                }
              />
              <StatCard
                label="Failed"
                value={failed}
                headline={failed === 0 ? "Nothing failed" : "Raised as defects"}
                caption="Items the inspector marked as failing"
                tone={failed > 0 ? "bad" : "good"}
              />
            </StatCardGrid>
          </div>

          <div className="divide-y">
            {[...groups.entries()].map(([group, list]) => (
              <div key={group} className="px-5 py-4">
                <SubHeading count={list.length} className="mb-2">
                  {group}
                </SubHeading>
                <ul className="divide-y">
                  {list.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start gap-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1">
                        {item.label}
                        {item.mandatory ? (
                          <span className="text-danger" title="Mandatory">
                            {" "}
                            *
                          </span>
                        ) : null}
                        {item.status === "not_checked" && item.reason ? (
                          <span className="text-muted-foreground block text-xs">
                            Not checked — {item.reason}
                          </span>
                        ) : null}
                      </span>
                      <StatusPill status={item.status} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {mandatory.length > 0 ? (
            <p className="text-muted-foreground border-t px-5 py-3 text-xs">
              Items marked <span className="text-danger">*</span> are mandatory
              and must be answered before the inspection can be signed off.
            </p>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

const STATUS = {
  passed: {
    label: "Passed",
    icon: CheckCircle2,
    cls: "bg-success/10 text-success",
  },
  failed: { label: "Failed", icon: XCircle, cls: "bg-danger/10 text-danger" },
  not_checked: {
    label: "Not checked",
    icon: MinusCircle,
    cls: "bg-warning/10 text-warning",
  },
  pending: {
    label: "Pending",
    icon: Circle,
    cls: "bg-muted text-muted-foreground",
  },
} as const;

/** A whole-number percentage, and 100 rather than NaN for an empty list. */
function percent(part: number, whole: number): number {
  return whole === 0 ? 100 : Math.round((part / whole) * 100);
}

/**
 * One soft-tinted pill carrying the icon and the word together.
 *
 * There used to be a coloured icon on the left of the row and a
 * separate pill on the right saying the same thing — the same fact
 * twice, at opposite ends of a line.
 */
function StatusPill({ status }: { status: SnaggingChecklistItem["status"] }) {
  const { label, icon: Icon, cls } = STATUS[status];
  return (
    <Badge
      variant="secondary"
      className={cn("shrink-0 gap-1 border-0 font-medium", cls)}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </Badge>
  );
}
