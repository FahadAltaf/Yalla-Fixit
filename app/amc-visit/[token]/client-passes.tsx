"use client";

import { useRef, useState } from "react";
import { FileUp, KeyRound, Plus, Trash2, X } from "lucide-react";

import { DatePickerField } from "@/components/dashboard/extensions/amc/components/date-picker-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ACCESS_TYPES, ACCESS_TYPE_LABELS } from "@/lib/amc/client-profile";
import { cn } from "@/lib/utils";

/*
  The client's passes and the building's access rules on a visit's pass
  link (27 Nov 2026): several passes, each with what it is and until when
  it is valid, and the rules the building has (who issues the pass, how
  many days ahead, which days and hours). Sent one file at a time.
*/

export type AccessType = (typeof ACCESS_TYPES)[number];
export type PassDraft = { key: string; file: File | null; accessType: AccessType; label: string; validUntil: string };
export type RuleDraft = {
  key: string;
  accessType: AccessType;
  issuer: string;
  leadTimeDays: string;
  permittedDays: number[];
  permittedFrom: string;
  permittedTo: string;
  contactName: string;
  contactPhone: string;
  notes: string;
};
export type ExistingRule = { type: string; label: string; issuer: string | null; leadTimeDays: number };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
let seq = 0;
const key = () => `k${Date.now().toString(36)}${(seq += 1)}`;

export const newPass = (type: AccessType = "community_gate_pass"): PassDraft => ({ key: key(), file: null, accessType: type, label: "", validUntil: "" });
export const newRule = (): RuleDraft => ({
  key: key(),
  accessType: "community_gate_pass",
  issuer: "",
  leadTimeDays: "",
  permittedDays: [],
  permittedFrom: "",
  permittedTo: "",
  contactName: "",
  contactPhone: "",
  notes: "",
});

/** A rule as the API takes it (accessRuleSchema). */
export function ruleBody(r: RuleDraft) {
  const blank = (v: string) => (v.trim() ? v.trim() : null);
  return {
    accessType: r.accessType,
    issuer: blank(r.issuer),
    leadTimeDays: Math.max(0, Math.min(90, Number.parseInt(r.leadTimeDays || "0", 10) || 0)),
    permittedDays: [...r.permittedDays].sort(),
    permittedFrom: blank(r.permittedFrom),
    permittedTo: blank(r.permittedTo),
    parking: null,
    contactName: blank(r.contactName),
    contactPhone: blank(r.contactPhone),
    notes: blank(r.notes),
  };
}

/** What stops a send: a pass without its file or name, a time half given. Null when fine. */
export function passesProblem(passes: PassDraft[], rules: RuleDraft[]): string | null {
  const used = passes.filter((p) => p.file);
  if (passes.some((p) => !p.file && (p.label.trim() || p.validUntil))) return "Choose the file for each pass, or remove the empty one.";
  if (!used.length && !rules.length) return "Add a pass, or the building's access rules.";
  if (used.some((p) => p.accessType === "other" && !p.label.trim())) return "Say what each \"Other\" pass is.";
  if (rules.some((r) => Boolean(r.permittedFrom) !== Boolean(r.permittedTo))) return "Give both times for a rule's hours, or neither.";
  return null;
}

