"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { BellRing, ListChecks, Pencil, Percent, Play, Plus, Save, Tag } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { IconText } from "@/components/data-table/columns/icon-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeading, SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, FieldsSkeleton, SectionSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { cn } from "@/lib/utils";
import {
  amcContractsService,
  type AmcNotificationSettings,
  type ChecklistItem,
  type DiscountConfig,
} from "@/modules/amc-contracts/amc-contracts-service";

import { AmcNotificationsBell } from "./amc-notifications-bell";
import { ConfigTableToolbar, LocalDataTable } from "./config-table";
import { useAmcData } from "./use-amc-data";

/** AMC operations settings: the site visit checklist and the additional-service discount. Approvers edit. */
export function AmcOpsSettings() {
  useBreadcrumbLabel("settings", "Operations settings");
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Configuration"
        title="Operations settings"
        description="Notifications and reminders, the site visit checklist and the AMC discount on additional services. AMC proposal wording and prices stay in AMC Settings."
        actions={<AmcNotificationsBell />}
      />
      <NotificationSettings />
      <DiscountSettings />
      <ChecklistSettings />
    </div>
  );
}

/**
 * Who hears about what. Workflow emails go to people the workflow already
 * names (approvers, the proposal owner). Allowance emails and automatic
 * expiry reminders stay off until the business confirms recipients and a
 * schedule; the defaults are configuration, not a decision.
 */
