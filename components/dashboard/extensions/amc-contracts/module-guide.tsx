"use client";

import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { SubHeading } from "@/components/dashboard/shared/kaizen";
import { CONFIG_VIEWS, HIDDEN_CONFIG_VIEWS, SECTION_DEFS } from "@/components/dashboard/extensions/amc/configuration/config-fields";
import { AMC_CONFIG_DEFAULTS } from "@/lib/amc/config";
import { cn } from "@/lib/utils";

import { MODULE_GUIDES, type GuideSetting, type ModuleKey } from "./module-guides";

/**
 * The (i) beside an AMC page's title: what the page is for, how its work
 * moves, what runs on its own and which configuration shapes it. Plain
 * words for the people using it; the texts live in module-guides.ts.
 */
export function ModuleGuide({ module }: { module: ModuleKey }) {
  const guide = MODULE_GUIDES[module];
  return (
    <Dialog>
      <Hint label="How this page works">
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground size-8 shrink-0" aria-label={`How ${guide.title} works`}>
            <Info className="size-[18px]" />
          </Button>
        </DialogTrigger>
      </Hint>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 pt-6 pb-4 text-left">
          <p className="eyebrow">How it works</p>
          <DialogTitle className="text-xl">{guide.title}</DialogTitle>
          <DialogDescription className="text-[0.9375rem]">{guide.summary}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 overflow-y-auto px-6 py-5">
          {guide.who ? (
            <p className="text-sm">
              <span className="font-medium">Who uses it: </span>
              <span className="text-muted-foreground">{guide.who}</span>
            </p>
          ) : null}

          <section className="space-y-3">
            <SubHeading>Step by step</SubHeading>
            <ol className="space-y-3">
              {guide.steps.map((step, i) => (
                <li key={step.title} className="flex gap-3">
                  <span className="bg-muted text-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0 space-y-0.5 pt-0.5">
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="text-muted-foreground text-sm">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {guide.explain?.map((block) => <Bullets key={block.title} title={block.title} items={block.items} />)}
          {guide.automatic?.length ? <Bullets title="Happens on its own" items={guide.automatic} /> : null}
          {guide.rules?.length ? <Bullets title="Good to know" items={guide.rules} /> : null}
          {guide.settings?.length ? <Settings settings={guide.settings} /> : null}

          {guide.before?.length || guide.after?.length ? (
            <section className="space-y-3">
              <SubHeading>Where it fits</SubHeading>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {guide.before?.map((link) => <FlowLink key={link.href} {...link} />)}
                {guide.before?.length ? <ArrowRight className="text-muted-foreground size-4" /> : null}
                <span className="bg-foreground text-background rounded-md px-2.5 py-1 font-medium">{guide.title}</span>
                {guide.after?.length ? <ArrowRight className="text-muted-foreground size-4" /> : null}
                {guide.after?.map((link) => <FlowLink key={link.href} {...link} />)}
              </div>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="space-y-2">
      <SubHeading>{title}</SubHeading>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item} className="text-muted-foreground flex gap-2.5 text-sm">
            <span className="bg-muted-foreground/50 mt-[0.55rem] size-1 shrink-0 rounded-full" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FlowLink({ label, href }: { label: string; href: string }) {
  return (
    <Link href={href} className="hover:bg-muted rounded-md border px-2.5 py-1 transition-colors">
      {label}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Settings: labels and defaults read from the configuration itself   */
/* ------------------------------------------------------------------ */

function Settings({ settings }: { settings: GuideSetting[] }) {
  const rows = settings.map(describeSetting).filter((row): row is NonNullable<typeof row> => row !== null);
  if (!rows.length) return null;
  /* A setting on a hidden view is still described; it just has no tab to open. */
  const views = [...new Set(rows.map((row) => row.view))].filter((v) => !HIDDEN_CONFIG_VIEWS.has(v));
  return (
    <section className="space-y-2">
      <SubHeading
        action={
          views.length === 0 ? null : views.length === 1 ? (
            <Link href={`/settings/amc/configuration?view=${views[0]}`} className="hover:text-foreground text-muted-foreground text-xs underline underline-offset-2">
              Open in AMC configuration
            </Link>
          ) : (
            <Link href="/settings/amc/configuration" className="hover:text-foreground text-muted-foreground text-xs underline underline-offset-2">
              Open AMC configuration
            </Link>
          )
        }
      >
        Settings that shape it
      </SubHeading>
      <div className="divide-y rounded-lg border">
        {rows.map((row) => (
          <div key={`${row.section}.${row.key}`} className="flex items-baseline justify-between gap-4 px-3 py-2 text-sm">
            <span className="min-w-0">
              {row.label}
              {row.note ? <span className="text-muted-foreground block text-xs">{row.note}</span> : null}
            </span>
            <span className={cn("shrink-0 text-right tabular-nums", row.value ? "text-muted-foreground" : "text-muted-foreground/70 italic")}>
              {row.value ? `Default ${row.value}` : "Set in configuration"}
            </span>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">{views.length ? "Defaults shown; your team may have changed them in AMC configuration." : "Defaults shown."}</p>
    </section>
  );
}

function describeSetting({ section, key, note }: GuideSetting) {
  const def = SECTION_DEFS.find((s) => s.section === section);
  const field = def?.fields.find((f) => f.key === key);
  if (!def || !field) return null;
  const view = CONFIG_VIEWS.find((v) => (v.sections as readonly string[]).includes(section))?.value ?? "pipeline";
  const raw = (AMC_CONFIG_DEFAULTS[section] as Record<string, unknown>)[key];
  return { section, key, label: field.label, note, view, value: formatDefault(field, raw) };
}

function formatDefault(field: (typeof SECTION_DEFS)[number]["fields"][number], raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  switch (field.kind) {
    case "number":
      return field.unit ? `${String(raw)}${field.unit === "%" ? "%" : ` ${field.unit}`}` : String(raw);
    case "boolean":
      return raw ? "on" : "off";
    case "select":
      return field.options.find((o) => o.value === String(raw))?.label ?? String(raw);
    case "multi": {
      const values = Array.isArray(raw) ? raw.map(String) : [];
      const labels = field.options.filter((o) => values.includes(o.value)).map((o) => o.label);
      return labels.length ? labels.join(", ") : null;
    }
    default:
      return null;
  }
}
