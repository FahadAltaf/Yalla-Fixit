"use client";

import { useEffect, useState } from "react";

import { amcContractsService } from "@/modules/amc-contracts/amc-contracts-service";

import { PersonSelect } from "./enquiries/enquiry-ui";

type Person = { id: string; name: string; email: string | null };

/**
 * Who approves a site visit (16 Nov 2026): someone whose role can approve
 * in AMC. Once the inspector completes the visit on the mobile app, only
 * this person can approve it (the scope and asset changes made on site then
 * go onto the property) or send it back. The list is read once and kept
 * (it rarely changes); `me` is chosen first when they are in it.
 */
export function ApproverSelect({
  value,
  onChange,
  me,
  disabled = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  /** The signed-in user, chosen when nothing is and they can approve. */
  me?: string | null;
  disabled?: boolean;
}) {
  const [approvers, setApprovers] = useState<Person[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    amcContractsService.siteVisitApprovers().then(
      ({ approvers: list }) => {
        if (stale) return;
        setApprovers(list);
        if (!value && me && list.some((p) => p.id === me)) onChange(me);
      },
      (e: unknown) => !stale && setFailed(e instanceof Error ? e.message : "Could not load the approvers."),
    );
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once when the field opens; the default is only a first choice
  }, []);
  if (failed) return <p className="text-destructive text-sm">{failed}</p>;
  return (
    <div className={disabled ? "pointer-events-none opacity-60" : undefined}>
      <PersonSelect
        label="Approver"
        people={approvers ?? []}
        value={value}
        onChange={onChange}
        placeholder={approvers === null ? "Loading the approvers…" : approvers.length ? "Choose who approves the visit" : "Nobody can approve in AMC yet"}
      />
    </div>
  );
}