function NotificationSettings() {
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.notificationSettings(), "notification-settings");
  const [form, setForm] = useState<(AmcNotificationSettings & { thresholdsText: string; extraText: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  if (error) return <ErrorState title="Could not load the notification settings" message={error} onRetry={reload} />;
  if (loading || !data)
    return (
      <SectionSkeleton>
        <FieldsSkeleton fields={4} columns={2} />
      </SectionSkeleton>
    );
  const cfg = data.settings;
  const value = form ?? { ...cfg, thresholdsText: cfg.reminderThresholds.join(", "), extraText: cfg.reminderExtraEmails.join(", ") };
  const set = (patch: Partial<typeof value>) => setForm({ ...value, ...patch });
  const toggle = <T extends string>(list: T[], item: T, on: boolean) => (on ? [...new Set([...list, item])] : list.filter((x) => x !== item));

  const save = async () => {
    setBusy(true);
    try {
      const next: AmcNotificationSettings = {
        workflowEmailEnabled: value.workflowEmailEnabled,
        entitlementEmailEnabled: value.entitlementEmailEnabled,
        reminderAutoEnabled: value.reminderAutoEnabled,
        reminderThresholds: value.thresholdsText
          .split(",")
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
        reminderRecipients: value.reminderRecipients,
        reminderChannels: value.reminderChannels,
        reminderExtraEmails: value.extraText
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      };
      await amcContractsService.saveNotificationSettings(next);
      toast.success("Notification settings saved");
      setForm(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await amcContractsService.runReminders();
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
      toast.success(
        r.ran
          ? `Checked ${plural(r.contractsChecked, "contract")}: ${plural(r.remindersCreated, "new reminder")}.`
          : (r.reason ?? "Nothing to do."),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run the reminders.");
    } finally {
      setRunning(false);
    }
  };

  const disabled = !data.canEdit;
  return (
    <SectionCard
      title="Notifications and reminders"
      description="Everyone gets AMC notifications in the portal (the bell at the top of each AMC page). Expiry reminders are not sent automatically until the business confirms the schedule, recipients and channels."
      icon={<BellRing />}
      bodyClassName="px-5 pb-5 grid gap-5"
    >
      <div className="grid gap-3">
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={value.workflowEmailEnabled} disabled={disabled} onCheckedChange={(v) => set({ workflowEmailEnabled: v })} aria-label="Workflow emails" />
          <span>
            <span className="font-medium">Workflow emails</span>
            <span className="text-muted-foreground block text-xs">
              Approvers when a proposal is submitted; the owner when it is approved or sent back, when the client answers or signs, and when the AMC is activated.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={value.entitlementEmailEnabled} disabled={disabled} onCheckedChange={(v) => set({ entitlementEmailEnabled: v })} aria-label="Allowance emails" />
          <span>
            <span className="font-medium">Allowance emails</span>
            <span className="text-muted-foreground block text-xs">
              Email the owner when a visits or hours allowance runs low (25% left) or out. Always shown in the portal.
            </span>
          </span>
        </label>
      </div>

      <div className="grid gap-3 border-t pt-4">
        <div className="text-sm font-medium">Contract expiry reminders</div>
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={value.reminderAutoEnabled} disabled={disabled} onCheckedChange={(v) => set({ reminderAutoEnabled: v })} aria-label="Automatic reminders" />
          <span>
            <span className="font-medium">Send automatically</span>
            <span className="text-muted-foreground block text-xs">
              Off: reminders are created only when an approver runs them below. Business decision required before switching on.
            </span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="rem-days">Days before the end date</Label>
            <Input id="rem-days" value={value.thresholdsText} disabled={disabled} placeholder="60, 30, 15" onChange={(e) => set({ thresholdsText: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rem-extra">Also email (optional)</Label>
            <Input id="rem-extra" value={value.extraText} disabled={disabled} placeholder="renewals@example.com" onChange={(e) => set({ extraText: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-muted-foreground">Recipients</span>
          {(["owner", "approvers"] as const).map((r) => (
            <label key={r} className="flex items-center gap-2">
              <Checkbox
                checked={value.reminderRecipients.includes(r)}
                disabled={disabled}
                onCheckedChange={(v) => set({ reminderRecipients: toggle(value.reminderRecipients, r, v === true) })}
              />
              {r === "owner" ? "Proposal owner" : "AMC approvers"}
            </label>
          ))}
          <span className="text-muted-foreground">Channels</span>
          {(["in_app", "email"] as const).map((c) => (
            <label key={c} className="flex items-center gap-2">
              <Checkbox
                checked={value.reminderChannels.includes(c)}
                disabled={disabled}
                onCheckedChange={(v) => set({ reminderChannels: toggle(value.reminderChannels, c, v === true) })}
              />
              {c === "in_app" ? "In the portal" : "Email"}
            </label>
          ))}
        </div>
      </div>

      {data.canEdit ? (
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <SubmitButton variant="outline" pending={running} pendingLabel="Running…" icon={<Play className="size-4" />} onClick={() => void runNow()} disabled={!!form}>
            Run reminders now
          </SubmitButton>
          <SubmitButton pending={busy} pendingLabel="Saving…" icon={<Save className="size-4" />} onClick={() => void save()} disabled={!form}>
            Save
          </SubmitButton>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">Only AMC approvers can change this.</p>
      )}
    </SectionCard>
  );
}

function DiscountSettings() {
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.discountConfig(), "discount");
  const [form, setForm] = useState<{ enabled: boolean; percent: string; keys: string; categories: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <ErrorState title="Could not load the discount settings" message={error} onRetry={reload} />;
  if (loading || !data)
    return (
      <SectionSkeleton>
        <FieldsSkeleton fields={3} columns={3} />
      </SectionSkeleton>
    );
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
        <div className="flex justify-end border-t pt-4">
          <SubmitButton pending={busy} pendingLabel="Saving…" icon={<Save className="size-4" />} onClick={() => void save()} disabled={!form}>
            Save
          </SubmitButton>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">Only AMC approvers can change this.</p>
      )}
    </SectionCard>
  );
}

function ChecklistSettings() {
  const { data, error, loading, reload } = useAmcData(() => amcContractsService.checklist(), "checklist");
  /* The item being edited; kept while the dialog closes so its content does not blank mid-animation. */
  const [editing, setEditing] = useState<Partial<ChecklistItem>>({ active: true });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);

  const open = (item: Partial<ChecklistItem>) => {
    setEditing(item);
    setDialogOpen(true);
  };
  const addNew = () => open({ active: true, sortOrder: (data?.items.at(-1)?.sortOrder ?? 0) + 10 });

  const items = data?.items ?? [];
  const term = search.trim().toLowerCase();
  const shown = term ? items.filter((i) => `${i.categoryLabel} ${i.label}`.toLowerCase().includes(term)) : items;
  const canEdit = data?.canEdit ?? false;

  const columns: ColumnDef<ChecklistItem, unknown>[] = [
    {
      id: "item",
      header: "Item",
      cell: ({ row }) => <span className={cn("font-medium", !row.original.active && "text-muted-foreground")}>{row.original.label}</span>,
    },
    {
      id: "category",
      header: "Category",
      cell: ({ row }) => <IconText icon={Tag}>{row.original.categoryLabel}</IconText>,
    },
    {
      id: "order",
      header: () => <div className="text-right">Order</div>,
      cell: ({ row }) => <div className="text-right text-sm tabular-nums">{row.original.sortOrder}</div>,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant="secondary" className={cn("border-0 font-medium", row.original.active ? "bg-success/10 text-success" : "bg-mist text-ink-soft")}>
          {row.original.active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    ...(canEdit
      ? [
          {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            cell: ({ row }) => (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit ${row.original.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    open(row.original);
                  }}
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
              </div>
            ),
          } satisfies ColumnDef<ChecklistItem, unknown>,
        ]
      : []),
  ];

  return (
    <>
      {error ? <ErrorState title="Could not load the checklist" message={error} onRetry={reload} /> : null}
      <SectionCard
        title="Site visit checklist"
        description="New site visits copy the active items. Past site visits keep the wording they were made with."
        icon={<ListChecks />}
        action={
          canEdit ? (
            <Button size="sm" variant="outline" onClick={addNew}>
              <Plus className="size-4" />
              Add item
            </Button>
          ) : null
        }
      >
        <LocalDataTable
          columns={columns}
          rows={shown}
          loading={loading}
          pageSize={pageSize}
          resetKey={term}
          onRowClick={canEdit ? (item) => open(item) : undefined}
          toolbar={
            <ConfigTableToolbar
              search={search}
              onSearchChange={setSearch}
              placeholder="Search by item or category…"
              searchLabel="Search the checklist"
              loading={loading}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
              onRefresh={reload}
            />
          }
          emptyState={
            items.length === 0 ? (
              <EmptyState
                icon={<ListChecks />}
                title="No checklist items yet"
                description="Site visits start from these items. Add the first one to build the checklist."
                action={canEdit ? { label: "Add item", onClick: addNew } : undefined}
              />
            ) : (
              <EmptyState icon={<ListChecks />} title="No items match" description="Try another word from the item or its category." />
            )
          }
        />
      </SectionCard>
      <ChecklistDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editing}
        categories={[...new Set(items.map((i) => i.categoryLabel))]}
        reload={reload}
      />
    </>
  );
}

function ChecklistDialog({
  open,
  onOpenChange,
  item,
  categories,
  reload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Partial<ChecklistItem>;
  categories: string[];
  reload: () => void;
}) {
  const [category, setCategory] = useState(item.categoryLabel ?? "");
  const [label, setLabel] = useState(item.label ?? "");
  const [order, setOrder] = useState(String(item.sortOrder ?? 0));
  const [active, setActive] = useState(item.active ?? true);
  const [busy, setBusy] = useState(false);
  /* Each opening starts from the item, seeded during render so the previous one never paints. */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setCategory(item.categoryLabel ?? "");
      setLabel(item.label ?? "");
      setOrder(String(item.sortOrder ?? 0));
      setActive(item.active ?? true);
    }
  }
  const save = async () => {
    setBusy(true);
    try {
      await amcContractsService.saveChecklistItem({ itemKey: item.itemKey ?? null, categoryLabel: category.trim(), label: label.trim(), sortOrder: Number(order) || 0, active });
      toast.success("Checklist saved");
      reload();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item.itemKey ? "Edit checklist item" : "Add checklist item"}</DialogTitle>
          <DialogDescription>Applies to site visits started from now on.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
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
              <Label htmlFor="cl-order">Order</Label>
              <Input id="cl-order" type="number" min={0} value={order} onChange={(e) => setOrder(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cl-label">Item</Label>
            <Input id="cl-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} aria-label="Active" />
            Active
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} pendingLabel="Saving…" icon={<Save className="size-4" />} onClick={() => void save()} disabled={!category.trim() || !label.trim()}>
            Save
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
