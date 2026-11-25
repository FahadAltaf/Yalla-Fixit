"use client";

import { useId, useState, type ReactNode } from "react";
import { CircleCheck, CircleMinus, ListChecks, Pencil, Plus, TriangleAlert, Trash2 } from "lucide-react";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { CollapseToggle } from "@/components/dashboard/extensions/amc/approval-checklist-card";
import { Badge } from "@/components/ui/badge";
import type { SiteVisitChecklist } from "@/lib/amc/site-visit-checklist";
import { cn } from "@/lib/utils";

/**
 * The approver's checklist on a site visit or an amendment (23 Nov 2026),
 * in the same card as a proposal's: what approving changes, then each
 * check, done, missing or worth a look.
 */

export interface ChecklistRow {
  key: string;
  label: string;
  state: "ok" | "missing" | "warn";
  detail: ReactNode;
}

const STATE_ICON = {
  ok: <CircleCheck className="text-success size-4" aria-label="Done" />,
  missing: <CircleMinus className="text-muted-foreground size-4" aria-label="Missing" />,
  warn: <TriangleAlert className="text-warning size-4" aria-label="Check" />,
} as const;

export function ApproverChecklistCard({
  title,
  description,
  changes,
  changesTitle,
  rows,
}: {
  title: string;
  description: string;
  /** What approving does, one line each; none: nothing to list. */
  changes?: Array<{ key: string; op: "insert" | "update" | "delete"; label: ReactNode; kind?: string }>;
  changesTitle?: string;
  rows: ChecklistRow[];
}) {
  const attention = rows.filter((r) => r.state !== "ok").length;
  /* Folded at first (24 Nov 2026, the user): the badge says enough until someone opens it. */
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <SectionCard
      icon={<ListChecks />}
      title={title}
      description={description}
      bodyClassName={open ? "border-t" : undefined}
      action={
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className={cn("border-0 font-medium", attention ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}>
            {attention ? `${attention} to look at` : "All in order"}
          </Badge>
          <CollapseToggle open={open} onToggle={() => setOpen((o) => !o)} controls={bodyId} />
        </div>
      }
    >
      {open ? (
      <div id={bodyId}>
      {changes ? (
        <div className="border-b px-5 py-4">
          <p className="mb-2 text-sm font-medium">{changesTitle ?? "What approving changes"}</p>
          {changes.length ? (
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {changes.map((c) => (
                <li key={c.key} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded",
                      c.op === "insert" ? "bg-success/10 text-success" : c.op === "delete" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning",
                    )}
                    aria-hidden
                  >
                    {c.op === "insert" ? <Plus className="size-3" /> : c.op === "delete" ? <Trash2 className="size-3" /> : <Pencil className="size-3" />}
                  </span>
                  <span className="min-w-0 truncate">
                    {c.kind ? <span className="text-muted-foreground">{c.kind}: </span> : null}
                    {c.label}
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">{c.op === "insert" ? "Added" : c.op === "delete" ? "Removed" : "Changed"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing on the property changes.</p>
          )}
        </div>
      ) : null}
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-3 px-5 py-3 text-sm">
            <span className="mt-0.5 shrink-0">{STATE_ICON[r.state]}</span>
            <span className="w-40 shrink-0 font-medium">{r.label}</span>
            <span className={cn("min-w-0 flex-1", r.state === "ok" ? "text-muted-foreground" : r.state === "warn" ? "text-warning" : "")}>{r.detail}</span>
          </li>
        ))}
      </ul>
      </div>
      ) : null}
    </SectionCard>
  );
}

/** A site visit's checklist in that card. */
export function SiteVisitChecklistCard({ checklist, canApprove }: { checklist: SiteVisitChecklist; canApprove: boolean }) {
  return (
    <ApproverChecklistCard
      title={canApprove ? "What to check before approving" : "What the approver checks"}
      description="What the site visit recorded (DEV-362). Its changes to the property are on the Scope and assets tab."
      /* No "What approving changes" list here (24 Nov 2026, the user): the Scope and assets tab shows each change beside what was. */
      rows={checklist.checks}
    />
  );
}

/** The checks alone, inside another card (an amendment waiting for approval). */
export function ChecklistRows({ title, rows }: { title: string; rows: ChecklistRow[] }) {
  const attention = rows.filter((r) => r.state !== "ok").length;
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <ListChecks className="size-4" />
          {title}
        </span>
        <Badge variant="secondary" className={cn("border-0 font-medium", attention ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}>
          {attention ? `${attention} to look at` : "All in order"}
        </Badge>
      </div>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-2.5 px-3 py-2 text-sm">
            <span className="mt-0.5 shrink-0">{STATE_ICON[r.state]}</span>
            <span className="w-32 shrink-0 font-medium">{r.label}</span>
            <span className={cn("min-w-0 flex-1", r.state === "ok" ? "text-muted-foreground" : r.state === "warn" ? "text-warning" : "")}>{r.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
