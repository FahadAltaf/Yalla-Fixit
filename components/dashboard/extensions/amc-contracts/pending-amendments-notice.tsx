"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, FilePen, Wand2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AMENDMENT_LABELS } from "@/lib/amc/amendments";
import { amcSelfApprovalOn } from "@/lib/amc/workflow";
import { renewalsService } from "@/modules/amc-contracts/renewals-service";

import { formatContractDate, formatDateTime } from "./contract-status";
import { useAmcData } from "./use-amc-data";

/**
 * An amendment that needs something, shown above the contract's tabs
 * (24 Nov 2026, the user): one waiting for approval says who asked, why and
 * who decides; one approved says it changes the contract only when applied.
 * Each opens the Amendments tab. Read again when that tab is left, so a
 * decision made there shows here.
 */
export function PendingAmendmentsNotice({ contractId, tab, onOpen }: { contractId: string; tab: string; onOpen: () => void }) {
  const { data, reload } = useAmcData(() => renewalsService.amendments(contractId), `amendments:${contractId}`);
  const wasOnTab = useRef(tab === "amendments");
  useEffect(() => {
    if (wasOnTab.current && tab !== "amendments") reload();
    wasOnTab.current = tab === "amendments";
  }, [tab, reload]);

  const open = (data?.amendments ?? []).filter((a) => a.status === "requested" || a.status === "approved");
  if (!open.length) return null;
  const onTab = tab === "amendments";

  return (
    <div className="grid gap-3">
      {open.map((a) => {
        const label = AMENDMENT_LABELS[a.kind] ?? a.kind;
        const own = Boolean(a.requestedBy) && a.requestedBy === data?.userId;
        const canDecide = a.status === "requested" && Boolean(data?.canApprove) && (!own || amcSelfApprovalOn());
        const destructive = a.kind === "early_termination" || a.kind === "cancellation";
        if (a.status === "requested") {
          return (
            <Alert key={a.id} variant={destructive ? "danger" : "warning"}>
              <FilePen />
              <AlertTitle>{canDecide ? `${label} waiting for your decision` : `${label} waiting for approval`}</AlertTitle>
              <AlertDescription>
                <p>
                  Asked for by {a.requestedByName ?? "someone"} on {formatDateTime(a.requestedAt)}
                  {a.effectiveOn ? `, to take effect ${formatContractDate(a.effectiveOn)}` : ""}: &ldquo;{a.reason.length > 160 ? `${a.reason.slice(0, 157)}…` : a.reason}&rdquo;
                </p>
                <p>
                  {a.deciders?.length
                    ? `${canDecide ? "You can approve or reject it" : `Waiting for ${a.deciders.join(", ")}`}. The contract does not change until it is approved and applied.`
                    : "Nobody can approve it yet: name an approver in AMC Settings or AMC Configuration."}
                </p>
                {onTab ? null : (
                  <Button size="sm" variant={canDecide ? "default" : "outline"} onClick={onOpen}>
                    {canDecide ? "Review and decide" : "Open amendments"}
                    <ArrowRight className="size-4" />
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          );
        }
        return (
          <Alert key={a.id} variant="warning">
            <Wand2 />
            <AlertTitle>{label} approved, not applied yet</AlertTitle>
            <AlertDescription>
              <p>
                Approved by {a.decidedByName ?? "an approver"}
                {a.decidedAt ? ` on ${formatDateTime(a.decidedAt)}` : ""}. It changes the contract only when someone applies it on the Amendments tab.
              </p>
              {onTab ? null : (
                <Button size="sm" variant="outline" onClick={onOpen}>
                  Open amendments
                  <ArrowRight className="size-4" />
                </Button>
              )}
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
