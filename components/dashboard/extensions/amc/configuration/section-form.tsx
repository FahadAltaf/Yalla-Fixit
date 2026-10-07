"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MultipleSelector from "@/components/ui/multiselect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AMC_CONFIG_SECTION_LEVEL, validateAmcConfigSection, type AmcConfig } from "@/lib/amc/config";
import type { AmcConfigUser } from "@/modules/amc-platform/amc-platform-service";

import type { FieldDef, SectionDef } from "./config-fields";

type Value = Record<string, unknown>;

/**
 * One configuration section: its fields, Save and Reset to defaults.
 * Validated in the browser with the same schema the API applies, so a
 * mistake is shown beside the field before anything is sent.
 */
export function ConfigSectionForm({
  def,
  value,
  defaults,
  canEdit,
  migrated,
  users,
  onSave,
}: {
  def: SectionDef;
  value: AmcConfig[SectionDef["section"]];
  defaults: AmcConfig[SectionDef["section"]];
  canEdit: boolean;
  migrated: boolean;
  users: AmcConfigUser[];
  onSave: (value: Value) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Value>(value as Value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value as Value), [value]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const validation = useMemo(() => validateAmcConfigSection(def.section, draft), [def.section, draft]);
  /* "field: message" (or "field.2: message" for a list item) → which field shows it. */
  const fieldError = (key: string): string | null => {
    if (validation.ok) return null;
    const [where, ...rest] = validation.error.split(": ");
    return rest.length > 0 && where.split(".")[0] === key ? rest.join(": ") : null;
  };
  const editable = canEdit && migrated;
  const management = AMC_CONFIG_SECTION_LEVEL[def.section] === "management";

  const set = (key: string, next: unknown) => setDraft((d) => ({ ...d, [key]: next }));

  const save = async () => {
    if (!validation.ok) {
      toast.error(validation.error);
      return;
    }
    setSaving(true);
    try {
      await onSave(validation.value as Value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title={def.title}
      description={def.description}
      bodyClassName="px-5 pb-5"
      action={
        !canEdit ? (
          <Badge variant="outline">{management ? "Management only" : "View only"}</Badge>
        ) : null
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {def.fields.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={draft[field.key]}
            onChange={(next) => set(field.key, next)}
            disabled={!editable}
            users={users}
            error={fieldError(field.key)}
          />
        ))}
      </div>
      {editable ? (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving || JSON.stringify(draft) === JSON.stringify(defaults)}
            onClick={() => setDraft(defaults as Value)}
          >
            <RotateCcw className="size-4" />
            Reset to defaults
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!dirty || saving} onClick={() => setDraft(value as Value)}>
            Discard changes
          </Button>
          <SubmitButton size="sm" pending={saving} pendingLabel="Saving…" icon={<Save className="size-4" />} disabled={!dirty} onClick={() => void save()}>
            Save {def.title.toLowerCase()}
          </SubmitButton>
        </div>
      ) : null}
    </SectionCard>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  disabled,
  users,
  error,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled: boolean;
  users: AmcConfigUser[];
  error: string | null;
}) {
  const id = `amc-config-${field.key}`;
  const wide = field.kind === "users" || field.kind === "list" || field.kind === "holidays" || field.kind === "multi";
  return (
    <div className={wide ? "space-y-1.5 sm:col-span-2 xl:col-span-3" : "space-y-1.5"}>
      {field.kind === "boolean" ? (
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
          <Label htmlFor={id} className="font-normal">{field.label}</Label>
          <Switch id={id} checked={value === true} onCheckedChange={(c) => onChange(c)} disabled={disabled} />
        </div>
      ) : (
        <Label htmlFor={id}>{field.label}</Label>
      )}

      {field.kind === "number" ? (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={value === null || value === undefined ? "" : String(value)}
            placeholder={field.nullable ? "Not used" : undefined}
            disabled={disabled}
            aria-invalid={!!error}
            onChange={(e) => {
              const raw = e.target.value;
              onChange(raw === "" ? (field.nullable ? null : raw) : Number(raw));
            }}
          />
          {field.unit ? <span className="text-muted-foreground shrink-0 text-sm">{field.unit}</span> : null}
        </div>
      ) : null}

      {field.kind === "text" ? (
        <Input id={id} value={String(value ?? "")} disabled={disabled} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      ) : null}

      {field.kind === "select" ? (
        <Select
          value={value === null || value === undefined ? undefined : String(value)}
          onValueChange={(v) => onChange(field.numeric ? Number(v) : v)}
          disabled={disabled}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {field.kind === "multi" ? (
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={id}>
          {field.options.map((o) => {
            const list = (Array.isArray(value) ? value : []) as Array<string | number>;
            const v = field.numeric ? Number(o.value) : o.value;
            const checked = list.includes(v);
            return (
              <label
                key={o.value}
                className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(c) => onChange(c ? [...list, v] : list.filter((x) => x !== v))}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      ) : null}

      {field.kind === "users" ? (
        <MultipleSelector
          value={((value as string[]) ?? []).map((uid) => ({ value: uid, label: users.find((u) => u.id === uid)?.name ?? "Unknown user" }))}
          onChange={(picked) => onChange(picked.map((o) => o.value))}
          options={users.map((u) => ({ value: u.id, label: u.role ? `${u.name} (${u.role})` : u.name }))}
          placeholder="Name the approvers"
          hidePlaceholderWhenSelected
          disabled={disabled}
          commandProps={{ className: "h-auto" }}
          emptyIndicator={<p className="text-muted-foreground py-2 text-center text-sm">No one found.</p>}
        />
      ) : null}

      {field.kind === "list" ? (
        <Textarea
          id={id}
          rows={Math.min(12, Math.max(4, ((value as string[]) ?? []).length + 1))}
          value={((value as string[]) ?? []).join("\n")}
          disabled={disabled}
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trimStart()).filter((s, i, all) => s !== "" || i === all.length - 1))}
          onBlur={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
        />
      ) : null}

      {field.kind === "holidays" ? (
        <HolidaysInput value={(value as Array<{ date: string; name: string }>) ?? []} onChange={onChange} disabled={disabled} />
      ) : null}

      {error ? <p className="text-destructive text-xs">{error}</p> : field.hint ? <p className="text-muted-foreground text-xs">{field.hint}</p> : null}
    </div>
  );
}

function HolidaysInput({
  value,
  onChange,
  disabled,
}: {
  value: Array<{ date: string; name: string }>;
  onChange: (next: Array<{ date: string; name: string }>) => void;
  disabled: boolean;
}) {
  const sorted = [...value].sort((a, b) => a.date.localeCompare(b.date));
  const update = (index: number, patch: Partial<{ date: string; name: string }>) =>
    onChange(sorted.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  return (
    <div className="space-y-2">
      {sorted.length === 0 ? <p className="text-muted-foreground text-sm">No holidays listed.</p> : null}
      {sorted.map((h, i) => (
        <div key={`${h.date}-${i}`} className="flex flex-wrap items-center gap-2">
          <Input type="date" className="w-44" value={h.date} disabled={disabled} onChange={(e) => update(i, { date: e.target.value })} />
          <Input className="min-w-48 flex-1" value={h.name} disabled={disabled} onChange={(e) => update(i, { name: e.target.value })} />
          {!disabled ? (
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${h.name}`} onClick={() => onChange(sorted.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>
      ))}
      {!disabled ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...sorted, { date: new Date().toISOString().slice(0, 10), name: "Holiday" }])}
        >
          <Plus className="size-4" />
          Add holiday
        </Button>
      ) : null}
    </div>
  );
}
