"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService, type SnaggingPricingConfig } from "@/modules/snagging";
import { ActionType, ResourceType } from "@/types/types";

import { PageHeading, SectionCard } from "./shared";

const TYPES = ["apartment", "villa", "townhouse", "commercial"] as const;
const TYPE_LABEL: Record<string, string> = {
  apartment: "Apartment",
  villa: "Villa",
  townhouse: "Townhouse",
  commercial: "Commercial",
};

/** Admin pricing formula, scope of work and terms (F7-F10). */
export default function PricingSettings() {
  const { user } = useAuth();
  const canEdit = hasResourceAction(user, ResourceType.SNAGGING_CATALOGUE, ActionType.EDIT);
  const [config, setConfig] = useState<SnaggingPricingConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    snaggingService
      .getPricing()
      .then(setConfig)
      .catch(() => toast.error("Could not load pricing"));
  }, []);

  function set<K extends keyof SnaggingPricingConfig>(key: K, value: SnaggingPricingConfig[K]) {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  }
  function setMultiplier(type: string, value: number) {
    setConfig((c) => (c ? { ...c, multipliers: { ...c.multipliers, [type]: value } } : c));
  }

  async function save() {
    if (!config || saving) return;
    setSaving(true);
    try {
      const saved = await snaggingService.updatePricing(config);
      setConfig(saved);
      toast.success("Pricing saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save pricing");
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return <p className="text-muted-foreground p-6 text-sm">Loading pricing…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Master data"
        title="Snagging pricing"
        description="The rate per square foot, the multiplier by property type, and the scope and terms on every quotation. Admin only."
      />

      <SectionCard title="Rates" bodyClassName="border-t">
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Rate per sq ft ({config.currency})</Label>
            <Input
              type="number"
              value={config.rate_per_sqft}
              disabled={!canEdit}
              onChange={(e) => set("rate_per_sqft", Number(e.target.value))}
            />
          </div>
          <div>
            <Label className="text-xs">External area rate per sq ft</Label>
            <Input
              type="number"
              value={config.external_rate_per_sqft}
              disabled={!canEdit}
              onChange={(e) => set("external_rate_per_sqft", Number(e.target.value))}
            />
          </div>
          <div>
            <Label className="text-xs">VAT %</Label>
            <Input
              type="number"
              value={config.tax_rate}
              disabled={!canEdit}
              onChange={(e) => set("tax_rate", Number(e.target.value))}
            />
          </div>
          <div>
            <Label className="text-xs">De-snag round price</Label>
            <Input
              type="number"
              value={config.desnag_price}
              disabled={!canEdit}
              onChange={(e) => set("desnag_price", Number(e.target.value))}
            />
          </div>
          <div>
            <Label className="text-xs">Additional visit price</Label>
            <Input
              type="number"
              value={config.additional_visit_price}
              disabled={!canEdit}
              onChange={(e) => set("additional_visit_price", Number(e.target.value))}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Multiplier by property type" bodyClassName="border-t">
        <div className="grid gap-4 p-5 sm:grid-cols-4">
          {TYPES.map((type) => (
            <div key={type}>
              <Label className="text-xs">{TYPE_LABEL[type]}</Label>
              <Input
                type="number"
                step="0.05"
                value={config.multipliers?.[type] ?? 1}
                disabled={!canEdit}
                onChange={(e) => setMultiplier(type, Number(e.target.value))}
              />
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Scope of work &amp; terms" bodyClassName="border-t">
        <div className="space-y-4 p-5">
          <div>
            <Label className="text-xs">Scope of work</Label>
            <Textarea
              rows={4}
              value={config.scope_of_work ?? ""}
              disabled={!canEdit}
              onChange={(e) => set("scope_of_work", e.target.value)}
              placeholder="What the snagging inspection covers…"
            />
          </div>
          <div>
            <Label className="text-xs">Terms &amp; conditions</Label>
            <Textarea
              rows={6}
              value={config.terms ?? ""}
              disabled={!canEdit}
              onChange={(e) => set("terms", e.target.value)}
              placeholder="Snagging-specific terms (client not present, utilities not connected, unit unfinished…)"
            />
          </div>
        </div>
      </SectionCard>

      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save pricing
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">Only an admin can change these values.</p>
      )}
    </div>
  );
}
