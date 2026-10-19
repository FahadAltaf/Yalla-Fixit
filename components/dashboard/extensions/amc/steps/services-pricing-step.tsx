"use client";

import { AlertTriangle, BadgePercent, ListChecks, Plus, SlidersHorizontal, Trash2, UserRound, Wallet } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { formatPhoneForDocument } from "../amc-phone";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ServiceTable } from "../components/service-table";
import { emptyPriceListRow } from "../amc-constants";
import { CLAUSE_6_3_HANDYMAN, stripListMarker } from "../amc-contract-content";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type { AmcSettings } from "../amc-settings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AmcFormData, AmcPriceListRow } from "../amc-types";
import { servicesForProperty, type AmcServiceDefinition } from "../amc-settings";
import { calculateAmcTotals } from "../amc-pricing";
import { applyPackage, packagesFor, rateItemFor } from "@/lib/amc/rate-card";
import {
  PAYMENT_PLAN_LABELS,
  allowedPaymentPlans,
  approvalLevelName,
  discountApprovalLevel,
  isNonStandardPlan,
  legacyTermsForPlan,
  type CustomPlan,
  type PaymentPlan,
} from "@/lib/amc/proposal-rules";
import { formatCurrencyAED } from "@/utils/format-currency";
import type { ProposalRules } from "@/modules/amc-submissions";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
  /** The services AMC Settings defines; the table offers these. */
  catalogue: ReadonlyArray<AmcServiceDefinition>;
  /*
    The account managers an admin keeps in AMC Settings: a proposal picks
    one from that list and gets their direct number with them (Sharon,
    Oct 2026). Undefined while the settings are still loading.
  */
  settings?: AmcSettings;
  /* Phase 4: the rate card in force, payment bands and discount thresholds; undefined while loading. */
  rules?: ProposalRules | null;
}

/** The picker's "nobody" option (the second manager is optional). */
const MANAGER_NONE = "__none__";
/** A name saved on an older proposal that is not on the list any more. */
const MANAGER_KEPT = "__kept__";

/**
 * Step 2 — Services and Pricing (FR1.1, FR1.3, §5.1).
 *
 * Replaces PackageServicesStep. The package picker and the commercial
 * monthly-rate field are both gone (FR2.6): the step opens straight on the
 * service table, and every price comes from the base price entered per row
 * (FR2.4).
 *
 * The commercial rate field is worth a note, because deleting a required
 * field looks like a regression. It was required by validation, stored and
 * round-tripped — and never read by any pricing function, so the number the
 * team was forced to enter never reached the document. FR2.6 removes the
 * concept rather than wiring it up.
 *
 * §5.1 also puts the optional sections and the placeholder fields on this
 * step, which is why they are below rather than on Review.
 */
/*
  Clause 6.3's standard rates, from AMC Settings: what the Additional fixed
  price services rows start from when the switch is turned on (AMC-057).
  The first paragraph of the clause is its title, the rest one rate each.
*/
function standardFixedPriceRates(settings: AmcSettings | null | undefined): string[] {
  const body =
    settings?.clauseList?.find((clause) => clause.role === "handymanRates")?.body ??
    settings?.clauses?.handymanRates ??
    "";
  const rates = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(1)
    .map((rate) => stripListMarker(rate).trim())
    .filter(Boolean);
  return rates.length > 0 ? rates : CLAUSE_6_3_HANDYMAN.rates.map((rate) => rate.text);
}

