"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Archive,
  ArchiveRestore,
  BadgePercent,
  Building2,
  CalendarRange,
  History,
  Info,
  Package,
  Pencil,
  Plus,
  Send,
  Tags,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { IconText } from "@/components/data-table/columns/icon-text";
import { DataRow, PageHeading, SectionCard, TabCount } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, HeadingSkeleton, SectionSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import { cn } from "@/lib/utils";
import { proposalRulesService, type RateCardResponse, type RateCardVersion } from "@/modules/amc-submissions";
import { formatCurrencyAED } from "@/utils/format-currency";

import { AmcNotificationsBell } from "../amc-notifications-bell";
import { ConfigTableToolbar, LocalDataTable, RowActionsMenu } from "../config-table";
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

/* Status badges in the theme's tones, as Snagging's are. */
const TONE = {
  good: "bg-success/10 text-success",
  info: "bg-brand-50 text-brand",
  neutral: "bg-mist text-ink-soft",
} as const;
function Tone({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", TONE[tone])}>
      {children}
    </Badge>
  );
}

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

  const heading = (actions?: React.ReactNode) => (
    <PageHeading
      eyebrow="Pricing"
      title="Rate card"
      description="The rates every proposal is priced from: per service and property model, with a floor, the frequencies allowed, packages and promotions."
      actions={
        <>
          <AmcNotificationsBell />
          {actions}
        </>
      }
    />
  );

  if (loading) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <HeadingSkeleton withActions />
        <SectionSkeleton />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        {heading()}
        <ErrorState title="Could not load the rate card" message={error} onRetry={reload} />
      </div>
    );
  }

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
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-6 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {heading(
        data.canEdit && data.migrated ? (
          editing ? (
            <>
              <Button variant="outline" onClick={() => setDraft(null)}>
                <Undo2 className="size-4" />
                Discard changes
              </Button>
              <Button onClick={() => setPublishing(true)} disabled={changes.length === 0 || !!problem}>
                <Send className="size-4" />
                Publish ({changes.length})
              </Button>
            </>
          ) : (
            <Button onClick={() => setDraft(structuredClone(base))}>
              <Pencil className="size-4" />
              Change the card
            </Button>
          )
        ) : null,
      )}

      {!data.migrated ? (
        <Alert>
          <Info />
          <AlertTitle>The rate card has not been loaded yet</AlertTitle>
          <AlertDescription>
            It arrives with the AMC database update 20261007140000. Until then proposals are priced with the base prices entered on them.
          </AlertDescription>
        </Alert>
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
              <Tone key={v.id} tone="info">
                V{v.versionNo} from {dmy(v.effectiveFrom)}
              </Tone>
            ))}
          </div>

          {/* A working copy is a state worth seeing from every tab, so it is a banner rather than a chip. */}
          {editing ? (
            <Alert className={problem ? "border-danger/30 bg-danger/5" : "border-warning/30 bg-warning/5"}>
              <Pencil className={problem ? "text-danger" : "text-warning"} />
              <AlertTitle>
                Editing a working copy: {changes.length} change{changes.length === 1 ? "" : "s"} not published
              </AlertTitle>
              <AlertDescription>{problem ?? "Nothing changes for proposals until the card is published."}</AlertDescription>
            </Alert>
          ) : null}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
              <TabsTrigger value="rates">
                Rates
                <TabCount value={card.items.filter((i) => !i.retired).length} />
              </TabsTrigger>
              <TabsTrigger value="packages">
                Packages
                <TabCount value={card.packages.length} />
              </TabsTrigger>
              <TabsTrigger value="promotions">
                Promotions
                <TabCount value={card.promotions.length} />
              </TabsTrigger>
              <TabsTrigger value="history">
                History
                <TabCount value={data.versions.length} />
              </TabsTrigger>
            </TabsList>
            {panel("rates", <RatesTab card={card} editing={editing} services={data.services} onChange={setDraft} />)}
            {panel("packages", <PackagesTab card={card} editing={editing} services={data.services} onChange={setDraft} />)}
            {panel("promotions", <PromotionsTab card={card} editing={editing} services={data.services} today={data.today} onChange={setDraft} />)}
            {panel("history", <HistoryTab versions={data.versions} label={label} />)}
          </Tabs>
        </>
      )}

      <PublishDialog
        open={publishing && draft !== null}
        today={data.today}
        changes={changes.length}
        onOpenChange={setPublishing}
        onPublish={async (effectiveFrom, reason) => {
          if (!draft) return;
          const { version } = await proposalRulesService.publishRateCard({ card: draft, effectiveFrom, reason });
          toast.success(`Rate card V${version.versionNo} published, effective ${dmy(version.effectiveFrom)}`);
          setPublishing(false);
          setDraft(null);
          reload();
        }}
      />
    </div>
  );
}

