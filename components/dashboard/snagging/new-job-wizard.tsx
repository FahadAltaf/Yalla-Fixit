"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LayoutGrid, MapPin, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MultipleSelector, { type Option } from "@/components/ui/multiselect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { snaggingService } from "@/modules/snagging";
import { usersService } from "@/modules/users/services/users-service";
import type { SnaggingPropertyType, User } from "@/types/types";

import { PROPERTY_TYPE_LABELS, PageHeading } from "./shared";

/**
 * The new-job wizard.
 *
 * Four steps, because the reference pack an inspector pulls has four
 * parts: the property it is for, the plans they pin against, the rooms
 * they walk, and who is assigned. The stepper is honest about where you
 * are; each step validates before it lets you move on, so a job cannot
 * reach the field half-built.
 */

type Draft = {
  unit_label: string;
  building_name: string;
  client_name: string;
  community: string;
  developer_name: string;
  task_type: "single_unit" | "full_building";
  property_type: SnaggingPropertyType;
  scheduled_date: string;
  notes: string;
  technician_ids: string[];
  approval_manager_id: string;
};

const STEPS = [
  { key: "property", label: "Property", icon: MapPin },
  { key: "floorplans", label: "Floor plans", icon: LayoutGrid },
  { key: "areas", label: "Areas", icon: LayoutGrid },
  { key: "assign", label: "Assign", icon: Users },
] as const;

/** Rooms the property-type template seeds, shown as a preview in step 3. */
const TEMPLATE_PREVIEW: Record<SnaggingPropertyType, string[]> = {
  studio: ["Entrance", "Living / sleeping area", "Kitchen", "Bathroom", "Balcony"],
  "1br": ["Entrance", "Living room", "Kitchen", "Master bedroom", "Master bathroom", "Guest WC", "Laundry", "Balcony"],
  "2br": ["Entrance", "Living room", "Dining room", "Kitchen", "Master bedroom", "Master bathroom", "Bedroom 2", "Bathroom 2", "Guest WC", "Laundry", "Store", "Balcony"],
  "3br": ["Entrance", "Living room", "Dining room", "Kitchen", "Master bedroom", "Master bathroom", "Bedroom 2", "Bathroom 2", "Bedroom 3", "Bathroom 3", "Guest WC", "Corridor", "Laundry", "Store", "Maid room", "Balcony"],
  "4br": ["Entrance", "Living room", "Dining room", "Family room", "Kitchen", "Master bedroom", "Master bathroom", "Bedroom 2", "Bathroom 2", "Bedroom 3", "Bathroom 3", "Bedroom 4", "Bathroom 4", "Guest WC", "Corridor", "Laundry", "Store", "Maid room", "Balcony"],
  villa: ["Entrance", "Living room", "Dining room", "Family room", "Kitchen", "Guest WC", "Staircase", "Master bedroom", "Master bathroom", "Bedroom 2", "Bathroom 2", "Bedroom 3", "Bathroom 3", "Bedroom 4", "Bathroom 4", "Corridor", "Laundry", "Store", "Maid room", "Terrace", "Garden", "Roof", "Garage"],
  townhouse: ["Entrance", "Living room", "Dining room", "Kitchen", "Guest WC", "Staircase", "Master bedroom", "Master bathroom", "Bedroom 2", "Bathroom 2", "Bedroom 3", "Corridor", "Laundry", "Store", "Terrace", "Garden", "Garage"],
};

