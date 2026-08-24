"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarIcon,
  Check,
  ChevronDown,
  ImageIcon,
  LayoutGrid,
  MapPin,
  Plus,
  Search,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

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
import type { SnaggingProperty, SnaggingPropertyType, User } from "@/types/types";

import { PROPERTY_TYPE_LABELS, PageHeading } from "./shared";

/**
 * The new-job wizard.
 *
 * Four steps, because the reference pack an inspector pulls has four
 * parts: the property it is for, the plans they pin against, the rooms
 * they walk, and who is assigned. Each step validates before it lets
 * you move on, so a job cannot reach the field half-built.
 */

type AreaChoice = { name: string; code: string | null };
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

const STEPS = [
  { key: "property", label: "Property", icon: MapPin },
  { key: "floorplans", label: "Floor plans", icon: LayoutGrid },
  { key: "areas", label: "Areas", icon: LayoutGrid },
  { key: "assign", label: "Assign", icon: Users },
] as const;

/**
 * Rooms each property-type template seeds, with the catalogue area code
 * each draws its defect list from. The code rides with the area so the
 * inspector's capture sheet offers the right elements in each room.
 */
/**
 * Builds the starting room list from the property type and bedroom count.
 * The area list is only a starting point; the coordinator edits it and the
 * inspector can add rooms on site (Action Point H1).
 */
function templateFor(type: SnaggingPropertyType, bedrooms: number | null): AreaChoice[] {
  const rooms: AreaChoice[] = [];
  const add = (name: string, code: string) => rooms.push({ name, code });

  if (type === "commercial") {
    add("Reception", "ENT");
    add("Open office", "LIV");
    add("Meeting room", "DIN");
    add("Pantry", "KIT");
    add("Guest WC", "WC");
    add("Storage", "STO");
    add("Corridor", "COR");
    return rooms;
  }

  const bed = bedrooms ?? 0;
  add("Entrance", "ENT");
  add(bed === 0 ? "Living / sleeping area" : "Living room", "LIV");
  if (bed >= 2) add("Dining room", "DIN");
  if (bed >= 4) add("Family room", "FAM");
  add("Kitchen", "KIT");

  if (bed === 0) {
    add("Bathroom", "BTH");
  } else {
    add("Master bedroom", "MBR");
    add("Master bathroom", "MBA");
    for (let i = 2; i <= bed; i += 1) {
      add(`Bedroom ${i}`, "BED");
      add(`Bathroom ${i}`, "BTH");
    }
    add("Guest WC", "WC");
  }

  add("Laundry", "LDY");
  if (bed >= 2) add("Store", "STO");

  if (type === "villa" || type === "townhouse") {
    add("Staircase", "STA");
    if (bed >= 3) add("Maid room", "MRM");
    add("Terrace", "TER");
    add("Garden", "GDN");
    add("Garage", "GAR");
    if (type === "villa") add("Roof", "ROF");
  } else {
    add("Balcony", "BAL");
  }

  return rooms;
}