type Services = RateCardResponse["services"];

/* ------------------------------------------------------------------ */
/* Rates                                                               */
/* ------------------------------------------------------------------ */

function RatesTab({ card, editing, services, onChange }: { card: RateCard; editing: boolean; services: Services; onChange: (card: RateCard) => void }) {
  /* The rate being edited; "new" for a new one. Kept while the dialog closes so its content does not blank mid-animation. */
  const [editingItem, setEditingItem] = useState<RateItem | "new" | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const label = (id: string) => services.find((s) => s.id === id)?.label ?? id;
  const items = [...card.items].sort((a, b) => label(a.serviceId).localeCompare(label(b.serviceId)) || a.model.localeCompare(b.model));
  const term = search.trim().toLowerCase();
  const shown = term
    ? items.filter((i) => `${label(i.serviceId)} ${MODEL_LABELS[i.model]} ${i.unit}`.toLowerCase().includes(term))
    : items;

  const open = (item: RateItem | "new") => {
    setEditingItem(item);
    setDialogOpen(true);
  };
  const toggleRetired = (item: RateItem) =>
    onChange({ ...card, items: card.items.map((i) => (i.id === item.id ? { ...i, retired: !i.retired } : i)) });
  const save = (item: RateItem) => {
    const exists = card.items.some((i) => i.id === item.id);
    onChange({ ...card, items: exists ? card.items.map((i) => (i.id === item.id ? item : i)) : [...card.items, item] });
    setDialogOpen(false);
  };

  const columns: ColumnDef<RateItem, unknown>[] = [
    {
      id: "service",
      header: "Service",
      cell: ({ row }) => (
        <div className={cn("flex min-w-0 flex-col", row.original.retired && "opacity-60")}>
          <span className="truncate font-medium">{label(row.original.serviceId)}</span>
          <span className="text-muted-foreground truncate text-xs">{row.original.unit}</span>
        </div>
      ),
    },
    {
      id: "model",
      header: "Property model",
      cell: ({ row }) => <IconText icon={Building2}>{MODEL_LABELS[row.original.model]}</IconText>,
    },
    {
      id: "basis",
      header: "Counted",
      cell: ({ row }) => <span className="text-sm">{RATE_BASIS_LABELS[row.original.basis]}</span>,
    },
    {
      id: "standard",
      header: () => <div className="text-right">Standard</div>,
      cell: ({ row }) => <div className="text-right text-sm tabular-nums">{formatCurrencyAED(row.original.standardRate)}</div>,
    },
    {
      id: "floor",
      header: () => <div className="text-right">Floor</div>,
      cell: ({ row }) => <div className="text-right text-sm tabular-nums">{formatCurrencyAED(row.original.floorRate)}</div>,
    },
    {
      id: "frequencies",
      header: "Frequencies",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.allowedFrequencies.length ? `${row.original.allowedFrequencies.join(", ")} a year` : "Any"}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <Tone tone={row.original.retired ? "neutral" : "good"}>{row.original.retired ? "Retired" : "Active"}</Tone>,
    },
    ...(editing
      ? [
          {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            cell: ({ row }) => (
              <RowActionsMenu
                label={label(row.original.serviceId)}
                actions={[
                  { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => open(row.original) },
                  row.original.retired
                    ? { label: "Restore", icon: <ArchiveRestore className="size-4" />, onSelect: () => toggleRetired(row.original) }
                    : { label: "Retire", icon: <Archive className="size-4" />, onSelect: () => toggleRetired(row.original) },
                ]}
              />
            ),
          } satisfies ColumnDef<RateItem, unknown>,
        ]
      : []),
  ];

  return (
    <SectionCard
      title="Rates"
      icon={<Tags />}
      description="Line value = rate × units × frequency. A proposal discounted under a floor rate needs approval."
      action={
        editing ? (
          <Button size="sm" variant="outline" onClick={() => open("new")}>
            <Plus className="size-4" />
            Add a rate
          </Button>
        ) : null
      }
    >
      <LocalDataTable
        columns={columns}
        rows={shown}
        pageSize={pageSize}
        resetKey={term}
        onRowClick={editing ? (item) => open(item) : undefined}
        toolbar={
          <ConfigTableToolbar
            search={search}
            onSearchChange={setSearch}
            placeholder="Search by service, model or unit…"
            searchLabel="Search rates"
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
          />
        }
        emptyState={
          items.length === 0 ? (
            <EmptyState
              icon={<Tags />}
              title="No rates yet"
              description={editing ? "Add a rate for each service you offer." : "Change the card to add rates."}
              action={editing ? { label: "Add a rate", onClick: () => open("new") } : undefined}
            />
          ) : (
            <EmptyState icon={<Tags />} title="No rates match" description="Try a service, property model or unit name." />
          )
        }
      />
      <RateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editingItem === "new" ? null : editingItem}
        services={services}
        takenIds={card.items.map((i) => i.id)}
        onSave={save}
      />
    </SectionCard>
  );
}

