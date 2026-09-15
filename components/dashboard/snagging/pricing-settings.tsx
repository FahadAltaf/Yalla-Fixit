"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building,
  Building2,
  FileText,
  Home,
  Info,
  Receipt,
  RotateCcw,
  Save,
  Store,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import {
  computeQuotation,
  type PricingConfig,
} from "@/lib/server/snagging/pricing";
import { hasResourceAction } from "@/lib/role-permissions";
import { cn } from "@/lib/utils";
import { snaggingService, type SnaggingPricingConfig } from "@/modules/snagging";
import { ActionType, ResourceType } from "@/types/types";

import {
  DataState,
  FieldsSkeleton,
  HeadingSkeleton,
  PageHeading,
  SectionCard,
  SectionSkeleton,
  SubmitButton,
  formatGstDateTime,
  useConfirm,
} from "./shared";

const TYPES = ["apartment", "villa", "townhouse", "commercial"] as const;

const TYPE_META: Record<
  string,
  { label: string; icon: typeof Building2; note: string }
> = {
  apartment: {
    label: "Apartment",
    icon: Building2,
    note: "Priced on built-up area",
  },
  villa: { label: "Villa", icon: Home, note: "External areas charged separately" },
  townhouse: { label: "Townhouse", icon: Building, note: "Priced in the villa band" },
  commercial: { label: "Commercial", icon: Store, note: "Flat rate either way" },
};

/* ────────────────────────────── validation ────────────────────────────── */

type Issue = { field: string; message: string };

/**
 * Everything wrong with the card, as a list keyed by control.
 *
 * Checked here rather than only on the server because these are figures a
 * person is typing: an inverted band is a slip to point at while the cursor
 * is still in the field, not an error to discover after a round trip. The
 * server still owns the final word.
 */
function validate(config: SnaggingPricingConfig): Issue[] {
  const issues: Issue[] = [];
  const bad = (n: number | null | undefined) =>
    n == null || !Number.isFinite(n) || n < 0;

  const card = config.rate_card;
  if (card) {
    for (const type of TYPES) {
      const row = card.types?.[type];
      if (!row) continue;
      const name = TYPE_META[type].label;

      if (bad(row.unfurnished_min) || bad(row.unfurnished_max)) {
        issues.push({
          field: `${type}.unfurnished`,
          message: `${name}: an unfurnished rate cannot be blank or negative.`,
        });
      } else if (row.unfurnished_min > row.unfurnished_max) {
        issues.push({
          field: `${type}.unfurnished`,
          message: `${name}: the unfurnished band runs backwards — the low end is above the high end.`,
        });
      }

      if (bad(row.furnished)) {
        issues.push({
          field: `${type}.furnished`,
          message: `${name}: the furnished rate cannot be blank or negative.`,
        });
      }
      if (bad(row.minimum_charge)) {
        issues.push({
          field: `${type}.minimum_charge`,
          message: `${name}: the minimum charge cannot be blank or negative.`,
        });
      }

      /*
        Null on BOTH ends is the card's published "to be confirmed" and is
        valid. One end set and the other not is a half-finished edit.
      */
      if (row.desnag_min != null || row.desnag_max != null) {
        if (bad(row.desnag_min) || bad(row.desnag_max)) {
          issues.push({
            field: `${type}.desnag`,
            message: `${name}: set both ends of the de-snagging price, or clear it back to “to be confirmed”.`,
          });
        } else if ((row.desnag_min as number) > (row.desnag_max as number)) {
          issues.push({
            field: `${type}.desnag`,
            message: `${name}: the de-snagging band runs backwards.`,
          });
        }
      }
    }

    if (bad(card.external_min) || bad(card.external_max)) {
      issues.push({
        field: "external",
        message: "The external areas rate cannot be blank or negative.",
      });
    } else if (card.external_min > card.external_max) {
      issues.push({
        field: "external",
        message: "The external areas band runs backwards.",
      });
    }
    if (bad(card.additional_visit_price)) {
      issues.push({
        field: "additional_visit_price",
        message: "The additional visit price cannot be blank or negative.",
      });
    }
  }

  const percent = (n: number | null | undefined, field: string, name: string) => {
    if (bad(n)) issues.push({ field, message: `${name} cannot be blank or negative.` });
    else if ((n as number) > 100)
      issues.push({ field, message: `${name} cannot be above 100%.` });
  };
  percent(config.out_of_hours_percent, "out_of_hours_percent", "The out-of-hours surcharge");
  percent(config.tax_rate, "tax_rate", "VAT");

  return issues;
}