export default function NewJobWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
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
    appointment_date: "",
    appointment_time: "",
    developer_contact_name: "",
    developer_contact_phone: "",
    client_contact_name: "",
    client_contact_phone: "",
    notes: "",
    areas: templateFor("apartment", 2),
    technician_ids: [],
    approval_manager_id: "",
  });

  // Tracks whether the inspector list was hand-edited, so re-picking a
  // property type does not wipe a custom room set the user built.
  const areasTouched = useRef(false);

  useEffect(() => {
    usersService
      .getUsers()
      .then((rows: User[]) => setUsers(rows.filter((row) => row.is_active !== false)))
      .catch(() => toast.error("Could not load the staff list"));
  }, []);


  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  // Changing the property type or bedroom count reseeds the room list,
  // unless the user has already customised it.
  function setPropertyType(value: SnaggingPropertyType) {
    setDraft((current) => ({
      ...current,
      property_type: value,
      areas: areasTouched.current ? current.areas : templateFor(value, current.bedrooms),
    }));
  }

  function setBedrooms(value: number) {
    setDraft((current) => ({
      ...current,
      bedrooms: value,
      areas: areasTouched.current ? current.areas : templateFor(current.property_type, value),
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
      areas: areasTouched.current ? current.areas : templateFor(type, prop?.bedrooms ?? current.bedrooms),
    }));
  }

  const stepValid = useMemo(() => {
    switch (STEPS[step].key) {
      case "property":
        // Client name + phone (D1), a unit, and built up area (E3) are the
        // minimum a job and its quotation depend on.
        return (
          draft.client_name.trim().length >= 2 &&
          draft.client_phone.trim().length >= 5 &&
          draft.unit_label.trim().length > 0 &&
          Number(draft.built_up_area) > 0
        );
      case "floorplans":
        // Floor plans are optional; the plan can be added from the job later.
        return true;
      case "areas":
        return draft.areas.length > 0;
      case "assign":
        // An inspector and an approval manager are both required (I1).
        return draft.technician_ids.length > 0 && draft.approval_manager_id.trim().length > 0;
      default:
        return true;
    }
  }, [step, draft]);

  async function submit() {
    setSubmitting(true);
    try {
      // Combine appointment date + time into one instant (GST) when set.
      const appointmentAt = draft.appointment_date
        ? `${draft.appointment_date}T${draft.appointment_time || "09:00"}:00+04:00`
        : undefined;
      const num = (v: string) => (v.trim() && Number(v) ? Number(v) : undefined);

      const created = await snaggingService.createTask({
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
        technician_ids: draft.technician_ids,
        approval_manager_id: draft.approval_manager_id || null,
        notes: draft.notes,
      });

      // Plans upload after the task exists, so each attaches to it. A
      // failed plan does not lose the job — it is reported and the job
      // still opens, where the plan can be re-added.
      let planFailures = 0;
      for (const plan of plans) {
        try {
          await snaggingService.uploadFloorPlan(created.id, plan.file, {
            label: plan.label,
            width: plan.width,
            height: plan.height,
          });
        } catch {
          planFailures += 1;
        }
      }

      if (planFailures > 0) {
        toast.warning(`${planFailures} floor plan(s) did not upload. Add them from the job.`);
      }

      // Title deed (E8) and NOC (E10) upload after the job exists, and never
      // block it — a failure is reported and the job still opens.
      if (titleDeedFile) {
        try {
          await snaggingService.uploadDocument(created.id, titleDeedFile, "title_deed");
        } catch {
          toast.warning("The title deed did not upload. Add it from the job.");
        }
      }
      if (nocFile) {
        try {
          await snaggingService.uploadDocument(created.id, nocFile, "noc");
        } catch {
          toast.warning("The NOC did not upload. Add it from the job.");
        }
      }

      toast.success(`Job ${created.code} created`);
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
        eyebrow="Work"
        title="New job"
        description="Four steps to a reference pack an inspector can pull before losing signal."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STEPS.map((entry, index) => {
          const done = index < step;
          const current = index === step;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => index <= step && setStep(index)}
              disabled={index > step}
              className="text-left"
            >
              <div
                className={cn(
                  "h-1 rounded-full transition-colors",
                  done ? "bg-brand" : current ? "bg-brand/40" : "bg-mist",
                )}
              />
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                    done
                      ? "bg-brand text-white"
                      : current
                        ? "border-brand text-brand border"
                        : "border-border text-muted-foreground border",
                  )}
                >
                  {done ? <Check className="size-3" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "text-sm font-medium",
                    current ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {entry.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>

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
          ) : STEPS[step].key === "floorplans" ? (
            <FloorPlansStep plans={plans} setPlans={setPlans} />
          ) : STEPS[step].key === "areas" ? (
            <AreasStep
              propertyType={draft.property_type}
              bedrooms={draft.bedrooms}
              areas={draft.areas}
              setAreas={setAreas}
            />
          ) : (
            <AssignStep draft={draft} set={set} users={users} />
          )}
        </div>

        <div className="flex items-center justify-between border-t px-6 py-4">
          <p className="text-muted-foreground text-xs">
            {STEPS[step].key === "areas"
              ? `${draft.areas.length} area${draft.areas.length === 1 ? "" : "s"} selected.`
              : STEPS[step].key === "floorplans"
                ? "Floor plans are optional and can be added from the job later."
                : "Required fields are marked."}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => (step === 0 ? router.push("/snagging/jobs") : setStep(step - 1))}
              disabled={submitting}
            >
              Back
            </Button>
            {isLast ? (
              <Button onClick={() => void submit()} disabled={!stepValid || submitting}>
                {submitting ? "Creating…" : "Create job"}
              </Button>
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
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
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
            <Input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+971 50 000 0000"
            />
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

  // The client's properties on file, so an existing one can be reused (BR-1).
  const [clientProperties, setClientProperties] = useState<SnaggingProperty[]>([]);
  useEffect(() => {
    if (!draft.client_id) {
      setClientProperties([]);
      return;
    }
    let active = true;
    snaggingService
      .listProperties(draft.client_id)
      .then((rows) => active && setClientProperties(rows))
      .catch(() => active && setClientProperties([]));
    return () => {
      active = false;
    };
  }, [draft.client_id]);

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

      {draft.client_id && clientProperties.length > 0 ? (
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
              <SelectItem value="new">+ New property</SelectItem>
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Location latitude" hint="(optional pin)">
          <Input
            type="number"
            inputMode="decimal"
            value={draft.location_lat}
            onChange={(event) => set("location_lat", event.target.value)}
            placeholder="e.g. 25.0772"
          />
        </Field>
        <Field label="Location longitude" hint="(optional pin)">
          <Input
            type="number"
            inputMode="decimal"
            value={draft.location_lng}
            onChange={(event) => set("location_lng", event.target.value)}
            placeholder="e.g. 55.1345"
          />
        </Field>
      </div>

      <label className="border-border flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
        <Checkbox
          checked={draft.noc_required}
          onCheckedChange={(v) => set("noc_required", Boolean(v))}
        />
        <span>The person requesting the inspection is not the owner — an NOC / authorization letter is required</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <DocumentField
          label="Title deed"
          hint="(optional — confirms unit and area)"
          file={titleDeedFile}
          onPick={setTitleDeedFile}
        />
        {draft.noc_required ? (
          <DocumentField
            label="NOC / authorization letter"
            hint="(optional — never blocks the job)"
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

function FloorPlansStep({
  plans,
  setPlans,
}: {
  plans: PendingPlan[];
  setPlans: React.Dispatch<React.SetStateAction<PendingPlan[]>>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const next: PendingPlan[] = [];

    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      const dims = await readDimensions(file, url);
      next.push({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        label: file.name.replace(/\.[^.]+$/, ""),
        width: dims?.width,
        height: dims?.height,
        url,
      });
    }

    setPlans((current) => [...current, ...next]);
  }

  function remove(id: string) {
    setPlans((current) => {
      const target = current.find((plan) => plan.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((plan) => plan.id !== id);
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl">Floor plans</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Plans let the inspector pin each snag to a coordinate. They download with the pack for
          offline use. Optional — you can add them from the job later.
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

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="border-border hover:border-brand/40 hover:bg-mist-soft/50 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors"
      >
        <Upload className="text-muted-foreground size-6" />
        <span className="font-medium">Add a plan image</span>
        <span className="text-muted-foreground text-sm">PNG, JPG, WEBP or PDF · up to 15MB</span>
      </button>

      {plans.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {plans.map((plan) => (
            <li
              key={plan.id}
              className="border-border flex items-center gap-3 rounded-lg border p-2"
            >
              <span className="bg-mist-soft flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md">
                {plan.file.type.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={plan.url} alt="" className="size-full object-cover" />
                ) : (
                  <ImageIcon className="text-muted-foreground size-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{plan.label}</p>
                <p className="text-muted-foreground text-xs">
                  {plan.width && plan.height
                    ? `${plan.width}×${plan.height}px`
                    : "PDF"}{" "}
                  · {(plan.file.size / 1024 / 1024).toFixed(1)}MB
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => remove(plan.id)} aria-label="Remove">
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AreasStep({
  propertyType,
  bedrooms,
  areas,
  setAreas,
}: {
  propertyType: SnaggingPropertyType;
  bedrooms: number;
  areas: AreaChoice[];
  setAreas: (next: AreaChoice[]) => void;
}) {
  const [custom, setCustom] = useState("");

  // The full option list is the template for this property type, plus
  // any custom rooms already added, so ticking and unticking never
  // loses a room the user typed.
  const options = useMemo(() => {
    const template = templateFor(propertyType, bedrooms);
    const templateNames = new Set(template.map((a) => a.name.toLowerCase()));
    const extras = areas.filter((a) => !templateNames.has(a.name.toLowerCase()));
    return [...template, ...extras];
  }, [propertyType, bedrooms, areas]);

  const selectedNames = useMemo(
    () => new Set(areas.map((a) => a.name.toLowerCase())),
    [areas],
  );

  function toggle(option: AreaChoice) {
    const key = option.name.toLowerCase();
    if (selectedNames.has(key)) {
      setAreas(areas.filter((a) => a.name.toLowerCase() !== key));
    } else {
      setAreas([...areas, option]);
    }
  }

  function addCustom() {
    const name = custom.trim();
    if (!name) return;
    if (selectedNames.has(name.toLowerCase())) {
      setCustom("");
      return;
    }
    // A custom room carries no catalogue code; the capture sheet falls
    // back to the whole catalogue there.
    setAreas([...areas, { name, code: null }]);
    setCustom("");
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl">Areas to inspect</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Each area becomes a room the inspector confirms on site. Tick the rooms this job needs,
          and add any the template does not list.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => {
          const checked = selectedNames.has(option.name.toLowerCase());
          return (
            <label
              key={option.name}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                checked
                  ? "border-brand bg-brand-50/60"
                  : "border-border hover:bg-mist-soft",
              )}
            >
              <Checkbox checked={checked} onCheckedChange={() => toggle(option)} />
              <span className={cn("font-medium", checked && "text-brand")}>{option.name}</span>
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <Field label="Add a custom area">
            <Input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustom();
                }
              }}
              placeholder="e.g. Roof terrace, Plant room"
            />
          </Field>
        </div>
        <Button type="button" variant="outline" onClick={addCustom} disabled={!custom.trim()}>
          <Plus className="size-4" />
          Add area
        </Button>
      </div>
    </div>
  );
}

function AssignStep({
  draft,
  set,
  users,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  users: User[];
}) {
  const scheduled = draft.appointment_date ? parseISO(draft.appointment_date) : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl">Assign and schedule</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Who walks the unit, who signs it off, when, and who gives access. The job appears on the
          inspector&apos;s phone as soon as it is created.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Inspector" required>
          <Select
            value={draft.technician_ids[0] ?? ""}
            onValueChange={(value) => set("technician_ids", value ? [value] : [])}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Assign an inspector" />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.full_name || user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Approval manager" required>
          <Select
            value={draft.approval_manager_id}
            onValueChange={(value) => set("approval_manager_id", value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Who signs this off?" />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.full_name || user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                onSelect={(date) => set("appointment_date", date ? format(date, "yyyy-MM-dd") : "")}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        </Field>

        <Field label="Appointment time">
          <Input
            type="time"
            value={draft.appointment_time}
            onChange={(event) => set("appointment_time", event.target.value)}
          />
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
          <Input
            type="tel"
            inputMode="tel"
            value={draft.developer_contact_phone}
            onChange={(event) => set("developer_contact_phone", event.target.value)}
            placeholder="+971 50 000 0000"
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
          <Input
            type="tel"
            inputMode="tel"
            value={draft.client_contact_phone}
            onChange={(event) => set("client_contact_phone", event.target.value)}
            placeholder="+971 50 000 0000"
          />
        </Field>
      </div>

      {draft.noc_required ? (
        <p className="bg-warning/10 text-warning rounded-md px-3 py-2 text-sm">
          This job needs an NOC / authorization letter.{" "}
          {draft.noc_path ? "It is on file." : "It is not on file yet — add it on the property step."}
        </p>
      ) : null}
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
