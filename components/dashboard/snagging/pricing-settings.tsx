"use client";

import { DirhamIcon } from "@/components/ui/dirham-icon";
import { FormatToolbar, ScopeView, TermsView } from "./quote-text-view";
import { Money } from "@/components/ui/money";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Building,
  Building2,
  FileText,
  Home,
  Info,
  Pencil,
  Receipt,
  Store,
} from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { SnaggingPricingToolbar } from "@/components/data-table/toolbars/snagging-pricing-toolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  formatLocalDateTime,
  useConfirm,
} from "./shared";

const TYPES = ["apartment", "villa", "townhouse", "commercial"] as const;

const TYPE_META: Record<
  string,
  { label: string; icon: typeof Building2; note: string }
> = {
  apartment: { label: "Apartment", icon: Building2, note: "Priced on built-up area" },
  villa: { label: "Villa", icon: Home, note: "External areas charged separately" },
  townhouse: { label: "Townhouse", icon: Building, note: "Priced in the villa band" },
  commercial: { label: "Commercial", icon: Store, note: "Flat rate either way" },
};

/** One row of the rate card table: a property type and its four figures. */
type RateRow = {
  type: string;
  label: string;
  note: string;
  icon: typeof Building2;
  unfurnished_min: number;
  unfurnished_max: number;
  furnished: number;
  minimum_charge: number;
  desnag_min: number | null;
  desnag_max: number | null;
};

/* ─────────────────────────────── formatting ─────────────────────────────── */

/** An amount, with the dirham sign rather than the "AED" code. */
function money(value: number, currency: string, dp = 2) {
  return <Money value={value} currency={currency} dp={dp} />;
}

/** A published range, read as one figure when both ends agree. */
function Range({
  min,
  max,
  currency,
  dp = 2,
  suffix,
}: {
  min: number | null;
  max: number | null;
  currency: string;
  dp?: number;
  suffix?: string;
}) {
  if (min == null || max == null) {
    return <span className="text-muted-foreground text-sm">To be confirmed</span>;
  }
  return (
    <span className="text-sm tabular-nums">
      {min === max ? (
        money(min, currency, dp)
      ) : (
        <>
          {money(min, currency, dp)} – {money(max, currency, dp)}
        </>
      )}
      {suffix ? (
        <span className="text-muted-foreground ml-1 text-xs">{suffix}</span>
      ) : null}
    </span>
  );
}

/* ────────────────────────────── validation ────────────────────────────── */

type Issue = { field: string; message: string };

const bad = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) || n < 0;

/**
 * What is wrong with one property type's row, as a list keyed by control.
 *
 * Checked in the dialog rather than only on the server because these are
 * figures a person is typing: an inverted band is a slip to point at while
 * the cursor is still in the field, not an error to discover after a round
 * trip. The server still owns the final word.
 */
function validateType(row: RateRow): Issue[] {
  const issues: Issue[] = [];
  if (bad(row.unfurnished_min) || bad(row.unfurnished_max)) {
    issues.push({ field: "unfurnished", message: "An unfurnished rate cannot be blank or negative." });
  } else if (row.unfurnished_min > row.unfurnished_max) {
    issues.push({ field: "unfurnished", message: "The band runs backwards — the low end is above the high end." });
  }
  if (bad(row.furnished)) {
    issues.push({ field: "furnished", message: "The furnished rate cannot be blank or negative." });
  }
  if (bad(row.minimum_charge)) {
    issues.push({ field: "minimum_charge", message: "The minimum charge cannot be blank or negative." });
  }
  /* Null on BOTH ends is the card's published "to be confirmed", and valid.
     One end set and the other not is a half-finished edit. */
  if (row.desnag_min != null || row.desnag_max != null) {
    if (bad(row.desnag_min) || bad(row.desnag_max)) {
      issues.push({ field: "desnag", message: "Set both ends, or clear it back to “to be confirmed”." });
    } else if ((row.desnag_min as number) > (row.desnag_max as number)) {
      issues.push({ field: "desnag", message: "The de-snagging band runs backwards." });
    }
  }
  return issues;
}