/** How many individual figures differ from what the server last sent. */
function countChanges(next: unknown, base: unknown): number {
  if (next === base) return 0;
  if (
    next == null ||
    base == null ||
    typeof next !== "object" ||
    typeof base !== "object"
  ) {
    return next === base ? 0 : 1;
  }
  const keys = new Set([
    ...Object.keys(next as object),
    ...Object.keys(base as object),
  ]);
  let total = 0;
  for (const key of keys) {
    total += countChanges(
      (next as Record<string, unknown>)[key],
      (base as Record<string, unknown>)[key],
    );
  }
  return total;
}

/* ──────────────────────────────── screen ──────────────────────────────── */

/**
 * The rate card Operations issues, as a screen they can actually edit
 * (BA v2, change 12).
 *
 * The pricing model behind this was rebuilt first: one rate per square foot
 * times a multiplier per property type could not express the card at all,
 * and was quoting villas at 1.25 AED/sq ft — a figure outside the published
 * 0.80–1.00 band and below the 1.40 furnished rate, arrived at by
 * multiplication rather than signed off by anyone.
 *
 * What this screen adds is the other half of change 12: "it must be easy for
 * the team to update". That means the units are on the controls rather than
 * only in a column heading, a band is one control rather than two boxes and
 * a floating word, a wrong figure is caught while the cursor is still in the
 * field, the Save button follows the page instead of hiding under it, and
 * the effect of an edit can be seen before it is committed.
 */