function RateDialog({
  open,
  onOpenChange,
  item,
  services,
  takenIds,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: RateItem | null;
  services: Services;
  takenIds: string[];
  onSave: (item: RateItem) => void;
}) {
  const initial = () => ({
    serviceId: item?.serviceId ?? services[0]?.id ?? "",
    model: item?.model ?? ("any" as RateItem["model"]),
    unit: item?.unit ?? "per property",
    basis: item?.basis ?? ("per_property" as RateItem["basis"]),
    standardRate: item ? String(item.standardRate) : "",
    floorRate: item ? String(item.floorRate) : "",
    frequencies: item?.allowedFrequencies.join(", ") ?? "",
  });
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  /* Each opening starts from what is stored, seeded during render so the previous rate never paints (as Snagging's rate dialogs do). */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setValue(initial());
      setError(null);
    }
  }
  const set = (patch: Partial<ReturnType<typeof initial>>) => setValue((v) => ({ ...v, ...patch }));

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionDialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Edit rate" : "Add a rate"}</DialogTitle>
          <DialogDescription>Saved to the working copy. Nothing changes for proposals until the card is published.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Service</Label>
            <Select value={value.serviceId} onValueChange={(serviceId) => set({ serviceId })} disabled={!!item}>
              <SelectTrigger aria-label="Service" className="w-full">
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Property model</Label>
              <Select value={value.model} onValueChange={(model) => set({ model: model as RateItem["model"] })}>
                <SelectTrigger aria-label="Property model" className="w-full">
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
                <SelectTrigger aria-label="How the rate is counted" className="w-full">
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
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rate-unit">Unit (as it reads to the client)</Label>
            <Input id="rate-unit" value={value.unit} onChange={(e) => set({ unit: e.target.value })} maxLength={60} placeholder="per AC unit" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="rate-standard">Standard rate (AED)</Label>
              <Input id="rate-standard" type="number" min={0} step="0.01" value={value.standardRate} onChange={(e) => set({ standardRate: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rate-floor">Floor rate (AED)</Label>
              <Input id="rate-floor" type="number" min={0} step="0.01" value={value.floorRate} onChange={(e) => set({ floorRate: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rate-freq">Frequencies allowed a year (blank: any)</Label>
            <Input id="rate-freq" value={value.frequencies} onChange={(e) => set({ frequencies: e.target.value })} placeholder="2, 4, 6" />
          </div>
          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton icon={<Plus className="size-4" />} onClick={save}>
            Save to working copy
          </SubmitButton>
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const label = (id: string) => services.find((s) => s.id === id)?.label ?? id;
  const open = (pkg: RatePackage | "new") => {
    setEditingPkg(pkg);
    setDialogOpen(true);
  };
  return (
    <SectionCard
      title="Packages"
      icon={<Package />}
      description="Preset service sets, as in the brochure. Picking one in the wizard ticks its services with these units and visits."
      bodyClassName="px-5 pb-5"
      action={
        editing ? (
          <Button size="sm" variant="outline" onClick={() => open("new")}>
            <Plus className="size-4" />
            Add a package
          </Button>
        ) : null
      }
    >
      {card.packages.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title="No packages"
          description="Packages are optional: proposals can always pick services one by one."
          action={editing ? { label: "Add a package", onClick: () => open("new") } : undefined}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {card.packages.map((p) => (
            <div key={p.id} className={cn("rounded-lg border p-4", !p.active && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    {!p.active ? <Tone tone="neutral">Inactive</Tone> : null}
                  </div>
                  <div className="text-muted-foreground text-xs">{p.models.length ? p.models.map((m) => MODEL_LABELS[m]).join(", ") : "Every property model"}</div>
                </div>
                {editing ? (
                  <RowActionsMenu
                    label={p.name}
                    actions={[
                      { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => open(p) },
                      {
                        label: "Remove",
                        icon: <Trash2 className="size-4" />,
                        destructive: true,
                        onSelect: () => onChange({ ...card, packages: card.packages.filter((x) => x.id !== p.id) }),
                      },
                    ]}
                  />
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
      <PackageDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        pkg={editingPkg === "new" ? null : editingPkg}
        services={services}
        takenIds={card.packages.map((p) => p.id)}
        onSave={(pkg) => {
          const exists = card.packages.some((p) => p.id === pkg.id);
          onChange({ ...card, packages: exists ? card.packages.map((p) => (p.id === pkg.id ? pkg : p)) : [...card.packages, pkg] });
          setDialogOpen(false);
        }}
      />
    </SectionCard>
  );
}

function PackageDialog({
  open,
  onOpenChange,
  pkg,
  services,
  takenIds,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pkg: RatePackage | null;
  services: Services;
  takenIds: string[];
  onSave: (pkg: RatePackage) => void;
}) {
  const initial = (): RatePackage =>
    pkg ?? { id: "", name: "", description: "", models: [], lines: [{ serviceId: services[0]?.id ?? "", units: 1, frequency: 1 }], active: true };
  const [value, setValue] = useState<RatePackage>(initial);
  const [error, setError] = useState<string | null>(null);
  /* Seeded on the way open, during render (see RateDialog). */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setValue(initial());
      setError(null);
    }
  }
  const setLine = (index: number, patch: Partial<RatePackage["lines"][number]>) =>
    setValue((v) => ({ ...v, lines: v.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  const save = () => {
    const parsed = packageSchema.safeParse({ ...value, id: pkg?.id ?? uniqueId(value.name, takenIds) });
    if (!parsed.success) return setError(firstIssue(parsed));
    onSave(parsed.data);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionDialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{pkg ? `Edit ${pkg.name}` : "Add a package"}</DialogTitle>
          <DialogDescription>Saved to the working copy until the card is published.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
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
          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton icon={<Plus className="size-4" />} onClick={save}>
            Save to working copy
          </SubmitButton>
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const label = (id: string) => services.find((s) => s.id === id)?.label ?? id;
  const state = (p: RatePromotion) => (!p.active ? "Off" : p.endDate < today ? "Ended" : p.startDate > today ? "Scheduled" : "Running");
  const STATE_TONE = { Running: "good", Scheduled: "info", Ended: "neutral", Off: "neutral" } as const;
  const open = (promo: RatePromotion | "new") => {
    setEditingPromo(promo);
    setDialogOpen(true);
  };

  const columns: ColumnDef<RatePromotion, unknown>[] = [
    {
      id: "name",
      header: "Promotion",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: "dates",
      header: "Dates",
      cell: ({ row }) => (
        <IconText icon={CalendarRange} className="tabular-nums">
          {dmy(row.original.startDate)} – {dmy(row.original.endDate)}
        </IconText>
      ),
    },
    {
      id: "off",
      header: () => <div className="text-right">Off</div>,
      cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.percentOff}%</div>,
    },
    {
      id: "applies",
      header: "Applies to",
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col text-sm">
          <span className="truncate">{row.original.serviceIds.length ? row.original.serviceIds.map(label).join(", ") : "Every service"}</span>
          <span className="text-muted-foreground truncate text-xs">
            {row.original.models.length ? row.original.models.map((m) => MODEL_LABELS[m]).join(", ") : "Every model"}
          </span>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const s = state(row.original);
        return <Tone tone={STATE_TONE[s]}>{s}</Tone>;
      },
    },
    ...(editing
      ? [
          {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            cell: ({ row }) => (
              <RowActionsMenu
                label={row.original.name}
                actions={[
                  { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => open(row.original) },
                  {
                    label: "Remove",
                    icon: <Trash2 className="size-4" />,
                    destructive: true,
                    onSelect: () => onChange({ ...card, promotions: card.promotions.filter((x) => x.id !== row.original.id) }),
                  },
                ]}
              />
            ),
          } satisfies ColumnDef<RatePromotion, unknown>,
        ]
      : []),
  ];

  return (
    <SectionCard
      title="Promotions"
      icon={<BadgePercent />}
      description="A promotion in date reduces the rate automatically on new proposals. It never counts as going under the floor on its own."
      action={
        editing ? (
          <Button size="sm" variant="outline" onClick={() => open("new")}>
            <Plus className="size-4" />
            Add a promotion
          </Button>
        ) : null
      }
    >
      <LocalDataTable
        columns={columns}
        rows={card.promotions}
        onRowClick={editing ? (promo) => open(promo) : undefined}
        emptyState={
          <EmptyState
            icon={<BadgePercent />}
            title="No promotions"
            description="Add one with start and end dates when a campaign runs."
            action={editing ? { label: "Add a promotion", onClick: () => open("new") } : undefined}
          />
        }
      />
      <PromotionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        promo={editingPromo === "new" ? null : editingPromo}
        services={services}
        today={today}
        takenIds={card.promotions.map((p) => p.id)}
        onSave={(promo) => {
          const exists = card.promotions.some((p) => p.id === promo.id);
          onChange({ ...card, promotions: exists ? card.promotions.map((p) => (p.id === promo.id ? promo : p)) : [...card.promotions, promo] });
          setDialogOpen(false);
        }}
      />
    </SectionCard>
  );
}

function PromotionDialog({
  open,
  onOpenChange,
  promo,
  services,
  today,
  takenIds,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promo: RatePromotion | null;
  services: Services;
  today: string;
  takenIds: string[];
  onSave: (promo: RatePromotion) => void;
}) {
  const initial = (): RatePromotion =>
    promo ?? { id: "", name: "", startDate: today, endDate: today, percentOff: 10, serviceIds: [], models: [], active: true };
  const [value, setValue] = useState<RatePromotion>(initial);
  const [error, setError] = useState<string | null>(null);
  /* Seeded on the way open, during render (see RateDialog). */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setValue(initial());
      setError(null);
    }
  }
  const save = () => {
    const parsed = promotionSchema.safeParse({ ...value, id: promo?.id ?? uniqueId(value.name, takenIds) });
    if (!parsed.success) return setError(firstIssue(parsed));
    onSave(parsed.data);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionDialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{promo ? `Edit ${promo.name}` : "Add a promotion"}</DialogTitle>
          <DialogDescription>Saved to the working copy until the card is published.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="promo-name">Name</Label>
            <Input id="promo-name" value={value.name} onChange={(e) => setValue((v) => ({ ...v, name: e.target.value }))} maxLength={80} placeholder="Summer AC offer" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="promo-start">Starts</Label>
              <Input id="promo-start" type="date" value={value.startDate} onChange={(e) => setValue((v) => ({ ...v, startDate: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="promo-end">Ends</Label>
              <Input id="promo-end" type="date" value={value.endDate} onChange={(e) => setValue((v) => ({ ...v, endDate: e.target.value }))} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="promo-off">Percent off</Label>
              <Input id="promo-off" type="number" min={1} max={100} value={value.percentOff} onChange={(e) => setValue((v) => ({ ...v, percentOff: Number(e.target.value) || 0 }))} />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Switch checked={value.active} onCheckedChange={(active) => setValue((v) => ({ ...v, active }))} />
              On
            </label>
          </div>
          <div className="grid gap-1.5">
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
          <div className="grid gap-1.5">
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
          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton icon={<Plus className="size-4" />} onClick={save}>
            Save to working copy
          </SubmitButton>
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
  const entries = versions.map((v, index) => ({ v, changes: diffRateCards(versions[index + 1]?.card ?? emptyRateCard(), v.card, label) }));
  return (
    <SectionCard title="History" icon={<History />} description="Every published version: who, when, from which date, why, and each old and new value (BRD 5.3)." bodyClassName="border-t">
      {entries.length === 0 ? (
        <EmptyState icon={<History />} title="Nothing published yet" description="Each version appears here once it is published, with every value it changed." />
      ) : (
        <ul className="divide-y">
          {entries.map(({ v, changes }) => (
            <li key={v.id}>
              <DataRow
                icon={<History />}
                title={
                  <span className="flex items-center gap-2">
                    <Tone tone="info">V{v.versionNo}</Tone>
                    Effective {dmy(v.effectiveFrom)}
                  </span>
                }
                subtitle={v.reason}
                trailing={
                  <span className="text-muted-foreground text-xs">
                    {new Date(v.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" })}
                    <span className="block">{v.changedBy ?? "—"}</span>
                  </span>
                }
              />
              {/* Indented past the icon tile, so the changes read as part of their version. */}
              {!v.valid || changes.length ? (
                <div className="-mt-1 space-y-1 pr-5 pb-3 pl-17">
                  {!v.valid ? <p className="text-danger text-xs">This version&apos;s stored card no longer validates; it prices nothing.</p> : null}
                  {changes.length ? (
                    <ul className="space-y-1">
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
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function PublishDialog({
  open,
  today,
  changes,
  onOpenChange,
  onPublish,
}: {
  open: boolean;
  today: string;
  changes: number;
  onOpenChange: (open: boolean) => void;
  onPublish: (effectiveFrom: string, reason: string) => Promise<void>;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  /* Each opening starts blank, from today. */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setEffectiveFrom(today);
      setReason("");
    }
  }
  const publish = async () => {
    setBusy(true);
    try {
      await onPublish(effectiveFrom, reason.trim());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not publish.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish the rate card</DialogTitle>
          <DialogDescription>
            {changes} change{changes === 1 ? "" : "s"} become a new version. Proposals already shared keep the rates they were priced at; drafts take the new rates
            from the effective date.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="publish-from">Effective from</Label>
            <Input id="publish-from" type="date" min={today} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="publish-reason">Why</Label>
            <Textarea id="publish-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. 2027 rates agreed with Finance" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton
            pending={busy}
            pendingLabel="Publishing…"
            icon={<Send className="size-4" />}
            disabled={reason.trim().length < 3 || !effectiveFrom || effectiveFrom < today}
            onClick={() => void publish()}
          >
            Publish
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/* Rules for the card as a whole (two active rates for one service and model…); the server checks again on publish. */
function rateCardProblem(card: RateCard): string | null {
  return firstIssue(rateCardSchema.safeParse(card));
}
