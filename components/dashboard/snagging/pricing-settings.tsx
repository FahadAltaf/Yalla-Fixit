"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Coins, FileText, Info, Save } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
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
  function setMultiplier(type: string, value: number) {
    setDirty(true);
    setConfig((c) =>
      c ? { ...c, multipliers: { ...c.multipliers, [type]: value } } : c,
    );
  }

  /** Empty and malformed inputs must not reach the API as NaN. */
  function num(raw: string): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
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
                  Only an admin can change the snagging rates, multipliers and
                  terms.
                </AlertDescription>
              </Alert>
            ) : null}

            <SectionCard
              title="Rates"
              icon={<Coins />}
              description="The base figures behind every quotation total."
              bodyClassName="border-t"
            >
              <div className="grid gap-4 p-5 sm:grid-cols-3">
                <Field label={`Rate per sq ft (${config.currency})`}>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={config.rate_per_sqft}
                    disabled={!canEdit}
                    onChange={(e) => set("rate_per_sqft", num(e.target.value))}
                  />
                </Field>
                <Field label="External area rate per sq ft">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={config.external_rate_per_sqft}
                    disabled={!canEdit}
                    onChange={(e) =>
                      set("external_rate_per_sqft", num(e.target.value))
                    }
                  />
                </Field>
                <Field label="VAT %" hint="Applied to the quotation subtotal.">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={config.tax_rate}
                    disabled={!canEdit}
                    onChange={(e) => set("tax_rate", num(e.target.value))}
                  />
                </Field>
                <Field label="De-snag round price">
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    value={config.desnag_price}
                    disabled={!canEdit}
                    onChange={(e) => set("desnag_price", num(e.target.value))}
                  />
                </Field>
                <Field label="Additional visit price">
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    value={config.additional_visit_price}
                    disabled={!canEdit}
                    onChange={(e) =>
                      set("additional_visit_price", num(e.target.value))
                    }
                  />
                </Field>
              </div>
            </SectionCard>

            <SectionCard
              title="Multiplier by property type"
              icon={<Building2 />}
              description="The base rate is multiplied by this before VAT."
              bodyClassName="border-t"
            >
              <div className="grid gap-4 p-5 sm:grid-cols-4">
                {TYPES.map((type) => (
                  <Field key={type} label={TYPE_LABEL[type]}>
                    <Input
                      type="number"
                      min={0}
                      step="0.05"
                      value={config.multipliers?.[type] ?? 1}
                      disabled={!canEdit}
                      onChange={(e) => setMultiplier(type, num(e.target.value))}
                    />
                  </Field>
                ))}
              </div>
            </SectionCard>

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
