"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  Info,
  Loader2,
  MessageSquareText,
  Phone,
  Save,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { PageHeading } from "@/components/dashboard/shared/kaizen";
import {
  ErrorState,
  SubmitButton,
} from "@/components/dashboard/shared/kaizen-states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import DateTimeSelect from "@/components/ui/date-time-select";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  CHANNEL_LABELS,
  PREFERRED_CHANNELS,
  UNIT_TYPES,
  UNIT_TYPE_CATEGORY,
  UNIT_TYPE_LABELS,
} from "@/lib/amc/client-profile";
import { cn } from "@/lib/utils";
import {
  amcContractsService,
  type ClientAddress,
  type PropertyRecord,
} from "@/modules/amc-contracts/amc-contracts-service";
import {
  enquiriesService,
  type CreateEnquiryInput,
  type EnquiryMeta,
} from "@/modules/amc-contracts/enquiries-service";

import { ClientPicker } from "../client-picker";
import { useAmcData } from "../use-amc-data";
import {
  ChosenClientCard,
  NewClientDialog,
  contactOf,
  type ChosenClient,
} from "./enquiry-client";
import {
  Field,
  PersonSelect,
  SimpleSelect,
  fromLocalInput,
  localInputIn,
  toLocalInput,
} from "./enquiry-ui";

const ENQUIRIES = "/extensions/amc-contracts/enquiries";

type UnitType = (typeof UNIT_TYPES)[number];
type Category = "residential" | "commercial";

/** What the page collects besides the client (the client is the contact). */
type Draft = {
  source: string;
  referrer: string;
  enquiredAt: string;
  need: string;
  contactWhatsapp: string;
  preferredChannel: CreateEnquiryInput["preferredChannel"];
  preferredLanguage: string;
  propertyId: string | null;
  /* A property not on file: saved as the client's property with the enquiry when named. */
  propertyLabel: string;
  propertyBuilding: string;
  unitType: UnitType | null;
  propertyCategory: Category | null;
  area: string;
  ownerId: string | null;
  nextFollowUpAt: string;
};

function blankDraft(meta: EnquiryMeta): Draft {
  return {
    source: meta.sources[0] ?? "",
    referrer: "",
    enquiredAt: toLocalInput(new Date().toISOString()),
    need: "",
    contactWhatsapp: "",
    preferredChannel: null,
    preferredLanguage: "",
    propertyId: null,
    propertyLabel: "",
    propertyBuilding: "",
    unitType: null,
    propertyCategory: null,
    area: "",
    ownerId: meta.me,
    nextFollowUpAt: localInputIn(1, 10),
  };
}

const asUnitType = (v: string | null | undefined): UnitType | null =>
  v && (UNIT_TYPES as readonly string[]).includes(v) ? (v as UnitType) : null;
const asCategory = (v: string | null | undefined): Category | null =>
  v === "residential" || v === "commercial" ? v : null;

