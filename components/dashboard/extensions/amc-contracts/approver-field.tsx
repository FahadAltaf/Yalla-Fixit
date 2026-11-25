"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { amcContractsService } from "@/modules/amc-contracts/amc-contracts-service";

/**
 * Who approves a site visit, said rather than picked (24 Nov 2026, the
 * user: "we already define it in AMC configuration"). The approvers named
 * in AMC configuration decide every site visit: the level 1 approvers, else
 * the next level named, else the AMC approvers (all levels). This says who
 * that is now, what they do and when, so nobody wonders who to ask.
 */
export function SiteVisitApproversNote() {
  const [who, setWho] = useState<{ names: string[]; from: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stale = false;
    amcContractsService.siteVisitApprovers().then(
      (d) => !stale && setWho(d),
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, []);
  const names = who?.names ?? [];
  return (
    <div className="bg-muted/40 grid gap-1 rounded-lg border px-3 py-2.5">
      <p className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck className="text-brand size-4 shrink-0" aria-hidden />
        {who === null && !failed
          ? "Approved by the site visit approvers…"
          : names.length
            ? `Approved by ${names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(names.length === 2 ? " or " : ", ")}`
            : "Approved by the approvers set in AMC configuration"}
      </p>
      <p className="text-muted-foreground text-xs">
        {who?.from && names.length ? `The ${who.from} in AMC configuration. ` : "Set in AMC configuration (Settings), not here. "}
        When the inspector completes the visit on the app, they are told. Any one of them checks what was recorded, then approves it (the scope and
        assets recorded on site go onto the property) or sends it back to the inspector with a reason.
      </p>
    </div>
  );
}