export default function NewJobWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState<User[]>([]);

  const [draft, setDraft] = useState<Draft>({
    unit_label: "",
    building_name: "",
    client_name: "",
    community: "",
    developer_name: "",
    task_type: "single_unit",
    property_type: "2br",
    scheduled_date: "",
    notes: "",
    technician_ids: [],
    approval_manager_id: "",
  });

  useEffect(() => {
    usersService
      .getUsers()
      .then((rows: User[]) => setUsers(rows.filter((row) => row.is_active !== false)))
      .catch(() => toast.error("Could not load the staff list"));
  }, []);

  const userOptions: Option[] = users.map((user) => ({
    value: user.id,
    label: user.full_name || user.email || user.id,
  }));

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const stepValid = useMemo(() => {
    switch (STEPS[step].key) {
      case "property":
        return (
          draft.unit_label.trim().length > 0 &&
          draft.building_name.trim().length > 0 &&
          draft.client_name.trim().length >= 2
        );
      case "assign":
        return draft.technician_ids.length > 0;
      default:
        return true;
    }
  }, [step, draft]);

  async function submit() {
    setSubmitting(true);
    try {
      const created = await snaggingService.createTask({
        property: {
          unit_label: draft.unit_label,
          building_name: draft.building_name,
          community: draft.community,
          client_name: draft.client_name,
          developer_name: draft.developer_name,
          property_type: draft.property_type,
          city: "Dubai",
        },
        task_type: draft.task_type,
        scheduled_date: draft.scheduled_date,
        technician_ids: draft.technician_ids,
        approval_manager_id: draft.approval_manager_id || null,
        notes: draft.notes,
      });

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

      {/* Stepper */}
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
                <span className={cn("text-sm font-medium", current ? "text-foreground" : "text-muted-foreground")}>
                  {entry.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <Card className="max-w-3xl gap-0 p-0">
        <div className="p-6">
          {STEPS[step].key === "property" ? (
            <PropertyStep draft={draft} set={set} />
          ) : STEPS[step].key === "floorplans" ? (
            <FloorPlansStep taskType={draft.task_type} />
          ) : STEPS[step].key === "areas" ? (
            <AreasStep propertyType={draft.property_type} set={set} />
          ) : (
            <AssignStep
              draft={draft}
              set={set}
              userOptions={userOptions}
              users={users}
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t px-6 py-4">
          <p className="text-muted-foreground text-xs">Required fields are marked.</p>
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

function PropertyStep({
  draft,
  set,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl">Property and client</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          These details ride with the job into the reference pack, so the inspector sees them
          offline.
        </p>
      </div>

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
        <Field label="Client" required>
          <Input
            value={draft.client_name}
            onChange={(event) => set("client_name", event.target.value)}
            placeholder="Who receives the report"
          />
        </Field>
        <Field label="Job type">
          <div className="flex gap-2">
            {(
              [
                { value: "single_unit", label: "Single unit" },
                { value: "full_building", label: "Full building" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => set("task_type", option.value)}
                className={cn(
                  "flex-1 rounded-full border px-3 py-2 text-sm font-medium transition-colors",
                  draft.task_type === option.value
                    ? "border-brand bg-brand text-white"
                    : "border-border text-ink-soft hover:bg-mist-soft",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
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

function FloorPlansStep({ taskType }: { taskType: Draft["task_type"] }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl">Floor plans</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Plans let the inspector pin each snag to a coordinate. They download with the pack for
          offline use.
        </p>
      </div>

      <div className="border-border rounded-lg border border-dashed p-8 text-center">
        <LayoutGrid className="text-muted-foreground mx-auto size-6" />
        <p className="mt-3 text-sm font-medium">Upload comes from the job detail</p>
        <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
          {taskType === "full_building"
            ? "A full-building job is created as a draft, and a plan is required before it can be assigned. You will add it on the job once this is created."
            : "For a single unit a plan is optional. You can attach one from the job detail after this is created."}
        </p>
      </div>
    </div>
  );
}

function AreasStep({
  propertyType,
  set,
}: {
  propertyType: SnaggingPropertyType;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  const rooms = TEMPLATE_PREVIEW[propertyType] ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl">Areas</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          The property type seeds the room list. The inspector can add or drop rooms on site, so
          this is a starting point, not a cage.
        </p>
      </div>

      <Field label="Property type">
        <Select value={propertyType} onValueChange={(value) => set("property_type", value as SnaggingPropertyType)}>
          <SelectTrigger className="w-full sm:w-64">
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

      <div>
        <p className="eyebrow mb-3">{rooms.length} rooms in this template</p>
        <div className="flex flex-wrap gap-2">
          {rooms.map((room) => (
            <span
              key={room}
              className="border-border bg-mist-soft inline-flex rounded-full border px-3 py-1 text-sm"
            >
              {room}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AssignStep({
  draft,
  set,
  userOptions,
  users,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  userOptions: Option[];
  users: User[];
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl">Assign and schedule</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Who walks the unit, who signs it off, and when. No report reaches a client without a
          manager approval.
        </p>
      </div>

      <Field label="Inspectors" required>
        <MultipleSelector
          value={userOptions.filter((option) => draft.technician_ids.includes(option.value))}
          options={userOptions}
          onChange={(options) => set("technician_ids", options.map((option) => option.value))}
          placeholder="Assign inspectors"
          emptyIndicator={
            <p className="text-muted-foreground py-2 text-center text-sm">No staff found</p>
          }
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Approval manager">
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

        <Field label="Scheduled date">
          <Input
            type="date"
            value={draft.scheduled_date}
            onChange={(event) => set("scheduled_date", event.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}
