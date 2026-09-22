"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarIcon,
  ChevronDown,
  Crosshair,
  Eraser,
  FileText,
  ImageIcon,
  LayoutGrid,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Search,
  Shapes,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { addDays, format, parseISO } from "date-fns";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/use-debounce";

import { compressImage, readImageSize } from "@/lib/media/compress-image";
import {
  zoneLabelPoint,
  type ZonePoint,
} from "@/lib/snagging/zone-geometry";
import { nowLocal, toLocalInstant } from "@/lib/snagging/schedule-defaults";
import { PlanZoneCanvas } from "./plan-zone-canvas";
import { LocationPicker } from "./location-picker";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import TimeSelect, { formatTimeAmPm } from "@/components/ui/time-select";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { pickRateForSize } from "@/lib/server/snagging/pricing";
import {
  snaggingService,
  type SnaggingClientOption,
  type SnaggingPricingConfig,
} from "@/modules/snagging";
import { usersService } from "@/modules/users/services/users-service";
import { templateFor } from "@/lib/snagging/area-templates";
import type { SnaggingProperty, SnaggingPropertyType, User } from "@/types/types";

import {
  ErrorState,
  PROPERTY_TYPE_LABELS,
  PageHeading,
  SubmitButton,
} from "./shared";

/**
 * The new-job wizard.
 *
 * Three steps, because the reference pack an inspector pulls has three
 * parts: the property it is for, the plan and the rooms they walk on it,
 * and who is assigned. Each step validates before it lets you move on, so
 * a job cannot reach the field half-built.
 */

type AreaChoice = {
  name: string;
  code: string | null;
  /** The PendingPlan this room is pinned to, before either has a real id. */
  planId?: string | null;
  /** 0..1 fractions of the plan image, so a pin survives any render size. */
  pinX?: number;
  pinY?: number;
  /**
   * The room's outline on that plan (BA change 6).
   *
   * Sits alongside the pin rather than replacing it: a zone is worth
   * drawing for the rooms that matter and a pin is faster for the rest, so
   * a job routinely carries both. The handset prefers the outline when it
   * has one and falls back to the pin when it does not.
   */
  zone?: ZonePoint[] | null;
};
type PendingPlan = { id: string; file: File; label: string; width?: number; height?: number; url: string };

type Draft = {
  client_id: string;
  /** Set when an existing property record is reused (BR-1); "" = create new. */
  property_id: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  unit_label: string;
  building_name: string;
  community: string;
  developer_name: string;
  property_type: SnaggingPropertyType;
  bedrooms: number; // 0 = studio; ignored for commercial
  built_up_area: string; // sqft
  plot_area: string; // villa / townhouse
  external_areas_in_scope: boolean;
  floors: string; // villa
  location_lat: string;
  location_lng: string;
  title_deed_path: string;
  noc_required: boolean;
  noc_path: string;
  /*
    What the client declared, and what the coordinator charged.

    Both belong to the QUOTATION rather than to the unit (FR-2.15,
    FR-2.04): the same property can be let furnished to one client and
    empty to the next, and the rate is a person's decision that the
    document has to record.
  */
  furnished: boolean;
  /* Booked outside working hours: the surcharge is added (FR-2.08). */
  out_of_hours: boolean;
  rate_per_sqft: string;
  external_rate_per_sqft: string;
  appointment_date: string; // YYYY-MM-DD
  appointment_time: string; // HH:MM
  developer_contact_name: string;
  developer_contact_phone: string;
  client_contact_name: string;
  client_contact_phone: string;
  notes: string;
  areas: AreaChoice[];
  technician_ids: string[];
  approval_manager_id: string;
};

/**
 * The full ladder to a job.
 *
 * A quotation walks only the first rung: it needs the client and the
 * property and nothing else (BA v2, change 2). Running the same component
 * for both is what stops a quotation and a job ever disagreeing about what
 * a property is — one form, one set of rules, one validation.
 */
/*
  Appointments are typed on the coordinator's own clock (see
  lib/snagging/schedule-defaults), so "is this in the past" is asked on it
  too, and submit turns the pair into an instant.
*/


/*
  The first slot worth offering: tomorrow at the start of the working day.

  Today is not offered by default because an inspection needs the door
  opened by somebody who has been told about it, and 09:00 is where YFI's
  standard hours start — the same window the quotation's terms quote.
*/
function defaultAppointment() {
  return {
    date: format(addDays(parseISO(nowLocal().date), 1), "yyyy-MM-dd"),
    time: "09:00",
  };
}

const ALL_STEPS = [
  { key: "property", label: "Property", icon: MapPin },
  { key: "plan_areas", label: "Plan & areas", icon: LayoutGrid },
  { key: "assign", label: "Assign", icon: Users },
] as const;

type PropertyErrorKey = "client" | "unit_label" | "built_up_area";

/**
 * The property-step rules, expressed as the sentence the coordinator
 * needs rather than a bare boolean.
 *
 * The step gate and the inline messages both read this one function, so
 * the Continue button can never grey out for a reason no field explains.
 */
function propertyErrors(draft: Draft): Partial<Record<PropertyErrorKey, string>> {
  const errors: Partial<Record<PropertyErrorKey, string>> = {};

  // Client name + phone (D1), a unit, and built up area (E3) are the
  // minimum a job and its quotation depend on.
  if (draft.client_name.trim().length < 2) {
    errors.client = "Choose a client on file, or add a new one with the + button.";
  } else if (draft.client_phone.trim().length < 5) {
    errors.client =
      "This client has no usable phone number. Change the client, or add one with the + button.";
  }

  if (draft.unit_label.trim().length === 0) {
    errors.unit_label = "The inspector finds the property by this reference, so it is required.";
  }

  if (!(Number(draft.built_up_area) > 0)) {
    errors.built_up_area = draft.built_up_area.trim()
      ? "Enter the area as a number greater than 0."
      : "The quotation is priced from this, so it is required.";
  }

  return errors;
}

const AREAS_ERROR =
  "Tick at least one area. A job with no rooms gives the inspector nothing to walk.";

