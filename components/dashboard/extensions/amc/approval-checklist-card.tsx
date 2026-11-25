"use client";

import { useId, useState } from "react";
import { ChevronDown, Info, ListChecks, TriangleAlert } from "lucide-react";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApprovalCheck } from "@/lib/amc/approval-checklist";
import { cn } from "@/lib/utils";

/**
 * What the approver checks on a proposal (23 Nov 2026): each rule it
 * crosses, what it asks for against what the rule allows, the level that
 * decides, and, for the rate card, every line and why. Rates changed within
 * the rules follow, for information. Before submitting, the owner sees the
 * same list as "what will need approval".
 */
export function ApprovalChecklistCard({ checks, waiting }: { checks: ApprovalCheck[]; waiting: boolean }) {
  /* Folded at first (24 Nov 2026, the user): the count says enough until someone opens it. */
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (!checks.length) return null;
  const needing = checks.filter((c) => c.level !== null);
  return (
    <SectionCard
      icon={<ListChecks />}
      title={waiting ? "What to check before approving" : "What will need approval"}
      description={
        needing.length
          ? `${needing.length} ${needing.length === 1 ? "rule is" : "rules are"} crossed. Each says what this proposal asks for, what the rule allows, and who approves it.`
          : "No rule is crossed. These changes are shown for information."
      }
      bodyClassName={open ? "border-t" : undefined}
      action={<CollapseToggle open={open} onToggle={() => setOpen((o) => !o)} controls={bodyId} />}
    >
      {open ? (
      <ul id={bodyId} className="divide-y">
        {checks.map((c) => {
          const info = c.level === null;
          return (
            <li key={c.key} className="px-5 py-4">
              <div className="flex flex-wrap items-start gap-2">
                {info ? <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden /> : <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.title}</p>
                  <dl className="mt-1.5 grid gap-1 text-sm sm:grid-cols-[7rem_1fr]">
                    <dt className="text-muted-foreground">This proposal</dt>
                    <dd>{c.asked}</dd>
                    <dt className="text-muted-foreground">The rule</dt>
                    <dd className="text-muted-foreground">{c.rule}</dd>
                  </dl>
                </div>
                <Badge
                  variant="secondary"
                  className={cn("shrink-0 border-0 font-medium", info ? "bg-muted text-muted-foreground" : "bg-warning/10 text-warning")}
                >
                  {info ? "For information" : `Needs ${c.levelName || `level ${c.level}`}`}
                </Badge>
              </div>
              {c.lines.length ? (
                <ul className="mt-3 grid gap-2 sm:ml-6">
                  {c.lines.map((l, i) => (
                    <li key={`${l.service}:${l.problem}:${i}`} className="rounded-lg border px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{l.service}</span>
                        <Badge variant="outline" className={cn("font-normal", info ? "" : "border-warning/40 text-warning")}>
                          {l.problem}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground mt-0.5">{l.detail}</p>
                      {l.reason ? (
                        <p className="mt-1">
                          <span className="text-muted-foreground">Reason given: </span>
                          {l.reason}
                          {l.by ? <span className="text-muted-foreground"> ({l.by})</span> : null}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      ) : null}
    </SectionCard>
  );
}

/** Show / Hide for a card that folds away (24 Nov 2026). */
export function CollapseToggle({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls?: string }) {
  return (
    <Button variant="outline" size="sm" onClick={onToggle} aria-expanded={open} aria-controls={controls}>
      {open ? "Hide details" : "Show details"}
      <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
    </Button>
  );
}
