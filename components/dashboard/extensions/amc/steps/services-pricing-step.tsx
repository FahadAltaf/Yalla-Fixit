"use client";

import { AlertTriangle, ListChecks, SlidersHorizontal, UserRound } from "lucide-react";
import { useState } from "react";
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
import { AmcPhoneInput } from "../components/amc-phone-input";
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
import type { AmcSettings } from "../amc-settings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AmcFormData, AmcPriceListRow } from "../amc-types";
import { servicesForProperty, type AmcServiceDefinition } from "../amc-settings";

interface StepProps {
  form: UseFormReturn<AmcFormData>;
  /** The services AMC Settings defines; the table offers these. */
  catalogue: ReadonlyArray<AmcServiceDefinition>;
  /*
    The account managers an admin keeps in AMC Settings, so a proposal
    picks one rather than retyping a name and a number. Undefined while
    the settings are still loading, and empty on an install where nobody
    has added any -- both fall back to the plain fields.
  */
  settings?: AmcSettings;
}

/** Marks the "someone else" option in the account manager picker. */
const MANAGER_CUSTOM = "__custom__";

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
export function ServicesPricingStep({ form, catalogue, settings }: StepProps) {
  const savedManagers = (settings?.accountManagers ?? []).filter(
    (manager) => manager.name.trim(),
  );
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
            Tick each service this AMC covers, then set its units, visits per
            year and base price. The price is base price × units × frequency,
            and it updates as you type.
          </p>
        </div>
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

          <ServiceTable form={form} catalogue={catalogue} />
        </div>
      </section>

      {/* FR4.4 / §8.2 — clause 1.1 names one or two account managers with
          a direct number. Chosen here, per client. */}
      <section className="space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <UserRound className="text-brand size-4" />
            Account managers
          </h3>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Who the client calls, printed in clause 1.1. One is enough.
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
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Blank rows are dropped when the contract renders, so
                      three empty rows cost nothing but an unused row. */}
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
                    onCheckedChange={field.onChange}
                    aria-label="Include additional fixed price services"
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
      </section>
    </div>
  );
}
/**
 * One of the two account managers on a proposal.
 *
 * Three states, one box:
 *
 *   nobody chosen   the picker, and nothing else
 *   from Settings   their number, read back, with no field to mistype
 *   this job only   name and number, entered here and saved with the
 *                   proposal rather than added to Settings
 *
 * The third exists because a proposal sometimes names somebody who is
 * not a standing account manager — a colleague covering a holiday, a
 * contact for one site — and putting them on the Settings list to get
 * them onto one contract would offer them on every future one.
 */
function AccountManagerField({
  form,
  index,
  saved,
}: {
  form: UseFormReturn<AmcFormData>;
  index: 0 | 1;
  saved: ReadonlyArray<{ name: string; phone: string }>;
}) {
  const nameField = `accountManagers.${index}.name` as const;
  const phoneField = `accountManagers.${index}.phone` as const;
  const name = form.watch(nameField);
  const matched = saved.find((manager) => manager.name === name) ?? null;

  /*
    Switched to the one-off fields deliberately, OR holding a name that is
    not on the list. The second covers a proposal written before somebody
    was added to Settings, or after they were taken off it: it reopens
    showing its own manager rather than quietly losing them.
  */
  const [chose, setChose] = useState(false);
  const custom = chose || (!matched && Boolean(name));

  const set = (value: { name: string; phone: string }) => {
    form.setValue(nameField, value.name, { shouldValidate: true });
    form.setValue(phoneField, value.phone, { shouldValidate: true });
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">Account manager {index + 1}</h4>
        {index === 1 ? (
          <span className="text-muted-foreground text-xs">Optional</span>
        ) : null}
      </div>

      {saved.length > 0 ? (
        <Select
          value={matched ? matched.name : custom ? MANAGER_CUSTOM : ""}
          onValueChange={(value) => {
            if (value === MANAGER_CUSTOM) {
              setChose(true);
              set({ name: "", phone: "" });
              return;
            }
            const manager = saved.find((item) => item.name === value);
            if (!manager) return;
            setChose(false);
            // The number comes with the name: that is what the list is for.
            set(manager);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose a manager" />
          </SelectTrigger>
          <SelectContent>
            {saved.map((manager) => (
              <SelectItem key={manager.name} value={manager.name}>
                {manager.name}
              </SelectItem>
            ))}
            <SelectItem value={MANAGER_CUSTOM}>
              Someone else, this proposal only
            </SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      {matched ? (
        /*
          Read back, not re-entered. The number is the one thing the
          Settings list exists to keep right, so this is the one place it
          must not be editable: a correction typed here would be invisible
          to the next proposal that names the same person.
        */
        <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-md px-3 py-2">
          <span className="text-sm tabular-nums">
            {formatPhoneForDocument(matched.phone) || "No number on file"}
          </span>
          <span className="text-muted-foreground text-xs">From AMC Settings</span>
        </div>
      ) : custom || saved.length === 0 ? (
        <div className="space-y-3">
          <FormField
            control={form.control}
            name={nameField}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Name</FormLabel>
                <FormControl>
                  <Input placeholder="Full name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={phoneField}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Direct number</FormLabel>
                <FormControl>
                  <AmcPhoneInput
                    id={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={field.disabled}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <p className="text-muted-foreground text-xs">
            {saved.length === 0
              ? "Add the managers you use often under AMC Settings, and they become a list to pick from."
              : "Saved with this proposal only, not added to AMC Settings."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
