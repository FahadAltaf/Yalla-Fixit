"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, FileText, Info, Save } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import {
  snaggingService,
  type SnaggingPricingConfig,
} from "@/modules/snagging";
import { ActionType, ResourceType } from "@/types/types";

import {
  DataState,
  FieldsSkeleton,
  HeadingSkeleton,
  PageHeading,
  SectionCard,
  SectionSkeleton,
  SubmitButton,
  useConfirm,
} from "./shared";

const TYPES = ["apartment", "villa", "townhouse", "commercial"] as const;
const TYPE_LABEL: Record<string, string> = {
  apartment: "Apartment",
  villa: "Villa",
  townhouse: "Townhouse",
  commercial: "Commercial",
};

/** Admin pricing formula, scope of work and terms (F7-F10). */
export default function PricingSettings() {
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING_CATALOGUE,
    ActionType.EDIT,
  );
  const { confirm, dialog } = useConfirm();

  const [config, setConfig] = useState<SnaggingPricingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Whether the form differs from what the server last gave us, so the
  // admin can tell an unsaved edit from a saved one at a glance.
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConfig(await snaggingService.getPricing());
      setDirty(false);
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

  function set<K extends keyof SnaggingPricingConfig>(
    key: K,
    value: SnaggingPricingConfig[K],
  ) {
    setDirty(true);
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  }
  /**
   * One figure on one property type's row of the card.
   *
   * The card is stored as a single document and written whole, so editing
   * has to rebuild the nesting rather than patch a flat key -- otherwise a
   * saved band could land against another type's stale minimum.
   */
  function setCardType(type: string, field: string, value: number | null) {
    setDirty(true);
    setConfig((c) =>
      c && c.rate_card
        ? {
          ...c,
          rate_card: {
            ...c.rate_card,
            types: {
              ...c.rate_card.types,
              [type]: { ...c.rate_card.types?.[type], [field]: value },
            },
          },
        }
        : c,
    );
  }

  /** A figure that sits on the card itself rather than on a type. */
  function setCard(field: string, value: number) {
    setDirty(true);
    setConfig((c) =>
      c && c.rate_card
        ? { ...c, rate_card: { ...c.rate_card, [field]: value } }
        : c,
    );
  }

  async function save() {
    if (!config || saving) return;

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
      setDirty(false);
      toast.success("Pricing saved");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save pricing",
      );
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
          description="The rate per square foot, the multiplier by property type, and the scope and terms on every quotation."
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
          <div className="flex flex-col gap-6">
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
              <SectionCard
                title="Rate card"
                icon={<Building2 />}
                description={`Issued by Operations, 21 August 2026. Every figure is exclusive of VAT and quoted in ${config.currency}.`}
                bodyClassName="border-t"
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[42rem] text-sm">
                    <thead>
                      <tr className="border-b">
                        <Th>Property type</Th>
                        {/*
                          The unit sits under the heading rather than in
                          every cell. Repeating "AED / sq ft" sixteen times
                          is noise; saying it once is the column's job.
                        */}
                        <Th align="right" unit="per sq ft">
                          Unfurnished
                        </Th>
                        <Th align="right" unit="per sq ft">
                          Furnished
                        </Th>
                        <Th align="right" unit="per job">
                          Minimum charge
                        </Th>
                        <Th align="right" unit="fixed, per round" last>
                          De-snagging
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {TYPES.map((type) => {
                        const row = config.rate_card?.types?.[type];
                        if (!row) return null;
                        return (
                          <tr key={type} className="border-b last:border-b-0">
                            <td className="px-5 py-2.5 font-medium whitespace-nowrap">
                              {TYPE_LABEL[type]}
                            </td>
                            {/*
                              A band, not a figure. The rate charged is
                              picked inside it by property size (F22), so
                              the two ends are what Operations owns.
                            */}
                            <td className="px-3 py-2.5">
                              <Band
                                min={row.unfurnished_min}
                                max={row.unfurnished_max}
                                disabled={!canEdit}
                                onMin={(v) => setCardType(type, "unfurnished_min", v)}
                                onMax={(v) => setCardType(type, "unfurnished_max", v)}
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex justify-end">
                                <RateInput
                                  value={row.furnished}
                                  disabled={!canEdit}
                                  onChange={(v) => setCardType(type, "furnished", v)}
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex justify-end">
                                <RateInput
                                  value={row.minimum_charge}
                                  step="10"
                                  disabled={!canEdit}
                                  onChange={(v) =>
                                    setCardType(type, "minimum_charge", v)
                                  }
                                />
                              </div>
                            </td>
                            <td className="px-5 py-2.5">
                              {row.desnag_min == null ? (
                                /*
                                  The card says "to be confirmed" for
                                  commercial. Shown as the table's own empty
                                  convention rather than as a zero somebody
                                  could quote against.
                                */
                                <p className="text-muted-foreground text-right text-xs">
                                  — to be confirmed
                                </p>
                              ) : (
                                <Band
                                  min={row.desnag_min}
                                  max={row.desnag_max ?? row.desnag_min}
                                  step="10"
                                  disabled={!canEdit}
                                  onMin={(v) => setCardType(type, "desnag_min", v)}
                                  onMax={(v) => setCardType(type, "desnag_max", v)}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/*
                  The figures that are not per property type. Same right
                  aligned, fixed width controls as the table above, so the
                  card reads as one thing rather than a table with a form
                  bolted underneath it.
                */}
                <div className="bg-muted/20 grid gap-x-6 gap-y-5 border-t p-5 sm:grid-cols-2 lg:grid-cols-4">
                  <Field
                    label="External areas, per sq ft"
                    hint="Plot area minus built-up area. Villas and townhouses."
                  >
                    <Band
                      min={config.rate_card.external_min}
                      max={config.rate_card.external_max}
                      disabled={!canEdit}
                      align="start"
                      onMin={(v) => setCard("external_min", v)}
                      onMax={(v) => setCard("external_max", v)}
                    />
                  </Field>
                  <Field
                    label="Additional visit"
                    hint="Fixed, per visit per property, after a disconnection."
                  >
                    <RateInput
                      value={config.rate_card.additional_visit_price}
                      step="10"
                      disabled={!canEdit}
                      onChange={(v) => setCard("additional_visit_price", v)}
                    />
                  </Field>
                  <Field
                    label="Out of hours"
                    hint="Added as a line by the coordinator, not automatically."
                  >
                    <Suffixed suffix="%">
                      <RateInput
                        value={config.out_of_hours_percent ?? 40}
                        step="1"
                        disabled={!canEdit}
                        onChange={(v) => set("out_of_hours_percent", v)}
                      />
                    </Suffixed>
                  </Field>
                  <Field label="VAT" hint="Shown as its own line on the quotation.">
                    <Suffixed suffix="%">
                      <RateInput
                        value={config.tax_rate}
                        step="0.5"
                        disabled={!canEdit}
                        onChange={(v) => set("tax_rate", v)}
                      />
                    </Suffixed>
                  </Field>
                </div>
              </SectionCard>
            )}

            <SectionCard
              title="Scope of work & terms"
              icon={<FileText />}
              description="Printed on every snagging quotation."
              bodyClassName="border-t"
            >
              <div className="space-y-5 p-5">
                <Field label="Scope of work">
                  <Textarea
                    rows={4}
                    value={config.scope_of_work ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => set("scope_of_work", e.target.value)}
                    placeholder="What the snagging inspection covers…"
                  />
                </Field>
                <Field label="Terms & conditions">
                  <Textarea
                    rows={6}
                    value={config.terms ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => set("terms", e.target.value)}
                    placeholder="Snagging-specific terms (client not present, utilities not connected, unit unfinished…)"
                  />
                </Field>
              </div>
            </SectionCard>

            {canEdit ? (
              <div className="flex flex-wrap items-center justify-end gap-3">
                {dirty ? (
                  <p className="text-muted-foreground text-sm">
                    You have unsaved changes.
                  </p>
                ) : null}
                <SubmitButton
                  onClick={() => void save()}
                  pending={saving}
                  pendingLabel="Saving…"
                  icon={<Save className="size-4" />}
                  disabled={!dirty}
                >
                  Save pricing
                </SubmitButton>
              </div>
            ) : null}
          </div>
        ) : null}
      </DataState>

      {dialog}
    </div>
  );
}

