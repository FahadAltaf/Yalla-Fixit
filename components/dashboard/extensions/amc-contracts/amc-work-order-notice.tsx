"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { amcContractsService, type FsmWorkOrderContext } from "@/modules/amc-contracts/amc-contracts-service";

/**
 * On the scheduling board, under a chosen FSM work order: whether its
 * customer has an AMC and whether each service line is covered. Optional
 * and read-only: it never blocks scheduling, records nothing, and stays
 * silent for people without AMC access or customers without an AMC.
 */
export function AmcWorkOrderNotice({ workOrderId, date }: { workOrderId: string; date?: string }) {
  /* Kept with the work order it answers for, so a new choice never shows the old answer. */
  const [answer, setAnswer] = useState<{ key: string; context: FsmWorkOrderContext } | null>(null);
  const key = `${workOrderId}|${date ?? ""}`;

  useEffect(() => {
    let stale = false;
    amcContractsService.fsmContext(workOrderId, date).then(
      ({ context: next }) => !stale && setAnswer({ key: `${workOrderId}|${date ?? ""}`, context: next }),
      /* No AMC access, migration missing or FSM unreachable: say nothing. */
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [workOrderId, date]);

  const context = answer?.key === key ? answer.context : null;
  if (!context || context.status !== "checked") return null;
  const lines = context.lines.filter((l) => l.answer.status !== "no_amc");
  if (lines.length === 0) return null;

  return (
    <div className="border-brand/30 bg-brand-50 flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
      <ShieldCheck className="text-brand mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="space-y-0.5">
        <div className="text-brand font-medium">
          AMC client{lines[0].answer.proposalNumber ? ` · ${lines[0].answer.proposalNumber}` : ""}
          {context.links.length ? " · linked to the contract" : ""}
        </div>
        {lines.map((l) => (
          <div key={l.lineId}>
            {l.serviceName ?? l.lineName}:{" "}
            {l.answer.status === "service_unmapped"
              ? "service not mapped to the AMC"
              : l.answer.verdict
                ? `${l.answer.verdict.headline}${l.answer.coverage?.remaining !== null && l.answer.coverage?.remaining !== undefined ? ` (${l.answer.coverage.remaining} left)` : ""}`
                : l.answer.reason}
          </div>
        ))}
      </div>
    </div>
  );
}