/** One titled part of the form, as on New quotation: who, where, what, how to reach them, who follows up. */
function FormSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Icon className="text-brand size-4" aria-hidden />
          {title}
        </h3>
        {description ? (
          <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

/**
 * New enquiry (BRD 5.1), a page of its own like New quotation: someone is
 * interested in AMC, and instead of a WhatsApp chat or a spreadsheet row
 * the portal records who they are, which property, what they need, how to
 * reach them, who owns it and when to call again. The client comes from
 * Zoho FSM (or is added with +) and is the enquiry's contact. A property
 * already on file can be chosen; the full property record, assets and
 * scope are captured later, at the site visit (BRD 5.2).
 */
export function NewEnquiryPage({
  initialClientId = null,
}: {
  initialClientId?: string | null;
}) {
  useBreadcrumbLabel("new", "New enquiry");
  const meta = useAmcData(() => enquiriesService.meta(), "enquiry-meta");

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Sales"
        title="New enquiry"
        description="Someone is interested in AMC. Record who they are, the property, what they need and when to follow up, so the lead never sits in a chat or a spreadsheet."
        actions={
          <Button variant="outline" asChild>
            <Link href={ENQUIRIES}>
              <ArrowLeft className="size-4" />
              Back to enquiries
            </Link>
          </Button>
        }
      />
      {meta.error ? (
        <ErrorState
          title="Could not open the form"
          message={meta.error}
          onRetry={meta.reload}
        />
      ) : !meta.data ? (
        <FormSkeleton />
      ) : !meta.data.canCreate ? (
        <Card className="text-muted-foreground p-6 text-sm">
          You can see enquiries but not log one. Ask an administrator for AMC
          Enquiries (Create).
        </Card>
      ) : (
        <EnquiryForm meta={meta.data} initialClientId={initialClientId} />
      )}
    </div>
  );
}

function FormSkeleton() {
  return (
    <Card className="gap-0 p-0" aria-label="Loading the form">
      <div className="space-y-8 p-4 sm:p-6">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-2/3" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

type AddressLookup = {
  clientId: string | null;
  state: "loading" | "ready" | "error";
  rows: ClientAddress[];
  fsmError: string | null;
};

function EnquiryForm({
  meta,
  initialClientId,
}: {
  meta: EnquiryMeta;
  initialClientId: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => blankDraft(meta));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const [client, setClient] = useState<ChosenClient | null>(null);
  const [addingClient, setAddingClient] = useState<{
    typed: string;
    fromFsm: boolean;
  } | null>(null);
  const [loadingClient, setLoadingClient] = useState(Boolean(initialClientId));
  const [lookup, setLookup] = useState<AddressLookup>({
    clientId: null,
    state: "loading",
    rows: [],
    fsmError: null,
  });
  const [linkingAddress, setLinkingAddress] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  /* Opened from a client's page: that client is already chosen. */
  useEffect(() => {
    if (!initialClientId) return;
    let stale = false;
    amcContractsService
      .customer(initialClientId)
      .then(
        ({ overview }) =>
          !stale &&
          setClient({ kind: "existing", customer: overview.customer }),
        () =>
          !stale &&
          toast.error("That client could not be loaded. Pick them below."),
      )
      .finally(() => !stale && setLoadingClient(false));
    return () => {
      stale = true;
    };
  }, [initialClientId]);

  const clientId = client?.kind === "existing" ? client.customer.id : null;

  /* The property fields follow the address chosen; they stay the enquiry's own, so they can still be corrected. */
  const applyAddress = useCallback(
    (
      property: Pick<
        PropertyRecord,
        "id" | "unitType" | "propertyCategory" | "community"
      > | null,
    ) => {
      setDraft((d) =>
        property
          ? {
              ...d,
              propertyId: property.id,
              unitType: asUnitType(property.unitType) ?? d.unitType,
              propertyCategory:
                asCategory(property.propertyCategory) ??
                (asUnitType(property.unitType)
                  ? (UNIT_TYPE_CATEGORY[
                      asUnitType(property.unitType)!
                    ] as Category)
                  : d.propertyCategory),
              area: property.community ?? d.area,
            }
          : { ...d, propertyId: null },
      );
    },
    [],
  );

  /* The client's addresses, as on New quotation: the portal's first, then Zoho FSM's not used yet. */
  const loadAddresses = useCallback(
    (id: string) => {
      let active = true;
      amcContractsService.clientAddresses(id).then(
        ({ addresses, fsmError }) => {
          if (!active) return;
          setLookup({
            clientId: id,
            state: "ready",
            rows: addresses,
            fsmError,
          });
          // Their newest address on file is filled in, as on a quotation; an FSM-only one waits to be picked.
          const first = addresses.find((a) => a.source === "portal");
          if (first) applyAddress(first);
        },
        () =>
          active &&
          setLookup({ clientId: id, state: "error", rows: [], fsmError: null }),
      );
      return () => {
        active = false;
      };
    },
    [applyAddress],
  );

  useEffect(() => {
    if (!clientId) return;
    return loadAddresses(clientId);
  }, [clientId, loadAddresses]);

  const fresh = Boolean(clientId) && lookup.clientId === clientId;
  const addressState = !clientId ? "idle" : fresh ? lookup.state : "loading";
  const addresses = fresh ? lookup.rows : [];

  async function pickAddress(value: string) {
    if (value === "new") return applyAddress(null);
    const row = addresses.find((a) => a.id === value);
    if (!row || !clientId) return;
    if (row.source === "portal") return applyAddress(row);
    setLinkingAddress(true);
    try {
      const { property } = await amcContractsService.openFsmAddress(
        clientId,
        row.fsmAddressId ?? row.id.replace(/^fsm:/, ""),
      );
      setLookup((l) =>
        l.clientId === clientId
          ? {
              ...l,
              rows: l.rows.map((r) =>
                r.id === row.id
                  ? { ...r, id: property.id, source: "portal" }
                  : r,
              ),
            }
          : l,
      );
      applyAddress(property);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not use that address",
      );
    } finally {
      setLinkingAddress(false);
    }
  }

  function changeClient(next: ChosenClient | null) {
    setClient(next);
    set({ propertyId: null });
  }

  const contact = client ? contactOf(client) : null;
  const referral = /referr/i.test(draft.source);
  const reachable = !!(
    contact?.phone ||
    contact?.email ||
    draft.contactWhatsapp.trim()
  );
  const needsSiteVisit =
    !!draft.propertyCategory &&
    meta.siteVisitRequiredCategories.includes(draft.propertyCategory);

  const blockers = [
    !client ? "Choose the client, or add a new one with +." : null,
    client && !reachable
      ? `${contact?.name ?? "The client"} has no phone or email on file: give a WhatsApp number.`
      : null,
    !draft.source ? "Choose where the enquiry came from." : null,
    referral && !draft.referrer.trim() ? "Say who referred them." : null,
    draft.need.trim().length < 3 ? "Say in short what they need." : null,
  ].filter((b): b is string => Boolean(b));

  async function save() {
    setAttempted(true);
    if (blockers.length > 0 || !client || !contact) return;
    setSaving(true);
    try {
      const t = (v: string) => (v.trim() ? v.trim() : null);
      const input: CreateEnquiryInput = {
        source: draft.source,
        referrer: referral ? t(draft.referrer) : null,
        enquiredAt: fromLocalInput(draft.enquiredAt) ?? undefined,
        // The client is the contact: their name, phone and email are not asked for twice.
        contactName: contact.name,
        contactPhone: contact.phone,
        contactEmail: contact.email,
        contactWhatsapp: t(draft.contactWhatsapp),
        preferredChannel: draft.preferredChannel ?? null,
        preferredLanguage: t(draft.preferredLanguage),
        area: t(draft.area),
        propertyCategory: draft.propertyCategory,
        unitType: draft.unitType,
        need: draft.need.trim(),
        ownerId: draft.ownerId,
        propertyId: client.kind === "existing" ? draft.propertyId : null,
        newProperty:
          (client.kind === "new" || !draft.propertyId) &&
          draft.propertyLabel.trim()
            ? {
                label: draft.propertyLabel.trim(),
                building: t(draft.propertyBuilding),
              }
            : null,
        nextFollowUpAt: fromLocalInput(draft.nextFollowUpAt),
        customerId: client.kind === "existing" ? client.customer.id : null,
        newCustomer:
          client.kind === "new"
            ? {
                name: client.name,
                customerType: client.company ? "company" : "individual",
                company: client.company || null,
                phone: client.phone || null,
                email: client.email || null,
                maherId: client.maherId || null,
              }
            : null,
      };
      const { enquiry } = await enquiriesService.create(input);
      toast.success(`Enquiry ${enquiry.enquiryNumber} logged`);
      router.push(`${ENQUIRIES}/${enquiry.id}`);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not log the enquiry.",
      );
      setSaving(false);
    }
  }

  return (
    <Card className="gap-0 p-0">
      <div className="space-y-8 p-4 sm:p-6">
        <FormSection
          icon={UserRound}
          title="Client"
          description="Who is enquiring. Pick them from Zoho FSM, or add them with +. They are the enquiry's contact."
        >
          <Field
            label="Client"
            hint={
              client
                ? undefined
                : "Search by last name, email or phone. A new client is saved as a prospect when the enquiry is logged."
            }
          >
            {loadingClient ? (
              <Skeleton className="h-[3.75rem] rounded-[12px]" />
            ) : client ? (
              <ChosenClientCard
                client={client}
                onChange={() => changeClient(null)}
              />
            ) : (
              <ClientPicker
                onPick={(c) => changeClient({ kind: "existing", customer: c })}
                onAddNew={(typed, fromFsm) =>
                  setAddingClient({ typed, fromFsm })
                }
              />
            )}
          </Field>
          <NewClientDialog
            adding={addingClient}
            onClose={() => setAddingClient(null)}
            onAdd={(added) => {
              changeClient(added);
              setAddingClient(null);
            }}
          />
        </FormSection>

        <FormSection
          icon={Building2}
          title="Property"
          description="What they want maintained. Pick an address on file, or add a new one. Its assets and scope are captured at the site visit."
        >
          {addressState === "loading" ? (
            <Field
              label="Address on file"
              hint="Checking what this client already has…"
            >
              <div className="border-input text-muted-foreground flex h-8 w-full items-center gap-2 rounded-[12px] border px-3 text-sm">
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                Loading addresses on file…
              </div>
            </Field>
          ) : addressState === "error" ? (
            <Field label="Address on file">
              <div className="border-input flex flex-wrap items-center justify-between gap-2 rounded-[12px] border px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  Could not load this client&apos;s addresses.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => clientId && loadAddresses(clientId)}
                >
                  Try again
                </Button>
              </div>
            </Field>
          ) : addressState === "ready" && addresses.length > 0 ? (
            <Field
              label="Address on file"
              hint={
                draft.propertyId
                  ? "The type, category and area below come from this address."
                  : `This client has ${addresses.length === 1 ? "one address" : `${addresses.length} addresses`} on file. Pick the one this is for, or leave it as a new property.`
              }
            >
              <Select
                value={draft.propertyId ?? "new"}
                disabled={linkingAddress}
                onValueChange={(v) => void pickAddress(v)}
              >
                <SelectTrigger className="w-full" aria-label="Address on file">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">
                    New property, not on file yet
                  </SelectItem>
                  {addresses.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="truncate">
                        {a.label}
                        {a.source === "fsm" ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · Zoho FSM
                          </span>
                        ) : null}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : addressState === "ready" ? (
            <p className="text-muted-foreground text-xs">
              No address on file for this client yet. Add the property below.
            </p>
          ) : null}
          {lookup.fsmError && fresh ? (
            <p className="text-warning text-xs">
              Zoho FSM could not be read, so this client&apos;s addresses there
              are not listed.
            </p>
          ) : null}

          {/* A new property (no address picked): named here, it is saved as the client's property with the enquiry. */}
          {client && (client.kind === "new" || !draft.propertyId) ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Unit or villa"
                htmlFor="ne-prop-label"
                hint="Saved as the client's property, ready to pick when the site visit is booked. Leave it empty if they have not said yet."
              >
                <Input
                  id="ne-prop-label"
                  placeholder="e.g. Villa 32"
                  value={draft.propertyLabel}
                  onChange={(e) => set({ propertyLabel: e.target.value })}
                  maxLength={200}
                />
              </Field>
              <Field
                label="Building or street (optional)"
                htmlFor="ne-prop-building"
              >
                <Input
                  id="ne-prop-building"
                  placeholder="e.g. Palmera 2, or Street 5"
                  value={draft.propertyBuilding}
                  onChange={(e) => set({ propertyBuilding: e.target.value })}
                  maxLength={200}
                />
              </Field>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Property type">
              <SimpleSelect
                label="Property type"
                allowNone
                value={draft.unitType}
                options={UNIT_TYPES.map((u) => [u, UNIT_TYPE_LABELS[u]])}
                onChange={(v) => {
                  const unit = asUnitType(v);
                  set({
                    unitType: unit,
                    propertyCategory: unit
                      ? ((UNIT_TYPE_CATEGORY[unit] as Category) ??
                        draft.propertyCategory)
                      : draft.propertyCategory,
                  });
                }}
              />
            </Field>
            <Field label="Category">
              <SimpleSelect
                label="Category"
                allowNone
                value={draft.propertyCategory}
                options={[
                  ["residential", "Residential"],
                  ["commercial", "Commercial"],
                ]}
                onChange={(v) => set({ propertyCategory: asCategory(v) })}
              />
            </Field>
            <Field label="Area" htmlFor="ne-area">
              <Input
                id="ne-area"
                placeholder="Community or district, e.g. Arabian Ranches"
                value={draft.area}
                onChange={(e) => set({ area: e.target.value })}
                maxLength={120}
              />
            </Field>
          </div>
          {needsSiteVisit ? (
            <p className="text-muted-foreground flex items-start gap-2 text-xs">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {draft.propertyCategory === "commercial"
                ? "Commercial"
                : "This"}{" "}
              prospects need a site visit before pricing: book it from the
              enquiry once it is logged.
              {meta.siteVisitRule === "block"
                ? " A proposal cannot be made without one."
                : " A proposal without one is flagged."}
            </p>
          ) : null}
        </FormSection>

        <FormSection
          icon={MessageSquareText}
          title="The enquiry"
          description="Where they came from and what they need, in their words."
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Source">
              <SimpleSelect
                label="Source"
                value={draft.source}
                options={meta.sources.map((s) => [s, s])}
                onChange={(v) => set({ source: v ?? "" })}
              />
            </Field>
            {referral ? (
              <Field label="Referred by" htmlFor="ne-ref">
                <Input
                  id="ne-ref"
                  value={draft.referrer}
                  onChange={(e) => set({ referrer: e.target.value })}
                  maxLength={200}
                />
              </Field>
            ) : null}
            <Field label="Enquired on" htmlFor="ne-when">
              <DateTimeSelect
                id="ne-when"
                value={draft.enquiredAt}
                max={toLocalInput(new Date().toISOString())}
                onChange={(v) => set({ enquiredAt: v })}
              />
            </Field>
          </div>
          <Field
            label="What they need"
            htmlFor="ne-need"
            hint="In short: services, units, timing, anything agreed."
          >
            <Textarea
              id="ne-need"
              rows={3}
              value={draft.need}
              onChange={(e) => set({ need: e.target.value })}
              maxLength={2000}
              placeholder="e.g. Villa in Arabian Ranches, yearly AC and plumbing maintenance for 6 AC units"
            />
          </Field>
        </FormSection>

        <FormSection
          icon={Phone}
          title="How to reach them"
          description="The client's phone and email are used. Add a WhatsApp number only if it is not the phone."
        >
          <p
            className={cn(
              "text-sm",
              contact && !reachable ? "text-warning" : "text-muted-foreground",
            )}
          >
            {!contact
              ? "Choose the client first."
              : reachable && (contact.phone || contact.email)
                ? `${contact.name}: ${[contact.phone, contact.email].filter(Boolean).join(" · ")}`
                : reachable
                  ? `${contact.name}, on WhatsApp.`
                  : `${contact.name} has no phone or email on file. Give a WhatsApp number.`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="WhatsApp (if not the phone)" htmlFor="ne-wa">
              <Input
                id="ne-wa"
                inputMode="tel"
                value={draft.contactWhatsapp}
                onChange={(e) => set({ contactWhatsapp: e.target.value })}
                maxLength={40}
              />
            </Field>
            <Field label="Preferred channel">
              <SimpleSelect
                label="Preferred channel"
                allowNone
                value={draft.preferredChannel}
                options={PREFERRED_CHANNELS.map((c) => [
                  c,
                  CHANNEL_LABELS[c] ?? c,
                ])}
                onChange={(v) =>
                  set({ preferredChannel: v as Draft["preferredChannel"] })
                }
              />
            </Field>
            <Field label="Preferred language" htmlFor="ne-lang">
              <Input
                id="ne-lang"
                placeholder="English, Arabic…"
                value={draft.preferredLanguage}
                onChange={(e) => set({ preferredLanguage: e.target.value })}
                maxLength={40}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection
          icon={CalendarClock}
          title="Owner and follow-up"
          description={`Who is responsible and when to contact them again. With no contact for ${meta.idleDays} days the owner is warned, then management.`}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner">
              <PersonSelect
                label="Owner"
                people={meta.people}
                value={draft.ownerId}
                onChange={(id) => set({ ownerId: id })}
                allowNone
              />
            </Field>
            <Field label="Next follow-up" htmlFor="ne-next">
              <DateTimeSelect
                id="ne-next"
                value={draft.nextFollowUpAt}
                onChange={(v) => set({ nextFollowUpAt: v })}
              />
            </Field>
          </div>
        </FormSection>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          {attempted
            ? blockers.map((reason) => (
                <p key={reason} className="text-destructive text-xs">
                  {reason}
                </p>
              ))
            : null}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <Button variant="outline" asChild disabled={saving}>
            <Link href={ENQUIRIES}>Cancel</Link>
          </Button>
          <SubmitButton
            onClick={() => void save()}
            pending={saving}
            pendingLabel="Logging…"
            icon={<Save className="size-4" />}
          >
            Log enquiry
          </SubmitButton>
        </div>
      </div>
    </Card>
  );
}