function TypeSelect({ id, value, onChange }: { id: string; value: AccessType; onChange: (v: AccessType) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AccessType)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ACCESS_TYPES.map((t) => (
          <SelectItem key={t} value={t}>
            {ACCESS_TYPE_LABELS[t]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One pass: its file, what it is, until when. */
function PassCard({ pass, index, minDate, canRemove, onChange, onRemove }: { pass: PassDraft; index: number; minDate: string; canRemove: boolean; onChange: (p: PassDraft) => void; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const fileId = `pass-file-${pass.key}`;
  return (
    <div className="bg-muted/30 grid gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Pass {index + 1}</p>
        {canRemove ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove pass ${index + 1}`}>
            <Trash2 className="size-4" />
            Remove
          </Button>
        ) : null}
      </div>
      <label
        htmlFor={fileId}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) onChange({ ...pass, file: dropped });
        }}
        className={cn(
          "bg-card flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition-colors",
          over ? "border-brand bg-brand/5" : "hover:bg-muted/40",
        )}
      >
        <FileUp className="text-muted-foreground size-5" />
        {pass.file ? (
          <span className="font-medium break-all">{pass.file.name}</span>
        ) : (
          <>
            <span className="font-medium">Choose a file, or drop it here</span>
            <span className="text-muted-foreground text-xs">PDF or a photo (JPG, PNG, WebP)</span>
          </>
        )}
      </label>
      <input ref={input} id={fileId} type="file" className="sr-only" accept={ACCEPT} onChange={(e) => onChange({ ...pass, file: e.target.files?.[0] ?? null })} />
      {pass.file ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => {
            onChange({ ...pass, file: null });
            if (input.current) input.current.value = "";
          }}
        >
          <X className="size-4" />
          Remove the file
        </Button>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`pass-type-${pass.key}`}>What it is</Label>
          <TypeSelect id={`pass-type-${pass.key}`} value={pass.accessType} onChange={(accessType) => onChange({ ...pass, accessType })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`pass-until-${pass.key}`}>
            Valid until <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <DatePickerField id={`pass-until-${pass.key}`} value={pass.validUntil} minDate={minDate} placeholder="Pick the end date" onChange={(validUntil) => onChange({ ...pass, validUntil })} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`pass-label-${pass.key}`}>
          Name of the pass {pass.accessType === "other" ? null : <span className="text-muted-foreground font-normal">(optional)</span>}
        </Label>
        <Input
          id={`pass-label-${pass.key}`}
          value={pass.label}
          maxLength={120}
          placeholder={pass.accessType === "other" ? "For example: Parking permit" : "For example: Emaar community gate pass"}
          onChange={(e) => onChange({ ...pass, label: e.target.value })}
        />
      </div>
    </div>
  );
}

/** One rule the building has. */
function RuleCard({ rule, index, onChange, onRemove }: { rule: RuleDraft; index: number; onChange: (r: RuleDraft) => void; onRemove: () => void }) {
  const id = (f: string) => `rule-${f}-${rule.key}`;
  return (
    <div className="bg-muted/30 grid gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Rule {index + 1}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove rule ${index + 1}`}>
          <Trash2 className="size-4" />
          Remove
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={id("type")}>What the building needs</Label>
          <TypeSelect id={id("type")} value={rule.accessType} onChange={(accessType) => onChange({ ...rule, accessType })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id("issuer")}>
            Who issues it <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input id={id("issuer")} value={rule.issuer} maxLength={200} placeholder="For example: Emaar community office" onChange={(e) => onChange({ ...rule, issuer: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id("lead")}>
            Days ahead to apply <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input id={id("lead")} type="number" inputMode="numeric" min={0} max={90} value={rule.leadTimeDays} placeholder="0" onChange={(e) => onChange({ ...rule, leadTimeDays: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label>
            Hours allowed <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <div className="flex items-center gap-2">
            <Input aria-label="From" type="time" value={rule.permittedFrom} onChange={(e) => onChange({ ...rule, permittedFrom: e.target.value })} />
            <span className="text-muted-foreground text-sm">to</span>
            <Input aria-label="To" type="time" value={rule.permittedTo} onChange={(e) => onChange({ ...rule, permittedTo: e.target.value })} />
          </div>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>
          Days allowed <span className="text-muted-foreground font-normal">(leave all off for any day)</span>
        </Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days allowed">
          {DAYS.map((d, i) => {
            const on = rule.permittedDays.includes(i);
            return (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                aria-pressed={on}
                onClick={() => onChange({ ...rule, permittedDays: on ? rule.permittedDays.filter((x) => x !== i) : [...rule.permittedDays, i] })}
              >
                {d}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={id("contact")}>
            Contact person <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input id={id("contact")} value={rule.contactName} maxLength={200} placeholder="Security office or building manager" onChange={(e) => onChange({ ...rule, contactName: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id("phone")}>
            Their phone <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input id={id("phone")} type="tel" value={rule.contactPhone} maxLength={40} placeholder="+971 …" onChange={(e) => onChange({ ...rule, contactPhone: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id("notes")}>
          Anything else <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea id={id("notes")} rows={2} maxLength={1500} value={rule.notes} placeholder="For example: the crew shows Emirates ID at the gate" onChange={(e) => onChange({ ...rule, notes: e.target.value })} />
      </div>
    </div>
  );
}

/** The passes and the rules, as one section of the page. */
export function PassesSection({
  passes,
  rules,
  existing,
  minDate,
  onPasses,
  onRules,
}: {
  passes: PassDraft[];
  rules: RuleDraft[];
  existing: ExistingRule[];
  minDate: string;
  onPasses: (p: PassDraft[]) => void;
  onRules: (r: RuleDraft[]) => void;
}) {
  return (
    <div className="grid gap-6">
      <section className="grid gap-3" aria-label="Passes">
        <div>
          <p className="font-semibold">Your passes and permits</p>
          <p className="text-muted-foreground text-sm">Add each one with what it is and until when it is valid.</p>
        </div>
        {passes.map((p, i) => (
          <PassCard
            key={p.key}
            pass={p}
            index={i}
            minDate={minDate}
            canRemove={passes.length > 1}
            onChange={(next) => onPasses(passes.map((x) => (x.key === p.key ? next : x)))}
            onRemove={() => onPasses(passes.filter((x) => x.key !== p.key))}
          />
        ))}
        {passes.length < 10 ? (
          <Button type="button" variant="outline" className="justify-self-start" onClick={() => onPasses([...passes, newPass(passes.at(-1)?.accessType)])}>
            <Plus className="size-4" />
            Add another pass
          </Button>
        ) : null}
      </section>

      <section className="grid gap-3" aria-label="Access rules">
        <div>
          <p className="flex items-center gap-2 font-semibold">
            <KeyRound className="text-muted-foreground size-4" />
            What your building needs <span className="text-muted-foreground text-sm font-normal">(optional)</span>
          </p>
          <p className="text-muted-foreground text-sm">Tell us the building&apos;s rules for getting in, so we can arrange them for every visit.</p>
        </div>
        {existing.length ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">We already have:</span>
            {existing.map((r, i) => (
              <Badge key={`${r.type}-${i}`} variant="outline" className="font-normal">
                {r.label}
                {r.issuer ? ` (${r.issuer})` : ""}
                {r.leadTimeDays ? `, ${r.leadTimeDays} days ahead` : ""}
              </Badge>
            ))}
          </div>
        ) : null}
        {rules.map((r, i) => (
          <RuleCard key={r.key} rule={r} index={i} onChange={(next) => onRules(rules.map((x) => (x.key === r.key ? next : x)))} onRemove={() => onRules(rules.filter((x) => x.key !== r.key))} />
        ))}
        {rules.length < 10 ? (
          <Button type="button" variant="outline" className="justify-self-start" onClick={() => onRules([...rules, newRule()])}>
            <Plus className="size-4" />
            {rules.length ? "Add another rule" : "Add an access rule"}
          </Button>
        ) : null}
      </section>
    </div>
  );
}