export default function NewJobWizard({
  mode = "job",
  editQuotationId,
}: {
  /** "quote" stops after the property step and writes a quotation. */
  mode?: "job" | "quote";
  /**
   * The draft quotation this form is reopened on.
   *
   * Set, the wizard fills itself from that quotation and saves back to it
   * instead of writing a new one. Deliberately the same form rather than
   * a second, smaller "edit quotation" dialog: the two would ask for the
   * same property in two shapes and drift apart on the first field either
   * of them gained.
   */
  editQuotationId?: string;
} = {}) {
  const quoteOnly = mode === "quote";
  const isEdit = Boolean(editQuotationId);

  /*
    The rate card, so the form can show the band and suggest a rate.

    Fetched only in quote mode: the job wizard prices nothing, and asking
    for pricing it will not use is a round trip on every job creation.
  */
  const [pricing, setPricing] = useState<SnaggingPricingConfig | null>(null);
  useEffect(() => {
    if (!quoteOnly) return;
    let live = true;
    snaggingService
      .getPricing()
      .then((cfg) => live && setPricing(cfg))
      // Non-fatal: without the card the form falls back to letting the
      // server price it, which is exactly what it did before.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [quoteOnly]);
  const STEPS = useMemo(
    () => (quoteOnly ? ALL_STEPS.slice(0, 1) : ALL_STEPS),
    [quoteOnly],
  );
  const router = useRouter();
  /*
    The approved quotation this job is being raised from (BA v2, change 3).

    Present when the coordinator pressed "Create job" on a quotation, which
    is the ordinary route now: the client and the property are already
    agreed, so the wizard opens past the step that asks for them and the
    job is bound back to the quotation on submit.
  */
  const searchParams = useSearchParams();
  const quotationId = searchParams.get("quotation");
  const [quotationLoading, setQuotationLoading] = useState(
    Boolean(quotationId ?? editQuotationId),
  );
  const [quotationError, setQuotationError] = useState<string | null>(null);
  const [quotationLabel, setQuotationLabel] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PendingPlan[]>([]);
  const [titleDeedFile, setTitleDeedFile] = useState<File | null>(null);
  const [nocFile, setNocFile] = useState<File | null>(null);

  const [draft, setDraft] = useState<Draft>({
    client_id: "",
    property_id: "",
    client_name: "",
    client_email: "",
    client_phone: "",
    unit_label: "",
    building_name: "",
    community: "",
    developer_name: "",
    property_type: "apartment",
    bedrooms: 2,
    built_up_area: "",
    plot_area: "",
    external_areas_in_scope: false,
    floors: "",
    location_lat: "",
    location_lng: "",
    title_deed_path: "",
    noc_required: false,
    noc_path: "",
    furnished: false,
    out_of_hours: false,
    rate_per_sqft: "",
    external_rate_per_sqft: "",
    appointment_date: defaultAppointment().date,
    appointment_time: defaultAppointment().time,
    developer_contact_name: "",
    developer_contact_phone: "",
    client_contact_name: "",
    client_contact_phone: "",
    notes: "",
    /*
      No area starts ticked (point 5). Ticking every room the template
      suggests handed the inspector rooms that do not exist in the unit;
      the coordinator now ticks the ones to include.
    */
    areas: [],
    technician_ids: [],
    approval_manager_id: "",
  });

  // Tracks whether the inspector list was hand-edited, so re-picking a
  // property type does not wipe a custom room set the user built.
  const areasTouched = useRef(false);

  /*
    Opened from an approved quotation: fill in what the client already
    agreed and start at the floor plans (BA v2, change 3).

    The property step is skipped rather than pre-filled-and-shown, because
    re-presenting agreed figures invites someone to change the built-up
    area the quotation was priced from — and the document is already with
    the client. The property is read back from its record rather than the
    quotation's snapshot: the snapshot is what was quoted, the record is
    what the job must be built against, and where those differ the record
    is the one the inspector will walk.
  */
  useEffect(() => {
    if (!quotationId) return;
    let cancelled = false;

    void (async () => {
      setQuotationLoading(true);
      setQuotationError(null);
      try {
        const quote = await snaggingService.getQuotationById(quotationId);
        if (cancelled) return;

        if (quote.status !== "approved") {
          setQuotationError(
            "That quotation has not been approved yet, so there is nothing to raise a job against.",
          );
          return;
        }

        /*
          From the property RECORD, with the document's snapshot only as a
          fallback.

          The snapshot is a five-field copy frozen at pricing time
          (FR-2.03); it has never held the map pin, the plot area, the
          floors or the NOC. Filling the form from it alone left those
          fields empty, and submitting the job then wrote the emptiness
          back over the record — so a location pinned while quoting
          disappeared the moment the job was raised from that quotation.
        */
        const prop = (quote.property ?? {}) as Record<string, unknown>;
        const snap = (quote.property_snapshot ?? {}) as Record<string, unknown>;
        const text = (value: unknown) => (value == null ? "" : String(value));
        const either = (key: string) => text(prop[key] ?? snap[key] ?? null);

        const type =
          ((prop.property_type ?? snap.property_type) as SnaggingPropertyType) ??
          "apartment";
        const beds =
          typeof prop.bedrooms === "number"
            ? prop.bedrooms
            : typeof snap.bedrooms === "number"
              ? snap.bedrooms
              : 2;

        setDraft((current) => ({
          ...current,
          client_id: text(quote.client_id),
          property_id: text(quote.property_id),
          client_name: text(quote.client?.name ?? snap.client_name),
          client_email: text(quote.client?.email ?? snap.client_email),
          client_phone: text(quote.client?.phone ?? snap.client_phone),
          unit_label: either("unit_label"),
          building_name: either("building_name"),
          community: either("community"),
          developer_name: either("developer_name"),
          property_type: type,
          bedrooms: beds,
          built_up_area: either("built_up_area_sqft"),
          plot_area: text(prop.plot_area_sqft),
          external_areas_in_scope: Boolean(prop.external_areas_in_scope),
          floors: text(prop.floors),
          location_lat: text(prop.location_lat),
          location_lng: text(prop.location_lng),
          title_deed_path: text(prop.title_deed_path),
          noc_required: Boolean(prop.noc_required),
          noc_path: text(prop.noc_path),
          areas: areasTouched.current ? current.areas : [],
        }));
        setQuotationLabel(quote.quote_number);
        // Past the property step; the team adds plans, areas and contacts.
        setStep(1);
      } catch (error) {
        if (!cancelled) {
          setQuotationError(
            error instanceof Error ? error.message : "Could not load that quotation",
          );
        }
      } finally {
        if (!cancelled) setQuotationLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [quotationId]);


  /*
    Edit mode: fill the form from the quotation itself.

    From the LIVE property record rather than the document's snapshot.
    The snapshot is a frozen five-field copy taken at pricing time
    (FR-2.03) and is what the PDF renders; filling the form from it would
    drop the plot area, the pin and the rest, and saving would then write
    those absences back over the record.
  */
  useEffect(() => {
    if (!editQuotationId) return;
    let cancelled = false;

    void (async () => {
      setQuotationLoading(true);
      setQuotationError(null);
      try {
        const quote = await snaggingService.getQuotationById(editQuotationId);
        if (cancelled) return;

        if (quote.status !== "draft") {
          setQuotationError(
            quote.status === "sent"
              ? "That quotation has already been sent to the client, so it can no longer be edited."
              : "That quotation has been decided, so it can no longer be edited.",
          );
          return;
        }

        const prop = (quote.property ?? {}) as Record<string, unknown>;
        const snap = (quote.property_snapshot ?? {}) as Record<string, unknown>;
        const text = (value: unknown) => (value == null ? "" : String(value));
        // The record first, the snapshot as the fallback for a quotation
        // raised before the record carried the field.
        const either = (key: string) =>
          text(prop[key] ?? snap[key] ?? null);

        const type =
          ((prop.property_type ?? snap.property_type) as SnaggingPropertyType) ??
          "apartment";
        const beds =
          typeof prop.bedrooms === "number"
            ? prop.bedrooms
            : typeof snap.bedrooms === "number"
              ? snap.bedrooms
              : 2;

        setDraft((current) => ({
          ...current,
          client_id: text(quote.client_id),
          property_id: text(quote.property_id),
          client_name: text(quote.client?.name ?? snap.client_name),
          client_email: text(quote.client?.email ?? snap.client_email),
          client_phone: text(quote.client?.phone ?? snap.client_phone),
          unit_label: either("unit_label"),
          building_name: either("building_name"),
          community: either("community"),
          developer_name: either("developer_name"),
          property_type: type,
          bedrooms: beds,
          built_up_area: either("built_up_area_sqft"),
          plot_area: text(prop.plot_area_sqft),
          external_areas_in_scope: Boolean(prop.external_areas_in_scope),
          floors: text(prop.floors),
          location_lat: text(prop.location_lat),
          location_lng: text(prop.location_lng),
          noc_required: Boolean(prop.noc_required),
          furnished: Boolean(quote.furnished ?? snap.furnished),
          out_of_hours: quote.out_of_hours === true,
          // The rate this document was priced at, so leaving the field
          // alone saves the same figure rather than resuggesting one.
          rate_per_sqft: text(quote.rate_per_sqft),
          external_rate_per_sqft: text(quote.external_rate_per_sqft),
          areas: areasTouched.current ? current.areas : [],
        }));
        setQuotationLabel(quote.quote_number);
      } catch (error) {
        if (!cancelled) {
          setQuotationError(
            error instanceof Error ? error.message : "Could not load that quotation",
          );
        }
      } finally {
        if (!cancelled) setQuotationLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editQuotationId]);

  // Kept on screen rather than fired as a toast: a failed staff load used
  // to leave the approval-manager picker silently empty, which reads as
  // "there are no managers" instead of "the list did not load".
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const rows: User[] = await usersService.getUsers();
      setUsers(rows.filter((row) => row.is_active !== false));
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : "Could not load the staff list");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);


  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  // Changing the property type or bedroom count reseeds the room list,
  // unless the user has already customised it.
  function setPropertyType(value: SnaggingPropertyType) {
    setDraft((current) => ({
      ...current,
      property_type: value,
      areas: areasTouched.current ? current.areas : [],
      /*
        Each type has its own band, so a rate typed against the old one is
        no longer the number the coordinator meant. Same reasoning as the
        furnished toggle.
      */
      rate_per_sqft: "",
    }));
  }

  function setBedrooms(value: number) {
    setDraft((current) => ({
      ...current,
      bedrooms: value,
      areas: areasTouched.current ? current.areas : [],
    }));
  }

  function setAreas(next: AreaChoice[]) {
    areasTouched.current = true;
    set("areas", next);
  }

  // Reuse an existing property (BR-1): prefill every field from the record and
  // remember its id so the job links to it. Passing null returns to "new".
  function applyProperty(prop: SnaggingProperty | null) {
    const type = (prop?.property_type as SnaggingPropertyType) ?? draft.property_type;
    const s = (v: number | null | undefined) => (v != null ? String(v) : "");
    setDraft((current) => ({
      ...current,
      property_id: prop?.id ?? "",
      unit_label: prop?.unit_label ?? (prop ? "" : current.unit_label),
      building_name: prop?.building_name ?? (prop ? "" : current.building_name),
      community: prop?.community ?? (prop ? "" : current.community),
      developer_name: prop?.developer_name ?? (prop ? "" : current.developer_name),
      property_type: type,
      bedrooms: prop?.bedrooms ?? current.bedrooms,
      built_up_area: prop ? s(prop.built_up_area_sqft) : current.built_up_area,
      plot_area: prop ? s(prop.plot_area_sqft) : current.plot_area,
      external_areas_in_scope: prop ? Boolean(prop.external_areas_in_scope) : current.external_areas_in_scope,
      floors: prop ? s(prop.floors) : current.floors,
      location_lat: prop ? s(prop.location_lat) : current.location_lat,
      location_lng: prop ? s(prop.location_lng) : current.location_lng,
      title_deed_path: prop?.title_deed_path ?? (prop ? "" : current.title_deed_path),
      noc_required: prop ? Boolean(prop.noc_required) : current.noc_required,
      noc_path: prop?.noc_path ?? (prop ? "" : current.noc_path),
      areas: areasTouched.current ? current.areas : [],
    }));
  }

  // What is stopping this step, in words. Empty means the step passes —
  // the gate itself is unchanged, it just now carries its reasons.
  const blockers = useMemo(() => {
    switch (STEPS[step].key) {
      case "property":
        return Object.values(propertyErrors(draft)).filter((m): m is string => Boolean(m));
      case "plan_areas":
        // The plan itself stays optional — it can be added from the job
        // later. The rooms are what the inspector cannot walk without.
        return draft.areas.length > 0 ? [] : [AREAS_ERROR];
      case "assign": {
        // Schedule + contacts are optional here; the inspector is assigned from
        // the job only after the client approves the quotation (FR-3.08).
        // What is NOT optional is that a slot which is set is a slot that
        // can still be kept.
        const at = toLocalInstant(draft.appointment_date, draft.appointment_time);
        if (at && at.getTime() < Date.now()) {
          return ["The appointment is in the past. Pick a later date or time."];
        }
        if (draft.appointment_date && !draft.appointment_time) {
          return ["Give the appointment a time, or clear the date."];
        }
        return [];
      }
      default:
        return [];
    }
  }, [step, draft, STEPS]);

  const stepValid = blockers.length === 0;

  /*
    Errors wait until someone tries to move on. A form that opens already
    listing everything it is missing reads as a telling-off; after a
    click on Continue, each reason shows under the field it belongs to.
  */
  const [attempted, setAttempted] = useState(false);
  const [attemptedStep, setAttemptedStep] = useState(step);
  if (attemptedStep !== step) {
    setAttemptedStep(step);
    setAttempted(false);
  }
  const fieldErrors = attempted && STEPS[step].key === "property" ? propertyErrors(draft) : {};

  /** Runs the step's action, or shows why it cannot run yet. */
  function attempt(action: () => void) {
    if (!stepValid) {
      setAttempted(true);
      toast.error(
        STEPS[step].key === "property"
          ? "Fill in the fields marked below."
          : (blockers[0] ?? "Something on this step still needs attention."),
      );
      return;
    }
    action();
  }

  async function submit() {
    setSubmitting(true);
    try {
      /*
        Quote-only: write the quotation and stop (BA v2, changes 1-2).

        No job is created, because there is nothing to inspect until the
        client agrees a price. The same property fields the job would have
        used are sent, so the two records describe one unit.
      */
      if (quoteOnly) {
        const num0 = (v: string) => (v.trim() && Number(v) ? Number(v) : undefined);
        const payload = {
          client_id: draft.client_id || undefined,
          property_id: draft.property_id || undefined,
          property: {
            unit_label: draft.unit_label,
            building_name: draft.building_name,
            community: draft.community,
            client_name: draft.client_name,
            client_email: draft.client_email,
            client_phone: draft.client_phone,
            developer_name: draft.developer_name,
            property_type: draft.property_type,
            bedrooms:
              draft.property_type === "commercial" ? undefined : draft.bedrooms,
            built_up_area_sqft: num0(draft.built_up_area),
            plot_area_sqft: num0(draft.plot_area),
            external_areas_in_scope: draft.external_areas_in_scope,
            floors: num0(draft.floors),
            location_lat: num0(draft.location_lat),
            location_lng: num0(draft.location_lng),
          },
          furnished: draft.furnished,
          out_of_hours: draft.out_of_hours,
          rate_per_sqft: num0(draft.rate_per_sqft),
          external_rate_per_sqft: num0(draft.external_rate_per_sqft),
        };

        /*
          Saved back onto the draft, not raised as a second document. The
          quotation keeps its number, and the client and property records
          are corrected with it — they are what the next Regenerate would
          reprice from, so a fix that lived only on the quotation would
          not survive one.
        */
        if (editQuotationId) {
          await snaggingService.updateQuotation(editQuotationId, payload);
          toast.success(`Quotation ${quotationLabel ?? ""} saved`.replace("  ", " "));
          router.push(`/snagging/quotations/${editQuotationId}`);
          return;
        }

        const quote = await snaggingService.createQuotation(payload);
        toast.success(`Quotation ${quote.quote_number} created`);
        router.push(`/snagging/quotations/${quote.id}`);
        return;
      }

      // Combine appointment date + time into one instant, on the coordinator's clock.
      const appointmentAt = draft.appointment_date
        ? toLocalInstant(draft.appointment_date, draft.appointment_time || "09:00")?.toISOString()
        : undefined;
      const num = (v: string) => (v.trim() && Number(v) ? Number(v) : undefined);

      const created = await snaggingService.createTask({
        client_id: draft.client_id || undefined,
        property_id: draft.property_id || undefined,
        quotation_id: quotationId ?? undefined,
        property: {
          unit_label: draft.unit_label,
          building_name: draft.building_name,
          community: draft.community,
          client_name: draft.client_name,
          client_email: draft.client_email,
          client_phone: draft.client_phone,
          developer_name: draft.developer_name,
          property_type: draft.property_type,
          city: "Dubai",
          bedrooms: draft.property_type === "commercial" ? undefined : draft.bedrooms,
          built_up_area_sqft: num(draft.built_up_area),
          plot_area_sqft: num(draft.plot_area),
          external_areas_in_scope: draft.external_areas_in_scope,
          floors: num(draft.floors),
          location_lat: num(draft.location_lat),
          location_lng: num(draft.location_lng),
          title_deed_path: draft.title_deed_path || undefined,
          noc_required: draft.noc_required,
          noc_path: draft.noc_path || undefined,
        },
        scheduled_date: draft.appointment_date || undefined,
        appointment_at: appointmentAt,
        developer_contact_name: draft.developer_contact_name || undefined,
        developer_contact_phone: draft.developer_contact_phone || undefined,
        client_contact_name: draft.client_contact_name || undefined,
        client_contact_phone: draft.client_contact_phone || undefined,
        areas: draft.areas.map((area) => ({
          name: area.name,
          catalogue_area_code: area.code ?? undefined,
        })),
        // The inspector is assigned from the job after the quotation is
        // approved (FR-3.08); creation never assigns one.
        technician_ids: [],
        approval_manager_id: draft.approval_manager_id || null,
        notes: draft.notes,
      });

      // Plans upload after the task exists, so each attaches to it. A
      // failed plan does not lose the job — it is reported and the job
      // still opens, where the plan can be re-added.
      let planFailures = 0;
      const planIdByLocal = new Map<string, string>();
      for (const plan of plans) {
        try {
          const uploaded = await snaggingService.uploadFloorPlan(created.id, plan.file, {
            label: plan.label,
            width: plan.width,
            height: plan.height,
          });
          if (uploaded?.id) planIdByLocal.set(plan.id, uploaded.id);
        } catch {
          planFailures += 1;
        }
      }

      if (planFailures > 0) {
        toast.warning(`${planFailures} floor plan(s) did not upload. Add them from the job.`);
      }

      /*
        The rooms placed while the job was being created (BA change 5/6):
        pins, and the outlines drawn with "Draw the room".

        They can only be written once both ends exist: the plan needs the id
        its upload returned, and the room needs the id the job gave it.
        Areas are unique by name within a task, which is what makes the name
        a safe join back to the row that was just created. A failure here
        costs the pins, not the job, so it warns rather than throws.
      */
      const pinned = draft.areas.filter(
        (area) =>
          area.planId &&
          planIdByLocal.has(area.planId) &&
          area.pinX != null &&
          area.pinY != null,
      );

      if (pinned.length > 0) {
        try {
          const saved = await snaggingService.listAreas(created.id);
          const idByName = new Map(
            saved.map((area) => [area.name.toLowerCase(), area.id]),
          );
          for (const area of pinned) {
            const areaId = idByName.get(area.name.toLowerCase());
            const planId = area.planId ? planIdByLocal.get(area.planId) : undefined;
            if (!areaId || !planId) continue;
            await snaggingService.updateArea(created.id, {
              id: areaId,
              floor_plan_id: planId,
              pin_x: area.pinX,
              pin_y: area.pinY,
              /*
                The outline too. Only the pin was sent, so a room drawn here
                opened on the job as a plain pin at the outline's centre (the
                point a zone keeps as its fallback).
              */
              ...(area.zone && area.zone.length >= 3 ? { zone: area.zone } : {}),
            });
          }
        } catch {
          toast.warning(
            "The rooms were created, but their pins did not save. Place them from the job.",
          );
        }
      }

      // Title deed (E8) and NOC (E10) upload after the job exists, and never
      // block it — a failure is reported and the job still opens.
      if (titleDeedFile) {
        try {
          const { file: deed } = await compressImage(titleDeedFile);
          await snaggingService.uploadDocument(created.id, deed, "title_deed");
        } catch {
          toast.warning("The title deed did not upload. Add it from the job.");
        }
      }
      if (nocFile) {
        try {
          const { file: noc } = await compressImage(nocFile);
          await snaggingService.uploadDocument(created.id, noc, "noc");
        } catch {
          toast.warning("The NOC did not upload. Add it from the job.");
        }
      }

      toast.success("Job created");
      router.push(`/snagging/${created.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the job");
      setSubmitting(false);
    }
  }

  const isLast = step === STEPS.length - 1;

  return (
    <div className="flex flex-col gap-6">
      {/*
        No page heading on New quotation: the form's own "Quotation
        details" heading already says what the page is. Editing a
        quotation and raising a job keep theirs.
      */}
      {quoteOnly && !isEdit ? null : (
      <PageHeading
        eyebrow={quoteOnly ? "Sales" : "Work"}
        title={
          isEdit
            ? quotationLabel
              ? `Edit quotation ${quotationLabel}`
              : "Edit quotation"
            : quoteOnly
              ? "New quotation"
              : "New job"
        }
        description={
          isEdit
            ? "Correct the details while it is still a draft. Saving reprices the document and updates the client and property records."
            : quoteOnly
              ? "Price a client's property. The job is raised once they approve it."
              : quotationLabel
                ? "The client and property come from the approved quotation. Add the plans, areas and contacts."
                : "Three steps to a reference pack an inspector can pull before losing signal."
        }
      />
      )}

      {/*
        Only the two states worth interrupting for: still fetching, and
        could not be used. That the job came from a quotation is already
        in the page's own subtitle, and repeating it in a banner spent a
        full-width alert on something nobody has to act on.
      */}
      {quotationLoading ? (
        /*
          The form is about to be filled in from the quotation, so it is
          not shown yet. A banner over a blank New job form read as "here
          is your form, and also something is loading" — and anything
          typed into it was a second away from being overwritten.
        */
        <Card className="flex min-h-[20rem] flex-col items-center justify-center gap-3 p-10 text-center">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
          <p className="text-muted-foreground text-sm">
            Loading the quotation…
          </p>
        </Card>
      ) : quotationError ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>That quotation cannot be used</AlertTitle>
          <AlertDescription>
            {quotationError} Start the job from scratch, or go back to
            Quotations and pick another.
          </AlertDescription>
        </Alert>
      ) : null}

      {/*
        A draft that cannot be loaded, or can no longer be edited, gets no
        form at all. Rendering an empty one would invite somebody to fill
        it in and then be refused on save.
      */}
      {quotationLoading || (isEdit && quotationError) ? null : (
        <Card className="gap-0 p-0">
          <div className="p-4">
            {STEPS[step].key === "property" ? (
              <PropertyStep
                draft={draft}
                set={set}
                quoteOnly={quoteOnly}
                pricing={pricing}
                setPropertyType={setPropertyType}
                setBedrooms={setBedrooms}
                applyProperty={applyProperty}
                titleDeedFile={titleDeedFile}
                setTitleDeedFile={setTitleDeedFile}
                nocFile={nocFile}
                setNocFile={setNocFile}
                errors={fieldErrors}
              />
            ) : STEPS[step].key === "plan_areas" ? (
              <PlanAreasStep
                propertyType={draft.property_type}
                bedrooms={draft.bedrooms}
                areas={draft.areas}
                setAreas={setAreas}
                plans={plans}
                setPlans={setPlans}
              />
            ) : (
              <AssignStep
                draft={draft}
                set={set}
                users={users}
                usersLoading={usersLoading}
                usersError={usersError}
                retryUsers={() => void loadUsers()}
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-4 border-t px-6 py-4">
            <div className="min-w-0">
              {STEPS[step].key === "plan_areas" ? (
                <p className="text-muted-foreground text-xs">
                  {`${draft.areas.length} area${draft.areas.length === 1 ? "" : "s"} selected, ${draft.areas.filter((a) => a.pinX != null).length
                    } pinned. Pinning is optional.`}
                </p>
              ) : null}
              {attempted && STEPS[step].key !== "property"
                ? blockers.map((reason) => (
                  <p key={reason} className="text-destructive mt-1 text-xs">
                    {reason}
                  </p>
                ))
                : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  step > 0
                    ? setStep(step - 1)
                    : router.push(
                      isEdit
                        ? `/snagging/quotations/${editQuotationId}`
                        : quoteOnly
                          ? "/snagging/quotations"
                          : "/snagging/jobs",
                    )
                }
                disabled={submitting}
              >
                {isEdit ? "Cancel" : "Back"}
              </Button>
              {isLast ? (
                <SubmitButton
                  onClick={() => attempt(() => void submit())}
                  pending={submitting}
                  pendingLabel={isEdit ? "Saving…" : "Creating…"}
                >
                  {isEdit
                    ? "Save changes"
                    : quoteOnly
                      ? "Create quotation"
                      : "Create job"}
                </SubmitButton>
              ) : (
                <Button onClick={() => attempt(() => setStep(step + 1))}>
                  Continue
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  /** Why this field blocks the step. Shown under the control, in words. */
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {label}
        {required ? <span className="text-brand"> *</span> : null}
      </Label>
      {children}
      {/*
        The hint is helper text under the control, not squeezed in beside
        the label, where a long one wrapped the label onto two lines. An
        error takes its place when there is one.
      */}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Client picker.
 *
 * The search box finds a client already on file; the + button beside it
 * opens a dialog to add a brand-new one (name, email, phone). Once a
 * client is chosen either way, it is shown as a settled card with a
 * Change action, so the job always carries exactly one deliberate
 * client rather than whatever half-typed text was left in a field.
 *
 * Clients come from the distinct client rows on existing properties, so
 * there is no second table to keep in step.
 */
function ClientPicker({
  draft,
  set,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [clients, setClients] = useState<SnaggingClientOption[]>([]);
  // The search the list on screen answers; loading until it is the current one.
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /*
    The server searches every client and sends the best few. The picker
    used to load the first 400 and filter those here, so anyone after
    them could not be found.
  */
  const debouncedSearch = useDebounce(search.trim(), 250);
  const loading = fetchedFor !== debouncedSearch;

  useEffect(() => {
    let active = true;
    snaggingService
      .searchClients(debouncedSearch || undefined, { limit: 8 })
      .then((rows) => active && setClients(rows))
      .catch(() => undefined)
      .finally(() => active && setFetchedFor(debouncedSearch));
    return () => {
      active = false;
    };
  }, [debouncedSearch]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const matches = clients;

  function choose(client: SnaggingClientOption) {
    set("client_id", client.id ?? "");
    set("property_id", "");
    set("client_name", client.client_name);
    set("client_email", client.client_email ?? "");
    set("client_phone", client.client_phone ?? "");
    if (client.developer_name && !draft.developer_name) set("developer_name", client.developer_name);
    setOpen(false);
    setSearch("");
  }

  // The new client has already been persisted by the dialog, so it arrives
  // with an id we link the job to.
  function saveNew(client: SnaggingClientOption) {
    set("client_id", client.id ?? "");
    set("property_id", "");
    set("client_name", client.client_name);
    set("client_email", client.client_email ?? "");
    set("client_phone", client.client_phone ?? "");
    setAddOpen(false);
    setSearch("");
  }

  function clear() {
    set("client_id", "");
    set("property_id", "");
    set("client_name", "");
    set("client_email", "");
    set("client_phone", "");
  }

  // A client is settled: show it as a card rather than the search box.
  if (draft.client_name.trim().length > 0) {
    return (
      <>
        <div className="border-brand/30 bg-brand-50/50 flex items-center justify-between gap-3 rounded-[12px] border px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate font-medium">{draft.client_name}</p>
            <p className="text-muted-foreground truncate text-xs">
              {[draft.client_email, draft.client_phone].filter(Boolean).join(" · ") ||
                "No contact details"}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            Change
          </Button>
        </div>
        <AddClientDialog open={addOpen} onOpenChange={setAddOpen} onSave={saveNew} />
      </>
    );
  }

  return (
    <div ref={boxRef}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search clients on file"
            className="pr-9 pl-9"
          />
          <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2" />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setAddOpen(true)}
          aria-label="Add a new client"
          title="Add a new client"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {open ? (
        <div className="relative">
          <div className="bg-popover absolute z-50 mt-1 w-full overflow-hidden rounded-[12px] border shadow-md">
            <div className="max-h-64 overflow-y-auto py-1">
              {loading ? (
                <p className="text-muted-foreground px-3 py-2 text-sm">Loading clients…</p>
              ) : matches.length === 0 ? (
                <p className="text-muted-foreground px-3 py-2 text-sm">
                  No client on file matches. Use the + button to add a new one.
                </p>
              ) : (
                matches.map((client) => (
                  <button
                    key={`${client.client_name}-${client.client_email ?? ""}`}
                    type="button"
                    onClick={() => choose(client)}
                    className="hover:bg-mist-soft flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{client.client_name}</span>
                      {client.client_email ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          {client.client_email}
                        </span>
                      ) : null}
                    </span>
                    {client.property_count ? (
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {client.property_count} job{client.property_count === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setAddOpen(true);
              }}
              className="text-brand hover:bg-mist-soft flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm font-medium"
            >
              <UserPlus className="size-4" />
              Add a new client
            </button>
          </div>
        </div>
      ) : null}

      <AddClientDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        initialName={search.trim()}
        onSave={saveNew}
      />
    </div>
  );
}

/** Collects a brand-new client: name (required), email, phone. */
function AddClientDialog({
  open,
  onOpenChange,
  initialName = "",
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onSave: (client: SnaggingClientOption) => void;
}) {
  // The dialog content unmounts when closed, so these initialisers run
  // fresh on each open — seeding the name from whatever was typed in the
  // search so a near-miss flows straight into a new client, with no
  // reset effect needed.
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  // D1/D2: name and phone are required (phone in any international format);
  // email is optional and must never block the record.
  const valid =
    name.trim().length >= 2 &&
    /[0-9]{6,}/.test(phone.replace(/[^0-9]/g, "")) &&
    (email === "" || /.+@.+\..+/.test(email));

  // Persist the client now, so it is genuinely on file (and reusable) the
  // moment it is added, rather than only when the job is finally created.
  async function add() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const created = await snaggingService.createClient({
        client_name: name.trim(),
        client_email: email.trim() || undefined,
        client_phone: phone.trim() || undefined,
      });
      onSave(created);
      toast.success(`${created.client_name} added`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the client");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a client</DialogTitle>
          <DialogDescription>
            The client receives the report. Only the name is required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Client name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Ahmed Khan"
              autoFocus
            />
          </Field>
          <Field label="Phone" required hint="Any country code works.">
            <PhoneInput value={phone} onChange={setPhone} />
          </Field>
          <Field label="Email" hint="Optional.">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" disabled={!valid || saving} onClick={() => void add()}>
            {saving ? "Adding…" : "Add client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What an upload box accepts, and the limit it states. */
const DOCUMENT_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const DOCUMENT_MAX_MB = 10;

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * An optional document (PDF or image) as a proper drop box: click to
 * browse or drag a file onto it. Once chosen, the box becomes the file --
 * its name, size and a way to swap or remove it.
 */
function DocumentField({
  label,
  hint,
  file,
  onPick,
}: {
  label: string;
  hint?: string;
  file: File | null;
  onPick: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function accept(next: File | null | undefined) {
    if (!next) return;
    const allowed = DOCUMENT_ACCEPT.split(",");
    if (!allowed.includes(next.type)) {
      toast.error("That file type is not accepted. Use a PDF, JPG, PNG or WEBP.");
      return;
    }
    if (next.size > DOCUMENT_MAX_MB * 1024 * 1024) {
      toast.error(`That file is over ${DOCUMENT_MAX_MB} MB. Choose a smaller one.`);
      return;
    }
    onPick(next);
  }

  const isPdf = file?.type === "application/pdf";

  return (
    <Field label={label} hint={hint}>
      <input
        ref={inputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        onChange={(event) => {
          accept(event.target.files?.[0]);
          // The same file can be picked again after it was removed.
          event.target.value = "";
        }}
      />
      {file ? (
        <div className="border-border bg-muted/30 flex items-center gap-3 rounded-lg border px-3 py-3">
          <span className="bg-background text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md border">
            {isPdf ? <FileText className="size-5" /> : <ImageIcon className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-muted-foreground text-xs">
              {isPdf ? "PDF" : "Image"} · {formatFileSize(file.size)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            Replace
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onPick(null)}
            aria-label={`Remove ${file.name}`}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            accept(event.dataTransfer.files?.[0]);
          }}
          className={cn(
            "focus-visible:ring-ring flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none",
            dragging
              ? "border-brand bg-brand-50"
              : "border-border hover:border-brand/50 hover:bg-muted/40",
          )}
        >
          <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
            <Upload className="size-5" />
          </span>
          <span className="text-sm">
            <span className="text-brand font-medium">Click to upload</span>{" "}
            <span className="text-muted-foreground">or drag and drop</span>
          </span>
          <span className="text-muted-foreground text-xs">
            PDF, JPG, PNG or WEBP · up to {DOCUMENT_MAX_MB} MB
          </span>
        </button>
      )}
    </Field>
  );
}

/**
 * One titled part of the form. The long single column read as one wall
 * of fields; grouping them the way a coordinator thinks about the job --
 * who, what, where, paperwork -- makes it scannable.
 */
function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    // Title and subheading sit above the fields, so the fields get the
    // full width of the card.
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {description ? (
          <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

/**
 * A yes/no choice as a selectable card: the whole card is the target, and
 * a chosen option is visibly chosen rather than just a ticked box.
 */
function OptionCard({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors",
        checked ? "border-brand bg-brand-50" : "hover:bg-muted/40",
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(Boolean(v))}
        className="mt-0.5"
      />
      <span>
        <span className="font-medium">{title}</span>
        {description ? (
          <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function PropertyStep({
  draft,
  set,
  quoteOnly,
  pricing,
  setPropertyType,
  setBedrooms,
  applyProperty,
  titleDeedFile,
  setTitleDeedFile,
  nocFile,
  setNocFile,
  errors,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  /** Only a quotation prices anything, so only it shows the rate block. */
  quoteOnly: boolean;
  pricing: SnaggingPricingConfig | null;
  setPropertyType: (value: SnaggingPropertyType) => void;
  setBedrooms: (value: number) => void;
  applyProperty: (prop: SnaggingProperty | null) => void;
  titleDeedFile: File | null;
  setTitleDeedFile: (file: File | null) => void;
  nocFile: File | null;
  setNocFile: (file: File | null) => void;
  /** Shown under their fields once someone has tried to continue. */
  errors: Partial<Record<PropertyErrorKey, string>>;
}) {
  const isCommercial = draft.property_type === "commercial";
  const isVilla = draft.property_type === "villa";
  const hasPlot = isVilla || draft.property_type === "townhouse";

  /*
    The client's properties on file, so an existing one can be reused (BR-1).

    The lookup is tracked, not just its result. The field used to be gated on
    `clientProperties.length > 0`, so between picking a client and the rows
    arriving there was nothing on screen at all and the whole field then
    appeared from nowhere. Whether the list is still loading, came back empty,
    or failed are three different things and the form now says which.

    One piece of state carries the client it belongs to, so a result for the
    previously selected client is never shown against the current one. That
    also means no reset effect: a lookup whose `clientId` does not match the
    draft is stale by definition, which reads as loading without anything
    having to write state on the way in.
  */
  const [lookup, setLookup] = useState<{
    clientId: string | null;
    state: "loading" | "ready" | "error";
    rows: SnaggingProperty[];
  }>({ clientId: null, state: "loading", rows: [] });

  const fresh = Boolean(draft.client_id) && lookup.clientId === draft.client_id;
  const propertiesState: "idle" | "loading" | "ready" | "error" = !draft.client_id
    ? "idle"
    : fresh
      ? lookup.state
      : "loading";
  const clientProperties = fresh ? lookup.rows : [];

  const loadClientProperties = useCallback((clientId: string) => {
    let active = true;
    snaggingService
      .listProperties(clientId)
      .then((rows) => {
        if (active) setLookup({ clientId, state: "ready", rows });
      })
      .catch(() => {
        // Not the same as "this client has none": an empty list here would
        // quietly push the coordinator into creating a duplicate property.
        if (active) setLookup({ clientId, state: "error", rows: [] });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!draft.client_id) return;
    return loadClientProperties(draft.client_id);
  }, [draft.client_id, loadClientProperties]);


  /**
   * Accepts a pasted "lat, lng" pair in either box.
   *
   * Copying a coordinate out of Google Maps gives you both numbers at
   * once; pasting that into a single number field used to silently drop
   * half of it.
   */
  function setCoordinate(field: "location_lat" | "location_lng", raw: string) {
    const pair = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (pair) {
      set("location_lat", pair[1]);
      set("location_lng", pair[2]);
      return;
    }
    set(field, raw.trim());
  }

  // The draft holds strings so a half-typed coordinate is not destroyed;
  // the map needs numbers, and only when both are actually valid.
  const parsedLat = Number.isFinite(Number(draft.location_lat.trim())) && draft.location_lat.trim()
    ? Number(draft.location_lat.trim())
    : null;
  const parsedLng = Number.isFinite(Number(draft.location_lng.trim())) && draft.location_lng.trim()
    ? Number(draft.location_lng.trim())
    : null;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl">{quoteOnly ? "Quotation details" : "Property and client"}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {quoteOnly
            ? "Choose the client, describe the property and set the price. The job is raised once the client approves the quotation."
            : "Who the job is for and the property being inspected. The inspector sees all of this on site, even without signal."}
        </p>
      </div>

      <FormSection
        title="Client"
        description="Who the quotation is for. Pick someone on file, or add them with +."
      >
        <Field label="Client" required hint="Search clients on file, or add a new one with +." error={errors.client}>
          <ClientPicker draft={draft} set={set} />
        </Field>

        {draft.client_id && propertiesState === "loading" ? (
          <Field label="Property" hint="Checking what this client already has…">
            {/*
            Shaped like the select it becomes, so the form does not jump when
            the rows land.
          */}
            <div className="border-input text-muted-foreground flex h-9 w-full items-center gap-2 rounded-[12px] border px-3 text-sm">
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              Loading properties on file...
            </div>
          </Field>
        ) : null}

        {draft.client_id && propertiesState === "error" ? (
          <Field label="Property" hint="Reuse one on file, or start a new one.">
            <div className="border-input flex flex-wrap items-center justify-between gap-2 rounded-[12px] border px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                Could not load this client&apos;s properties.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => loadClientProperties(draft.client_id)}
              >
                Try again
              </Button>
            </div>
          </Field>
        ) : null}

        {draft.client_id && propertiesState === "ready" && clientProperties.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No properties on file for this client yet. The details below will
            create the first one.
          </p>
        ) : null}

        {draft.client_id && propertiesState === "ready" && clientProperties.length > 0 ? (
          <Field label="Property" hint="Reuse one on file, or start a new one.">
            <Select
              value={draft.property_id || "new"}
              onValueChange={(value) =>
                applyProperty(value === "new" ? null : clientProperties.find((p) => p.id === value) ?? null)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New property</SelectItem>
                {clientProperties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {[p.unit_label, p.building_name].filter(Boolean).join(", ") || p.unit_label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        {draft.property_id ? (
          <p className="text-muted-foreground -mt-2 text-xs">
            Reusing a saved property. Any edits below update that property record.
          </p>
        ) : null}
      </FormSection>

      <FormSection
        title="Property details"
        description="The unit being inspected. Built up area sets the price."
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Unit reference" required error={errors.unit_label}>
            <Input
              value={draft.unit_label}
              onChange={(event) => set("unit_label", event.target.value)}
              placeholder="e.g. Unit 1904"
            />
          </Field>
          <Field label="Project / tower" required>
            <Input
              value={draft.building_name}
              onChange={(event) => set("building_name", event.target.value)}
              placeholder="e.g. Riviera Tower 3"
            />
          </Field>
          <Field label="Community">
            <Input
              value={draft.community}
              onChange={(event) => set("community", event.target.value)}
              placeholder="e.g. Dubai Marina"
            />
          </Field>
          <Field label="Developer">
            <Input
              value={draft.developer_name}
              onChange={(event) => set("developer_name", event.target.value)}
              placeholder="e.g. Emaar"
            />
          </Field>
          <Field label="Property type" required>
            <Select
              value={draft.property_type}
              onValueChange={(value) => setPropertyType(value as SnaggingPropertyType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {!isCommercial ? (
            <Field label="Bedrooms" required>
              <Select value={String(draft.bedrooms)} onValueChange={(v) => setBedrooms(Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Studio</SelectItem>
                  {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} bedroom{n > 1 ? "s" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field
            label="Built up area (sq ft)"
            required
            hint="The price is based on this."
            error={errors.built_up_area}
          >
            <Input
              type="number"
              inputMode="decimal"
              value={draft.built_up_area}
              onChange={(event) => set("built_up_area", event.target.value)}
              placeholder="e.g. 1200"
            />
          </Field>

          {hasPlot ? (
            <Field label="Plot area (sq ft)">
              <Input
                type="number"
                inputMode="decimal"
                value={draft.plot_area}
                onChange={(event) => set("plot_area", event.target.value)}
                placeholder="e.g. 3500"
              />
            </Field>
          ) : null}

          {isVilla ? (
            <Field label="Number of floors">
              <Input
                type="number"
                inputMode="numeric"
                value={draft.floors}
                onChange={(event) => set("floors", event.target.value)}
                placeholder="e.g. 2"
              />
            </Field>
          ) : null}
        </div>

        {hasPlot ? (
          <OptionCard
            checked={draft.external_areas_in_scope}
            onChange={(v) => set("external_areas_in_scope", v)}
            title="External areas are in scope"
            description="Garden, pool and landscaping are inspected too."
          />
        ) : null}
      </FormSection>

      {/*
        What the client is charged (FR-2.15, FR-2.04).

        Only on a quotation: a job prices nothing, and the decisions here
        belong to the document that bills for the work.
      */}
      {quoteOnly ? (
        <FormSection
          title="Pricing"
          description="What the client declared, when the visit happens, and the rate this quotation charges."
        >
          <QuotePricingBlock draft={draft} set={set} pricing={pricing} />
        </FormSection>
      ) : null}

      {/*
        The map is the input. The two number boxes stay underneath
        because a coordinator sometimes has a coordinate from a
        developer and nothing to search for, but nobody should have to
        type one to say where a building is.
      */}
      <FormSection
        title="Location"
        description="Optional. Search or click the map to drop a pin, or paste a coordinate."
      >
        <LocationPicker
          lat={parsedLat}
          lng={parsedLng}
          onPick={(nextLat, nextLng) => {
            set("location_lat", String(nextLat));
            set("location_lng", String(nextLng));
          }}
          onClear={() => {
            set("location_lat", "");
            set("location_lng", "");
          }}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Latitude" hint="You can paste a lat, lng pair here.">
            <Input
              inputMode="decimal"
              value={draft.location_lat}
              onChange={(event) => setCoordinate("location_lat", event.target.value)}
              placeholder="e.g. 25.0772"
            />
          </Field>
          <Field label="Longitude">
            <Input
              inputMode="decimal"
              value={draft.location_lng}
              onChange={(event) => setCoordinate("location_lng", event.target.value)}
              placeholder="e.g. 55.1345"
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="Documents"
        description="Optional paperwork. Nothing here blocks the quotation or the job."
      >
        <OptionCard
          checked={draft.noc_required}
          onChange={(v) => set("noc_required", v)}
          title="An NOC or authorization letter is required"
          description="The person requesting the inspection is not the owner."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <DocumentField
            label="Title deed"
            hint="Optional. Confirms the unit and its area."
            file={titleDeedFile}
            onPick={setTitleDeedFile}
          />
          {draft.noc_required ? (
            <DocumentField
              label="NOC / authorization letter"
              hint="Optional. Never blocks the job."
              file={nocFile}
              onPick={setNocFile}
            />
          ) : null}
        </div>
      </FormSection>

      <FormSection
        title="Office notes"
        description="Optional. Anything the inspector should know on site."
      >
        <Textarea
          rows={3}
          value={draft.notes}
          onChange={(event) => set("notes", event.target.value)}
          placeholder="Access, handover date, anything the inspector should know on site"
          aria-label="Office notes"
        />
      </FormSection>
    </div>
  );
}

/**
 * The plan and the rooms, in one step (BA changes 4 and 5).
 *
 * These were two screens, and the pins were then placed a third time from
 * the job's own Areas and Plans tab once the job existed. The coordinator
 * had to carry the room list across a screen break and then repeat work
 * they had already done. Here the plan sits beside the list: pick a room,
 * click the plan, the pin lands, and the next unpinned room takes focus.
 */
function PlanAreasStep({
  propertyType,
  bedrooms,
  areas,
  setAreas,
  plans,
  setPlans,
}: {
  propertyType: SnaggingPropertyType;
  bedrooms: number;
  areas: AreaChoice[];
  setAreas: (next: AreaChoice[]) => void;
  plans: PendingPlan[];
  setPlans: React.Dispatch<React.SetStateAction<PendingPlan[]>>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [custom, setCustom] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [activeArea, setActiveArea] = useState<string | null>(null);
  /*
    Pin or outline (BA change 6). Pin stays the default because it is one
    click and it is what every existing job uses; drawing is opt-in for the
    rooms where edges earn their keep.
  */
  const [placeMode, setPlaceMode] = useState<"pin" | "zone">("pin");
  // The plan being renamed, and the name as typed so far.
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);

  const activePlan =
    plans.find((plan) => plan.id === activePlanId) ?? plans[0] ?? null;
  // Only an image can be clicked for a coordinate. A PDF plan still
  // uploads and still reaches the inspector; it just cannot be pinned here.
  const canPin = Boolean(activePlan?.file.type.startsWith("image/"));

  /*
    The template for this property type, plus any room added by hand.

    Added rooms sit ABOVE the template, newest first, rather than at the
    bottom of a list of twenty. A room you just typed is the one you are
    about to place, and hunting for it under a scroll bar was the whole
    reason adding one felt like it had not worked.
  */
  const options = useMemo(() => {
    const template = templateFor(propertyType, bedrooms);
    const templateNames = new Set(template.map((a) => a.name.toLowerCase()));
    const extras = areas.filter((a) => !templateNames.has(a.name.toLowerCase()));
    return [...extras.slice().reverse(), ...template];
  }, [propertyType, bedrooms, areas]);

  const selected = useMemo(
    () => new Map(areas.map((a) => [a.name.toLowerCase(), a])),
    [areas],
  );

  const placedCount = areas.filter((a) => a.pinX != null || a.zone).length;

  const planLabel = (id: string | null | undefined) =>
    plans.find((plan) => plan.id === id)?.label.trim() || "another plan";

  /**
   * Picks the room the next click on the plan belongs to.
   *
   * Brings its own floor forward when the room already sits on a different
   * plan, so "select, then click" can never quietly leave a second marker
   * for one room on the wrong floor.
   */
  function select(name: string) {
    setActiveArea(name);
    const area = selected.get(name.toLowerCase());
    if (area?.planId && area.planId !== activePlan?.id) setActivePlanId(area.planId);
  }

  /* Said in the dialog while the cursor is still in the field, rather than
     swallowing the click and leaving the list unchanged. */
  const duplicateArea =
    custom.trim().length > 0 &&
    options.some((o) => o.name.toLowerCase() === custom.trim().toLowerCase());

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const next: PendingPlan[] = [];

    for (const file of Array.from(files)) {
      /*
        Compressed at pick time, not at submit.

        The preview, the dimensions stored against the plan, and the bytes
        that eventually upload then all describe one image. Doing it at
        submit instead would mean the pin coordinates were measured against
        a picture the job never receives.
      */
      const { file: prepared, width, height } = await compressImage(file);
      const url = URL.createObjectURL(prepared);
      const dims =
        width && height
          ? { width, height }
          : (await readImageSize(prepared)) ?? (await readDimensions(prepared, url));
      next.push({
        id: `${prepared.name}-${prepared.size}-${Math.random().toString(36).slice(2)}`,
        file: prepared,
        label: file.name.replace(/\.[^.]+$/, ""),
        width: dims?.width,
        height: dims?.height,
        url,
      });
    }

    setPlans((current) => [...current, ...next]);
    if (next.length > 0 && !activePlanId) setActivePlanId(next[0].id);
  }

  function rename(id: string, label: string) {
    setPlans((current) =>
      current.map((plan) => (plan.id === id ? { ...plan, label } : plan)),
    );
  }

  function remove(id: string) {
    setPlans((current) => {
      const target = current.find((plan) => plan.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((plan) => plan.id !== id);
    });
    // A pin or an outline cannot outlive the plan it was placed on.
    setAreas(
      areas.map((a) =>
        a.planId === id
          ? { ...a, planId: null, pinX: undefined, pinY: undefined, zone: null }
          : a,
      ),
    );
    if (activePlanId === id) setActivePlanId(null);
  }

  function toggle(option: AreaChoice) {
    const key = option.name.toLowerCase();
    if (selected.has(key)) {
      setAreas(areas.filter((a) => a.name.toLowerCase() !== key));
      if (activeArea?.toLowerCase() === key) setActiveArea(null);
    } else {
      setAreas([...areas, option]);
      setActiveArea(option.name);
    }
  }

  function addCustom() {
    const name = custom.trim();
    if (!name || selected.has(name.toLowerCase())) return;

    // A custom room carries no catalogue code; the capture sheet falls
    // back to the whole catalogue there.
    setAreas([...areas, { name, code: null }]);
    setActiveArea(name);
    setCustom("");
    setAddOpen(false);

    // It lands at the top of the list; show that, in case the list was
    // scrolled somewhere else when the dialog was opened.
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) list.scrollTop = 0;
    });
  }

  /*
    A pin placed on the plan.

    Takes the coordinate rather than the event: the canvas owns the pointer
    work now and hands back a 0..1 fraction, which is the only form worth
    storing — it survives any render size, on any screen.
  */
  function placePin(key: string, x: number, y: number) {
    if (!activePlan) return;

    setAreas(
      areas.map((a) =>
        a.name.toLowerCase() === key
          ? { ...a, planId: activePlan.id, pinX: x, pinY: y }
          : a,
      ),
    );

    /*
      The room STAYS selected.

      This used to jump to the next unplaced room, which read as the
      placement having landed on the wrong one: you finished a room,
      looked up, and the list was highlighting its neighbour. Advancing
      saved one click and cost the confirmation that the click you just
      made did what you meant.
    */
  }

  /*
    An outline finished on the canvas. Stored exactly as a pin is — against
    the pending plan id, which submit later swaps for the real one — and
    the pin is kept so the handset still has a fallback point.
  */
  function onPlaceZone(key: string, points: ZonePoint[]) {
    if (!activePlan) return;
    const centre = zoneLabelPoint(points);
    setAreas(
      areas.map((a) =>
        a.name.toLowerCase() === key.toLowerCase()
          ? {
            ...a,
            planId: activePlan.id,
            zone: points,
            // A zone implies a point, so the room is placed either way.
            pinX: a.pinX ?? centre.x,
            pinY: a.pinY ?? centre.y,
          }
          : a,
      ),
    );
    // Stays selected, exactly as a pin does -- see placePin.
  }

  /** Unplaces a room: pin, outline and the plan it belonged to. */
  function clearPlacement(name: string) {
    const key = name.toLowerCase();
    setAreas(
      areas.map((a) =>
        a.name.toLowerCase() === key
          ? { ...a, planId: null, pinX: undefined, pinY: undefined, zone: null }
          : a,
      ),
    );
  }


  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl">Floor plan and areas</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Tick the rooms this job needs. To mark where a room sits, pick it in the
          list and click the plan. The plan and the pins are both optional, and can
          be added from the job later.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="grid gap-5 lg:min-h-[32rem] lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex flex-col gap-3">
          {plans.length === 0 ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="border-border hover:border-brand/40 hover:bg-mist-soft/50 flex w-full flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center transition-colors"
            >
              <Upload className="text-muted-foreground size-6" />
              <span className="font-medium">Add plan images</span>
              <span className="text-muted-foreground text-sm">
                PNG, JPG, WEBP or PDF, up to 15MB, one per floor
              </span>
            </button>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {/*
                  Each plan's own rename and remove sit on its chip, so
                  they act on the plan you are pointing at rather than on
                  whichever one happens to be open underneath.
                */}
                {plans.map((plan) => {
                  const name = plan.label.trim() || "Untitled plan";
                  const active = plan.id === activePlan?.id;
                  return (
                    <div
                      key={plan.id}
                      className={cn(
                        "inline-flex items-center rounded-full border text-xs font-medium transition-colors",
                        active
                          ? "border-brand bg-brand-50 text-brand"
                          : "border-border hover:bg-mist-soft",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setActivePlanId(plan.id)}
                        aria-pressed={active}
                        className="max-w-[14rem] truncate py-1 pr-1 pl-3"
                      >
                        {name}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenaming({ id: plan.id, label: plan.label })}
                        aria-label={`Rename ${name}`}
                        title="Rename"
                        className="rounded-full p-1 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(plan.id)}
                        aria-label={`Remove ${name}`}
                        title="Remove"
                        className="hover:text-destructive mr-1 rounded-full p-1 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => inputRef.current?.click()}
                >
                  <Plus className="size-4" />
                  Add plan
                </Button>
              </div>

              {activePlan ? (
                <>
                  {/*
                    Pin or outline (BA change 6). Only offered on an image —
                    a PDF plan still uploads and still reaches the inspector,
                    it just cannot be drawn on here.
                  */}
                  {canPin ? (
                    <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2 py-1.5">
                      <div className="bg-background inline-flex rounded-md border p-0.5">
                        {(["pin", "zone"] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setPlaceMode(option)}
                            aria-pressed={placeMode === option}
                            className={cn(
                              "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                              placeMode === option
                                ? "bg-brand-50 text-brand"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {option === "pin" ? (
                              <MapPin className="size-3.5" />
                            ) : (
                              <Shapes className="size-3.5" />
                            )}
                            {option === "pin" ? "Drop a pin" : "Draw the room"}
                          </button>
                        ))}
                      </div>

                      {/*
                        Which room the next click lands on. The list marks
                        it too, but the coordinator's eyes are on the plan
                        while they click, and that is the only question
                        that matters at that moment.
                      */}
                      {activeArea ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="bg-brand text-primary-foreground inline-flex max-w-[12rem] items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-xs font-medium">
                            <Crosshair className="size-3 shrink-0" />
                            <span className="truncate">{activeArea}</span>
                          </span>
                          <span className="text-muted-foreground hidden text-xs sm:inline">
                            {placeMode === "pin"
                              ? "Click the plan"
                              : "Click each corner · Enter closes · Esc restarts"}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setActiveArea(null)}
                          >
                            Done
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          Pick a room to place it
                        </span>
                      )}
                    </div>
                  ) : null}

                  {canPin ? (
                    <PlanZoneCanvas
                      src={activePlan.url}
                      alt={activePlan.label}
                      mode={placeMode}
                      activeKey={activeArea ? activeArea.toLowerCase() : null}
                      areas={areas
                        .filter((a) => a.planId === activePlan.id)
                        .map((a) => ({
                          key: a.name.toLowerCase(),
                          name: a.name,
                          pinX: a.pinX ?? null,
                          pinY: a.pinY ?? null,
                          zone: a.zone ?? null,
                        }))}
                      onPlacePin={(key, x, y) => placePin(key, x, y)}
                      onPlaceZone={onPlaceZone}
                      onPickArea={(key) => {
                        const hit = areas.find(
                          (a) => a.name.toLowerCase() === key,
                        );
                        if (hit) setActiveArea(hit.name);
                      }}
                    />
                  ) : (
                    <div className="border-border bg-mist-soft text-muted-foreground flex flex-col items-center justify-center gap-2 rounded-lg border px-6 py-16 text-center">
                      <ImageIcon className="size-6" />
                      <p className="max-w-sm text-sm">
                        A PDF plan still uploads with the job, but it cannot be
                        drawn on here. Add the floor as an image to place rooms
                        on it.
                      </p>
                    </div>
                  )}

                </>
              ) : null}
            </>
          )}
        </div>

        {/*
          The list is measured by the PLAN, not by its own contents.

          A grid row is as tall as its tallest cell, so eighteen rooms
          stretched the row past the bottom of the plan and left the
          left-hand column trailing white space. Taking the inner column
          out of flow with absolute positioning means only the plan side
          sets the row height; this side fills exactly that and scrolls.
        */}
        <div className="relative">
          <div className="flex flex-col gap-3 lg:absolute lg:inset-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <h3 className="font-medium">Areas to inspect</h3>
                <span className="text-muted-foreground text-xs">
                  {areas.length} ticked
                  {plans.length > 0 ? `, ${placedCount} placed` : ""}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Nothing starts ticked; these save ticking twenty rooms one by one. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    const have = new Set(areas.map((a) => a.name.toLowerCase()));
                    setAreas([...areas, ...options.filter((o) => !have.has(o.name.toLowerCase()))]);
                  }}
                  disabled={options.every((o) => selected.has(o.name.toLowerCase()))}
                >
                  Tick all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setAreas([]);
                    setActiveArea(null);
                  }}
                  disabled={areas.length === 0}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => setAddOpen(true)}
                  aria-label="Add an area"
                  title="Add an area"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>

            {/*
              The list runs to the bottom of the plan beside it. A fixed
              max-height left a ragged gap under a tall plan, and made a
              coordinator scroll a short list for no reason.
            */}
            <div
              ref={listRef}
              className="max-h-[26rem] min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 lg:max-h-none pl-1"
            >
              {options.map((option) => {
                const key = option.name.toLowerCase();
                const chosen = selected.get(key);
                const isActive = activeArea?.toLowerCase() === key;
                const drawn = Boolean(chosen?.zone);
                const placed = chosen?.pinX != null || drawn;
                const elsewhere =
                  placed && chosen?.planId && chosen.planId !== activePlan?.id;
                return (
                  <div
                    key={option.name}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors",
                      /*
                        Ticked is a soft edge; ACTIVE is the solid one. A
                        ring on top of a tint made every ticked room look
                        like the one being placed.
                      */
                      isActive
                        ? "border-brand bg-brand-50/50"
                        : chosen
                          ? "border-brand/30"
                          : "border-border hover:bg-muted/40",
                    )}
                  >
                    <Checkbox
                      checked={Boolean(chosen)}
                      onCheckedChange={() => toggle(option)}
                      aria-label={option.name}
                    />
                    <button
                      type="button"
                      disabled={!chosen}
                      onClick={() => select(option.name)}
                      className="min-w-0 flex-1 text-left disabled:cursor-default"
                    >
                      <span className="block truncate font-medium">{option.name}</span>
                      {chosen ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          {!placed
                            ? "Not on the plan"
                            : elsewhere
                              ? `${drawn ? "Drawn" : "Pinned"} on ${planLabel(chosen.planId)}`
                              : drawn
                                ? "Drawn as a room"
                                : "Pinned"}
                        </span>
                      ) : null}
                    </button>

                    {/*
                      The marker sits at the end, with the row's other
                      controls.

                      Between the tick and the name it split the two halves
                      of one idea — you read a box, then an icon, then the
                      room it belonged to. On the right it lines up down
                      the list, so the placed rooms can be counted in one
                      pass, and the names start at the same x.
                    */}
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-md border [&_svg]:size-3.5",
                        placed
                          ? "border-brand/30 bg-brand-50 text-brand"
                          : "text-muted-foreground bg-muted/50",
                      )}
                      title={
                        drawn ? "Drawn as a room" : placed ? "Pinned" : "Not on the plan"
                      }
                    >
                      {drawn ? <Shapes /> : placed ? <MapPin /> : <Crosshair />}
                    </span>

                    {chosen && canPin && placed ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive size-7 shrink-0"
                        onClick={() => clearPlacement(option.name)}
                        aria-label={`Take ${option.name} off the plan`}
                        title="Take off the plan"
                      >
                        <Eraser className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <Dialog
              open={renaming !== null}
              onOpenChange={(next) => {
                if (!next) setRenaming(null);
              }}
            >
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Rename plan</DialogTitle>
                  <DialogDescription>
                    The name the inspector sees when switching floors, on the
                    job and on the phone.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-1.5">
                  <Label htmlFor="plan-name">Name</Label>
                  <Input
                    id="plan-name"
                    autoFocus
                    value={renaming?.label ?? ""}
                    onChange={(event) =>
                      setRenaming((current) =>
                        current ? { ...current, label: event.target.value } : current,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && renaming?.label.trim()) {
                        event.preventDefault();
                        rename(renaming.id, renaming.label.trim());
                        setRenaming(null);
                      }
                    }}
                    placeholder="e.g. Ground floor"
                  />
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={!renaming?.label.trim()}
                    onClick={() => {
                      if (!renaming?.label.trim()) return;
                      rename(renaming.id, renaming.label.trim());
                      setRenaming(null);
                    }}
                  >
                    Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog
              open={addOpen}
              onOpenChange={(next) => {
                setAddOpen(next);
                if (!next) setCustom("");
              }}
            >
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Add an area</DialogTitle>
                  <DialogDescription>
                    A room the template for this property type does not carry. It
                    is ticked and made active as soon as you add it, so you can
                    place it on the plan straight away.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-1.5">
                  <Label htmlFor="new-area-name">Name</Label>
                  <Input
                    id="new-area-name"
                    autoFocus
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addCustom();
                      }
                    }}
                    placeholder="e.g. Roof terrace"
                  />
                  {duplicateArea ? (
                    <p className="text-destructive text-xs">
                      “{custom.trim()}” is already in the list.
                    </p>
                  ) : null}
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={addCustom}
                    disabled={!custom.trim() || duplicateArea}
                  >
                    <Plus className="size-4" /> Add area
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The pricing decisions a coordinator makes when raising a quotation.
 *
 * FURNISHED is the client's declaration, recorded per quotation rather
 * than per unit: the same property is let furnished to one client and
 * empty to the next, and the rate follows what is being inspected on the
 * day. Commercial is a flat rate either way, so the question is not asked
 * there.
 *
 * OUT OF HOURS is when the visit happens: outside working hours the card
 * adds a percentage of the service total, as its own line. It is the
 * coordinator's call rather than something read off the appointment time
 * (F17), and it applies to every property type, commercial included.
 *
 * THE RATE is a person's choice inside the published band. The size rule
 * still proposes a figure — smaller properties toward the top of the
 * range — but it is a suggestion, and the quotation records who took it.
 * Leaving the band is allowed, needs a reason, and cannot be sent to a
 * client until an admin approves it.
 */
function QuotePricingBlock({
  draft,
  set,
  pricing,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  pricing: SnaggingPricingConfig | null;
}) {
  const isCommercial = draft.property_type === "commercial";
  const row = pricing?.rate_card?.types?.[draft.property_type] ?? null;
  const area = Number(draft.built_up_area) || 0;

  /*
    The same rule the server applies, so the figure on screen is the one
    that will be charged. Imported rather than reimplemented — two copies
    of a pricing rule is two answers.
  */
  const suggested = row
    ? draft.furnished
      ? row.furnished
      : pickRateForSize(row.unfurnished_min, row.unfurnished_max, area)
    : null;

  const band = row && !draft.furnished
    ? { min: row.unfurnished_min, max: row.unfurnished_max }
    : null;

  /*
    External areas are a second, separate decision (FR-2.07).

    Only asked where they are actually charged: a villa or townhouse, in
    scope, with a plot larger than the building. Anywhere else there is no
    line to price and the question would be noise.
  */
  const plot = Number(draft.plot_area) || 0;
  const hasExternal =
    (draft.property_type === "villa" || draft.property_type === "townhouse") &&
    draft.external_areas_in_scope &&
    plot > area;
  const externalArea = hasExternal ? plot - area : 0;
  const externalBand = pricing?.rate_card
    ? { min: pricing.rate_card.external_min, max: pricing.rate_card.external_max }
    : null;
  const externalSuggested =
    hasExternal && externalBand
      ? pickRateForSize(externalBand.min, externalBand.max, externalArea)
      : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {/* The declaration. Not asked on commercial, which is flat. */}
        {!isCommercial ? (
          <OptionCard
            checked={draft.furnished}
            onChange={(v) => {
              set("furnished", v);
              /*
                The band changes with it, so a rate typed against the old
                one is no longer the number the coordinator meant.
                Furnished is a single published rate, with nothing to
                choose at all.
              */
              set("rate_per_sqft", "");
            }}
            title="Furnished"
            description="The client declares the property is furnished, so it is charged at the furnished rate. If the inspector finds otherwise on site, the quotation is void and a revised one is needed."
          />
        ) : null}

        <OptionCard
          checked={draft.out_of_hours}
          onChange={(v) => set("out_of_hours", v)}
          title="Out of hours"
          description={
            pricing
              ? `Adds the ${pricing.out_of_hours_percent}% out-of-hours surcharge to the service total, before VAT, as its own line on the quotation.`
              : "Adds the out-of-hours surcharge to the service total, before VAT, as its own line on the quotation."
          }
        />
      </div>

      {row ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <RateField
            label="Rate per sq ft"
            band={band}
            suggested={suggested}
            value={draft.rate_per_sqft}
            onChange={(v) => set("rate_per_sqft", v)}
            fixedNote={
              draft.furnished
                ? "Furnished is one published rate, so there is nothing to choose."
                : "The card publishes one rate for this property type."
            }
            hint={band ? `Between ${band.min} and ${band.max}.` : undefined}
          />

          {hasExternal ? (
            <RateField
              label="External areas, per sq ft"
              band={externalBand}
              suggested={externalSuggested}
              value={draft.external_rate_per_sqft}
              onChange={(v) => set("external_rate_per_sqft", v)}
              hint={
                externalBand
                  ? `Between ${externalBand.min} and ${externalBand.max}. Suggested ${externalSuggested} for ${externalArea.toLocaleString()} sq ft of plot.`
                  : undefined
              }
            />
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          {pricing
            ? "The rate card has no row for this property type, so the server will price it."
            : "Loading the rate card…"}
        </p>
      )}
    </div>
  );
}

/** One nudge of the arrow keys, and the rounding that keeps it clean. */
const RATE_STEP = 0.05;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Could this half-typed string still grow into the band?
 *
 * A keystroke has to be judged on what it might become, not on what it
 * is: on the way to "1.3" you must be allowed to type "1", which on its
 * own sits below a 1.2 minimum. So the partial string is read as the
 * range of numbers that start with it — "1" covers [1, 2), "1.3" covers
 * [1.3, 1.4) — and the keystroke is accepted only if that range still
 * touches the band.
 *
 * "2" covers [2, 3) and touches nothing in 1.2–1.4, so it never lands in
 * the field at all.
 */
function canReachBand(partial: string, band: { min: number; max: number }) {
  if (partial === "") return true;
  if (!/^\d*\.?\d*$/.test(partial)) return false;
  const lower = Number(partial === "." ? "0" : partial);
  if (!Number.isFinite(lower)) return false;
  const dot = partial.indexOf(".");
  // Appending digits can only move the value up, and never past the next
  // unit (no decimal point yet) or the next place (one already typed).
  const span = dot === -1 ? 1 : Math.pow(10, -(partial.length - dot - 1));
  /*
    A tolerance, because the arithmetic is binary floating point: 1.1
    plus one place is 1.2000000000000002, and without it that lands
    just inside a 1.2 minimum and lets a dead prefix through while
    the longer "1.19" is refused.
  */
  const EPS = 1e-9;
  return lower <= band.max + EPS && lower + span > band.min + EPS;
}

/**
 * One rate on the card, as either a fact or a bounded choice.
 *
 * Where the card publishes a SINGLE figure — the furnished rate, a
 * commercial flat rate, or a band whose two ends are equal — there is
 * nothing to decide, so it is shown rather than typed. Asking somebody
 * to key in a number the system already knows invites a typo into the
 * one field that decides what a client pays.
 *
 * Where it publishes a BAND, the field cannot leave it. A keystroke that
 * could never land inside the range is not accepted, the arrow keys stop
 * at each end, and a value left short of the band on blur is clamped
 * into it. There is no way to price outside the card from here.
 */
function RateField({
  label,
  band,
  suggested,
  value,
  onChange,
  fixedNote,
  hint,
}: {
  label: string;
  /** Null when the card publishes one figure rather than a range. */
  band: { min: number; max: number } | null;
  suggested: number | null;
  value: string;
  onChange: (value: string) => void;
  fixedNote?: string;
  hint?: string;
}) {
  const fixed = band === null || band.min === band.max;

  if (fixed) {
    return (
      <Field label={label} hint={fixedNote}>
        <div className="bg-muted/50 text-muted-foreground flex h-9 items-center rounded-md border px-3 text-sm">
          <span className="text-foreground font-medium tabular-nums">
            {suggested ?? "—"}
          </span>
          <span className="ml-2 text-xs">per sq ft · published rate</span>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} hint={hint}>
      {/*
        Deliberately a text field rather than type="number": a number
        input reports a half-typed "1." as an empty string, which makes
        it impossible to judge a keystroke on what it is becoming. The
        bounds are enforced here instead, and the arrow keys are wired
        back up below so the field still nudges.
      */}
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={suggested != null ? String(suggested) : ""}
        onChange={(e) => {
          const next = e.target.value;
          if (!/^\d*\.?\d*$/.test(next)) return;
          // A value that can never reach the band is refused outright,
          // so it never appears in the field at all.
          if (!canReachBand(next, band)) return;
          onChange(next);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const current = Number(value);
          const from =
            value.trim() !== "" && Number.isFinite(current)
              ? current
              : (suggested ?? band.min);
          const next = round2(
            from + (e.key === "ArrowUp" ? RATE_STEP : -RATE_STEP),
          );
          onChange(String(Math.min(band.max, Math.max(band.min, next))));
        }}
        onBlur={(e) => {
          // "1" can still reach the band while you are typing, but on
          // the way out it is just a number below the minimum, so it is
          // clamped rather than left sitting there out of range.
          const trimmed = e.target.value.trim().replace(/\.$/, "");
          if (trimmed === "") return;
          const n = Number(trimmed);
          if (!Number.isFinite(n)) return;
          const held = Math.min(band.max, Math.max(band.min, n));
          if (String(held) !== e.target.value) onChange(String(held));
        }}
      />
    </Field>
  );
}

function AssignStep({
  draft,
  set,
  users,
  usersLoading,
  usersError,
  retryUsers,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  users: User[];
  usersLoading: boolean;
  usersError: string | null;
  retryUsers: () => void;
}) {
  const scheduled = draft.appointment_date ? parseISO(draft.appointment_date) : undefined;
  const now = nowLocal();
  // Only today's times need a floor; every later day is open from 00:00.
  const earliestTime = draft.appointment_date === now.date ? now.time : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl">Schedule and site contacts</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          When the inspection happens and who gives access. The inspector is assigned from the job
          once the client approves the quotation; you can pre-select the approval manager here.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Approval manager">
          {usersError ? (
            <ErrorState
              title="Could not load the manager list"
              message={usersError}
              onRetry={retryUsers}
              retrying={usersLoading}
            />
          ) : (
            <Select
              value={draft.approval_manager_id}
              onValueChange={(value) => set("approval_manager_id", value)}
              disabled={usersLoading}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={usersLoading ? "Loading people…" : "Who signs this off?"}
                />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.full_name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Appointment date">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !scheduled && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-2 size-4" />
                {scheduled ? format(scheduled, "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={scheduled}
                // Yesterday is never a valid appointment, so it is not
                // offered — refusing it after the click would be worse.
                disabled={{ before: parseISO(now.date) }}
                onSelect={(date) => set("appointment_date", date ? format(date, "yyyy-MM-dd") : "")}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        </Field>

        <Field label="Appointment time">
          {/* The design-system picker rather than <input type="time">,
              whose popup is drawn by the browser and matched nothing
              else on the form. Steps in 30 minutes, in step with how
              the scheduling board books; an off-step time already on a
              record stays selectable. */}
          <TimeSelect
            value={draft.appointment_time}
            onChange={(value) => set("appointment_time", value)}
            min={earliestTime}
            placeholder="Select a time"
            aria-label="Appointment time"
          />
          {earliestTime ? (
            <p className="text-muted-foreground mt-1.5 text-xs">
              Today, so {formatTimeAmPm(earliestTime)} at the earliest.
            </p>
          ) : null}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Developer site contact">
          <Input
            value={draft.developer_contact_name}
            onChange={(event) => set("developer_contact_name", event.target.value)}
            placeholder="Who opens the door"
          />
        </Field>
        <Field label="Developer contact phone">
          <PhoneInput
            value={draft.developer_contact_phone}
            onChange={(v) => set("developer_contact_phone", v)}
          />
        </Field>
        <Field label="Client site contact">
          <Input
            value={draft.client_contact_name}
            onChange={(event) => set("client_contact_name", event.target.value)}
            placeholder="Client or their agent"
          />
        </Field>
        <Field label="Client contact phone">
          <PhoneInput
            value={draft.client_contact_phone}
            onChange={(v) => set("client_contact_phone", v)}
          />
        </Field>
      </div>

      {/* {draft.noc_required ? (
        <p className="bg-warning/10 text-warning rounded-md px-3 py-2 text-sm">
          This job needs an NOC / authorization letter.{" "}
          {draft.noc_path
            ? "It is on file."
            : "It is not on file yet. Add it on the property step."}
        </p>
      ) : null} */}
    </div>
  );
}

/** Reads an image's pixel dimensions so pins can resolve to pixels later. */
function readDimensions(
  file: File,
  url: string,
): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/")) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
