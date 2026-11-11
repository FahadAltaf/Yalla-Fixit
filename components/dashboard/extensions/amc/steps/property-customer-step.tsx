"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CalendarRange,
  Plus,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useFieldArray, type UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { AmcPhoneInput } from "../components/amc-phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  AddressDialog,
  useAddressFormAccess,
} from "../../amc-contracts/address-dialog";
import { ClientPicker } from "../../amc-contracts/client-picker";
import { NewClientDialog } from "../../amc-contracts/enquiries/enquiry-client";
import { EditClientDialog } from "../../amc-contracts/edit-client-dialog";
import { EnquiryPropertySelect } from "../../amc-contracts/enquiries/enquiry-property-select";
import { LinkedCard, printedAddress } from "../../amc-contracts/linked-card";
import { formatPhone } from "@/lib/phone/format-phone";
import {
  amcContractsService,
  type CustomerRecord,
} from "@/modules/amc-contracts/amc-contracts-service";
import { getDefaultEndDate } from "../amc-constants";
import { defaultEndDate, proposalTermMonths } from "@/lib/amc/contracts";
import {
  UNIT_TYPES,
  UNIT_TYPE_CATEGORY,
  UNIT_TYPE_LABELS,
} from "@/lib/amc/client-profile";
import { rateModelFor } from "@/lib/amc/proposal-rules";
import { MODEL_LABELS } from "@/lib/amc/rate-card";
import { isEndDateBeforeStartDate } from "../amc-date-utils";
import { DatePickerField } from "../components/date-picker-field";
import {
  DESIGNATION_PRESETS,
  MAX_COORDINATION_CONTACTS,
  type AmcFormData,
} from "../amc-types";

/**
 * What the wizard means by a required field.
 *
 * The form told nobody which fields it would refuse to move on without:
 * every label looked the same, and the first anyone heard of it was a row
 * of red under the ones they had skipped. Same mark and same colour as
 * the snagging wizard, so one convention covers the product.
 *
 * Only on fields that can actually be left blank. A select that opens
 * with a value is required too, and marking it would make the mark mean
 * nothing.
 */
function RequiredMark() {
  return (
    <span className="text-brand" aria-hidden>
      {" *"}
    </span>
  );
}

interface StepProps {
  form: UseFormReturn<AmcFormData>;
}

/**
 * The end date a start date gets: a year on (the usual AMC), or the
 * configured minimum term when that is longer.
 */
function endDateFor(startDate: string, minimumTermMonths: number): string {
  return minimumTermMonths > 12
    ? (defaultEndDate(startDate, minimumTermMonths) ??
        getDefaultEndDate(startDate))
    : getDefaultEndDate(startDate);
}

