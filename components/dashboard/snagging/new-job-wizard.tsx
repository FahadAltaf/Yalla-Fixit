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

import { compressImage, readImageSize } from "@/lib/media/compress-image";
import {
  zoneLabelPoint,
  type ZonePoint,
} from "@/lib/snagging/zone-geometry";
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
import { snaggingService, type SnaggingClientOption } from "@/modules/snagging";
import { usersService } from "@/modules/users/services/users-service";
import { suggestedFor, templateFor } from "@/lib/snagging/area-templates";
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
  Appointments are written in GST (+04:00 — see submit), so "is this in the
  past" has to be asked in GST too. Reading the browser's own clock would
  let a coordinator on another machine's timezone either book a slot that
  has already gone or be refused one that has not.
*/
function gstNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const at = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${at("year")}-${at("month")}-${at("day")}`,
    time: `${at("hour")}:${at("minute")}`,
  };
}

/** The instant an appointment names, or null when it is not fully set. */
function appointmentAtGst(date: string, time: string) {
  if (!date || !time) return null;
  const at = new Date(`${date}T${time}:00+04:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/*
  The first slot worth offering: tomorrow at the start of the working day.

  Today is not offered by default because an inspection needs the door
  opened by somebody who has been told about it, and 09:00 is where YFI's
  standard hours start — the same window the quotation's terms quote.
*/
function defaultAppointment() {
  return {
    date: format(addDays(parseISO(gstNow().date), 1), "yyyy-MM-dd"),
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
}: {
  /** "quote" stops after the property step and writes a quotation. */
  mode?: "job" | "quote";
} = {}) {
  const quoteOnly = mode === "quote";
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
  const [quotationLoading, setQuotationLoading] = useState(Boolean(quotationId));
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
    appointment_date: defaultAppointment().date,
    appointment_time: defaultAppointment().time,
    developer_contact_name: "",
    developer_contact_phone: "",
    client_contact_name: "",
    client_contact_phone: "",
    notes: "",
    areas: suggestedFor("apartment", 2),
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

        const snap = (quote.property_snapshot ?? {}) as Record<string, unknown>;
        const text = (value: unknown) => (value == null ? "" : String(value));

        setDraft((current) => ({
          ...current,
          client_id: text(quote.client_id),
          property_id: text(quote.property_id),
          client_name: text(snap.client_name),
          client_email: text(snap.client_email),
          client_phone: text(snap.client_phone),
          unit_label: text(snap.unit_label),
          building_name: text(snap.building_name),
          community: text(snap.community),
          developer_name: text(snap.developer_name),
          property_type:
            (snap.property_type as SnaggingPropertyType) ?? current.property_type,
          bedrooms:
            typeof snap.bedrooms === "number" ? snap.bedrooms : current.bedrooms,
          built_up_area: text(snap.built_up_area_sqft),
          areas: areasTouched.current
            ? current.areas
            : suggestedFor(
              (snap.property_type as SnaggingPropertyType) ?? current.property_type,
              typeof snap.bedrooms === "number" ? snap.bedrooms : current.bedrooms,
            ),
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
      areas: areasTouched.current ? current.areas : suggestedFor(value, current.bedrooms),
    }));
  }

  function setBedrooms(value: number) {
    setDraft((current) => ({
      ...current,
      bedrooms: value,
      areas: areasTouched.current ? current.areas : suggestedFor(current.property_type, value),
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
      areas: areasTouched.current ? current.areas : suggestedFor(type, prop?.bedrooms ?? current.bedrooms),
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
        const at = appointmentAtGst(draft.appointment_date, draft.appointment_time);
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
        const quote = await snaggingService.createQuotation({
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
        });
        toast.success(`Quotation ${quote.quote_number} created`);
        router.push(`/snagging/quotations/${quote.id}`);
        return;
      }

      // Combine appointment date + time into one instant (GST) when set.
      const appointmentAt = draft.appointment_date
        ? `${draft.appointment_date}T${draft.appointment_time || "09:00"}:00+04:00`
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
        The pins placed while the job was being created (BA change 5).

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
      <PageHeading
        eyebrow={quoteOnly ? "Sales" : "Work"}
        title={quoteOnly ? "New quotation" : "New job"}
        description={
          quoteOnly
            ? "Price a client's property. The job is raised once they approve it."
            : quotationLabel
              ? "The client and property come from the approved quotation. Add the plans, areas and contacts."
              : "Three steps to a reference pack an inspector can pull before losing signal."
        }
      />

      {/*
        Raised from a quotation (BA v2, change 3). Named, not implied — the
        coordinator needs to see WHICH agreement this job is being built
        against before they commit an inspector to it.
      */}
      {quotationLoading ? (
        <Alert>
          <Loader2 className="animate-spin" />
          <AlertTitle>Loading the quotation…</AlertTitle>
        </Alert>
      ) : quotationError ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>That quotation cannot be used</AlertTitle>
          <AlertDescription>
            {quotationError} Start the job from scratch, or go back to
            Quotations and pick another.
          </AlertDescription>
        </Alert>
      ) : quotationLabel ? (
        <Alert>
          <FileText />
          <AlertTitle>Raising the job for quotation {quotationLabel}</AlertTitle>
          <AlertDescription>
            The client and property were agreed on that quotation and are
            carried over. Changing them here would put the job out of step
            with what the client approved.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="gap-0 p-0">
        <div className="p-6">
          {STEPS[step].key === "property" ? (
            <PropertyStep
              draft={draft}
              set={set}
              setPropertyType={setPropertyType}
              setBedrooms={setBedrooms}
              applyProperty={applyProperty}
              titleDeedFile={titleDeedFile}
              setTitleDeedFile={setTitleDeedFile}
              nocFile={nocFile}
              setNocFile={setNocFile}
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

        <div className="flex items-start justify-between gap-4 border-t px-6 py-4">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">
              {STEPS[step].key === "plan_areas"
                ? `${draft.areas.length} area${draft.areas.length === 1 ? "" : "s"} selected, ${draft.areas.filter((a) => a.pinX != null).length
                } pinned. Pinning is optional.`
                : quoteOnly
                  ? "The client and the property are all a quotation needs."
                  : "Required fields are marked."}
            </p>
            {/* A greyed-out Continue used to explain nothing; the first
                unmet rule is named here, and again under its own field. */}
            {blockers.map((reason) => (
              <p key={reason} className="text-destructive mt-1 text-xs">
                {reason}
              </p>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                step === 0
                  ? router.push(quoteOnly ? "/snagging/quotations" : "/snagging/jobs")
                  : setStep(step - 1)
              }
              disabled={submitting}
            >
              Back
            </Button>
            {isLast ? (
              <SubmitButton
                onClick={() => void submit()}
                disabled={!stepValid}
                pending={submitting}
                pendingLabel="Creating…"
              >
                {quoteOnly ? "Create quotation" : "Create job"}
              </SubmitButton>
            ) : (
              <Button onClick={() => setStep(step + 1)} disabled={!stepValid}>
                Continue
              </Button>
            )}
          </div>
        </div>
      </Card>
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
        {hint ? <span className="text-muted-foreground font-normal"> {hint}</span> : null}
      </Label>
      {children}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
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
  const [loading, setLoading] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    snaggingService
      .searchClients()
      .then((rows) => active && setClients(rows))
      .catch(() => undefined)
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients.slice(0, 8);
    return clients
      .filter(
        (c) =>
          c.client_name.toLowerCase().includes(term) ||
          (c.client_email ?? "").toLowerCase().includes(term),
      )
      .slice(0, 8);
  }, [clients, search]);

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
          <Field label="Phone" required hint="any country">
            <PhoneInput value={phone} onChange={setPhone} />
          </Field>
          <Field label="Email" hint="(optional)">
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

/** A compact optional-document picker (PDF or image). */
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
  return (
    <Field label={label} hint={hint}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={(event) => onPick(event.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="border-border flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <ImageIcon className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <Button type="button" variant="ghost" size="icon" onClick={() => onPick(null)} aria-label="Remove">
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start font-normal"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-2 size-4" /> Choose file
        </Button>
      )}
    </Field>
  );
}

function PropertyStep({
  draft,
  set,
  setPropertyType,
  setBedrooms,
  applyProperty,
  titleDeedFile,
  setTitleDeedFile,
  nocFile,
  setNocFile,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  setPropertyType: (value: SnaggingPropertyType) => void;
  setBedrooms: (value: number) => void;
  applyProperty: (prop: SnaggingProperty | null) => void;
  titleDeedFile: File | null;
  setTitleDeedFile: (file: File | null) => void;
  nocFile: File | null;
  setNocFile: (file: File | null) => void;
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
    <div className="space-y-5">
      <div>
        <h2 className="text-xl">Property and client</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          These details ride with the job into the reference pack, so the inspector sees them
          offline.
        </p>
      </div>

      <Field label="Client" required hint="search on file, or + to add new">
        <ClientPicker draft={draft} set={set} />
      </Field>

      {draft.client_id && propertiesState === "loading" ? (
        <Field label="Property" hint="checking what this client already has">
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
        <Field label="Property" hint="reuse one on file, or start a new one">
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
        <Field label="Property" hint="reuse one on file, or start a new one">
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Unit reference" required>
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

        <Field label="Built up area (sq ft)" required hint="pricing is based on this">
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
        <label className="border-border flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
          <Checkbox
            checked={draft.external_areas_in_scope}
            onCheckedChange={(v) => set("external_areas_in_scope", Boolean(v))}
          />
          <span>External areas (garden, pool, landscaping) are inside the inspection scope</span>
        </label>
      ) : null}

      {/*
        The map is the input. The two number boxes stay underneath
        because a coordinator sometimes has a coordinate from a
        developer and nothing to search for, but nobody should have to
        type one to say where a building is.
      */}
      <div className="space-y-3">
        <p className="text-sm font-medium">
          Location <span className="text-muted-foreground font-normal">(optional pin)</span>
        </p>

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
          <Field label="Latitude" hint="(or paste a lat, lng pair)">
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
      </div>

      <label className="border-border flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
        <Checkbox
          checked={draft.noc_required}
          onCheckedChange={(v) => set("noc_required", Boolean(v))}
        />
        <span>The person requesting the inspection is not the owner, so an NOC or authorization letter is required</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <DocumentField
          label="Title deed"
          hint="(optional, confirms unit and area)"
          file={titleDeedFile}
          onPick={setTitleDeedFile}
        />
        {draft.noc_required ? (
          <DocumentField
            label="NOC / authorization letter"
            hint="(optional, never blocks the job)"
            file={nocFile}
            onPick={setNocFile}
          />
        ) : null}
      </div>

      <Field label="Office notes" hint="(optional)">
        <Textarea
          rows={3}
          value={draft.notes}
          onChange={(event) => set("notes", event.target.value)}
          placeholder="Access, handover date, anything the inspector should know on site"
        />
      </Field>
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
    // A pin cannot outlive the plan it was placed on.
    setAreas(
      areas.map((a) =>
        a.planId === id ? { ...a, planId: null, pinX: undefined, pinY: undefined } : a,
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
                {plans.map((plan) => (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setActivePlanId(plan.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      plan.id === activePlan?.id
                        ? "border-brand bg-brand-50 text-brand"
                        : "border-border hover:bg-mist-soft",
                    )}
                  >
                    {plan.label.trim() || "Untitled plan"}
                  </button>
                ))}
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
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="bg-muted inline-flex rounded-md p-0.5">
                        {(["pin", "zone"] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setPlaceMode(option)}
                            aria-pressed={placeMode === option}
                            className={cn(
                              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                              placeMode === option
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {option === "pin" ? "Drop a pin" : "Draw the room"}
                          </button>
                        ))}
                      </div>
                      {/*
                        Which room the next click lands on, named.

                        The list highlights it too, but the coordinator's
                        eyes are on the plan while they click, and "which
                        room am I placing" is the only question that matters
                        at that moment.
                      */}
                      {activeArea ? (
                        <p className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs">
                          <span className="text-brand font-medium">
                            Placing {activeArea}
                          </span>
                          <span>
                            {placeMode === "pin"
                              ? "— click the plan."
                              : "— click each corner, then Enter to close it. Backspace undoes a corner, Esc starts over."}
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveArea(null)}
                            className="hover:text-foreground underline underline-offset-2"
                          >
                            Done
                          </button>
                        </p>
                      ) : (
                        <p className="text-muted-foreground text-xs">
                          Pick a room in the list to place it on the plan.
                        </p>
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

                  <div className="flex items-center gap-2">
                    <Input
                      value={activePlan.label}
                      onChange={(event) => rename(activePlan.id, event.target.value)}
                      placeholder="e.g. Ground floor"
                      aria-label="Plan name"
                      className="h-8"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(activePlan.id)}
                      aria-label="Remove plan"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
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
                      chosen ? "border-brand/40 bg-brand-50/40" : "border-border",
                      isActive && "ring-brand/60 ring-2",
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
                      <span
                        className={cn("block truncate font-medium", chosen && "text-brand")}
                      >
                        {option.name}
                      </span>
                      {/* Which floor it sits on, said only when that could be
                          a different one from the plan on screen. */}
                      {elsewhere ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          on {planLabel(chosen.planId)}
                        </span>
                      ) : null}
                    </button>

                    {chosen && canPin ? (
                      <div className="flex shrink-0 items-center gap-0.5">
                        {/*
                          The room's state, as the control that changes it: a
                          marker when it is placed, a target when it is not.
                          Either way, clicking selects it for the plan.
                        */}
                        <button
                          type="button"
                          onClick={() => select(option.name)}
                          aria-label={
                            placed
                              ? `${option.name} is on the plan. Select it to place it again.`
                              : `Place ${option.name} on the plan`
                          }
                          title={
                            placed
                              ? drawn
                                ? "Drawn as a room. Select to place again."
                                : "Pinned. Select to place again."
                              : "Place on the plan"
                          }
                          className={cn(
                            "hover:bg-brand/10 rounded p-1 transition-colors",
                            placed ? "text-brand" : "text-muted-foreground",
                          )}
                        >
                          {drawn ? (
                            <Shapes className="size-3.5" />
                          ) : placed ? (
                            <MapPin className="size-3.5" />
                          ) : (
                            <Crosshair className="size-3.5" />
                          )}
                        </button>

                        {placed ? (
                          <button
                            type="button"
                            onClick={() => clearPlacement(option.name)}
                            aria-label={`Take ${option.name} off the plan`}
                            title="Take off the plan"
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded p-1 transition-colors"
                          >
                            <Eraser className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

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
  const now = gstNow();
  // Only today's times need a floor; every later day is open from 00:00.
  const earliestTime = draft.appointment_date === now.date ? now.time : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl">Schedule and site contacts</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          When the inspection happens and who gives access. The inspector is assigned from the job
          once the client approves the quotation (FR-3.08); you can pre-select the approval manager here.
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