/** What is wrong with the charges that are not per property type. */
function validateCharges(draft: ChargesDraft): Issue[] {
  const issues: Issue[] = [];
  if (bad(draft.external_min) || bad(draft.external_max)) {
    issues.push({ field: "external", message: "The external areas rate cannot be blank or negative." });
  } else if (draft.external_min > draft.external_max) {
    issues.push({ field: "external", message: "The external areas band runs backwards." });
  }
  if (bad(draft.additional_visit_price)) {
    issues.push({ field: "visit", message: "The additional visit price cannot be blank or negative." });
  }
  const percent = (n: number, field: string, name: string) => {
    if (bad(n)) issues.push({ field, message: `${name} cannot be blank or negative.` });
    else if (n > 100) issues.push({ field, message: `${name} cannot be above 100%.` });
  };
  percent(draft.out_of_hours_percent, "out_of_hours", "The out-of-hours surcharge");
  percent(draft.tax_rate, "vat", "VAT");
  return issues;
}

type ChargesDraft = {
  external_min: number;
  external_max: number;
  additional_visit_price: number;
  out_of_hours_percent: number;
  tax_rate: number;
};

/* ──────────────────────────────── screen ──────────────────────────────── */

/**
 * The rate card Operations issues (BA v2, change 12).
 *
 * Read first, edit deliberately. The figures here price every future
 * quotation, so the page shows them the way the rest of the module shows
 * reference data — as a table you read — and changing one is an explicit
 * act through a dialog rather than a form that is always live under the
 * cursor. That also makes it behave like the catalogue and checklist
 * screens next to it, which is how a coordinator learns one page from
 * another.
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  /** Which dialog is open, and on what. */
  const [editingType, setEditingType] = useState<RateRow | null>(null);
  const [editingCharges, setEditingCharges] = useState(false);
  const [editingTerms, setEditingTerms] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConfig(await snaggingService.getPricing());
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

  const rows = useMemo<RateRow[]>(() => {
    const card = config?.rate_card;
    if (!card) return [];
    return TYPES.flatMap((type) => {
      const row = card.types?.[type];
      if (!row) return [];
      const meta = TYPE_META[type];
      return [
        {
          type,
          label: meta.label,
          note: meta.note,
          icon: meta.icon,
          unfurnished_min: row.unfurnished_min,
          unfurnished_max: row.unfurnished_max,
          furnished: row.furnished,
          minimum_charge: row.minimum_charge,
          desnag_min: row.desnag_min,
          desnag_max: row.desnag_max,
        },
      ];
    });
  }, [config]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.label.toLowerCase().includes(needle) ||
        row.note.toLowerCase().includes(needle),
    );
  }, [rows, search]);

  /**
   * Writes the whole config back.
   *
   * The card is one stored document, so every dialog sends the complete
   * thing with its own change folded in — patching a single key would let
   * one type's band be saved against another type's stale minimum.
   */
  async function save(next: SnaggingPricingConfig, what: string) {
    if (saving) return false;
    const ok = await confirm({
      title: `Update ${what}?`,
      description:
        "New quotations will use these figures from now on. Quotations already generated keep the figures they were created with.",
      confirmText: "Save changes",
    });
    if (!ok) return false;

    setSaving(true);
    try {
      setConfig(await snaggingService.updatePricing(next));
      toast.success("Pricing saved");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save pricing");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const currency = config?.currency ?? "AED";

  const columns = useMemo<ColumnDef<RateRow>[]>(
    () => [
      {
        id: "type",
        header: "Property type",
        accessorKey: "label",
        cell: ({ row }) => {
          const Icon = row.original.icon;
          return (
            <div className="flex items-center gap-2.5">
              <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                <Icon className="size-4" />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{row.original.label}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {row.original.note}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        id: "unfurnished",
        header: "Unfurnished / sq ft",
        cell: ({ row }) => (
          <Range
            min={row.original.unfurnished_min}
            max={row.original.unfurnished_max}
            currency={currency}
          />
        ),
        enableSorting: false,
      },
      {
        id: "furnished",
        header: "Furnished / sq ft",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {money(row.original.furnished, currency)}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: "minimum",
        header: "Minimum charge",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {money(row.original.minimum_charge, currency, 0)}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: "desnag",
        header: "De-snagging / round",
        cell: ({ row }) => (
          <Range
            min={row.original.desnag_min}
            max={row.original.desnag_max}
            currency={currency}
            dp={0}
          />
        ),
        enableSorting: false,
      },
      {
        id: "actions",
        header: () => "Actions",
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) =>
          canEdit ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditingType(row.original)}
              aria-label={`Edit ${row.original.label} rates`}
            >
              <Pencil className="size-3.5" />
              Edit
            </Button>
          ) : null,
      },
    ],
    [canEdit, currency],
  );

  return (
    <div className="flex flex-col gap-6">
      {loading ? (
        <HeadingSkeleton />
      ) : (
        <PageHeading
          eyebrow="Master data"
          title="Snagging settings"
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
          <div className="flex flex-col gap-6">
            {!canEdit ? (
              <Alert>
                <Info />
                <AlertTitle>You are viewing these figures read-only</AlertTitle>
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
                <Card className="py-0">
                  <DataTable
                    columns={columns}
                    data={visible}
                    loading={loading}
                    rowCount={visible.length}
                    pageSize={Math.max(visible.length, 1)}
                    currentPage={0}
                    onPageChange={() => undefined}
                    onPageSizeChange={() => undefined}
                    onGlobalFilterChange={setSearch}
                    toolbar={
                      <SnaggingPricingToolbar
                        fetchRecords={() => void load()}
                        globalFilter={search}
                        onGlobalFilterChange={setSearch}
                        isSearchLoading={loading}
                        currency={currency}
                        updatedAt={
                          config.updated_at
                            ? formatLocalDateTime(config.updated_at)
                            : null
                        }
                      />
                    }
                  />
                </Card>

                {/*
                  The charges that are not per property type. A short list
                  rather than a second table — four figures with different
                  units do not make rows, and forcing them into columns
                  would invent a shape the data does not have.
                */}
                <SectionCard
                  title="Other charges"
                  icon={<Receipt />}
                  description="Applied on top of the per-type rates above."
                  action={
                    canEdit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingCharges(true)}
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                    ) : null
                  }
                  bodyClassName="border-t"
                >
                  <dl className="grid divide-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
                    <Figure
                      label="External areas"
                      hint="Plot minus built-up. Villas and townhouses."
                    >
                      <Range
                        min={config.rate_card.external_min}
                        max={config.rate_card.external_max}
                        currency={currency}
                        suffix="/ sq ft"
                      />
                    </Figure>
                    <Figure
                      label="Additional visit"
                      hint="Fixed, per visit per property."
                    >
                      <span className="text-sm tabular-nums">
                        {money(config.rate_card.additional_visit_price, currency, 0)}
                      </span>
                    </Figure>
                    <Figure
                      label="Out of hours"
                      hint="Added by the coordinator, not automatically."
                    >
                      <span className="text-sm tabular-nums">
                        {config.out_of_hours_percent ?? 40}%
                      </span>
                    </Figure>
                    <Figure label="VAT" hint="Its own line on the quotation.">
                      <span className="text-sm tabular-nums">{config.tax_rate}%</span>
                    </Figure>
                  </dl>
                </SectionCard>

                <QuotePreview config={config} />
              </>
            )}

            <SectionCard
              title="Scope of work & terms"
              icon={<FileText />}
              description="Printed on every snagging quotation."
              action={
                canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingTerms(true)}
                  >
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                ) : null
              }
              bodyClassName="border-t"
            >
              <div className="grid lg:grid-cols-2">
                <div className="border-b p-5 lg:border-r lg:border-b-0">
                  <TextBlock label="Scope of work" value={config.scope_of_work} kind="scope" />
                </div>
                <div className="p-5">
                  <TextBlock label="Terms & conditions" value={config.terms} kind="terms" />
                </div>
              </div>
            </SectionCard>
          </div>
        ) : null}
      </DataState>

      <TypeDialog
        row={editingType}
        currency={currency}
        saving={saving}
        onClose={() => setEditingType(null)}
        onSave={async (next) => {
          if (!config?.rate_card) return;
          const ok = await save(
            {
              ...config,
              rate_card: {
                ...config.rate_card,
                types: {
                  ...config.rate_card.types,
                  [next.type]: {
                    unfurnished_min: next.unfurnished_min,
                    unfurnished_max: next.unfurnished_max,
                    furnished: next.furnished,
                    minimum_charge: next.minimum_charge,
                    desnag_min: next.desnag_min,
                    desnag_max: next.desnag_max,
                  },
                },
              },
            },
            `${next.label} rates`,
          );
          if (ok) setEditingType(null);
        }}
      />

      <ChargesDialog
        open={editingCharges}
        config={config}
        saving={saving}
        onClose={() => setEditingCharges(false)}
        onSave={async (draft) => {
          if (!config?.rate_card) return;
          const ok = await save(
            {
              ...config,
              out_of_hours_percent: draft.out_of_hours_percent,
              tax_rate: draft.tax_rate,
              rate_card: {
                ...config.rate_card,
                external_min: draft.external_min,
                external_max: draft.external_max,
                additional_visit_price: draft.additional_visit_price,
              },
            },
            "the other charges",
          );
          if (ok) setEditingCharges(false);
        }}
      />

      <TermsDialog
        open={editingTerms}
        config={config}
        saving={saving}
        onClose={() => setEditingTerms(false)}
        onSave={async (scope, terms) => {
          if (!config) return;
          const ok = await save(
            { ...config, scope_of_work: scope, terms },
            "the scope and terms",
          );
          if (ok) setEditingTerms(false);
        }}
      />

      {dialog}
    </div>
  );
}

