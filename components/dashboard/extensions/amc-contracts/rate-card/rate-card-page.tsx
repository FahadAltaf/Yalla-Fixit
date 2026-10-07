"use client";

import { useState } from "react";
import { BadgePercent, History, Package, Pencil, Plus, Send, Tags, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { PageHeading, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, HeadingSkeleton, SectionSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  MODEL_LABELS,
  PROPERTY_MODELS,
  RATE_BASES,
  RATE_BASIS_LABELS,
  diffRateCards,
  emptyRateCard,
  packageSchema,
  promotionSchema,
  rateCardSchema,
  rateItemSchema,
  type PropertyModel,
  type RateCard,
  type RateItem,
  type RatePackage,
  type RatePromotion,
} from "@/lib/amc/rate-card";
import { proposalRulesService, type RateCardResponse, type RateCardVersion } from "@/modules/amc-submissions";
import { formatCurrencyAED } from "@/utils/format-currency";

import { AmcSectionNav } from "../amc-section-nav";
import { useUrlTab } from "../profile/use-url-tab";
import { useAmcData } from "../use-amc-data";

const TABS = ["rates", "packages", "promotions", "history"] as const;
const dmy = (iso: string) => iso.split("-").reverse().join("/");
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "item";
const uniqueId = (base: string, taken: string[]) => {
  let id = slug(base);
  let n = 2;
  while (taken.includes(id)) id = `${slug(base)}-${n++}`;
  return id;
};
const firstIssue = (result: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
  result.success ? null : (result.error?.issues[0]?.message ?? "Check the values");

/**
 * The governed rate card (BRD 5.3, DEV-363). Everyone with AMC Rate Card
 * View reads it; the department head and Finance (Edit) change a working
 * copy and publish it as a new version, effective from a date and with a
 * reason. Published versions are never edited, so every old rate stays on
 * record, and History shows who changed what, from and to which value.
 */
export function RateCardPage() {
  useBreadcrumbLabel("rate-card", "Rate card");
  const { data, error, loading, reload } = useAmcData(() => proposalRulesService.rateCard(), "rate-card");
  const { tab, setTab, isOpened } = useUrlTab(TABS, "rates");
  /* The working copy; null = not editing. */
  const [draft, setDraft] = useState<RateCard | null>(null);
  const [publishing, setPublishing] = useState(false);

  if (loading) {
    if (error) return <ErrorState title="Could not load the rate card" message={error} onRetry={reload} />;
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <HeadingSkeleton withActions />
        <SectionSkeleton />
      </div>
    );
  }
  if (error || !data) return <ErrorState title="Could not load the rate card" message={error} onRetry={reload} />;

  const inForce = data.versions.find((v) => v.id === data.inForceId) ?? null;
  const scheduled = data.versions.filter((v) => v.effectiveFrom > data.today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const base = scheduled.at(-1)?.card ?? inForce?.card ?? emptyRateCard();
  const card = draft ?? base;
  const editing = draft !== null;
  const label = (id: string) => data.services.find((s) => s.id === id)?.label ?? id;
  const changes = editing ? diffRateCards(base, draft, label) : [];
  const problem = editing ? rateCardProblem(draft) : null;
  const panel = (value: (typeof TABS)[number], children: React.ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="flex flex-col gap-6 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="AMC"
        title="Rate card"
        description="The rates every proposal is priced from: per service and property model, with a floor, the frequencies allowed, packages and promotions."
        actions={
          data.canEdit && data.migrated ? (
            editing ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setDraft(null)}>
                  <Undo2 className="size-4" />
                  Discard changes
                </Button>
                <Button onClick={() => setPublishing(true)} disabled={changes.length === 0 || !!problem}>
                  <Send className="size-4" />
                  Publish ({changes.length})
                </Button>
              </div>
            ) : (
              <Button onClick={() => setDraft(structuredClone(base))}>
                <Pencil className="size-4" />
                Change the card
              </Button>
            )
          ) : null
        }
      />
      <AmcSectionNav current="rate-card" />

      {!data.migrated ? (
        <SectionCard title="Rate card" icon={<Tags />} bodyClassName="px-5 pb-5">
          <p className="text-muted-foreground text-sm">
            The rate card arrives with the AMC database update 20261007140000. Until then proposals are priced with the base prices entered on them.
          </p>
        </SectionCard>
      ) : (
        <>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            {inForce ? (
              <span>
                In force: <span className="text-foreground font-medium">V{inForce.versionNo}</span> since {dmy(inForce.effectiveFrom)}
              </span>
            ) : (
              <span>No card is in force yet: proposals are priced with the base prices entered on them.</span>
            )}
            {scheduled.map((v) => (
              <Badge key={v.id} variant="outline" className="font-normal">
                V{v.versionNo} from {dmy(v.effectiveFrom)}
              </Badge>
            ))}
            {editing ? (
              <Badge variant="secondary" className="border-none bg-amber-500/10 font-normal text-amber-700 dark:text-amber-400">
                Editing a working copy: {changes.length} change{changes.length === 1 ? "" : "s"} not published
              </Badge>
            ) : null}
            {problem ? <span className="text-destructive">{problem}</span> : null}
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="rates">Rates ({card.items.filter((i) => !i.retired).length})</TabsTrigger>
              <TabsTrigger value="packages">Packages ({card.packages.length})</TabsTrigger>
              <TabsTrigger value="promotions">Promotions ({card.promotions.length})</TabsTrigger>
              <TabsTrigger value="history">History ({data.versions.length})</TabsTrigger>
            </TabsList>
            {panel("rates", <RatesTab card={card} editing={editing} services={data.services} onChange={setDraft} />)}
            {panel("packages", <PackagesTab card={card} editing={editing} services={data.services} onChange={setDraft} />)}
            {panel("promotions", <PromotionsTab card={card} editing={editing} services={data.services} today={data.today} onChange={setDraft} />)}
            {panel("history", <HistoryTab versions={data.versions} label={label} />)}
          </Tabs>
        </>
      )}

      {publishing && draft ? (
        <PublishDialog
          today={data.today}
          changes={changes.length}
          onClose={() => setPublishing(false)}
          onPublish={async (effectiveFrom, reason) => {
            const { version } = await proposalRulesService.publishRateCard({ card: draft, effectiveFrom, reason });
            toast.success(`Rate card V${version.versionNo} published, effective ${dmy(version.effectiveFrom)}`);
            setPublishing(false);
            setDraft(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

type Services = RateCardResponse["services"];

/* ------------------------------------------------------------------ */
/* Rates                                                               */
/* ------------------------------------------------------------------ */

function RatesTab({ card, editing, services, onChange }: { card: RateCard; editing: boolean; services: Services; onChange: (card: RateCard) => void }) {
  const [editingItem, setEditingItem] = useState<RateItem | "new" | null>(null);
  const label = (id: string) => services.find((s) => s.id === id)?.label ?? id;
  const items = [...card.items].sort((a, b) => label(a.serviceId).localeCompare(label(b.serviceId)) || a.model.localeCompare(b.model));
  const save = (item: RateItem) => {
    const exists = card.items.some((i) => i.id === item.id);
    onChange({ ...card, items: exists ? card.items.map((i) => (i.id === item.id ? item : i)) : [...card.items, item] });
    setEditingItem(null);
  };

  return (
    <SectionCard
      title="Rates"
      icon={<Tags />}
      description="Line value = rate × units × frequency. A proposal discounted under a floor rate needs approval."
      bodyClassName="pb-2"
      action={
        editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditingItem("new")}>
            <Plus className="size-4" />
            Add a rate
          </Button>
        ) : null
      }
    >
      {items.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState icon={<Tags className="size-5" />} title="No rates yet" description={editing ? "Add a rate for each service you offer." : "Change the card to add rates."} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Service</TableHead>
                <TableHead>Property model</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Standard</TableHead>
                <TableHead className="text-right">Floor</TableHead>
                <TableHead>Frequencies</TableHead>
                <TableHead>Status</TableHead>
                {editing ? <TableHead className="pr-5 text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} className={item.retired ? "opacity-60" : undefined}>
                  <TableCell className="pl-5 text-sm font-medium">{label(item.serviceId)}</TableCell>
                  <TableCell className="text-sm">{MODEL_LABELS[item.model]}</TableCell>
                  <TableCell className="text-sm">
                    {item.unit}
                    <div className="text-muted-foreground text-xs">{RATE_BASIS_LABELS[item.basis]}</div>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatCurrencyAED(item.standardRate)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatCurrencyAED(item.floorRate)}</TableCell>
                  <TableCell className="text-sm">{item.allowedFrequencies.length ? `${item.allowedFrequencies.join(", ")} a year` : "Any"}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={`border-none font-normal ${item.retired ? "bg-muted text-muted-foreground" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"}`}
                    >
                      {item.retired ? "Retired" : "Active"}
                    </Badge>
                  </TableCell>
                  {editing ? (
                    <TableCell className="pr-5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditingItem(item)} aria-label={`Edit ${label(item.serviceId)}`}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onChange({ ...card, items: card.items.map((i) => (i.id === item.id ? { ...i, retired: !i.retired } : i)) })}
                      >
                        {item.retired ? "Restore" : "Retire"}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editingItem ? (
        <RateDialog
          item={editingItem === "new" ? null : editingItem}
          services={services}
          takenIds={card.items.map((i) => i.id)}
          onClose={() => setEditingItem(null)}
          onSave={save}
        />
      ) : null}
    </SectionCard>
  );
}

function RateDialog({
  item,
  services,
  takenIds,
  onClose,
  onSave,
}: {
  item: RateItem | null;
  services: Services;
  takenIds: string[];
  onClose: () => void;
  onSave: (item: RateItem) => void;
}) {
  const [value, setValue] = useState({
    serviceId: item?.serviceId ?? services[0]?.id ?? "",
    model: item?.model ?? ("any" as RateItem["model"]),
    unit: item?.unit ?? "per property",
    basis: item?.basis ?? ("per_property" as RateItem["basis"]),
    standardRate: item ? String(item.standardRate) : "",
    floorRate: item ? String(item.floorRate) : "",
    frequencies: item?.allowedFrequencies.join(", ") ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof value>) => setValue((v) => ({ ...v, ...patch }));

  const save = () => {
    const candidate = {
      id: item?.id ?? uniqueId(`${value.serviceId}-${value.model}`, takenIds),
      serviceId: value.serviceId,
      model: value.model,
      unit: value.unit,
      basis: value.basis,
      standardRate: Number(value.standardRate),
      floorRate: Number(value.floorRate),
      allowedFrequencies: value.frequencies
        .split(/[,\s]+/)
        .filter(Boolean)
        .map(Number),
      retired: item?.retired ?? false,
    };
    const parsed = rateItemSchema.safeParse(candidate);
    if (!parsed.success) return setError(firstIssue(parsed));
    onSave(parsed.data);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <ActionDialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Edit rate" : "Add a rate"}</DialogTitle>
          <DialogDescription>Saved to the working copy. Nothing changes for proposals until the card is published.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Service</Label>
            <Select value={value.serviceId} onValueChange={(serviceId) => set({ serviceId })} disabled={!!item}>
              <SelectTrigger aria-label="Service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Property model</Label>
            <Select value={value.model} onValueChange={(model) => set({ model: model as RateItem["model"] })}>
              <SelectTrigger aria-label="Property model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["any", ...PROPERTY_MODELS] as const).map((m) => (
                  <SelectItem key={m} value={m}>
                    {MODEL_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Counted</Label>
            <Select value={value.basis} onValueChange={(basis) => set({ basis: basis as RateItem["basis"] })}>
              <SelectTrigger aria-label="How the rate is counted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RATE_BASES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {RATE_BASIS_LABELS[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="rate-unit">Unit (as it reads to the client)</Label>
            <Input id="rate-unit" value={value.unit} onChange={(e) => set({ unit: e.target.value })} maxLength={60} placeholder="per AC unit" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rate-standard">Standard rate (AED)</Label>
            <Input id="rate-standard" type="number" min={0} step="0.01" value={value.standardRate} onChange={(e) => set({ standardRate: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rate-floor">Floor rate (AED)</Label>
            <Input id="rate-floor" type="number" min={0} step="0.01" value={value.floorRate} onChange={(e) => set({ floorRate: e.target.value })} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="rate-freq">Frequencies allowed a year (blank: any)</Label>
            <Input id="rate-freq" value={value.frequencies} onChange={(e) => set({ frequencies: e.target.value })} placeholder="2, 4, 6" />
          </div>
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save to working copy</Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Packages                                                            */
/* ------------------------------------------------------------------ */

function PackagesTab({ card, editing, services, onChange }: { card: RateCard; editing: boolean; services: Services; onChange: (card: RateCard) => void }) {
  const [editingPkg, setEditingPkg] = useState<RatePackage | "new" | null>(null);
  const label = (id: string) => services.find((s) => s.id === id)?.label ?? id;
  return (
    <SectionCard
      title="Packages"
      icon={<Package />}
      description="Preset service sets, as in the brochure. Picking one in the wizard ticks its services with these units and visits."
      bodyClassName="px-5 pb-5"
      action={
        editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditingPkg("new")}>
            <Plus className="size-4" />
            Add a package
          </Button>
        ) : null
      }
    >
      {card.packages.length === 0 ? (
        <EmptyState icon={<Package className="size-5" />} title="No packages" description="Packages are optional: proposals can always pick services one by one." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {card.packages.map((p) => (
            <div key={p.id} className={`rounded-lg border p-4 ${p.active ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-muted-foreground text-xs">{p.models.length ? p.models.map((m) => MODEL_LABELS[m]).join(", ") : "Every property model"}</div>
                </div>
                {editing ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditingPkg(p)} aria-label={`Edit ${p.name}`}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onChange({ ...card, packages: card.packages.filter((x) => x.id !== p.id) })} aria-label={`Remove ${p.name}`}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ) : !p.active ? (
                  <Badge variant="secondary">Inactive</Badge>
                ) : null}
              </div>
              {p.description ? <p className="text-muted-foreground mt-2 text-sm">{p.description}</p> : null}
              <ul className="mt-2 space-y-0.5 text-sm">
                {p.lines.map((l) => (
                  <li key={l.serviceId}>
                    {label(l.serviceId)} <span className="text-muted-foreground">· {l.units} unit(s) × {l.frequency} a year</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {editingPkg ? (
        <PackageDialog
          pkg={editingPkg === "new" ? null : editingPkg}
          services={services}
          takenIds={card.packages.map((p) => p.id)}
          onClose={() => setEditingPkg(null)}
          onSave={(pkg) => {
            const exists = card.packages.some((p) => p.id === pkg.id);
            onChange({ ...card, packages: exists ? card.packages.map((p) => (p.id === pkg.id ? pkg : p)) : [...card.packages, pkg] });
            setEditingPkg(null);
          }}
        />
      ) : null}
    </SectionCard>
  );
}

function PackageDialog({
  pkg,
  services,
  takenIds,
  onClose,
  onSave,
}: {
  pkg: RatePackage | null;
  services: Services;
  takenIds: string[];
  onClose: () => void;
  onSave: (pkg: RatePackage) => void;
}) {
  const [value, setValue] = useState<RatePackage>(
    pkg ?? { id: "", name: "", description: "", models: [], lines: [{ serviceId: services[0]?.id ?? "", units: 1, frequency: 1 }], active: true },
  );
  const [error, setError] = useState<string | null>(null);
  const setLine = (index: number, patch: Partial<RatePackage["lines"][number]>) =>
    setValue((v) => ({ ...v, lines: v.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  const save = () => {
    const parsed = packageSchema.safeParse({ ...value, id: pkg?.id ?? uniqueId(value.name, takenIds) });
    if (!parsed.success) return setError(firstIssue(parsed));
    onSave(parsed.data);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <ActionDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{pkg ? `Edit ${pkg.name}` : "Add a package"}</DialogTitle>
          <DialogDescription>Saved to the working copy until the card is published.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="pkg-name">Name</Label>
            <Input id="pkg-name" value={value.name} onChange={(e) => setValue((v) => ({ ...v, name: e.target.value }))} maxLength={80} placeholder="Gold" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pkg-desc">Description</Label>
            <Textarea id="pkg-desc" rows={2} value={value.description} onChange={(e) => setValue((v) => ({ ...v, description: e.target.value }))} maxLength={500} />
          </div>
          <div className="grid gap-1.5">
            <Label>Offered on (none ticked: every model)</Label>
            <div className="flex flex-wrap gap-4">
              {PROPERTY_MODELS.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={value.models.includes(m)}
                    onCheckedChange={(checked) =>
                      setValue((v) => ({ ...v, models: checked === true ? [...v.models, m] : v.models.filter((x: PropertyModel) => x !== m) }))
                    }
                  />
                  {MODEL_LABELS[m]}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Services</Label>
            {value.lines.map((line, index) => (
              <div key={index} className="flex items-center gap-2">
                <Select value={line.serviceId} onValueChange={(serviceId) => setLine(index, { serviceId })}>
                  <SelectTrigger className="flex-1" aria-label={`Service ${index + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input className="w-16" type="number" min={1} value={line.units} onChange={(e) => setLine(index, { units: Math.max(1, Number(e.target.value) || 1) })} aria-label="Units" />
                <Input className="w-16" type="number" min={1} value={line.frequency} onChange={(e) => setLine(index, { frequency: Math.max(1, Number(e.target.value) || 1) })} aria-label="Visits a year" />
                <Button size="icon" variant="ghost" className="size-8" disabled={value.lines.length <= 1} onClick={() => setValue((v) => ({ ...v, lines: v.lines.filter((_, i) => i !== index) }))} aria-label="Remove service">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => setValue((v) => ({ ...v, lines: [...v.lines, { serviceId: services[0]?.id ?? "", units: 1, frequency: 1 }] }))}
            >
              <Plus className="size-4" />
              Add a service
            </Button>
            <p className="text-muted-foreground text-xs">Units, then visits a year.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={value.active} onCheckedChange={(active) => setValue((v) => ({ ...v, active }))} />
            Offered in the wizard
          </label>
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save to working copy</Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Promotions                                                          */
/* ------------------------------------------------------------------ */

function PromotionsTab({
  card,
  editing,
  services,
  today,
  onChange,
}: {
  card: RateCard;
  editing: boolean;
  services: Services;
  today: string;
  onChange: (card: RateCard) => void;
}) {
  const [editingPromo, setEditingPromo] = useState<RatePromotion | "new" | null>(null);
  const label = (id: string) => services.find((s) => s.id === id)?.label ?? id;
  const state = (p: RatePromotion) => (!p.active ? "Off" : p.endDate < today ? "Ended" : p.startDate > today ? "Scheduled" : "Running");
  return (
    <SectionCard
      title="Promotions"
      icon={<BadgePercent />}
      description="A promotion in date reduces the rate automatically on new proposals. It never counts as going under the floor on its own."
      bodyClassName="pb-2"
      action={
        editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditingPromo("new")}>
            <Plus className="size-4" />
            Add a promotion
          </Button>
        ) : null
      }
    >
      {card.promotions.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState icon={<BadgePercent className="size-5" />} title="No promotions" description="Add one with start and end dates when a campaign runs." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Promotion</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Off</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>Status</TableHead>
                {editing ? <TableHead className="pr-5 text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {card.promotions.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-5 text-sm font-medium">{p.name}</TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {dmy(p.startDate)} – {dmy(p.endDate)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{p.percentOff}%</TableCell>
                  <TableCell className="text-sm">
                    {p.serviceIds.length ? p.serviceIds.map(label).join(", ") : "Every service"}
                    <div className="text-muted-foreground text-xs">{p.models.length ? p.models.map((m) => MODEL_LABELS[m]).join(", ") : "Every model"}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">
                      {state(p)}
                    </Badge>
                  </TableCell>
                  {editing ? (
                    <TableCell className="pr-5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditingPromo(p)} aria-label={`Edit ${p.name}`}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onChange({ ...card, promotions: card.promotions.filter((x) => x.id !== p.id) })} aria-label={`Remove ${p.name}`}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editingPromo ? (
        <PromotionDialog
          promo={editingPromo === "new" ? null : editingPromo}
          services={services}
          today={today}
          takenIds={card.promotions.map((p) => p.id)}
          onClose={() => setEditingPromo(null)}
          onSave={(promo) => {
            const exists = card.promotions.some((p) => p.id === promo.id);
            onChange({ ...card, promotions: exists ? card.promotions.map((p) => (p.id === promo.id ? promo : p)) : [...card.promotions, promo] });
            setEditingPromo(null);
          }}
        />
      ) : null}
    </SectionCard>
  );
}

function PromotionDialog({
  promo,
  services,
  today,
  takenIds,
  onClose,
  onSave,
}: {
  promo: RatePromotion | null;
  services: Services;
  today: string;
  takenIds: string[];
  onClose: () => void;
  onSave: (promo: RatePromotion) => void;
}) {
  const [value, setValue] = useState<RatePromotion>(
    promo ?? { id: "", name: "", startDate: today, endDate: today, percentOff: 10, serviceIds: [], models: [], active: true },
  );
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const parsed = promotionSchema.safeParse({ ...value, id: promo?.id ?? uniqueId(value.name, takenIds) });
    if (!parsed.success) return setError(firstIssue(parsed));
    onSave(parsed.data);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <ActionDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{promo ? `Edit ${promo.name}` : "Add a promotion"}</DialogTitle>
          <DialogDescription>Saved to the working copy until the card is published.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="promo-name">Name</Label>
            <Input id="promo-name" value={value.name} onChange={(e) => setValue((v) => ({ ...v, name: e.target.value }))} maxLength={80} placeholder="Summer AC offer" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="promo-start">Starts</Label>
            <Input id="promo-start" type="date" value={value.startDate} onChange={(e) => setValue((v) => ({ ...v, startDate: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="promo-end">Ends</Label>
            <Input id="promo-end" type="date" value={value.endDate} onChange={(e) => setValue((v) => ({ ...v, endDate: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="promo-off">Percent off</Label>
            <Input id="promo-off" type="number" min={1} max={100} value={value.percentOff} onChange={(e) => setValue((v) => ({ ...v, percentOff: Number(e.target.value) || 0 }))} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Switch checked={value.active} onCheckedChange={(active) => setValue((v) => ({ ...v, active }))} />
            On
          </label>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Services (none ticked: every service)</Label>
            <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={value.serviceIds.includes(s.id)}
                    onCheckedChange={(checked) =>
                      setValue((v) => ({ ...v, serviceIds: checked === true ? [...v.serviceIds, s.id] : v.serviceIds.filter((x) => x !== s.id) }))
                    }
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Property models (none ticked: every model)</Label>
            <div className="flex flex-wrap gap-4">
              {PROPERTY_MODELS.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={value.models.includes(m)}
                    onCheckedChange={(checked) =>
                      setValue((v) => ({ ...v, models: checked === true ? [...v.models, m] : v.models.filter((x: PropertyModel) => x !== m) }))
                    }
                  />
                  {MODEL_LABELS[m]}
                </label>
              ))}
            </div>
          </div>
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save to working copy</Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* History and publishing                                              */
/* ------------------------------------------------------------------ */

const show = (value: unknown) => (value === null || value === undefined ? "—" : Array.isArray(value) ? value.join(", ") || "—" : String(value));

function HistoryTab({ versions, label }: { versions: RateCardVersion[]; label: (id: string) => string }) {
  /* Newest first; each compared with the one published before it. */
  return (
    <SectionCard title="History" icon={<History />} description="Every published version: who, when, from which date, why, and each old and new value (BRD 5.3)." bodyClassName="border-t">
      {versions.length === 0 ? (
        <p className="text-muted-foreground px-5 py-4 text-sm">Nothing published yet.</p>
      ) : (
        <ul className="divide-y">
          {versions.map((v, index) => {
            const previous = versions[index + 1];
            const changes = diffRateCards(previous?.card ?? emptyRateCard(), v.card, label);
            return (
              <li key={v.id} className="px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">V{v.versionNo}</Badge>
                  <span className="font-medium">Effective {dmy(v.effectiveFrom)}</span>
                  <span className="text-muted-foreground ml-auto text-xs">
                    {new Date(v.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" })} · {v.changedBy ?? "—"}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1">{v.reason}</p>
                {!v.valid ? <p className="text-destructive mt-1 text-xs">This version&apos;s stored card no longer validates; it prices nothing.</p> : null}
                {changes.length ? (
                  <ul className="mt-2 space-y-1">
                    {changes.slice(0, 50).map((c) => (
                      <li key={`${c.kind}-${c.id}`} className="text-xs">
                        <span className="font-medium">{c.label}</span>{" "}
                        <span className="text-muted-foreground">
                          {c.change === "added" ? `${c.kind} added` : c.change === "removed" ? `${c.kind} removed` : c.fields.map((f) => `${f.field}: ${show(f.before)} → ${show(f.after)}`).join("; ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function PublishDialog({
  today,
  changes,
  onClose,
  onPublish,
}: {
  today: string;
  changes: number;
  onClose: () => void;
  onPublish: (effectiveFrom: string, reason: string) => Promise<void>;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await onPublish(effectiveFrom, reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish.");
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !busy && !open && onClose()}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish the rate card</DialogTitle>
          <DialogDescription>
            {changes} change{changes === 1 ? "" : "s"} become a new version. Proposals already shared keep the rates they were priced at; drafts take the new rates
            from the effective date.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="publish-from">Effective from</Label>
            <Input id="publish-from" type="date" min={today} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="publish-reason">Why</Label>
            <Textarea id="publish-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. 2027 rates agreed with Finance" />
          </div>
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void publish()} disabled={busy || reason.trim().length < 3 || !effectiveFrom || effectiveFrom < today}>
            {busy ? "Publishing…" : "Publish"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* Rules for the card as a whole (two active rates for one service and model…); the server checks again on publish. */
function rateCardProblem(card: RateCard): string | null {
  return firstIssue(rateCardSchema.safeParse(card));
}