export function ServicesPricingStep({ form, catalogue, settings, rules }: StepProps) {
  const card = rules?.rateCard ?? null;
  const model = form.watch("unitType");
  const packages = card ? packagesFor(card.card, model) : [];
  /* The visits a year the card allows per service on this model (BRD 5.3). */
  const allowedFrequencies = (serviceId: string) => (card ? (rateItemFor(card.card, serviceId, model)?.allowedFrequencies ?? []) : []);
  const discount = form.watch("discountPercent") ?? 0;
  const level = rules ? discountApprovalLevel(rules.approvals, discount) : 0;
  const belowFloor = (form.watch("serviceRows") ?? []).some((row) => row.included && row.belowFloor);
  /* null while AMC Settings is loading, so the picker can say so instead of looking empty. */
  const savedManagers = settings
    ? settings.accountManagers.filter((manager) => manager.name.trim())
    : null;
  const unitType = form.watch("unitType");
  /* Named, so an absence reads as a rule rather than as a missing row. */
  const offeredIds = new Set(
    servicesForProperty({ services: [...catalogue] }, unitType).map((s) => s.id),
  );
  const hiddenServices = catalogue
    .filter((service) => service.enabled !== false && !offeredIds.has(service.id))
    .map((service) => service.label.replace(/\s*\(.*?\)\s*/g, " ").trim());
  const showPriceList = form.watch("optionalSections.supplyInstallPriceList");
  const priceListRows = form.watch("priceListRows") ?? [];
  const showFixedRates = form.watch("optionalSections.additionalFixedPriceServices");
  const fixedPriceRates = form.watch("fixedPriceRates") ?? [];

  const setFixedRates = (next: string[]) =>
    form.setValue("fixedPriceRates", next, { shouldValidate: true });

  /* A row that is not wanted can go (AMC-057); one row always stays, so
     the table never disappears while the section is on. */
  const removePriceListRow = (index: number) =>
    form.setValue(
      "priceListRows",
      priceListRows.length > 1
        ? priceListRows.filter((_, i) => i !== index)
        : [emptyPriceListRow()],
      { shouldValidate: true },
    );

  const updatePriceListRow = (
    index: number,
    patch: Partial<AmcPriceListRow>,
  ) => {
    const next = priceListRows.map((row, i) =>
      i === index ? { ...row, ...patch } : row,
    );
    form.setValue("priceListRows", next, { shouldValidate: true });
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <ListChecks className="text-brand size-4" />
            Contract services
          </h3>
          <p className="text-sm text-muted-foreground">
            {card
              ? "Tick each service this AMC covers and set its units and visits per year. Rates come from the rate card and cannot be changed here; the price is rate × units × frequency."
              : "Tick each service this AMC covers, then set its units, visits per year and base price. The price is base price × units × frequency, and it updates as you type."}
          </p>
        </div>
        {card ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              Rate card V{card.versionNo}, in force since {card.effectiveFrom.split("-").reverse().join("/")}. Promotions in date are applied.
            </span>
            {packages.length ? (
              <Select
                value=""
                onValueChange={(id) => {
                  const pkg = packages.find((p) => p.id === id);
                  if (pkg) form.setValue("serviceRows", applyPackage(form.getValues("serviceRows"), pkg), { shouldValidate: true });
                }}
              >
                <SelectTrigger size="sm" className="w-[200px]" aria-label="Apply a package">
                  <SelectValue placeholder="Apply a package" />
                </SelectTrigger>
                <SelectContent>
                  {packages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-4">
          {/* FR1.4 — villa-only services stay hidden for apartments and
              offices. Naming them, so an absence reads as a rule rather
              than as a missing row. */}
          {hiddenServices.length > 0 && (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle className="text-xs font-medium">
                Some services aren&apos;t offered on this kind of property
              </AlertTitle>
              <AlertDescription className="text-xs">
                {hiddenServices.join(", ")}.
              </AlertDescription>
            </Alert>
          )}

          <ServiceTable
            form={form}
            catalogue={catalogue}
            rateCard={!!card}
            allowedFrequencies={card ? allowedFrequencies : undefined}
            discountNote={
              rules ? (
                <p className={`flex items-center gap-1.5 text-xs ${level ? "text-warning" : "text-muted-foreground"}`}>
                  <BadgePercent className="size-3.5" />
                  {level
                    ? `A ${discount}% discount needs ${approvalLevelName(rules.approvals, level)} approval.`
                    : "This discount is within the standard authority."}
                  {belowFloor ? " One or more lines fall below their floor rate, which also needs approval." : ""}
                </p>
              ) : null
            }
          />
        </div>
      </section>

      {/* DEV-366: the plan replaces monthly / quarterly / annual. */}
      <PaymentPlanSection form={form} rules={rules} />

      {/* FR4.4 / §8.2 — clause 1.1 names one or two account managers with
          a direct number. Chosen here, per client. */}
      <section className="space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <UserRound className="text-brand size-4" />
            Account managers
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Choose the account managers assigned to this client. Their names and direct contact numbers will appear in the contract for support.
          </p>

        </div>
        {/*
          A box each, rather than four fields in a row.

          The two managers were laid out as name, number, name, number
          across one grid, so the second manager’s name sat beside the
          first one’s number and nothing said which belonged to which.
          Each is its own bordered block now, which also gives the
          “this proposal only” fields somewhere to appear without
          shifting the field beside them.
        */}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {([0, 1] as const).map((index) => (
            <AccountManagerField
              key={index}
              form={form}
              index={index}
              saved={savedManagers}
              taken={form.watch(`accountManagers.${index === 0 ? 1 : 0}.name`) ?? ""}
            />
          ))}
        </div>
      </section>

      {/* FR4.5 / §8.3 — a section that is switched off is left out of the
          document completely. The other three optional sections are service
          rows, so their own checkbox above already decides. */}
      <section className="space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <SlidersHorizontal className="text-brand size-4" />
            Optional contract sections
          </h3>
          <p className="text-sm text-muted-foreground">
            These are off by default. A section that stays off is left out of
            the contract completely.
          </p>
        </div>
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="optionalSections.supplyInstallPriceList"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div className="space-y-0.5">
                  <FormLabel className="text-sm">
                    Supply and installation price list
                  </FormLabel>
                  <p className="text-xs text-muted-foreground">
                    Fill in the rows below once it is on.
                  </p>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label="Include the supply and installation price list"
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {showPriceList && (
            <FormField
              control={form.control}
              name="priceListRows"
              render={() => (
                <FormItem>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">No.</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="w-[130px]">Brand</TableHead>
                          <TableHead className="w-[120px]">Price (AED)</TableHead>
                          <TableHead className="w-10">
                            <span className="sr-only">Remove</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {priceListRows.map((row, index) => (
                          <TableRow key={index}>
                            <TableCell className="text-xs text-muted-foreground">
                              {index + 1}
                            </TableCell>
                            {(
                              [
                                ["category", "e.g. Plumbing"],
                                ["description", "e.g. Mixer tap replacement"],
                                ["brand", "e.g. Grohe"],
                                ["price", "0.00"],
                              ] as const
                            ).map(([key, placeholder]) => (
                              <TableCell key={key}>
                                <Input
                                  className="h-8 text-xs"
                                  placeholder={placeholder}
                                  aria-label={`${key} for price list row ${index + 1}`}
                                  value={row[key]}
                                  onChange={(event) =>
                                    updatePriceListRow(index, {
                                      [key]: event.target.value,
                                    })
                                  }
                                />
                              </TableCell>
                            ))}
                            <TableCell className="px-1">
                              <Hint label="Remove this row">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground hover:text-destructive size-8"
                                  onClick={() => removePriceListRow(index)}
                                  aria-label={`Remove price list row ${index + 1}`}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </Hint>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Blank rows are dropped when the contract renders, and
                      any row can be removed with its bin. */}
                  <button
                    type="button"
                    className="text-primary mt-2 text-xs font-medium hover:underline"
                    onClick={() =>
                      form.setValue(
                        "priceListRows",
                        [...priceListRows, emptyPriceListRow()],
                        { shouldValidate: true },
                      )
                    }
                  >
                    Add another row
                  </button>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="optionalSections.additionalFixedPriceServices"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div className="space-y-0.5">
                  <FormLabel className="text-sm">
                    Additional fixed price services
                  </FormLabel>
                  <p className="text-xs text-muted-foreground">
                    The hourly rates for handyman work beyond the free
                    hours.
                  </p>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      /* On, it asks for the rates, starting from the
                         standard ones in AMC Settings (AMC-057). */
                      if (checked && !fixedPriceRates.some((rate) => rate.trim())) {
                        setFixedRates(standardFixedPriceRates(settings));
                      }
                    }}
                    aria-label="Include additional fixed price services"
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {showFixedRates && (
            <FormField
              control={form.control}
              name="fixedPriceRates"
              render={() => (
                <FormItem>
                  <div className="space-y-2 rounded-md border p-3">
                    <p className="text-muted-foreground text-xs">
                      One rate per line, as it prints in clause 6.3 of the
                      contract. These start from the standard rates in AMC
                      Settings and apply to this proposal only.
                    </p>
                    {fixedPriceRates.map((rate, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="text-muted-foreground w-5 text-right text-xs tabular-nums">
                          {index + 1}.
                        </span>
                        <Input
                          className="h-8 text-xs"
                          value={rate}
                          maxLength={300}
                          placeholder="e.g. First hour: 199.00 AED + VAT"
                          aria-label={`Fixed price rate ${index + 1}`}
                          onChange={(event) =>
                            setFixedRates(
                              fixedPriceRates.map((r, i) =>
                                i === index ? event.target.value : r,
                              ),
                            )
                          }
                        />
                        <Hint label="Remove this rate">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive size-8 shrink-0"
                            onClick={() =>
                              setFixedRates(fixedPriceRates.filter((_, i) => i !== index))
                            }
                            aria-label={`Remove fixed price rate ${index + 1}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </Hint>
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={fixedPriceRates.length >= 20}
                        onClick={() => setFixedRates([...fixedPriceRates, ""])}
                      >
                        <Plus className="size-4" />
                        Add a rate
                      </Button>
                      <button
                        type="button"
                        className="text-primary text-xs font-medium hover:underline"
                        onClick={() => setFixedRates(standardFixedPriceRates(settings))}
                      >
                        Reset to the standard rates
                      </button>
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>
      </section>
    </div>
  );
}
/**
 * One of the two account managers on a proposal: a dropdown of the
 * account managers in AMC Settings, and the chosen one's direct number
 * read back from there (Sharon, Oct 2026: no free-text name or number).
 *
 * A proposal written before its manager was taken off the list keeps
 * that name as an option, so reopening it never loses who was named; it
 * cannot be typed in new.
 */
function AccountManagerField({
  form,
  index,
  saved,
  taken,
}: {
  form: UseFormReturn<AmcFormData>;
  index: 0 | 1;
  saved: ReadonlyArray<{ name: string; phone: string }> | null;
  /* The name chosen in the other box: not offered here, so nobody is named twice. */
  taken: string;
}) {
  const nameField = `accountManagers.${index}.name` as const;
  const phoneField = `accountManagers.${index}.phone` as const;
  const name = form.watch(nameField) ?? "";
  const phone = form.watch(phoneField) ?? "";
  /* Ignoring case and spacing: "ahmed khan " on a proposal is the Settings entry "Ahmed Khan". */
  const sameName = (a: string, b: string) =>
    a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
  const all = saved ?? [];
  const matched = (name.trim() ? all.find((manager) => sameName(manager.name, name)) : null) ?? null;
  const list = all.filter((manager) => !taken.trim() || !sameName(manager.name, taken) || manager === matched);
  const kept = !matched && name.trim() ? { name: name.trim(), phone } : null;

  const set = (value: { name: string; phone: string }) => {
    form.setValue(nameField, value.name, { shouldValidate: true, shouldDirty: true });
    form.setValue(phoneField, value.phone, { shouldValidate: true, shouldDirty: true });
  };

  const shown = matched ?? kept;
  const loading = saved === null;
  const empty = !loading && all.length === 0 && !kept;
  /* Everyone on the list is already the other manager. */
  const allTaken = !loading && all.length > 0 && list.length === 0 && !kept;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">Account manager {index + 1}</h4>
        {index === 1 ? <span className="text-muted-foreground text-xs">Optional</span> : null}
      </div>

      <Select
        value={matched ? matched.name : kept ? MANAGER_KEPT : ""}
        disabled={loading || empty || (allTaken && !name.trim())}
        onValueChange={(value) => {
          if (value === MANAGER_NONE) return set({ name: "", phone: "" });
          if (value === MANAGER_KEPT) return;
          const manager = list.find((item) => item.name === value);
          // The number comes with the name: that is what the list is for.
          if (manager) set(manager);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue
            placeholder={
              loading
                ? "Loading account managers…"
                : empty
                  ? "No account managers in AMC Settings"
                  : allTaken
                    ? "No other account manager in AMC Settings"
                    : "Choose a manager"
            }
          >
            {/* The name only: the number is read back under the field. */}
            {shown?.name}
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={4} className="max-h-72">
          {list.map((manager) => (
            <SelectItem key={manager.name} value={manager.name} className="py-2">
              <span className="flex w-full items-center justify-between gap-4">
                <span className="truncate">{manager.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {formatPhoneForDocument(manager.phone) || "No number"}
                </span>
              </span>
            </SelectItem>
          ))}
          {kept ? (
            <SelectItem value={MANAGER_KEPT} className="py-2">
              <span className="truncate">{kept.name}</span>
              <span className="text-muted-foreground ml-2 text-xs">Not in AMC Settings</span>
            </SelectItem>
          ) : null}
          {name.trim() || index === 1 ? (
            <>
              {list.length || kept ? <SelectSeparator /> : null}
              <SelectItem value={MANAGER_NONE} className="text-muted-foreground py-2">
                None
              </SelectItem>
            </>
          ) : null}
        </SelectContent>
      </Select>

      {shown ? (
        /*
          Read back, not re-entered: the number is the one thing the
          Settings list exists to keep right.
        */
        <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-md px-3 py-2">
          <span className="text-sm tabular-nums">{formatPhoneForDocument(shown.phone) || "No number on file"}</span>
          <span className="text-muted-foreground text-xs">{matched ? "From AMC Settings" : "Saved with this proposal"}</span>
        </div>
      ) : allTaken ? (
        <p className="text-muted-foreground text-xs">
          The only account manager in AMC Settings is already account manager {index === 0 ? 2 : 1}. Add another under AMC
          Settings to name a second one.
        </p>
      ) : empty ? (
        <p className="text-muted-foreground text-xs">
          An administrator adds account managers, with their direct numbers, under AMC Settings. They can then be chosen here.
        </p>
      ) : null}
    </div>
  );
}

/**
 * How the client pays (BRD 5.8, DEV-366): one payment below the value band;
 * above it the configured plans, plus a custom plan when allowed. A plan
 * outside the band is kept but marked, because it needs approval.
 */
function PaymentPlanSection({ form, rules }: { form: UseFormReturn<AmcFormData>; rules?: ProposalRules | null }) {
  const values = form.watch();
  const finalPrice = calculateAmcTotals(values).finalPrice;
  const plan: PaymentPlan = values.paymentPlan ?? "single";
  const custom: CustomPlan = values.paymentPlanCustom ?? [];
  const allowed = rules ? allowedPaymentPlans(rules.payments, finalPrice) : (["single", "fifty_fifty", "quarterly", "monthly", "custom"] as PaymentPlan[]);
  const options = allowed.includes(plan) ? allowed : [plan, ...allowed];
  const nonStandard = rules ? isNonStandardPlan(rules.payments, finalPrice, plan) : false;
  const total = custom.reduce((sum, row) => sum + (Number(row.percent) || 0), 0);

  const setPlan = (next: PaymentPlan) => {
    form.setValue("paymentPlan", next, { shouldValidate: true, shouldDirty: true });
    /* The legacy reading live main prints (lib/amc/proposal-rules.ts). */
    form.setValue("paymentTerms", legacyTermsForPlan(next), { shouldValidate: true });
    if (next === "custom" && custom.length === 0) {
      form.setValue("paymentPlanCustom", [{ label: "On signing", percent: 50 }, { label: "After six months", percent: 50 }], { shouldValidate: true });
    }
  };
  const setCustom = (rows: CustomPlan) => form.setValue("paymentPlanCustom", rows, { shouldValidate: true, shouldDirty: true });

  return (
    <section className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Wallet className="text-brand size-4" />
          Payment plan
        </h3>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {rules
            ? finalPrice < rules.payments.singlePaymentBelowAed
              ? `Below ${formatCurrencyAED(rules.payments.singlePaymentBelowAed)} a year the AMC is paid in one payment.`
              : `From ${formatCurrencyAED(rules.payments.singlePaymentBelowAed)} a year the client can pay in instalments.`
            : "How the client pays the annual fee."}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select value={plan} onValueChange={(value) => setPlan(value as PaymentPlan)}>
          <SelectTrigger className="w-full" aria-label="Payment plan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {PAYMENT_PLAN_LABELS[option]}
                {!allowed.includes(option) ? " (outside the band)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {nonStandard ? (
          <p className="text-warning text-xs">
            {plan === "custom" ? "A custom plan" : "This plan is outside the standard plans for this value and"} needs approval.
          </p>
        ) : null}
      </div>
      {plan === "custom" ? (
        <div className="space-y-2 rounded-md border p-3">
          {custom.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                className="h-8 flex-1 text-xs"
                value={row.label}
                placeholder="When (e.g. On signing)"
                aria-label={`Instalment ${index + 1} name`}
                onChange={(event) => setCustom(custom.map((r, i) => (i === index ? { ...r, label: event.target.value } : r)))}
              />
              <Input
                className="h-8 w-24 text-xs"
                type="number"
                min={1}
                max={100}
                value={row.percent}
                aria-label={`Instalment ${index + 1} percent`}
                onChange={(event) => setCustom(custom.map((r, i) => (i === index ? { ...r, percent: Number(event.target.value) || 0 } : r)))}
              />
              <span className="text-muted-foreground text-xs">%</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                disabled={custom.length <= 2}
                aria-label={`Remove instalment ${index + 1}`}
                onClick={() => setCustom(custom.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={custom.length >= 12}
              onClick={() => setCustom([...custom, { label: "", percent: 0 }])}
            >
              <Plus className="size-4" />
              Add instalment
            </Button>
            <span className={`text-xs tabular-nums ${Math.abs(total - 100) < 0.01 ? "text-muted-foreground" : "text-destructive"}`}>
              {total}% of 100%
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
