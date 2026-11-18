"use client";

import { useId } from "react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACCESS_TYPE_LABELS } from "@/lib/amc/client-profile";
import { ACCESS_STATUSES, ACCESS_STATUS_LABELS, defaultPassStatus, passStatus, type AccessStatus } from "@/lib/amc/visits";

import { ACCESS_TONE } from "./visit-status";

/*
  A pass's access type and status (17 Nov 2026): which of the property's
  access rules it is for, and where it stands. A pass for a rule starts
  approved, one for no rule starts pending; the coordinator can pick any
  status. Shared by a visit's Access tab, a site visit and the property's
  Passes card.
*/

export type PassRuleOption = { id: string; accessType: string; issuer: string | null };
export type PassType = { ruleId: string | null; status: AccessStatus; /** Picked by hand: a new access type no longer changes it. */ touched: boolean };

const NONE = "none";
export const accessTypeLabel = (type: string) => ACCESS_TYPE_LABELS[type as keyof typeof ACCESS_TYPE_LABELS] ?? type;
export const ruleLabel = (r: PassRuleOption) => (r.issuer ? `${accessTypeLabel(r.accessType)} · ${r.issuer}` : accessTypeLabel(r.accessType));

/** A new pass: for no rule, so pending, unless the property has one rule (then for that one). */
export const newPassType = (rules: PassRuleOption[]): PassType => {
  const ruleId = rules.length === 1 ? rules[0].id : null;
  return { ruleId, status: defaultPassStatus(ruleId), touched: false };
};

/** An existing pass as the fields show it. */
export const passTypeOf = (p: { accessRuleId: string | null; accessStatus: AccessStatus | null }): PassType => ({
  ruleId: p.accessRuleId,
  status: passStatus({ status: p.accessStatus }),
  touched: true,
});

export function PassTypeFields({ rules, value, onChange, disabled }: { rules: PassRuleOption[]; value: PassType; onChange: (next: PassType) => void; disabled?: boolean }) {
  const ids = { rule: useId(), status: useId() };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor={ids.rule}>Access type</Label>
        <Select
          value={value.ruleId ?? NONE}
          onValueChange={(next) => {
            const ruleId = next === NONE ? null : next;
            onChange({ ruleId, status: value.touched ? value.status : defaultPassStatus(ruleId), touched: value.touched });
          }}
          disabled={disabled}
        >
          <SelectTrigger id={ids.rule} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {rules.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {ruleLabel(r)}
              </SelectItem>
            ))}
            <SelectItem value={NONE}>Not for an access rule</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          {rules.length === 0 ? "The property has no access rules yet." : value.ruleId ? "For one of the property's rules: approved unless you pick otherwise." : "For no rule: it waits for approval."}
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.status}>Status</Label>
        <Select value={value.status} onValueChange={(next) => onChange({ ...value, status: next as AccessStatus, touched: true })} disabled={disabled}>
          <SelectTrigger id={ids.status} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACCESS_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ACCESS_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">Only an approved pass valid on the day lets the crew in.</p>
      </div>
    </div>
  );
}

/** The status and the rule it is for, beside a pass's name. */
export function PassTypeBadges({ pass, rules }: { pass: { accessRuleId: string | null; accessStatus: AccessStatus | null }; rules: PassRuleOption[] }) {
  const status = passStatus({ status: pass.accessStatus });
  const rule = pass.accessRuleId ? rules.find((r) => r.id === pass.accessRuleId) : null;
  return (
    <>
      <Badge variant="secondary" className={`border-0 font-medium ${ACCESS_TONE[status]}`}>
        {ACCESS_STATUS_LABELS[status]}
      </Badge>
      {rule ? (
        <Badge variant="outline" className="font-normal" title="The access rule this pass is for">
          {accessTypeLabel(rule.accessType)}
        </Badge>
      ) : null}
    </>
  );
}