export function PropertyCustomerStep({
  form,
  minimumTermMonths = 12,
}: StepProps & { minimumTermMonths?: number }) {
  const startDate = form.watch("startDate");
  const endDate = form.watch("endDate");
  /* BRD 5.7: the term against the configured minimum, said here rather than only on submit. */
  const termMonths =
    startDate && endDate ? proposalTermMonths(startDate, endDate) : null;
  const termShort = termMonths !== null && termMonths < minimumTermMonths;
  /*
    Which property types this category has (Behrouz, Oct 2026; the full
    BRD 5.2 list since Phase 4): the pair prints as the document's banner,
    so "Residential - OFFICE" must not be one stray click away. Each type is
    priced on a rate model (villa, apartment or office), kept in unitType.
  */
  const propertyCategory = form.watch("propertyCategory");
  const unitType = form.watch("unitType");
  const propertyType = form.watch("propertyType");
  /* BRD 5.2's types for this category ("Other" in both). */
  const propertyTypes = useMemo(
    () =>
      UNIT_TYPES.filter(
        (t) => UNIT_TYPE_CATEGORY[t] === propertyCategory || t === "other",
      ),
    [propertyCategory],
  );
  /* An older proposal has only its model; it reads as that type. */
  const shownType = propertyType ?? unitType;

  /*
    Changing the category can leave the unit type behind. Moved to the
    first type the new category offers rather than cleared, because the
    field is required and an empty required field right after a change
    the user did not make reads as an error they caused.
  */
  useEffect(() => {
    if (!(propertyTypes as readonly string[]).includes(shownType)) {
      const first = propertyTypes[0];
      form.setValue("propertyType", first, { shouldValidate: true });
      form.setValue("unitType", rateModelFor(first, propertyCategory), {
        shouldValidate: true,
      });
    }
  }, [form, shownType, propertyTypes, propertyCategory]);

  /*
    The client and the property are picked from the records (BRD 5.9, as a
    new quotation and a new enquiry pick them), and fill the details that
    print. A property is added or corrected in the address form, in its own
    window, rather than typed here. A proposal saved before this keeps its
    typed details, editable, until a client is picked for it.
  */
  const customerRecordId = form.watch("customerRecordId") ?? null;
  const propertyRecordId = form.watch("propertyRecordId") ?? null;
  const customerName = form.watch("customerName");
  const customerRef = form.watch("customerId");
  const customerPhone = form.watch("customerPhone");
  const customerEmail = form.watch("customerEmail");
  const propertyDetail = form.watch("propertyDetail");
  const propertyAddress = form.watch("propertyAddress");
  const typedClient = !customerRecordId && Boolean(customerName?.trim());
  const typedProperty =
    !propertyRecordId &&
    Boolean(propertyDetail?.trim() || propertyAddress?.trim());
  const addressForm = useAddressFormAccess();
  /* From an enquiry or a site visit: its client and property stay; Edit corrects them, Change is not offered. */
  const recordsLocked = Boolean(form.watch("recordsLocked"));
  const [addingClient, setAddingClient] = useState<{ typed: string; fromFsm: boolean } | null>(null);
  const [editingClient, setEditingClient] = useState(false);
  const [propertyDialog, setPropertyDialog] = useState<"add" | "edit" | null>(
    null,
  );
  const [addressesKey, setAddressesKey] = useState(0);
  const [loadingProperty, setLoadingProperty] = useState(false);

  const set = <K extends keyof AmcFormData>(name: K, value: AmcFormData[K]) =>
    form.setValue(name as never, value as never, {
      shouldValidate: true,
      shouldDirty: true,
    });

  const clearProperty = () => {
    set("propertyRecordId", null);
    set("propertyDetail", "");
    set("propertyAddress", "");
  };
  const fillClient = (c: {
    id: string;
    name: string;
    customerRef: string | null;
    phone: string | null;
    email: string | null;
  }) => {
    set("customerRecordId", c.id);
    set("customerName", c.name);
    set("customerId", c.customerRef ?? "");
    set("customerPhone", c.phone ?? "");
    set("customerEmail", c.email ?? "");
  };
  const pickClient = (c: CustomerRecord) => {
    fillClient(c);
    if (c.id !== customerRecordId) clearProperty();
    if (!c.customerRef) void giveClientId(c.id);
  };
  /* A client on file without a Client ID gets the next one (Zoho FSM is only read, so it cannot number them). */
  const giveClientId = async (id: string) => {
    try {
      const { customer } = await amcContractsService.assignClientId(id);
      if (form.getValues("customerRecordId") === id) fillClient(customer);
    } catch {
      /* The client card then says the ID is missing, and Edit client adds it. */
    }
  };
  /* A proposal already linked to such a client gets one when it opens. */
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (customerRecordId && !customerRef?.trim() && asked.current !== customerRecordId) {
      asked.current = customerRecordId;
      void giveClientId(customerRecordId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per client; giveClientId reads the form when it lands
  }, [customerRecordId, customerRef]);
  const clearClient = () => {
    set("customerRecordId", null);
    set("customerName", "");
    set("customerId", "");
    set("customerPhone", "");
    set("customerEmail", "");
    clearProperty();
  };
  /* After "Edit client": the record as saved fills the details again. */
  const reloadClient = async () => {
    if (!customerRecordId) return;
    try {
      const { customer } = await amcContractsService.customerRecord(customerRecordId);
      fillClient(customer);
    } catch {
      toast.warning(
        "The client was saved; reopen the proposal to see the change here.",
      );
    }
  };
  /* The property's record fills its name, address, category and type (the type sets the rate model). */
  const fillProperty = async (id: string | null) => {
    if (!id) return clearProperty();
    setLoadingProperty(true);
    try {
      const { property: p } = await amcContractsService.propertyCard(id);
      set("propertyRecordId", p.id);
      set("propertyDetail", p.label);
      set("propertyAddress", printedAddress(p));
      const type = (UNIT_TYPES as readonly string[]).includes(p.unitType ?? "")
        ? (p.unitType as (typeof UNIT_TYPES)[number])
        : null;
      const category =
        p.propertyCategory === "commercial" ||
        p.propertyCategory === "residential"
          ? p.propertyCategory
          : type &&
              (UNIT_TYPE_CATEGORY[type] === "commercial" ||
                UNIT_TYPE_CATEGORY[type] === "residential")
            ? UNIT_TYPE_CATEGORY[type]
            : form.getValues("propertyCategory");
      set("propertyCategory", category as AmcFormData["propertyCategory"]);
      if (type) {
        set("propertyType", type);
        set("unitType", rateModelFor(type, category));
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not read the property.",
      );
    } finally {
      setLoadingProperty(false);
    }
  };

  return (
    <div className="space-y-8">
      <StepSection
        icon={UserRound}
        title="Client"
        description="Who the proposal is for. Search the client list (Zoho FSM, as on a new quotation), or add a new client with +."
      >
        {customerRecordId ? (
          <>
            <LinkedCard
              title={customerName || "Client"}
              detail={
                [customerRef, customerEmail, formatPhone(customerPhone)]
                  .filter(Boolean)
                  .join(" · ") || "No contact details on file"
              }
              onEdit={() => setEditingClient(true)}
              editLabel="Edit client"
              onChange={recordsLocked ? undefined : clearClient}
            />
            <MissingDetails
              form={form}
              names={[
                "customerName",
                "customerId",
                "customerPhone",
                "customerEmail",
              ]}
              fix="Edit the client to add it: it prints on the proposal and the contract."
            />
          </>
        ) : (
          <>
            <ClientPicker
              defaultSearch={typedClient ? customerName : undefined}
              onPick={pickClient}
              onAddNew={(typed, fromFsm) => setAddingClient({ typed, fromFsm })}
            />
            {typedClient ? (
              <>
                <TypedNote
                  detail={[
                    customerName,
                    customerRef,
                    customerEmail,
                    formatPhone(customerPhone),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  hint="Written before clients were picked from the list. Pick the client above to link it; their details then replace these."
                />
                <MissingDetails
                  form={form}
                  names={[
                    "customerName",
                    "customerId",
                    "customerPhone",
                    "customerEmail",
                  ]}
                  fix="Pick the client from the list to fill it."
                />
              </>
            ) : null}
          </>
        )}
      </StepSection>

      <StepSection
        icon={Building2}
        title="Property"
        description="The property the contract covers. Pick one of the client's properties, or add a new one."
      >
        {customerRecordId && propertyRecordId ? (
          <>
            <LinkedCard
              title={propertyDetail || "Property"}
              detail={[
                UNIT_TYPE_LABELS[shownType as (typeof UNIT_TYPES)[number]] ??
                  shownType,
                propertyCategory === "commercial"
                  ? "Commercial"
                  : "Residential",
                propertyAddress,
              ]
                .filter(Boolean)
                .join(" · ")}
              note={`Priced on the ${MODEL_LABELS[unitType]} rates, which also decide the services offered.`}
              onEdit={addressForm ? () => setPropertyDialog("edit") : undefined}
              editLabel="Edit property"
              onChange={recordsLocked ? undefined : clearProperty}
              busy={loadingProperty}
            />
            <MissingDetails
              form={form}
              names={["propertyDetail", "propertyAddress"]}
              fix="Edit the property to add it: it prints on the contract."
            />
          </>
        ) : customerRecordId ? (
          <>
            {typedProperty ? (
              <TypedNote
                detail={[propertyDetail, propertyAddress]
                  .filter(Boolean)
                  .join(" · ")}
                hint="Typed before properties were picked from the client's list. Pick the property it is, or add it; its details then replace these."
              />
            ) : null}
            <EnquiryPropertySelect
              customerId={customerRecordId}
              clientName={customerName || "the client"}
              value={null}
              refreshKey={addressesKey}
              onChange={(id) => void fillProperty(id)}
              onAddNew={
                addressForm ? () => setPropertyDialog("add") : undefined
              }
            />
            {loadingProperty ? (
              <p className="text-muted-foreground text-xs">
                Reading the property…
              </p>
            ) : null}
            <MissingDetails
              form={form}
              names={["propertyDetail", "propertyAddress"]}
              fix="Pick the property, or add a new one."
            />
          </>
        ) : typedProperty ? (
          <>
            <TypedNote
              detail={[propertyDetail, propertyAddress]
                .filter(Boolean)
                .join(" · ")}
              hint="Pick the client first, then the property this is; its details then replace these."
            />
            <MissingDetails
              form={form}
              names={["propertyDetail", "propertyAddress"]}
              fix="Pick the client and the property to fill it."
            />
          </>
        ) : (
          <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            Pick the client first; their properties are listed here.
          </div>
        )}
      </StepSection>

      <StepSection
        icon={CalendarRange}
        title="Contract"
        description="The contract period, and the proposal's reference."
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>
                  Contract start date
                  <RequiredMark />
                </FormLabel>
                <FormControl>
                  <DatePickerField
                    value={field.value}
                    placeholder="Select start date"
                    onChange={(nextStartDate) => {
                      field.onChange(nextStartDate);

                      const currentEndDate = form.getValues("endDate");
                      /*
                          The end date follows the start: set when there is
                          none, or when it is before the start or would make
                          the term shorter than the minimum.
                        */
                      const currentTerm =
                        nextStartDate && currentEndDate
                          ? proposalTermMonths(nextStartDate, currentEndDate)
                          : null;
                      if (
                        nextStartDate &&
                        (!currentEndDate ||
                          isEndDateBeforeStartDate(
                            nextStartDate,
                            currentEndDate,
                          ) ||
                          currentTerm === null ||
                          currentTerm < minimumTermMonths)
                      ) {
                        form.setValue(
                          "endDate",
                          endDateFor(nextStartDate, minimumTermMonths),
                          { shouldValidate: true, shouldDirty: true },
                        );
                      } else {
                        void form.trigger("endDate");
                      }
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="endDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>
                  Contract end date
                  <RequiredMark />
                </FormLabel>
                <FormControl>
                  <DatePickerField
                    value={field.value}
                    minDate={startDate}
                    disabled={!startDate}
                    placeholder={
                      startDate ? "Select end date" : "Select start date first"
                    }
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
                {termShort ? (
                  <p className="text-destructive text-xs">
                    The term is at least {minimumTermMonths} months (AMC
                    configuration). These dates run {termMonths} month
                    {termMonths === 1 ? "" : "s"}.
                  </p>
                ) : termMonths !== null ? (
                  <p className="text-muted-foreground text-xs">
                    {termMonths} month{termMonths === 1 ? "" : "s"}, as the fee
                    is priced.
                  </p>
                ) : null}
              </FormItem>
            )}
          />

          {/* The payment plan is chosen with the price, on the next step (DEV-366). */}
          <FormField
            control={form.control}
            name="proposalNumber"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Proposal number</FormLabel>
                <FormControl>
                  {/* Step 1.7 — allocated by the server so two proposals
                        can never share a reference. Read-only, and blank
                        until the first save. */}
                  <Input
                    {...field}
                    readOnly
                    tabIndex={-1}
                    className="bg-muted/50 text-muted-foreground"
                    placeholder="Assigned automatically when saved"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </StepSection>

      <CoordinationContacts form={form} />

      {/*
        New client: the same form as a new enquiry's (Zoho FSM needs the
        email and Maher ID when it keeps the clients), saved straight away
        as a prospect, then picked.
      */}
      <NewClientDialog
        adding={addingClient}
        onClose={() => setAddingClient(null)}
        intro="Saved as a prospect now and picked for this proposal."
        askClientId
        onAdd={async (added) => {
          try {
            const { customer } = await amcContractsService.createCustomer({
              name: added.name.trim(),
              phone: added.phone || null,
              email: added.email.trim() || null,
              company: added.company.trim() || null,
              maherId: added.maherId.trim() || null,
              customerRef: added.customerRef?.trim() || null,
              customerType: added.company.trim() ? "company" : "individual",
              lifecycle: "prospect",
            });
            toast.success("Client added");
            pickClient(customer);
            setAddingClient(null);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not add the client.");
          }
        }}
      />
      {customerRecordId ? (
        <EditClientDialog
          open={editingClient}
          onOpenChange={setEditingClient}
          customerId={customerRecordId}
          onSaved={() => void reloadClient()}
        />
      ) : null}
      {customerRecordId && addressForm ? (
        <AddressDialog
          open={propertyDialog !== null}
          onOpenChange={(open) => !open && setPropertyDialog(null)}
          clientId={customerRecordId}
          clientName={customerName || "the client"}
          propertyId={propertyDialog === "edit" ? propertyRecordId : null}
          editing={propertyDialog === "edit"}
          full={propertyDialog === "add"}
          onSaved={(id) => {
            setPropertyDialog(null);
            setAddressesKey((k) => k + 1);
            void fillProperty(id);
          }}
        />
      ) : null}
    </div>
  );
}

/** A step section: an icon title, one muted line, then its content. */
function StepSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Icon className="text-brand size-4" />
          {title}
        </h3>
        <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** Details typed on an older proposal, read-only until a client or property is picked to replace them. */
function TypedNote({ detail, hint }: { detail: string; hint: string }) {
  return (
    <div className="rounded-[12px] border border-dashed px-3 py-2.5">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Typed on this proposal
      </p>
      <p className="mt-0.5 text-sm">{detail || "Nothing typed"}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>
    </div>
  );
}

/** What the picked record lacks for the proposal, in the words the fields would have used. */
function MissingDetails({
  form,
  names,
  fix,
}: StepProps & { names: Array<keyof AmcFormData>; fix: string }) {
  const errors = form.formState.errors as Record<
    string,
    { message?: string } | undefined
  >;
  const messages = names
    .map((n) => errors[n as string]?.message)
    .filter(Boolean) as string[];
  if (messages.length === 0) return null;
  return (
    <p className="text-destructive text-xs">
      {messages.join(". ")}. {fix}
    </p>
  );
}

/**
 * Who the team coordinates with day to day (AMC-099).
 *
 * The first contact is required; more can be added, up to six, for the
 * clients who give a facility manager, a site supervisor and an owner's
 * representative. Each designation is one of the usual three or whatever
 * the client calls the person, typed in.
 */
function CoordinationContacts({ form }: StepProps) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "coordinationContacts",
  });

  return (
    <section className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Users className="text-brand size-4" />
          Coordination contacts
        </h3>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Who the team coordinates with day to day. One is enough; add more only
          if the client has them.
        </p>
      </div>
      <div className="space-y-6">
        {fields.map((item, index) => (
          <div key={item.id} className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-muted-foreground text-sm font-medium">
                Contact person {index + 1}
                {index > 0 ? (
                  <span className="font-normal"> (optional)</span>
                ) : null}
              </h4>
              {index > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive h-7 px-2"
                  onClick={() => remove(index)}
                  aria-label={`Remove contact person ${index + 1}`}
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </Button>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name={`coordinationContacts.${index}.name`}
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>
                      Name
                      {index === 0 ? <RequiredMark /> : null}
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Contact person name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`coordinationContacts.${index}.phone`}
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>
                      Phone
                      {index === 0 ? <RequiredMark /> : null}
                    </FormLabel>
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
              <FormField
                control={form.control}
                name={`coordinationContacts.${index}.designation`}
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Designation</FormLabel>
                    <DesignationInput
                      id={field.name}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        ))}
        {fields.length < MAX_COORDINATION_CONTACTS ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              append({ name: "", phone: "", designation: "owner" })
            }
          >
            <Plus className="size-4" />
            Add another contact
          </Button>
        ) : null}
      </div>
    </section>
  );
}

const OTHER = "__other";

/**
 * Owner, tenant, representative, or the client's own title for the person
 * ("Operation Manager"), typed in when Other is chosen.
 */
function DesignationInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const preset = DESIGNATION_PRESETS.some((option) => option.value === value);
  const [typing, setTyping] = useState(!preset && value.trim() !== "");
  const selected = preset && !typing ? value : typing ? OTHER : "";

  return (
    <div className="space-y-2">
      <Select
        value={selected}
        onValueChange={(next) => {
          if (next === OTHER) {
            setTyping(true);
            onChange("");
            return;
          }
          setTyping(false);
          onChange(next);
        }}
      >
        <FormControl className="w-full">
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Select designation" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          {DESIGNATION_PRESETS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          <SelectItem value={OTHER}>Other (type it)</SelectItem>
        </SelectContent>
      </Select>
      {typing ? (
        <Input
          autoFocus
          value={value}
          maxLength={60}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. Operation Manager"
          aria-label="Designation"
        />
      ) : null}
    </div>
  );
}
