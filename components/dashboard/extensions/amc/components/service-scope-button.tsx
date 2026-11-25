"use client";

import { useState } from "react";
import { CalendarCog, ChevronRight } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MONTHS, WEEKDAY_SHORT } from "@/lib/amc/client-profile";
import { clientProfileService, type ScopeItemRecord } from "@/modules/amc-contracts/client-profile-service";
import { useAmcData } from "@/components/dashboard/extensions/amc-contracts/use-amc-data";
import { ScopeDialog, tradeForService, useCatalogue } from "@/components/dashboard/extensions/amc-contracts/profile/property-panels";

/**
 * A proposal line's visit details (23 Nov 2026, the user): the property's
 * scope item for the service, edited from the services step with the same
 * dialog as the property's Scope card (asset, visits a year, duration,
 * preferred months and days, exclusions, notes). Saved on the property, so
 * the PPM schedule uses it when the contract starts. The line's price is not
 * changed by it.
 */
export function ServiceScopeButton({
  propertyId,
  serviceId,
  label,
  units,
  frequency,
  disabled = false,
  equipment,
  onEquipmentChange,
}: {
  propertyId: string | null;
  serviceId: string;
  label: string;
  units: number;
  frequency: number;
  disabled?: boolean;
  /** The line's equipment (printed on the contract), entered in the same dialog (24 Nov 2026). */
  equipment?: string | null;
  onEquipmentChange?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const scope = useAmcData(() => (propertyId ? clientProfileService.scope(propertyId) : Promise.resolve(null)), `scope|${propertyId ?? "none"}`);
  /* The last active item for the service, the one the schedule reads (it keeps the last one it meets). */
  const item: ScopeItemRecord | null = (scope.data?.items ?? []).filter((i) => i.active && i.serviceId === serviceId).at(-1) ?? null;
  const visits = item
    ? [
        item.preferredMonths.length ? item.preferredMonths.map((m) => MONTHS[m - 1]).join(", ") : "Any month",
        item.preferredDays.length ? item.preferredDays.map((d) => WEEKDAY_SHORT[d]).join(", ") : "any day",
        item.durationMinutes ? `${item.durationMinutes} min` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const equipmentText = equipment?.trim() || null;
  const filled = Boolean(item || equipmentText);
  const summary = [equipmentText, visits].filter(Boolean).join(" · ") || (onEquipmentChange ? "Add equipment, months, days" : "Add months, days, duration");

  /*
    One field-like button (24 Nov 2026): built like the Equipment field
    beside it (same height, corners, a muted label inside, the value after
    it), so the two read as a pair rather than a button and a stray note.
  */
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn(
          /* Built like the inputs beside it: same border, fill, height and corners. */
          "border-input dark:bg-input/30 dark:hover:bg-input/50 h-8 w-full max-w-[360px] min-w-0 justify-start gap-1.5 rounded-[12px] px-2.5 text-xs font-normal shadow-none",
        )}
        disabled={disabled || !propertyId || scope.data?.migrated === false}
        title={propertyId ? (filled ? `Details: ${summary}` : "Add the equipment and visit details for this service") : "Choose the property in step 1 first"}
        aria-label={`Details for ${label}${filled ? `: ${summary}` : ""}`}
        onClick={() => setOpen(true)}
      >
        <CalendarCog className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <span className="text-muted-foreground shrink-0 text-[11px] font-medium">Details</span>
        <span className={cn("min-w-0 flex-1 truncate text-left", !filled && "text-muted-foreground")}>{propertyId ? summary : "Choose the property first"}</span>
        <ChevronRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      </Button>
      {open && propertyId ? (
        <ScopeEditor
          propertyId={propertyId}
          item={item}
          serviceId={serviceId}
          label={label}
          units={units}
          frequency={frequency}
          equipment={equipment ?? ""}
          onEquipmentChange={onEquipmentChange}
          onClose={() => setOpen(false)}
          onSaved={scope.reload}
        />
      ) : null}
    </>
  );
}

/* Loaded only when opened: the catalogue and the property's assets. */
function ScopeEditor({
  propertyId,
  item,
  serviceId,
  label,
  units,
  frequency,
  equipment,
  onEquipmentChange,
  onClose,
  onSaved,
}: {
  propertyId: string;
  item: ScopeItemRecord | null;
  serviceId: string;
  label: string;
  units: number;
  frequency: number;
  equipment: string;
  onEquipmentChange?: (value: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const catalogue = useCatalogue();
  /* The line's equipment, kept here until Save (24 Nov 2026). */
  const [kit, setKit] = useState(equipment);
  const assets = useAmcData(() => clientProfileService.assets(propertyId), `assets|${propertyId}`);
  return (
    <ScopeDialog
      open
      onOpenChange={(next) => !next && onClose()}
      initial={item}
      catalogue={catalogue}
      assets={(assets.data?.assets ?? []).filter((a) => a.status === "active")}
      lockService
      title={`Details: ${label}`}
      description="The equipment goes on the proposal and the contract. The visit details are saved on the property, and the PPM schedule uses them when the contract starts."
      lead={
        onEquipmentChange ? (
          <>
            <Label htmlFor="scope-equipment">Equipment (on the proposal)</Label>
            <Input id="scope-equipment" placeholder="e.g. 10 FCU" maxLength={80} value={kit} onChange={(e) => setKit(e.target.value)} />
          </>
        ) : undefined
      }
      defaults={{ serviceId, trade: tradeForService(serviceId), quantity: Math.max(1, Math.round(units) || 1), frequencyPerYear: Math.max(1, Math.round(frequency) || 1) }}
      onSave={async (input) => {
        if (item) await clientProfileService.updateScopeItem(propertyId, item.id, { ...input, serviceId, active: true });
        else await clientProfileService.addScopeItem(propertyId, { ...input, serviceId });
        if (onEquipmentChange && kit !== equipment) onEquipmentChange(kit);
        toast.success(onEquipmentChange ? "Details saved" : "Visit details saved on the property");
        onSaved();
      }}
    />
  );
}