/* ──────────────────────────────── dialogs ─────────────────────────────── */

/** Edits one property type's four figures. */
function TypeDialog({
  row,
  currency,
  saving,
  onClose,
  onSave,
}: {
  row: RateRow | null;
  currency: string;
  saving: boolean;
  onClose: () => void;
  onSave: (next: RateRow) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<RateRow | null>(row);

  /*
    Each opening starts from what is stored, discarding anything typed into
    a previous one. Done by comparing against the row we last seeded from
    during render, not in an effect: an effect runs after the browser has
    been handed a frame, so the dialog would paint the previous property
    type's figures once under the new heading.
  */
  const [seed, setSeed] = useState(row);
  if (seed !== row) {
    setSeed(row);
    setDraft(row);
  }

  const issues = draft ? validateType(draft) : [];
  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message;
  const set = (patch: Partial<RateRow>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  return (
    <Dialog open={Boolean(row)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draft ? `${draft.label} rates` : "Rates"}</DialogTitle>
          <DialogDescription>
            Every figure is exclusive of VAT and quoted in {currency}. Quotations
            already issued keep the figures they were raised with.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
            <GroupLabel
              title="Inspection rate"
              hint="Charged per sq ft of built-up area."
            />
            <Field
              label="Unfurnished, lowest"
              error={issueFor("unfurnished")}
              hint="The rate charged is picked inside this range by property size."
            >
              <MoneyInput
                value={draft.unfurnished_min}
                suffix="/ sq ft"
                invalid={Boolean(issueFor("unfurnished"))}
                label={`${draft.label} unfurnished rate, lowest`}
                onChange={(value) => set({ unfurnished_min: value })}
              />
            </Field>
            <Field label="Unfurnished, highest">
              <MoneyInput
                value={draft.unfurnished_max}
                suffix="/ sq ft"
                invalid={Boolean(issueFor("unfurnished"))}
                label={`${draft.label} unfurnished rate, highest`}
                onChange={(value) => set({ unfurnished_max: value })}
              />
            </Field>
            <Field
              label="Furnished"
              error={issueFor("furnished")}
              hint="One flat rate, not a range."
            >
              <MoneyInput
                value={draft.furnished}
                suffix="/ sq ft"
                invalid={Boolean(issueFor("furnished"))}
                label={`${draft.label} furnished rate`}
                onChange={(value) => set({ furnished: value })}
              />
            </Field>
            <Field
              label="Minimum charge"
              error={issueFor("minimum_charge")}
              hint="Topped up to this when the area calculation lands below it."
            >
              <MoneyInput
                value={draft.minimum_charge}
                step="10"
                suffix="/ job"
                invalid={Boolean(issueFor("minimum_charge"))}
                label={`${draft.label} minimum charge`}
                onChange={(value) => set({ minimum_charge: value })}
              />
            </Field>

            <GroupLabel
              title="De-snagging"
              hint="A fixed price per re-inspection round."
              action={
                <div className="flex items-center gap-2">
                  <Label className="text-muted-foreground text-xs">Priced</Label>
                  <Switch
                    checked={draft.desnag_min != null || draft.desnag_max != null}
                    aria-label={`${draft.label} de-snagging is priced`}
                    onCheckedChange={(on) =>
                      set(
                        on
                          ? {
                              desnag_min: draft.minimum_charge,
                              desnag_max: draft.minimum_charge,
                            }
                          : { desnag_min: null, desnag_max: null },
                      )
                    }
                  />
                </div>
              }
            />
            {draft.desnag_min == null && draft.desnag_max == null ? (
              <p className="text-muted-foreground -mt-2 text-xs sm:col-span-2">
                Published on the rate card as “to be confirmed”. Turn Priced on to
                quote a figure for {draft.label.toLowerCase()} jobs.
              </p>
            ) : (
              <>
                <Field label="Lowest" error={issueFor("desnag")}>
                  <MoneyInput
                    value={draft.desnag_min}
                    step="10"
                    suffix="/ round"
                    invalid={Boolean(issueFor("desnag"))}
                    label={`${draft.label} de-snagging price, lowest`}
                    onChange={(value) => set({ desnag_min: value })}
                  />
                </Field>
                <Field label="Highest">
                  <MoneyInput
                    value={draft.desnag_max}
                    step="10"
                    suffix="/ round"
                    invalid={Boolean(issueFor("desnag"))}
                    label={`${draft.label} de-snagging price, highest`}
                    onChange={(value) => set({ desnag_max: value })}
                  />
                </Field>
              </>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton
            pending={saving}
            pendingLabel="Saving…"
            disabled={!draft || issues.length > 0}
            onClick={() => draft && void onSave(draft)}
          >
            Save changes
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Edits the charges that sit on the card rather than on a property type. */
function ChargesDialog({
  open,
  config,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  config: SnaggingPricingConfig | null;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: ChargesDraft) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<ChargesDraft | null>(null);

  /* Seeded on the way open, during render — see TypeDialog. */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setDraft(
      open && config?.rate_card
        ? {
            external_min: config.rate_card.external_min,
            external_max: config.rate_card.external_max,
            additional_visit_price: config.rate_card.additional_visit_price,
            out_of_hours_percent: config.out_of_hours_percent ?? 40,
            tax_rate: config.tax_rate,
          }
        : null,
    );
  }

  const issues = draft ? validateCharges(draft) : [];
  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message;
  const set = (patch: Partial<ChargesDraft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Other charges</DialogTitle>
          <DialogDescription>
            Applied on top of the per-type rates. Every figure is exclusive of
            VAT.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
            <GroupLabel
              title="External areas"
              hint="Plot area minus built-up area. Villas and townhouses only."
            />
            <Field
              label="Lowest"
              error={issueFor("external")}
              hint="The rate charged is picked inside this range by plot size."
            >
              <MoneyInput
                value={draft.external_min}
                suffix="/ sq ft"
                invalid={Boolean(issueFor("external"))}
                label="External areas rate, lowest"
                onChange={(value) => set({ external_min: value })}
              />
            </Field>
            <Field label="Highest">
              <MoneyInput
                value={draft.external_max}
                suffix="/ sq ft"
                invalid={Boolean(issueFor("external"))}
                label="External areas rate, highest"
                onChange={(value) => set({ external_max: value })}
              />
            </Field>

            <GroupLabel
              title="Surcharges"
              hint="Added to a quotation by the coordinator, never automatically."
            />
            <Field
              label="Additional visit"
              error={issueFor("visit")}
              hint="Per visit, per property."
            >
              <MoneyInput
                value={draft.additional_visit_price}
                step="10"
                suffix="/ visit"
                invalid={Boolean(issueFor("visit"))}
                label="Additional visit price"
                onChange={(value) => set({ additional_visit_price: value })}
              />
            </Field>
            <Field
              label="Out of hours"
              error={issueFor("out_of_hours")}
              hint="Weekends, public holidays, outside 09:00–17:00."
            >
              <PercentInput
                value={draft.out_of_hours_percent}
                step="1"
                invalid={Boolean(issueFor("out_of_hours"))}
                label="Out of hours surcharge"
                onChange={(value) => set({ out_of_hours_percent: value })}
              />
            </Field>

            <GroupLabel title="Tax" hint="Its own line on every quotation." />
            <Field label="VAT" error={issueFor("vat")}>
              <PercentInput
                value={draft.tax_rate}
                step="0.5"
                invalid={Boolean(issueFor("vat"))}
                label="VAT rate"
                onChange={(value) => set({ tax_rate: value })}
              />
            </Field>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton
            pending={saving}
            pendingLabel="Saving…"
            disabled={!draft || issues.length > 0}
            onClick={() => draft && void onSave(draft)}
          >
            Save changes
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Edits the two blocks of text printed on every quotation. */
function TermsDialog({
  open,
  config,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  config: SnaggingPricingConfig | null;
  saving: boolean;
  onClose: () => void;
  onSave: (scope: string, terms: string) => void | Promise<void>;
}) {
  const [scope, setScope] = useState(config?.scope_of_work ?? "");
  const [terms, setTerms] = useState(config?.terms ?? "");
  const scopeRef = useRef<HTMLTextAreaElement>(null);
  const termsRef = useRef<HTMLTextAreaElement>(null);

  /* Seeded on the way open, during render — see TypeDialog. */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setScope(config?.scope_of_work ?? "");
      setTerms(config?.terms ?? "");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/*
        One scroll for the whole dialog, not one per box. Both blocks run to
        several hundred words, and two independently scrolling panes meant
        you could never see a clause and its neighbour at the same time.
      */}
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Scope of work & terms</DialogTitle>
          <DialogDescription>
            Printed on every snagging quotation. The scope prints as its own
            block above the numbered notes.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-2">
          <Field
            label="Scope of work"
            hint="Use the buttons, or type: # heading, ## sub-heading, - bullet, **bold**."
          >
            <FormatToolbar
              target={scopeRef}
              value={scope}
              onChange={setScope}
              kinds={["heading", "subheading", "bullet", "bold"]}
            />
            <Textarea
              ref={scopeRef}
              rows={8}
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              placeholder="What the snagging inspection covers…"
              className="mt-2 resize-none font-mono text-xs leading-relaxed [field-sizing:content]"
            />
            <PreviewBox>
              <ScopeView value={scope} />
            </PreviewBox>
          </Field>
          <Field
            label="Terms & conditions"
            hint="One term per line; they are numbered for you. **bold** works here too."
          >
            <FormatToolbar
              target={termsRef}
              value={terms}
              onChange={setTerms}
              kinds={["number", "bold"]}
            />
            <Textarea
              ref={termsRef}
              rows={8}
              value={terms}
              onChange={(event) => setTerms(event.target.value)}
              placeholder="This quotation is valid for 30 calendar days…"
              className="mt-2 resize-none font-mono text-xs leading-relaxed [field-sizing:content]"
            />
            <PreviewBox>
              <TermsView value={terms} />
            </PreviewBox>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton
            pending={saving}
            pendingLabel="Saving…"
            onClick={() => void onSave(scope, terms)}
          >
            Save changes
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────── preview ─────────────────────────────── */

/**
 * What the card above actually quotes, on a property you choose.
 *
 * The figures on the card are rates and floors; what Operations is really
 * deciding is what lands on a client's quotation, and until now the only
 * way to find out was to save, raise a quotation and look. This prices one
 * through `computeQuotation`, the very function the quotation route runs,
 * so the preview cannot drift from the document.
 */
function QuotePreview({ config }: { config: SnaggingPricingConfig }) {
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
      bodyClassName="border-t"
    >
      {/*
        Controls across the top, the priced document underneath.

        Side by side, the four controls made a tall left column against two
        or three quotation lines, and the card was mostly the gap between
        them. Stacked, each half is the width it needs and the lines read
        as what they are — a document, not a sidebar's output.
      */}
      {/*
        Each control is only as wide as the value it holds. On a four-column
        grid the two area fields stretched to a third of the card each, so a
        four-digit number sat a hand's width from its own label.
      */}
      <div className="bg-muted/20 flex flex-wrap items-end gap-x-4 gap-y-4 border-b px-5 py-4">
        <Field label="Property type" className="w-40">
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
        </Field>

        <Field label="Built-up area" className="w-36">
          <MoneyInput
            value={builtUp}
            step="50"
            prefix={null}
            suffix="sq ft"
            label="Built-up area"
            onChange={setBuiltUp}
          />
        </Field>

        {external ? (
          <Field label="Plot area" className="w-36">
            <MoneyInput
              value={plot}
              step="50"
              prefix={null}
              suffix="sq ft"
              label="Plot area"
              onChange={setPlot}
            />
          </Field>
        ) : null}

        <div className="flex items-center gap-5 pb-2">
          <Toggle
            checked={furnished}
            onChange={setFurnished}
            label="Furnished"
            disabled={type === "commercial"}
          />
          <Toggle
            checked={outOfHours}
            onChange={setOutOfHours}
            label="Out of hours"
          />
        </div>
      </div>

      <div className="flex flex-col">
        {quote.lines.length === 0 ? (
          <p className="text-muted-foreground p-5 text-sm">
            Nothing to price — this property type has no row on the card.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-xs">
                    <th className="px-5 py-2.5 text-left font-medium">
                      Description
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                    <th className="px-3 py-2.5 text-right font-medium">Rate</th>
                    <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {quote.lines.map((line, index) => (
                    <tr key={index}>
                      <td className="px-5 py-3">{line.description}</td>
                      <td className="text-muted-foreground px-3 py-3 text-right whitespace-nowrap tabular-nums">
                        {line.qty.toLocaleString()}{" "}
                        <span className="text-xs">{line.unit}</span>
                      </td>
                      <td className="text-muted-foreground px-3 py-3 text-right whitespace-nowrap tabular-nums">
                        {line.unit_price.toLocaleString("en-AE", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-5 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                        {money(line.amount, config.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col items-end gap-3 border-t p-5 sm:flex-row sm:items-end sm:justify-between">
              {quote.minimum_applied ? (
                <p className="text-muted-foreground max-w-sm text-xs">
                  The area calculation came in under the minimum charge, so a
                  top-up line was added.
                </p>
              ) : (
                <span />
              )}

              <dl className="w-full space-y-2 sm:max-w-xs">
                <Total
                  label="Subtotal"
                  value={money(quote.subtotal, config.currency)}
                />
                <Total
                  label={`VAT (${quote.tax_rate}%)`}
                  value={money(quote.tax_amount, config.currency)}
                />
                <div className="flex items-baseline justify-between gap-4 border-t pt-2.5">
                  <dt className="text-sm font-medium">Total</dt>
                  <dd className="text-xl font-semibold tabular-nums">
                    {money(quote.total, config.currency)}
                  </dd>
                </div>
              </dl>
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}

function Total({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm tabular-nums">{value}</dd>
    </div>
  );
}

/* ─────────────────────────────── controls ─────────────────────────────── */

/** Label + value or control + hint or error, so every figure lines up. */
function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
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

/**
 * A heading that groups the fields under it, spanning the dialog's grid.
 *
 * The figures in these dialogs are not a flat list — a low and a high rate
 * belong together, a surcharge belongs with the other surcharges — and
 * without a heading between them the dialog reads as eight unrelated boxes
 * that happen to be stacked.
 */
function GroupLabel({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 border-b pb-2 sm:col-span-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {hint ? (
          <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** A read-only figure in the "other charges" list. */
function Figure({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1 p-5">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="font-medium">{children}</dd>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/**
 * Stored prose, shown in full as it will print.
 *
 * No scroll box. These two blocks are the quotation's small print, and the
 * point of showing them on the pricing page is that somebody can read them
 * end to end before a client does — which a 200px window with a scrollbar
 * actively discourages.
 */
/** How the text will print, under the box it is typed in. */
function PreviewBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 mt-3 rounded-lg border p-3">
      <p className="text-muted-foreground mb-2 text-[0.6875rem] font-medium tracking-wide uppercase">
        Preview on the quotation
      </p>
      {children}
    </div>
  );
}

/** Shown formatted, as the quotation prints it (point 14). */
function TextBlock({
  label,
  value,
  kind,
}: {
  label: string;
  value?: string | null;
  kind: "scope" | "terms";
}) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </p>
      {value?.trim() ? (
        kind === "scope" ? (
          <ScopeView value={value} />
        ) : (
          <TermsView value={value} />
        )
      ) : (
        <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
          Nothing set. This block will not print on the quotation.
        </p>
      )}
    </div>
  );
}

/**
 * A number a person is typing, which is not the same thing as a number.
 *
 * The keystrokes live here as text until they parse; the model only ever
 * receives a real number, and an empty field keeps the last good value
 * rather than silently becoming zero — which is what a parse-on-every-
 * keystroke field does the moment you clear it to type a new rate.
 */
function NumberBox({
  value,
  onChange,
  step,
  invalid,
  label,
  className,
}: {
  value: number | null | undefined;
  onChange: (value: number) => void;
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
      className={cn("tabular-nums", className)}
      value={shown}
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

/** One figure, with its units attached to the control. */
function MoneyInput({
  value,
  onChange,
  step = "0.05",
  invalid,
  label,
  prefix = "AED",
  suffix,
}: {
  value: number | null | undefined;
  onChange: (value: number) => void;
  step?: string;
  invalid?: boolean;
  label: string;
  prefix?: string | null;
  suffix?: string;
}) {
  return (
    <InputGroup>
      {prefix ? (
        <InputGroupAddon className="text-[0.6875rem]">
          {prefix === "AED" ? <DirhamIcon className="size-3.5" aria-label="AED" role="img" /> : prefix}
        </InputGroupAddon>
      ) : null}
      <NumberBox
        value={value}
        onChange={onChange}
        step={step}
        invalid={invalid}
        label={label}
      />
      {suffix ? (
        <InputGroupAddon align="inline-end" className="text-[0.6875rem]">
          {suffix}
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

/** A percentage, which needs no currency but does need its sign. */
function PercentInput({
  value,
  onChange,
  step,
  invalid,
  label,
}: {
  value: number | null | undefined;
  onChange: (value: number) => void;
  step?: string;
  invalid?: boolean;
  label: string;
}) {
  return (
    <InputGroup>
      <NumberBox
        value={value}
        onChange={onChange}
        step={step}
        invalid={invalid}
        label={label}
      />
      <InputGroupAddon align="inline-end">%</InputGroupAddon>
    </InputGroup>
  );
}

/** A switch and its label, for the preview's two options. */
function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={checked && !disabled}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={label}
      />
      <Label
        className={cn(
          "text-xs font-medium whitespace-nowrap",
          disabled && "text-muted-foreground",
        )}
      >
        {label}
      </Label>
    </div>
  );
}