/** Label + control + optional hint, so every field on the page lines up. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs font-medium">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/**
 * A column heading, with its unit underneath.
 *
 * Numeric columns are right aligned to match their inputs, so the figures
 * line up under the words instead of drifting away from them.
 */
function Th({
  children,
  unit,
  align = "left",
  last,
}: {
  children: React.ReactNode;
  unit?: string;
  align?: "left" | "right";
  last?: boolean;
}) {
  return (
    <th
      className={cn(
        "py-2.5 align-bottom font-medium",
        align === "right" ? "text-right" : "text-left",
        last ? "px-5" : "px-3",
        align === "left" && "px-5",
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

/** The two ends of a published range, as one control. */
function Band({
  min,
  max,
  onMin,
  onMax,
  disabled,
  step,
  align = "end",
}: {
  min: number | null | undefined;
  max: number | null | undefined;
  onMin: (value: number) => void;
  onMax: (value: number) => void;
  disabled?: boolean;
  step?: string;
  align?: "start" | "end";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        align === "end" ? "justify-end" : "justify-start",
      )}
    >
      <RateInput value={min} step={step} disabled={disabled} onChange={onMin} />
      <span className="text-muted-foreground text-xs">to</span>
      <RateInput value={max} step={step} disabled={disabled} onChange={onMax} />
    </div>
  );
}

/** A unit glued to the right of an input, for percentages. */
function Suffixed({
  suffix,
  children,
}: {
  suffix: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {children}
      <span className="text-muted-foreground text-xs">{suffix}</span>
    </div>
  );
}

/**
 * A money input sized for a table cell.
 *
 * The card puts up to four of these on a row, so the full-width Input the
 * rest of the form uses would push the table past any screen.
 */
function RateInput({
  value,
  onChange,
  disabled,
  step = "0.05",
}: {
  value: number | null | undefined;
  onChange: (value: number) => void;
  disabled?: boolean;
  step?: string;
}) {
  return (
    <Input
      type="number"
      min={0}
      step={step}
      className="w-[4.75rem] text-right tabular-nums"
      value={value ?? 0}
      disabled={disabled}
      onChange={(event) => {
        const parsed = Number(event.target.value);
        onChange(Number.isFinite(parsed) ? parsed : 0);
      }}
    />
  );
}