export default function PricingSettings() {
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING_CATALOGUE,
    ActionType.EDIT,
  );
  const { confirm, dialog } = useConfirm();

  const [config, setConfig] = useState<SnaggingPricingConfig | null>(null);
  /*
    What the server last gave us. Dirty state is a comparison against this
    rather than a boolean someone remembered to set, so typing a figure and
    typing it back is correctly not a change, and Discard has something
    exact to restore to.
  */
  const [baseline, setBaseline] = useState<SnaggingPricingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /* Bumped on load, save and discard, to remount the fields and drop any
     half-typed draft a control is still holding. */
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fresh = await snaggingService.getPricing();
      setConfig(fresh);
      setBaseline(fresh);
      setRevision((n) => n + 1);
    } catch (err) {
      // Kept on screen rather than fired as a toast: a failed load used
      // to leave this page stuck on "Loading pricing…" forever.
      setError(err instanceof Error ? err.message : "Could not load pricing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changes = useMemo(
    () => (config && baseline ? countChanges(config, baseline) : 0),
    [config, baseline],
  );
  const dirty = changes > 0;
  const issues = useMemo(() => (config ? validate(config) : []), [config]);
  const issueFor = useCallback(
    (field: string) => issues.find((i) => i.field === field)?.message,
    [issues],
  );

  function set<K extends keyof SnaggingPricingConfig>(
    key: K,
    value: SnaggingPricingConfig[K],
  ) {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  }

  /**
   * One or more figures on one property type's row.
   *
   * The card is stored as a single document and written whole, so editing
   * has to rebuild the nesting rather than patch a flat key — otherwise a
   * saved band could land against another type's stale minimum.
   */
  function setCardType(type: string, patch: Record<string, number | null>) {
    setConfig((c) =>
      c && c.rate_card
        ? {
            ...c,
            rate_card: {
              ...c.rate_card,
              types: {
                ...c.rate_card.types,
                [type]: { ...c.rate_card.types?.[type], ...patch },
              },
            },
          }
        : c,
    );
  }

  /** A figure that sits on the card itself rather than on a type. */
  function setCard(field: string, value: number) {
    setConfig((c) =>
      c && c.rate_card
        ? { ...c, rate_card: { ...c.rate_card, [field]: value } }
        : c,
    );
  }

  function discard() {
    setConfig(baseline);
    setRevision((n) => n + 1);
  }

  async function save() {
    if (!config || saving || issues.length > 0) return;

    // These figures price every future quotation, so the change is
    // confirmed rather than fired on a stray click.
    const ok = await confirm({
      title: "Update snagging pricing?",
      description:
        "New quotations will use these rates from now on. Quotations already generated keep the figures they were created with.",
      confirmText: "Save pricing",
    });
    if (!ok) return;

    setSaving(true);
    try {
      const saved = await snaggingService.updatePricing(config);
      setConfig(saved);
      setBaseline(saved);
      setRevision((n) => n + 1);
      toast.success(changes === 1 ? "1 figure saved" : `${changes} figures saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save pricing");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {loading ? (
        <HeadingSkeleton />
      ) : (
        <PageHeading
          eyebrow="Master data"
          title="Snagging pricing"
          description="The rate card every quotation is priced against, plus the scope and terms printed on it."
        />
      )}

      <DataState
        loading={loading}
        error={error}
        onRetry={() => void load()}
        retrying={loading}
        errorTitle="Could not load pricing"
        skeleton={
          <div className="flex flex-col gap-6">
            <SectionSkeleton>
              <FieldsSkeleton fields={5} columns={3} />
            </SectionSkeleton>
            <SectionSkeleton>
              <FieldsSkeleton fields={4} columns={4} />
            </SectionSkeleton>
          </div>
        }
      >
        {config ? (
          <div className="flex flex-col gap-6" key={revision}>
            {!canEdit ? (
              <Alert>
                <Info />
                <AlertTitle>You are viewing these values read-only</AlertTitle>
                <AlertDescription>
                  Only an admin can change a rate, a minimum or a surcharge
                  (FR-2.11).
                </AlertDescription>
              </Alert>
            ) : null}

            {!config.rate_card ? (
              <Alert>
                <Info />
                <AlertTitle>The rate card has not been loaded yet</AlertTitle>
                <AlertDescription>
                  Quotations cannot be priced until it is. Run the rate card
                  migration against this database.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <SectionCard
                  title="Rate card"
                  icon={<Building2 />}
                  description={`Issued by Operations, 21 August 2026. Every figure is exclusive of VAT and quoted in ${config.currency}.`}
                  action={
                    config.updated_at ? (
                      <p className="text-muted-foreground text-xs">
                        Last saved {formatGstDateTime(config.updated_at)}
                      </p>
                    ) : null
                  }
                  bodyClassName="border-t"
                >
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[56rem] text-sm">
                      <thead>
                        <tr className="bg-muted/30 border-b">
                          <Th>Property type</Th>
                          {/*
                            The unit sits under the heading AND on the
                            control. A column heading alone leaves a figure
                            ambiguous the moment the table scrolls.
                          */}
                          <Th unit="per sq ft">Unfurnished</Th>
                          <Th unit="per sq ft">Furnished</Th>
                          <Th unit="per job">Minimum charge</Th>
                          <Th unit="fixed, per round" last>
                            De-snagging
                          </Th>
                        </tr>
                      </thead>
                      <tbody>
                        {TYPES.map((type) => {
                          const row = config.rate_card?.types?.[type];
                          if (!row) return null;
                          const meta = TYPE_META[type];
                          const Icon = meta.icon;
                          return (
                            <tr
                              key={type}
                              className="hover:bg-muted/20 border-b transition-colors last:border-b-0"
                            >
                              {/*
                                Icon, name, and what makes this row
                                different — the identity column the rest of
                                the tables use. Without it the card is
                                twenty-two boxes and four words.
                              */}
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-3">
                                  <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                                    <Icon className="size-4" />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block font-medium">
                                      {meta.label}
                                    </span>
                                    <span className="text-muted-foreground block text-xs">
                                      {meta.note}
                                    </span>
                                  </span>
                                </div>
                              </td>

                              {/*
                                A band, not a figure. The rate charged is
                                picked inside it by property size (F22), so
                                the two ends are what Operations owns.
                              */}
                              <td className="px-3 py-3">
                                <Band
                                  min={row.unfurnished_min}
                                  max={row.unfurnished_max}
                                  disabled={!canEdit}
                                  invalid={issueFor(`${type}.unfurnished`)}
                                  label={`${meta.label} unfurnished rate`}
                                  onMin={(v) => setCardType(type, { unfurnished_min: v })}
                                  onMax={(v) => setCardType(type, { unfurnished_max: v })}
                                />
                              </td>
                              <td className="px-3 py-3">
                                <Money
                                  value={row.furnished}
                                  disabled={!canEdit}
                                  invalid={issueFor(`${type}.furnished`)}
                                  label={`${meta.label} furnished rate`}
                                  onChange={(v) => setCardType(type, { furnished: v })}
                                />
                              </td>
                              <td className="px-3 py-3">
                                <Money
                                  value={row.minimum_charge}
                                  step="10"
                                  disabled={!canEdit}
                                  invalid={issueFor(`${type}.minimum_charge`)}
                                  label={`${meta.label} minimum charge`}
                                  onChange={(v) =>
                                    setCardType(type, { minimum_charge: v })
                                  }
                                />
                              </td>
                              <td className="px-5 py-3">
                                <DesnagCell
                                  min={row.desnag_min}
                                  max={row.desnag_max}
                                  seed={row.minimum_charge}
                                  disabled={!canEdit}
                                  invalid={issueFor(`${type}.desnag`)}
                                  label={`${meta.label} de-snagging price`}
                                  onChange={(patch) => setCardType(type, patch)}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/*
                    The figures that are not per property type. Same controls
                    as the table above, so the card reads as one thing rather
                    than a table with a form bolted underneath it.
                  */}
                  <dl className="bg-muted/20 grid gap-x-8 gap-y-6 border-t p-5 sm:grid-cols-2 xl:grid-cols-4">
                    <Figure
                      label="External areas"
                      hint="Plot area minus built-up area. Villas and townhouses only."
                      error={issueFor("external")}
                    >
                      <Band
                        min={config.rate_card.external_min}
                        max={config.rate_card.external_max}
                        disabled={!canEdit}
                        invalid={issueFor("external")}
                        align="start"
                        suffix="/sq ft"
                        label="External areas rate"
                        onMin={(v) => setCard("external_min", v)}
                        onMax={(v) => setCard("external_max", v)}
                      />
                    </Figure>
                    <Figure
                      label="Additional visit"
                      hint="Fixed, per visit per property, after a disconnection."
                      error={issueFor("additional_visit_price")}
                    >
                      <Money
                        value={config.rate_card.additional_visit_price}
                        step="10"
                        align="start"
                        disabled={!canEdit}
                        invalid={issueFor("additional_visit_price")}
                        label="Additional visit price"
                        onChange={(v) => setCard("additional_visit_price", v)}
                      />
                    </Figure>
                    <Figure
                      label="Out of hours"
                      hint="Added as a line by the coordinator, not automatically."
                      error={issueFor("out_of_hours_percent")}
                    >
                      <Percent
                        value={config.out_of_hours_percent ?? 40}
                        step="1"
                        disabled={!canEdit}
                        invalid={issueFor("out_of_hours_percent")}
                        label="Out of hours surcharge"
                        onChange={(v) => set("out_of_hours_percent", v)}
                      />
                    </Figure>
                    <Figure
                      label="VAT"
                      hint="Shown as its own line on the quotation."
                      error={issueFor("tax_rate")}
                    >
                      <Percent
                        value={config.tax_rate}
                        step="0.5"
                        disabled={!canEdit}
                        invalid={issueFor("tax_rate")}
                        label="VAT rate"
                        onChange={(v) => set("tax_rate", v)}
                      />
                    </Figure>
                  </dl>
                </SectionCard>

                <QuotePreview config={config} dirty={dirty} />
              </>
            )}

            <SectionCard
              title="Scope of work & terms"
              icon={<FileText />}
              description="Printed on every snagging quotation."
              bodyClassName="border-t"
            >
              <div className="grid gap-5 p-5 lg:grid-cols-2">
                <Figure label="Scope of work">
                  <Textarea
                    rows={7}
                    value={config.scope_of_work ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => set("scope_of_work", e.target.value)}
                    placeholder="What the snagging inspection covers…"
                  />
                </Figure>
                <Figure label="Terms & conditions">
                  <Textarea
                    rows={7}
                    value={config.terms ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => set("terms", e.target.value)}
                    placeholder="Snagging-specific terms (client not present, utilities not connected, unit unfinished…)"
                  />
                </Figure>
              </div>
            </SectionCard>

            {/*
              The save bar follows the page rather than sitting at the bottom
              of it. Everything above is a field, the page is taller than a
              screen, and an edit made at the top used to be committed by
              scrolling past the preview to find a button.
            */}
            {canEdit && (dirty || issues.length > 0) ? (
              <div className="sticky bottom-4 z-30">
                <div
                  className={cn(
                    "bg-background flex flex-wrap items-center gap-3 rounded-xl border p-3 shadow-sm",
                    issues.length > 0 && "border-destructive/40",
                  )}
                >
                  {issues.length > 0 ? (
                    <p className="text-destructive flex min-w-0 flex-1 items-start gap-2 text-sm">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                      <span>
                        {issues[0].message}
                        {issues.length > 1 ? (
                          <span className="text-muted-foreground">
                            {" "}
                            (+{issues.length - 1} more)
                          </span>
                        ) : null}
                      </span>
                    </p>
                  ) : (
                    <p className="text-muted-foreground min-w-0 flex-1 text-sm">
                      <span className="text-foreground font-medium">
                        {changes === 1
                          ? "1 unsaved change"
                          : `${changes} unsaved changes`}
                      </span>{" "}
                      — new quotations will use these once saved.
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={discard}
                      disabled={saving || !dirty}
                    >
                      <RotateCcw className="size-4" />
                      Discard
                    </Button>
                    <SubmitButton
                      onClick={() => void save()}
                      pending={saving}
                      pendingLabel="Saving…"
                      icon={<Save className="size-4" />}
                      disabled={!dirty || issues.length > 0}
                    >
                      Save pricing
                    </SubmitButton>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </DataState>

      {dialog}
    </div>
  );
}

/* ─────────────────────────────── preview ─────────────────────────────── */

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

/**
 * What the card above actually quotes, on a property you choose.
 *
 * The figures on the card are rates and floors; what Operations is really
 * deciding is what lands on a client's quotation, and until now the only way
 * to find out was to save, raise a quotation and look. This prices one
 * against the values on screen — including unsaved ones — through
 * `computeQuotation`, the very function the quotation route runs, so the
 * preview cannot drift from the document.
 */
function QuotePreview({
  config,
  dirty,
}: {
  config: SnaggingPricingConfig;
  dirty: boolean;
}) {
  const [type, setType] = useState<string>("apartment");
  const [furnished, setFurnished] = useState(false);
  const [builtUp, setBuiltUp] = useState(1200);
  const [plot, setPlot] = useState(3000);
  const [outOfHours, setOutOfHours] = useState(false);

  const external = type === "villa" || type === "townhouse";

  const quote = useMemo(
    () =>
      computeQuotation(
        {
          property_type: type,
          built_up_area_sqft: builtUp,
          plot_area_sqft: external ? plot : null,
          external_areas_in_scope: external,
          bedrooms: null,
          furnished,
        },
        config as unknown as PricingConfig,
        { outOfHours },
      ),
    [type, builtUp, plot, external, furnished, outOfHours, config],
  );

  return (
    <SectionCard
      title="What this quotes"
      icon={<Receipt />}
      description="Priced by the same code that generates a real quotation."
      action={
        dirty ? (
          <span className="border-brand/30 bg-brand/5 text-brand rounded-full border px-2.5 py-1 text-xs font-medium">
            Including unsaved edits
          </span>
        ) : null
      }
      bodyClassName="border-t"
    >
      <div className="grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* The property to price. */}
        <div className="bg-muted/20 flex flex-col gap-5 border-b p-5 lg:border-r lg:border-b-0">
          <Figure label="Property type">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_META[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Figure>

          <Figure label="Built-up area">
            <Money
              value={builtUp}
              step="50"
              align="start"
              prefix={null}
              suffix="sq ft"
              label="Built-up area"
              onChange={setBuiltUp}
            />
          </Figure>

          {external ? (
            <Figure
              label="Plot area"
              hint="Anything above the built-up area is charged at the external rate."
            >
              <Money
                value={plot}
                step="50"
                align="start"
                prefix={null}
                suffix="sq ft"
                label="Plot area"
                onChange={setPlot}
              />
            </Figure>
          ) : null}

          <Toggle
            checked={furnished}
            onChange={setFurnished}
            label="Furnished"
            hint={
              type === "commercial"
                ? "Commercial is a flat rate either way."
                : "Switches this row to the furnished rate."
            }
            disabled={type === "commercial"}
          />
          <Toggle
            checked={outOfHours}
            onChange={setOutOfHours}
            label="Out of hours"
            hint="Weekend, public holiday, or outside 09:00–17:00."
          />
        </div>

        {/* What that costs. */}
        <div className="flex flex-col">
          {quote.lines.length === 0 ? (
            <p className="text-muted-foreground p-5 text-sm">
              Nothing to price — this property type has no row on the card.
            </p>
          ) : (
            <>
              <ul className="divide-y">
                {quote.lines.map((line, index) => (
                  <li
                    key={index}
                    className="flex items-start justify-between gap-4 px-5 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm">{line.description}</span>
                      <span className="text-muted-foreground block text-xs tabular-nums">
                        {line.qty.toLocaleString()} {line.unit} × {line.unit_price}{" "}
                        {config.currency}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {money(line.amount, config.currency)}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="mt-auto space-y-2 border-t p-5">
                <Total
                  label="Subtotal"
                  value={money(quote.subtotal, config.currency)}
                />
                <Total
                  label={`VAT (${quote.tax_rate}%)`}
                  value={money(quote.tax_amount, config.currency)}
                />
                <div className="flex items-baseline justify-between gap-4 border-t pt-3">
                  <dt className="text-sm font-medium">Total</dt>
                  <dd className="text-xl font-semibold tabular-nums">
                    {money(quote.total, config.currency)}
                  </dd>
                </div>
                {quote.minimum_applied ? (
                  <p className="text-muted-foreground pt-1 text-xs">
                    The area calculation came in under the minimum charge, so a
                    top-up line was added.
                  </p>
                ) : null}
              </dl>
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm tabular-nums">{value}</dd>
    </div>
  );
}

/* ─────────────────────────────── controls ─────────────────────────────── */

/** Label + control + hint or error, so every figure on the page lines up. */
function Figure({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs font-medium">{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

/** A column heading, with its unit underneath. */
function Th({
  children,
  unit,
  last,
}: {
  children: React.ReactNode;
  unit?: string;
  last?: boolean;
}) {
  return (
    <th
      className={cn(
        "py-3 text-left align-bottom font-medium",
        unit ? (last ? "px-5" : "px-3") : "px-5",
      )}
    >
      <span className="text-foreground block text-xs">{children}</span>
      {unit ? (
        <span className="text-muted-foreground mt-0.5 block text-[0.6875rem] font-normal">
          {unit}
        </span>
      ) : null}
    </th>
  );
}

/**
 * A number a person is typing, which is not the same thing as a number.
 *
 * The field used to parse on every keystroke and write the result straight
 * back, so clearing it to type a new rate wrote 0 and left that 0 wedged in
 * front of whatever came next — every edit had to start with select-all. The
 * keystrokes live here as text until they parse; the model only ever
 * receives a real number, and an empty field keeps the last good value
 * rather than silently becoming zero.
 */
function NumberBox({
  value,
  onChange,
  disabled,
  step,
  invalid,
  label,
  className,
}: {
  value: number | null | undefined;
  onChange: (value: number) => void;
  disabled?: boolean;
  step?: string;
  invalid?: boolean;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value == null ? "" : String(value));

  return (
    <InputGroupInput
      type="number"
      min={0}
      step={step}
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={cn("text-right tabular-nums", className)}
      value={shown}
      disabled={disabled}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const parsed = Number(text);
        if (text.trim() !== "" && Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/** One figure, in its own bordered group, with its units attached. */
function Money({
  value,
  onChange,
  disabled,
  step = "0.05",
  invalid,
  label,
  align = "end",
  prefix = "AED",
  suffix,
}: {
  value: number | null | undefined;
  onChange: (value: number) => void;
  disabled?: boolean;
  step?: string;
  invalid?: string;
  label: string;
  align?: "start" | "end";
  prefix?: string | null;
  suffix?: string;
}) {
  return (
    <div className={cn("flex", align === "end" ? "justify-end" : "justify-start")}>
      <InputGroup className={cn("w-[8.5rem]", suffix && "w-[10rem]")}>
        {prefix ? (
          <InputGroupAddon className="text-[0.6875rem]">{prefix}</InputGroupAddon>
        ) : null}
        <NumberBox
          value={value}
          onChange={onChange}
          disabled={disabled}
          step={step}
          invalid={Boolean(invalid)}
          label={label}
        />
        {suffix ? (
          <InputGroupAddon align="inline-end" className="text-[0.6875rem]">
            {suffix}
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}

/** A percentage, which needs no currency but does need its sign. */
function Percent({
  value,
  onChange,
  disabled,
  step,
  invalid,
  label,
}: {
  value: number | null | undefined;
  onChange: (value: number) => void;
  disabled?: boolean;
  step?: string;
  invalid?: string;
  label: string;
}) {
  return (
    <InputGroup className="w-[8.5rem]">
      <NumberBox
        value={value}
        onChange={onChange}
        disabled={disabled}
        step={step}
        invalid={Boolean(invalid)}
        label={label}
      />
      <InputGroupAddon align="inline-end">%</InputGroupAddon>
    </InputGroup>
  );
}

/**
 * The two ends of a published range, as ONE control.
 *
 * Two separate boxes with a floating "to" between them read as two unrelated
 * figures that happen to be adjacent. Sharing a border says what is true:
 * this is a band, and the rate charged is picked inside it by size.
 */
function Band({
  min,
  max,
  onMin,
  onMax,
  disabled,
  step,
  invalid,
  label,
  align = "end",
  suffix,
}: {
  min: number | null | undefined;
  max: number | null | undefined;
  onMin: (value: number) => void;
  onMax: (value: number) => void;
  disabled?: boolean;
  step?: string;
  invalid?: string;
  label: string;
  align?: "start" | "end";
  suffix?: string;
}) {
  return (
    <div className={cn("flex", align === "end" ? "justify-end" : "justify-start")}>
      <InputGroup
        role="group"
        aria-label={label}
        className={cn("w-[11.5rem]", suffix && "w-[13.5rem]")}
      >
        <NumberBox
          value={min}
          onChange={onMin}
          disabled={disabled}
          step={step}
          invalid={Boolean(invalid)}
          label={`${label}, low end`}
          className="pr-0"
        />
        <span
          aria-hidden
          className="text-muted-foreground shrink-0 px-1 text-xs select-none"
        >
          –
        </span>
        <NumberBox
          value={max}
          onChange={onMax}
          disabled={disabled}
          step={step}
          invalid={Boolean(invalid)}
          label={`${label}, high end`}
          className="pl-0"
        />
        {suffix ? (
          <InputGroupAddon align="inline-end" className="text-[0.6875rem]">
            {suffix}
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}

/**
 * De-snagging, which the card publishes as a price for three property types
 * and as "to be confirmed" for the fourth.
 *
 * "To be confirmed" used to be printed as dead text, so the one figure on
 * the card explicitly expected to change was the one figure with no way to
 * change it. It is a state now: set it, and clear it back.
 */
function DesnagCell({
  min,
  max,
  seed,
  disabled,
  invalid,
  label,
  onChange,
}: {
  min: number | null;
  max: number | null;
  /** Starts a first price, so "Set" does not open on a quotable zero. */
  seed: number;
  disabled?: boolean;
  invalid?: string;
  label: string;
  onChange: (patch: Record<string, number | null>) => void;
}) {
  if (min == null && max == null) {
    return (
      <div className="flex items-center justify-end gap-2">
        <span className="text-muted-foreground text-xs">To be confirmed</span>
        {!disabled ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => onChange({ desnag_min: seed, desnag_max: seed })}
          >
            Set price
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Band
        min={min}
        max={max}
        step="10"
        disabled={disabled}
        invalid={invalid}
        label={label}
        onMin={(v) => onChange({ desnag_min: v })}
        onMax={(v) => onChange({ desnag_max: v })}
      />
      {!disabled ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={`Clear ${label} back to to-be-confirmed`}
          title="Back to “to be confirmed”"
          onClick={() => onChange({ desnag_min: null, desnag_max: null })}
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

/** A switch with its label and reason, for the preview's two options. */
function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <Label className="text-xs font-medium">{label}</Label>
        <span className="text-muted-foreground mt-0.5 block text-xs">{hint}</span>
      </span>
      <Switch
        checked={checked && !disabled}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  );
}
