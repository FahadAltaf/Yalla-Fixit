"use client";

import { useState } from "react";
import { ListChecks, Percent, Plus } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { amcContractsService, type ChecklistItem, type DiscountConfig } from "@/modules/amc-contracts/amc-contracts-service";

import { AmcSectionNav } from "./amc-section-nav";
import { useAmcData } from "./use-amc-data";

/** AMC operations settings: the assessment checklist and the additional-service discount. Approvers edit. */
export function AmcOpsSettings() {
  useBreadcrumbLabel("settings", "Settings");
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="AMC contracts"
        title="Settings"
        description="The property assessment checklist and the AMC discount on additional services. AMC proposal wording and prices stay in AMC Settings."
      />
      <AmcSectionNav current="settings" />
      <DiscountSettings />
      <ChecklistSettings />
    </div>
  );
}

function DiscountSettings() {
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.discountConfig(), "discount");
  const [form, setForm] = useState<{ enabled: boolean; percent: string; keys: string; categories: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <ErrorState title="Could not load the discount settings" message={error} onRetry={reload} />;
  if (loading || !data) return <SectionCard title="Additional-service discount" icon={<Percent />} bodyClassName="px-5 pb-5"><ListSkeleton rows={2} /></SectionCard>;
  const cfg = data.config;
  const value = form ?? {
    enabled: cfg.enabled,
    percent: cfg.discountPercent?.toString() ?? "",
    keys: cfg.eligibleServiceKeys.join(", "),
    categories: cfg.eligibleCategories.join(", "),
  };
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    setBusy(true);
    try {
      const next: DiscountConfig = {
        enabled: value.enabled,
        discountPercent: value.percent === "" ? null : Number(value.percent),
        eligibleServiceKeys: list(value.keys),
        eligibleCategories: list(value.categories),
      };
      await amcContractsService.saveDiscountConfig(next);
      toast.success("Discount settings saved");
      setForm(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Additional-service discount"
      description="Business decision required: no rate is assumed. Off until an approver sets one; only the listed services and categories qualify."
      icon={<Percent />}
      bodyClassName="px-5 pb-5 grid gap-4"
    >
      {!cfg.migrated ? <p className="text-muted-foreground text-sm">Needs migration 20261006130000.</p> : null}
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={value.enabled} disabled={!data.canEdit} onCheckedChange={(v) => setForm({ ...value, enabled: v })} aria-label="Discount on" />
        {value.enabled ? "On" : "Off"}
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="disc-pct">Discount %</Label>
          <Input id="disc-pct" type="number" min={0} max={100} step="0.01" value={value.percent} disabled={!data.canEdit} onChange={(e) => setForm({ ...value, percent: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="disc-keys">Eligible service keys</Label>
          <Input id="disc-keys" value={value.keys} disabled={!data.canEdit} placeholder="painting, deep-cleaning" onChange={(e) => setForm({ ...value, keys: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="disc-cats">Eligible categories</Label>
          <Input id="disc-cats" value={value.categories} disabled={!data.canEdit} placeholder="plumbing, electrical" onChange={(e) => setForm({ ...value, categories: e.target.value })} />
        </div>
      </div>
      {data.canEdit ? (
        <div>
          <Button onClick={() => void save()} disabled={busy || !form}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">Only AMC approvers can change this.</p>
      )}
    </SectionCard>
  );
}

function ChecklistSettings() {
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.checklist(), "checklist");
  const [editing, setEditing] = useState<Partial<ChecklistItem> | null>(null);

  if (error) return <ErrorState title="Could not load the checklist" message={error} onRetry={reload} />;
  return (
    <SectionCard
      title="Assessment checklist"
      description="New assessments copy the active items. Past assessments keep the wording they were made with."
      icon={<ListChecks />}
      bodyClassName="pb-2"
      action={
        data?.canEdit ? (
          <Button size="sm" variant="outline" onClick={() => setEditing({ active: true, sortOrder: (data.items.at(-1)?.sortOrder ?? 0) + 10 })}>
            <Plus className="size-4" />
            Add item
          </Button>
        ) : null
      }
    >
      {loading || !data ? (
        <div className="px-5 pb-4">
          <ListSkeleton rows={5} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Category</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((i) => (
                <TableRow key={i.itemKey}>
                  <TableCell className="pl-5">{i.categoryLabel}</TableCell>
                  <TableCell>{i.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.sortOrder}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">
                      {i.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {data.canEdit ? (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                        Edit
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <ChecklistDialog
          item={editing}
          categories={[...new Set((data?.items ?? []).map((i) => i.categoryLabel))]}
          onOpenChange={(next) => !next && setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </SectionCard>
  );
}

function ChecklistDialog({
  item,
  categories,
  onOpenChange,
  onSaved,
}: {
  item: Partial<ChecklistItem>;
  categories: string[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState(item.categoryLabel ?? "");
  const [label, setLabel] = useState(item.label ?? "");
  const [order, setOrder] = useState(String(item.sortOrder ?? 0));
  const [active, setActive] = useState(item.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await amcContractsService.saveChecklistItem({ itemKey: item.itemKey ?? null, categoryLabel: category.trim(), label: label.trim(), sortOrder: Number(order) || 0, active });
      toast.success("Checklist saved");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item.itemKey ? "Edit checklist item" : "Add checklist item"}</DialogTitle>
          <DialogDescription>Applies to assessments started from now on.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cl-cat">Category</Label>
            <Input id="cl-cat" list="cl-cats" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={100} placeholder="e.g. Plumbing" />
            <datalist id="cl-cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cl-label">Item</Label>
            <Input id="cl-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cl-order">Order</Label>
            <Input id="cl-order" type="number" min={0} value={order} onChange={(e) => setOrder(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} aria-label="Active" />
            Active
          </label>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !category.trim() || !label.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
