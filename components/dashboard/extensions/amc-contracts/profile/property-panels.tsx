"use client";

import { useEffect, useState } from "react";
import { Archive, ClipboardList, KeyRound, MoreHorizontal, Pencil, Plus, Power, Wrench } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  ACCESS_TYPES,
  ACCESS_TYPE_LABELS,
  ASSET_CONDITIONS,
  ASSET_TYPE_SUGGESTIONS,
  MONTHS,
  TRADES,
  TRADE_LABELS,
  WEEKDAY_SHORT,
} from "@/lib/amc/client-profile";
import {
  clientProfileService,
  type AccessRuleInput,
  type AccessRuleRecord,
  type AssetInput,
  type AssetRecord,
  type ScopeItemInput,
  type ScopeItemRecord,
} from "@/modules/amc-contracts/client-profile-service";
import { amcSettingsService } from "@/modules/amc-submissions/services/amc-settings-service";

import { formatContractDate } from "../contract-status";
import { useAmcData } from "../use-amc-data";

const nul = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const CONDITION_TONE: Record<string, string> = {
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  fair: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  poor: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  critical: "bg-destructive/10 text-destructive",
  unknown: "bg-muted text-muted-foreground",
};

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="text-destructive text-sm" role="alert">
      {error}
    </p>
  ) : null;
}

/* ------------------------------------------------------------------ */
/* Asset register (DEV-361)                                            */
/* ------------------------------------------------------------------ */

