"use client";

import { useEffect, useMemo, useState } from "react";
import { Mail, MessageCircle, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AMC_TEMPLATE_DEFINITIONS, type AmcTemplateDefinition, type AmcTemplatesConfig } from "@/lib/amc/message-templates";
import { renderTemplate, templatePlaceholders } from "@/lib/amc/templates";

/**
 * The AMC emails (BRD 6.1) and WhatsApp / SMS messages (BRD 6.3). Each
 * keeps its default until someone changes it; only changed texts are saved.
 * Placeholders such as {Proposal no} are filled from the record when sent.
 */
export function TemplatesEditor({
  saved,
  canEdit,
  migrated,
  onSave,
}: {
  saved: AmcTemplatesConfig;
  canEdit: boolean;
  migrated: boolean;
  onSave: (value: AmcTemplatesConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AmcTemplatesConfig>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const editable = canEdit && migrated;

  const textOf = (t: AmcTemplateDefinition) => ({ subject: draft[t.id]?.subject ?? t.subject, body: draft[t.id]?.body ?? t.body });

  const update = (t: AmcTemplateDefinition, patch: { subject?: string; body?: string }) => {
    const current = textOf(t);
    const next = { subject: patch.subject ?? current.subject, body: patch.body ?? current.body };
    setDraft((d) => {
      const copy = { ...d };
      /* Store only what differs from the default. */
      if (next.body === t.body && (next.subject ?? undefined) === (t.subject ?? undefined)) delete copy[t.id];
      else copy[t.id] = t.kind === "email" ? { subject: next.subject, body: next.body } : { body: next.body };
      return copy;
    });
  };

  const save = async () => {
    for (const [id, t] of Object.entries(draft)) {
      if (!t.body?.trim() || (t.subject !== undefined && !t.subject.trim())) {
        toast.error(`${AMC_TEMPLATE_DEFINITIONS.find((d) => d.id === id)?.label ?? id}: the text cannot be empty.`);
        return;
      }
    }
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  const groups: Array<{ kind: AmcTemplateDefinition["kind"]; title: string; description: string; icon: React.ReactNode }> = [
    {
      kind: "email",
      title: "Emails",
      description: "BRD 6.1. Sent from the portal. Email 4 is a draft until the companion workbook text arrives.",
      icon: <Mail />,
    },
    {
      kind: "message",
      title: "WhatsApp and SMS messages",
      description:
        "BRD 6.3. The portal prepares the text and the coordinator sends it from WhatsApp (SMS as the fallback). Drafts until the companion workbook text arrives.",
      icon: <MessageCircle />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <SectionCard key={g.kind} icon={g.icon} title={g.title} description={g.description} bodyClassName="divide-y border-t">
          {AMC_TEMPLATE_DEFINITIONS.filter((t) => t.kind === g.kind).map((t) => (
            <TemplateRow key={t.id} t={t} text={textOf(t)} customised={!!draft[t.id]} editable={editable} onChange={(p) => update(t, p)} />
          ))}
        </SectionCard>
      ))}
      {editable ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
            Discard changes
          </Button>
          <SubmitButton size="sm" pending={saving} pendingLabel="Saving…" icon={<Save className="size-4" />} disabled={!dirty} onClick={() => void save()}>
            Save emails and messages
          </SubmitButton>
        </div>
      ) : null}
    </div>
  );
}

function TemplateRow({
  t,
  text,
  customised,
  editable,
  onChange,
}: {
  t: AmcTemplateDefinition;
  text: { subject?: string; body: string };
  customised: boolean;
  editable: boolean;
  onChange: (patch: { subject?: string; body?: string }) => void;
}) {
  const placeholders = useMemo(
    () => templatePlaceholders(`${text.subject ?? ""}\n${text.body}`),
    [text.subject, text.body],
  );
  /* A preview with each placeholder shown by name, so the shape is visible without data. */
  const sample = useMemo(
    () => Object.fromEntries(placeholders.map((p) => [p, `[${p}]`])),
    [placeholders],
  );
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{t.label}</h3>
        <span className="text-muted-foreground text-xs">{t.source}</span>
        {t.draft ? <Badge variant="outline">Draft</Badge> : null}
        {customised ? <Badge variant="secondary">Changed</Badge> : null}
        {customised && editable ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={() => onChange({ subject: t.subject, body: t.body })}
          >
            <RotateCcw className="size-3.5" />
            Use the default
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          {t.kind === "email" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${t.id}-subject`}>Subject</Label>
              <Input id={`${t.id}-subject`} value={text.subject ?? ""} disabled={!editable} onChange={(e) => onChange({ subject: e.target.value })} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor={`${t.id}-body`}>{t.kind === "email" ? "Body" : "Message"}</Label>
            <Textarea
              id={`${t.id}-body`}
              rows={t.kind === "email" ? 9 : 4}
              value={text.body}
              disabled={!editable}
              onChange={(e) => onChange({ body: e.target.value })}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Placeholders: {placeholders.length ? placeholders.map((p) => `{${p}}`).join(", ") : "none"}
          </p>
        </div>
        <div className="bg-muted/40 space-y-1 rounded-md border p-3 text-sm">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Preview</p>
          {t.kind === "email" ? <p className="font-medium">{renderTemplate(text.subject ?? "", sample).text}</p> : null}
          <p className="whitespace-pre-wrap">{renderTemplate(text.body, sample).text}</p>
        </div>
      </div>
    </div>
  );
}