export function AssetsPanel({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const { data, error, loading, reload } = useAmcData(() => clientProfileService.assets(propertyId), `assets|${propertyId}`);
  const [editing, setEditing] = useState<AssetRecord | "new" | null>(null);
  const [retiring, setRetiring] = useState<AssetRecord | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const all = data?.assets ?? [];
  const assets = all.filter((a) => showRetired || a.status === "active");
  const activeUnits = all.filter((a) => a.status === "active").reduce((sum, a) => sum + a.quantity, 0);

  return (
    <SectionCard
      icon={<Wrench />}
      title="Asset register"
      description={`Type, location, make, model, serial number and condition (BRD 5.2). ${activeUnits ? `${activeUnits} active unit(s).` : ""}`}
      bodyClassName="border-t"
      action={
        <div className="flex items-center gap-2">
          {all.some((a) => a.status === "retired") ? (
            <Button size="sm" variant="ghost" onClick={() => setShowRetired((v) => !v)}>
              {showRetired ? "Hide retired" : "Show retired"}
            </Button>
          ) : null}
          {canEdit && data?.migrated !== false ? (
            <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              Add asset
            </Button>
          ) : null}
        </div>
      }
    >
      {error ? (
        <div className="p-5">
          <ErrorState title="Could not load the assets" message={error} onRetry={reload} />
        </div>
      ) : loading ? (
        <ListSkeleton rows={4} />
      ) : data?.migrated === false ? (
        <p className="text-muted-foreground px-5 py-4 text-sm">The asset register arrives with the Phase 2 database update (20261007120000).</p>
      ) : assets.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={<Wrench className="size-5" />} title="No assets yet" description="List the AC units by type and count, water heaters, pumps and boards. Visits and call outs build each asset's history." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Asset</TableHead>
                <TableHead>Trade</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Make / model</TableHead>
                <TableHead>Serial</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="w-12 pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((a) => (
                <TableRow key={a.id} className={a.status === "retired" ? "opacity-60" : undefined}>
                  <TableCell className="pl-5">
                    <div className="font-medium">{a.assetType}</div>
                    {a.status === "retired" ? (
                      <div className="text-muted-foreground text-xs">
                        Retired {a.retiredAt ? formatContractDate(a.retiredAt.slice(0, 10)) : ""}: {a.retiredReason}
                      </div>
                    ) : a.installedOn ? (
                      <div className="text-muted-foreground text-xs">Installed {formatContractDate(a.installedOn)}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{TRADE_LABELS[a.trade as keyof typeof TRADE_LABELS] ?? a.trade}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.quantity}</TableCell>
                  <TableCell>{a.location ?? "—"}</TableCell>
                  <TableCell>{[a.make, a.model].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{a.serialNo ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`border-none capitalize ${CONDITION_TONE[a.condition] ?? ""}`}>
                      {a.condition}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-5">
                    {canEdit && a.status === "active" ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${a.assetType}`}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(a)}>
                            <Pencil className="size-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRetiring(a)}>
                            <Archive className="size-4" />
                            Retire
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <AssetDialog
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === "new") await clientProfileService.addAsset(propertyId, input);
            else await clientProfileService.updateAsset(propertyId, editing.id, input);
            toast.success("Asset saved");
            setEditing(null);
            reload();
          }}
        />
      ) : null}
      {retiring ? (
        <ReasonDialog
          title={`Retire ${retiring.assetType}?`}
          description="It leaves the active register; its details and history are kept."
          label="Why is it retired?"
          placeholder="e.g. Replaced with a new unit"
          confirm="Retire"
          onClose={() => setRetiring(null)}
          onSave={async (reason) => {
            await clientProfileService.retireAsset(propertyId, retiring.id, reason);
            toast.success("Asset retired");
            setRetiring(null);
            reload();
          }}
        />
      ) : null}
    </SectionCard>
  );
}

function AssetDialog({ initial, onClose, onSave }: { initial: AssetRecord | null; onClose: () => void; onSave: (input: AssetInput) => Promise<void> }) {
  const [v, setV] = useState<AssetInput>(
    initial
      ? {
          assetType: initial.assetType,
          trade: initial.trade,
          quantity: initial.quantity,
          location: initial.location,
          make: initial.make,
          model: initial.model,
          serialNo: initial.serialNo,
          capacity: initial.capacity,
          installedOn: initial.installedOn,
          condition: initial.condition,
          notes: initial.notes,
        }
      : { assetType: "", trade: "ac", quantity: 1, condition: "unknown" },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = (k: keyof AssetInput) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const suggestions = ASSET_TYPE_SUGGESTIONS[v.trade as keyof typeof ASSET_TYPE_SUGGESTIONS] ?? [];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        ...v,
        assetType: v.assetType.trim(),
        location: nul(v.location),
        make: nul(v.make),
        model: nul(v.model),
        serialNo: nul(v.serialNo),
        capacity: nul(v.capacity),
        installedOn: v.installedOn || null,
        notes: nul(v.notes),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <ActionDialogContent busy={busy} className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit asset" : "Add asset"}</DialogTitle>
          <DialogDescription>Identical units can be one row with a quantity; a serial number means one unit.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Trade</Label>
            <Select value={v.trade} onValueChange={(trade) => setV((x) => ({ ...x, trade }))}>
              <SelectTrigger aria-label="Trade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRADES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TRADE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-type">Asset type</Label>
            <Input id="asset-type" list="asset-type-suggestions" value={v.assetType} onChange={text("assetType")} maxLength={80} placeholder="e.g. Split AC" />
            <datalist id="asset-type-suggestions">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-qty">Quantity</Label>
            <Input id="asset-qty" type="number" min={1} max={1000} value={v.quantity} onChange={(e) => setV((x) => ({ ...x, quantity: Math.max(1, Number(e.target.value) || 1) }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-location">Location</Label>
            <Input id="asset-location" value={v.location ?? ""} onChange={text("location")} maxLength={120} placeholder="e.g. Master bedroom" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-make">Make</Label>
            <Input id="asset-make" value={v.make ?? ""} onChange={text("make")} maxLength={80} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-model">Model</Label>
            <Input id="asset-model" value={v.model ?? ""} onChange={text("model")} maxLength={80} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-serial">Serial number</Label>
            <Input id="asset-serial" value={v.serialNo ?? ""} onChange={text("serialNo")} maxLength={80} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-capacity">Capacity (optional)</Label>
            <Input id="asset-capacity" value={v.capacity ?? ""} onChange={text("capacity")} maxLength={60} placeholder="e.g. 2 ton" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="asset-installed">Installed on (optional)</Label>
            <Input id="asset-installed" type="date" value={v.installedOn ?? ""} onChange={text("installedOn")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Condition</Label>
            <Select value={v.condition} onValueChange={(condition) => setV((x) => ({ ...x, condition }))}>
              <SelectTrigger aria-label="Condition">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSET_CONDITIONS.map((c) => (
                  <SelectItem key={c} value={c} className="capitalize">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="asset-notes">Notes (optional)</Label>
            <Textarea id="asset-notes" rows={2} value={v.notes ?? ""} onChange={text("notes")} maxLength={1000} />
          </div>
        </div>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !v.assetType.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

export function ReasonDialog({
  title,
  description,
  label,
  placeholder,
  confirm,
  onClose,
  onSave,
}: {
  title: string;
  description: string;
  label: string;
  placeholder?: string;
  confirm: string;
  onClose: () => void;
  onSave: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="reason-text">{label}</Label>
          <Textarea id="reason-text" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={placeholder} />
        </div>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void save()} disabled={busy || reason.trim().length < 3}>
            {busy ? "Saving…" : confirm}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Access rules (DEV-380)                                              */
/* ------------------------------------------------------------------ */

const dayList = (days: number[]) => (days.length === 0 || days.length === 7 ? "Any day" : days.map((d) => WEEKDAY_SHORT[d]).join(", "));

export function AccessRulesPanel({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const { data, error, loading, reload } = useAmcData(() => clientProfileService.accessRules(propertyId), `rules|${propertyId}`);
  const [editing, setEditing] = useState<AccessRuleRecord | "new" | null>(null);
  const { confirm, dialog } = useConfirm();

  const toggle = async (r: AccessRuleRecord) => {
    const ok = await confirm({
      title: r.active ? `Switch off ${ACCESS_TYPE_LABELS[r.accessType as keyof typeof ACCESS_TYPE_LABELS]}?` : "Switch this rule back on?",
      description: r.active ? "Visits stop asking for it. The rule stays on record." : "Visits will ask for it again.",
      confirmText: r.active ? "Switch off" : "Switch on",
      action: () => clientProfileService.updateAccessRule(propertyId, r.id, { ...ruleInput(r), active: !r.active }),
    });
    if (ok) reload();
  };

  return (
    <SectionCard
      icon={<KeyRound />}
      title="Access rules"
      description="What a visit needs before it can happen: gate pass, permits, security clearance, lift booking, keys (BRD 5.9). Visits show each rule and its status."
      bodyClassName="border-t"
      action={
        canEdit && data?.migrated !== false ? (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            Add rule
          </Button>
        ) : null
      }
    >
      {dialog}
      {error ? (
        <div className="p-5">
          <ErrorState title="Could not load the access rules" message={error} onRetry={reload} />
        </div>
      ) : loading ? (
        <ListSkeleton rows={2} />
      ) : data?.migrated === false ? (
        <p className="text-muted-foreground px-5 py-4 text-sm">Access rules arrive with the Phase 2 database update (20261007120000).</p>
      ) : (data?.rules.length ?? 0) === 0 ? (
        <div className="p-5">
          <EmptyState icon={<KeyRound className="size-5" />} title="No access rules" description="Add the community gate pass, building permit or key collection this property needs, with the lead time." />
        </div>
      ) : (
        <ul className="divide-y">
          {data!.rules.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-start gap-3 px-5 py-3.5 ${r.active ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{ACCESS_TYPE_LABELS[r.accessType as keyof typeof ACCESS_TYPE_LABELS] ?? r.accessType}</span>
                  <Badge variant="secondary" className="font-normal">
                    {r.leadTimeDays ? `${r.leadTimeDays} day(s) ahead` : "Same day"}
                  </Badge>
                  {!r.active ? <Badge variant="outline">Off</Badge> : null}
                </div>
                <div className="text-muted-foreground mt-1 text-sm">
                  {[
                    r.issuer ? `Issued by ${r.issuer}` : null,
                    `${dayList(r.permittedDays)}${r.permittedFrom && r.permittedTo ? `, ${r.permittedFrom}–${r.permittedTo}` : ""}`,
                    r.parking ? `Parking: ${r.parking}` : null,
                    r.contactName ? `Contact: ${r.contactName}${r.contactPhone ? ` (${r.contactPhone})` : ""}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {r.notes ? <p className="text-muted-foreground mt-1 text-sm">{r.notes}</p> : null}
              </div>
              {canEdit ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Rule actions">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditing(r)}>
                      <Pencil className="size-4" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void toggle(r)}>
                      <Power className="size-4" />
                      {r.active ? "Switch off" : "Switch on"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <AccessRuleDialog
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === "new") await clientProfileService.addAccessRule(propertyId, input);
            else await clientProfileService.updateAccessRule(propertyId, editing.id, { ...input, active: editing.active });
            toast.success("Access rule saved");
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </SectionCard>
  );
}

const ruleInput = (r: AccessRuleRecord): AccessRuleInput => ({
  accessType: r.accessType,
  issuer: r.issuer,
  leadTimeDays: r.leadTimeDays,
  permittedDays: r.permittedDays,
  permittedFrom: r.permittedFrom,
  permittedTo: r.permittedTo,
  parking: r.parking,
  contactName: r.contactName,
  contactPhone: r.contactPhone,
  notes: r.notes,
});

function DayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAY_SHORT.map((d, i) => (
        <label key={d} className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
          <Checkbox checked={value.includes(i)} onCheckedChange={(c) => onChange(c ? [...value, i] : value.filter((x) => x !== i))} />
          {d}
        </label>
      ))}
    </div>
  );
}

function AccessRuleDialog({ initial, onClose, onSave }: { initial: AccessRuleRecord | null; onClose: () => void; onSave: (input: AccessRuleInput) => Promise<void> }) {
  const [v, setV] = useState<AccessRuleInput>(initial ? ruleInput(initial) : { accessType: "community_gate_pass", leadTimeDays: 2, permittedDays: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = (k: keyof AccessRuleInput) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        ...v,
        issuer: nul(v.issuer),
        permittedFrom: v.permittedFrom || null,
        permittedTo: v.permittedTo || null,
        parking: nul(v.parking),
        contactName: nul(v.contactName),
        contactPhone: nul(v.contactPhone),
        notes: nul(v.notes),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <ActionDialogContent busy={busy} className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit access rule" : "Add access rule"}</DialogTitle>
          <DialogDescription>The lead time decides when the access to-do appears before a visit.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Access type</Label>
            <Select value={v.accessType} onValueChange={(accessType) => setV((x) => ({ ...x, accessType }))}>
              <SelectTrigger aria-label="Access type">
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
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-lead">Lead time (days)</Label>
            <Input id="rule-lead" type="number" min={0} max={90} value={v.leadTimeDays} onChange={(e) => setV((x) => ({ ...x, leadTimeDays: Math.max(0, Number(e.target.value) || 0) }))} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="rule-issuer">Issued by (optional)</Label>
            <Input id="rule-issuer" value={v.issuer ?? ""} onChange={text("issuer")} maxLength={200} placeholder="e.g. Emaar community management" />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Permitted days (none ticked = any day)</Label>
            <DayPicker value={v.permittedDays} onChange={(permittedDays) => setV((x) => ({ ...x, permittedDays }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-from">From (optional)</Label>
            <Input id="rule-from" type="time" value={v.permittedFrom ?? ""} onChange={text("permittedFrom")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-to">To (optional)</Label>
            <Input id="rule-to" type="time" value={v.permittedTo ?? ""} onChange={text("permittedTo")} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="rule-parking">Parking (optional)</Label>
            <Input id="rule-parking" value={v.parking ?? ""} onChange={text("parking")} maxLength={500} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-contact">Contact (optional)</Label>
            <Input id="rule-contact" value={v.contactName ?? ""} onChange={text("contactName")} maxLength={200} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-phone">Contact phone (optional)</Label>
            <Input id="rule-phone" value={v.contactPhone ?? ""} onChange={text("contactPhone")} maxLength={40} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="rule-notes">Notes (optional)</Label>
            <Textarea id="rule-notes" rows={2} value={v.notes ?? ""} onChange={text("notes")} maxLength={2000} />
          </div>
        </div>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Scope (DEV-360)                                                     */
/* ------------------------------------------------------------------ */

type CatalogueService = { id: string; label: string; frequencyPerYear?: number };

/** The trade a catalogue service belongs to, from its id (ac-ppm → AC). */
export function tradeForService(id: string): string {
  if (id.startsWith("ac")) return "ac";
  if (id.startsWith("plumbing")) return "plumbing";
  if (id.startsWith("electrical")) return "electrical";
  if (id.startsWith("handyman")) return "handyman";
  if (id.startsWith("civil")) return "civil";
  return "other";
}

function useCatalogue(): CatalogueService[] {
  const [services, setServices] = useState<CatalogueService[]>([]);
  useEffect(() => {
    let gone = false;
    amcSettingsService
      .getSettings()
      .then((r) => {
        if (!gone) setServices(r.settings.services.filter((s) => s.enabled !== false).map((s) => ({ id: s.id, label: s.label, frequencyPerYear: s.frequencyPerYear })));
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, []);
  return services;
}

export function ScopePanel({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const { data, error, loading, reload } = useAmcData(() => clientProfileService.scope(propertyId), `scope|${propertyId}`);
  const assets = useAmcData(() => clientProfileService.assets(propertyId), `assets|${propertyId}`);
  const catalogue = useCatalogue();
  const [editing, setEditing] = useState<ScopeItemRecord | "new" | null>(null);
  const { confirm, dialog } = useConfirm();
  const label = (id: string) => catalogue.find((s) => s.id === id)?.label ?? id;
  const items = (data?.items ?? []).filter((i) => i.active);

  const remove = async (i: ScopeItemRecord) => {
    const ok = await confirm({
      title: `Remove ${label(i.serviceId)} from the scope?`,
      description: "It stops being offered for proposals and the schedule. The record is kept.",
      confirmText: "Remove",
      variant: "destructive",
      action: () => clientProfileService.updateScopeItem(propertyId, i.id, { ...scopeInput(i), active: false }),
    });
    if (ok) reload();
  };

  return (
    <SectionCard
      icon={<ClipboardList />}
      title="Scope"
      description="The services this property needs, by trade, with frequency, duration, preferred months or days and exclusions (BRD 5.2). Captured once; the proposal and the PPM schedule reuse it."
      bodyClassName="border-t"
      action={
        canEdit && data?.migrated !== false ? (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            Add to scope
          </Button>
        ) : null
      }
    >
      {dialog}
      {error ? (
        <div className="p-5">
          <ErrorState title="Could not load the scope" message={error} onRetry={reload} />
        </div>
      ) : loading ? (
        <ListSkeleton rows={3} />
      ) : data?.migrated === false ? (
        <p className="text-muted-foreground px-5 py-4 text-sm">Scope capture arrives with the Phase 2 database update (20261007120000).</p>
      ) : items.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={<ClipboardList className="size-5" />} title="No scope yet" description="Add the services this property needs; the proposal starts from this list." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Service</TableHead>
                <TableHead>Trade</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Visits / year</TableHead>
                <TableHead>Preferred</TableHead>
                <TableHead>Exclusions</TableHead>
                <TableHead className="w-12 pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => {
                const asset = assets.data?.assets.find((a) => a.id === i.assetId);
                return (
                  <TableRow key={i.id}>
                    <TableCell className="pl-5">
                      <div className="font-medium">{label(i.serviceId)}</div>
                      {asset ? <div className="text-muted-foreground text-xs">For {asset.assetType}{asset.location ? `, ${asset.location}` : ""}</div> : null}
                    </TableCell>
                    <TableCell>{TRADE_LABELS[i.trade as keyof typeof TRADE_LABELS] ?? i.trade}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.frequencyPerYear ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {[i.preferredMonths.length ? i.preferredMonths.map((m) => MONTHS[m - 1]).join(", ") : null, i.preferredDays.length ? i.preferredDays.map((d) => WEEKDAY_SHORT[d]).join(", ") : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-56 truncate text-sm">{i.exclusions ?? "—"}</TableCell>
                    <TableCell className="pr-5">
                      {canEdit ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Scope item actions">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditing(i)}>
                              <Pencil className="size-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void remove(i)}>
                              <Archive className="size-4" />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <ScopeDialog
          initial={editing === "new" ? null : editing}
          catalogue={catalogue}
          assets={(assets.data?.assets ?? []).filter((a) => a.status === "active")}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === "new") await clientProfileService.addScopeItem(propertyId, input);
            else await clientProfileService.updateScopeItem(propertyId, editing.id, { ...input, active: true });
            toast.success("Scope saved");
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </SectionCard>
  );
}

const scopeInput = (i: ScopeItemRecord): ScopeItemInput => ({
  serviceId: i.serviceId,
  trade: i.trade,
  assetId: i.assetId,
  quantity: i.quantity,
  frequencyPerYear: i.frequencyPerYear,
  durationMinutes: i.durationMinutes,
  preferredMonths: i.preferredMonths,
  preferredDays: i.preferredDays,
  exclusions: i.exclusions,
  notes: i.notes,
});

function ScopeDialog({
  initial,
  catalogue,
  assets,
  onClose,
  onSave,
}: {
  initial: ScopeItemRecord | null;
  catalogue: CatalogueService[];
  assets: AssetRecord[];
  onClose: () => void;
  onSave: (input: ScopeItemInput) => Promise<void>;
}) {
  const [v, setV] = useState<ScopeItemInput>(initial ? scopeInput(initial) : { serviceId: "", trade: "ac", quantity: 1, preferredMonths: [], preferredDays: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...v, exclusions: nul(v.exclusions), notes: nul(v.notes) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <ActionDialogContent busy={busy} className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit scope item" : "Add to scope"}</DialogTitle>
          <DialogDescription>Preferred months and days set the target dates in the PPM schedule.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Service</Label>
            <Select
              value={v.serviceId}
              onValueChange={(serviceId) => {
                const s = catalogue.find((x) => x.id === serviceId);
                setV((x) => ({ ...x, serviceId, trade: tradeForService(serviceId), frequencyPerYear: x.frequencyPerYear ?? s?.frequencyPerYear ?? null }));
              }}
            >
              <SelectTrigger aria-label="Service">
                <SelectValue placeholder={catalogue.length ? "Choose a service" : "Loading services…"} />
              </SelectTrigger>
              <SelectContent>
                {catalogue.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Trade</Label>
            <Select value={v.trade} onValueChange={(trade) => setV((x) => ({ ...x, trade }))}>
              <SelectTrigger aria-label="Trade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRADES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TRADE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>For asset (optional)</Label>
            <Select value={v.assetId ?? "none"} onValueChange={(a) => setV((x) => ({ ...x, assetId: a === "none" ? null : a }))}>
              <SelectTrigger aria-label="Asset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Whole property</SelectItem>
                {assets.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.assetType}
                    {a.location ? ` · ${a.location}` : ""}
                    {a.quantity > 1 ? ` (${a.quantity})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="scope-qty">Quantity</Label>
            <Input id="scope-qty" type="number" min={1} max={1000} value={v.quantity} onChange={(e) => setV((x) => ({ ...x, quantity: Math.max(1, Number(e.target.value) || 1) }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="scope-freq">Visits a year</Label>
            <Input
              id="scope-freq"
              type="number"
              min={1}
              max={365}
              value={v.frequencyPerYear ?? ""}
              onChange={(e) => setV((x) => ({ ...x, frequencyPerYear: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="scope-duration">Duration per visit (minutes)</Label>
            <Input
              id="scope-duration"
              type="number"
              min={5}
              max={1440}
              value={v.durationMinutes ?? ""}
              onChange={(e) => setV((x) => ({ ...x, durationMinutes: e.target.value === "" ? null : Math.max(5, Number(e.target.value)) }))}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Preferred months</Label>
            <div className="flex flex-wrap gap-1.5">
              {MONTHS.map((m, idx) => (
                <label key={m} className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                  <Checkbox
                    checked={v.preferredMonths.includes(idx + 1)}
                    onCheckedChange={(c) => setV((x) => ({ ...x, preferredMonths: c ? [...x.preferredMonths, idx + 1] : x.preferredMonths.filter((n) => n !== idx + 1) }))}
                  />
                  {m}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Preferred days</Label>
            <DayPicker value={v.preferredDays} onChange={(preferredDays) => setV((x) => ({ ...x, preferredDays }))} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="scope-excl">Exclusions (optional)</Label>
            <Textarea id="scope-excl" rows={2} value={v.exclusions ?? ""} onChange={(e) => setV((x) => ({ ...x, exclusions: e.target.value }))} maxLength={2000} />
          </div>
        </div>
        <ErrorLine error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !v.serviceId}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
