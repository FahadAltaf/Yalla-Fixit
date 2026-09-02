"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Contact,
  Download,
  FileText,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
  Upload,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DateSelect from "@/components/ui/date-select";
import { InspectorAssignmentAlert } from "./inspector-alert";
import TimeSelect from "@/components/ui/time-select";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService } from "@/modules/snagging";
import { usersService } from "@/modules/users/services/users-service";

import { LocationMap } from "./location-map";
import { GoogleLocationMap, hasGoogleMapsKey } from "./google-location-map";
import {
  ActionType,
  ResourceType,
  type SnaggingTask,
  type User,
} from "@/types/types";

import {
  DataRow,
  DataState,
  PROPERTY_TYPE_LABELS,
  FieldsSkeleton,
  SectionCard,
  SubHeading,
  SubmitButton,
  useConfirm,
} from "./shared";

const UNASSIGNED = "none";

/** Splits a stored appointment instant into GST (+04:00) date + time parts. */
function splitAppointment(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const shifted = new Date(new Date(iso).getTime() + 4 * 3600 * 1000);
  if (Number.isNaN(shifted.getTime())) return { date: "", time: "" };
  const s = shifted.toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

// Which map the Setup tab draws. Google when a key is configured,
// Leaflet otherwise -- so a missing env var degrades to the old map
// rather than an empty box.
function MapForSetupTab(props: {
  lat: number;
  lng: number;
  label?: string | null;
  className?: string;
}) {
  return hasGoogleMapsKey() ? (
    <GoogleLocationMap {...props} />
  ) : (
    <LocationMap {...props} />
  );
}

/**
 * Job setup (FR-3.02, FR-3.03, FR-3.04, FR-3.08): the appointment, the two site
 * contacts, the property NOC (read-only, from FR-1.09), and inspector
 * assignment. Assignment is gated on the client approving the quotation and is
 * enforced server-side too — this panel only surfaces the gate and availability.
 */
export function JobSetupPanel({
  task,
  onChanged,
}: {
  task: SnaggingTask;
  onChanged: () => void;
}) {
  const { userProfile } = useAuth();
  const canEdit = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING,
    ActionType.EDIT,
  );
  const { confirm, dialog } = useConfirm();
  const nocInputRef = useRef<HTMLInputElement | null>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [saving, setSaving] = useState<
    null | "appt" | "contacts" | "assign" | "noc"
  >(null);
  const [busyMap, setBusyMap] = useState<Record<string, string>>({});
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null,
  );
  // Bumped to re-run the availability check after a failed one.
  const [availabilityNonce, setAvailabilityNonce] = useState(0);

  const initial = splitAppointment(task.appointment_at ?? null);
  const [apptDate, setApptDate] = useState(initial.date);
  const [apptTime, setApptTime] = useState(initial.time);

  const [devName, setDevName] = useState(task.developer_contact_name ?? "");
  const [devPhone, setDevPhone] = useState(task.developer_contact_phone ?? "");
  const [cliName, setCliName] = useState(task.client_contact_name ?? "");
  const [cliPhone, setCliPhone] = useState(task.client_contact_phone ?? "");

  const [inspectorId, setInspectorId] = useState(
    task.inspector_id ?? UNASSIGNED,
  );
  const [managerId, setManagerId] = useState(
    task.approval_manager_id ?? UNASSIGNED,
  );

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const rows: User[] = await usersService.getUsers();
      setUsers(rows.filter((r) => r.is_active !== false));
    } catch (e) {
      // An empty Select was the only sign of a failed fetch, so "no staff
      // exist" and "the staff list broke" looked identical.
      setUsers([]);
      setUsersError(
        e instanceof Error ? e.message : "Could not load the staff list",
      );
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  // Availability for the appointment day, so a booked inspector is flagged.
  useEffect(() => {
    if (!apptDate) {
      setBusyMap({});
      setAvailabilityError(null);
      return;
    }
    let active = true;
    setAvailabilityError(null);
    snaggingService
      .getAvailability(apptDate, task.id)
      .then((r) => active && setBusyMap(r.busy ?? {}))
      .catch((e) => {
        // A swallowed failure reads as "everyone is free that day", which
        // is how two jobs get booked onto one inspector.
        if (!active) return;
        setBusyMap({});
        setAvailabilityError(
          e instanceof Error ? e.message : "Could not check availability",
        );
      });
    return () => {
      active = false;
    };
  }, [apptDate, task.id, availabilityNonce]);

  // The quotation approval flips the job draft -> assigned; a child job (round /
  // additional visit) is created assigned. So anything past draft has cleared
  // the gate. `locked` (approved report) freezes further edits.
  const quotationApproved = task.status !== "draft";
  const canAssign = canEdit && quotationApproved && !task.locked;

  async function saveAppointment() {
    setSaving("appt");
    try {
      const appointment_at = apptDate
        ? `${apptDate}T${apptTime || "09:00"}:00+04:00`
        : null;
      await snaggingService.updateTask(task.id, { appointment_at });
      toast.success("Appointment saved");
      onChanged();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not save the appointment",
      );
    } finally {
      setSaving(null);
    }
  }

  async function saveContacts() {
    setSaving("contacts");
    try {
      await snaggingService.updateTask(task.id, {
        developer_contact_name: devName.trim() || null,
        developer_contact_phone: devPhone.trim() || null,
        client_contact_name: cliName.trim() || null,
        client_contact_phone: cliPhone.trim() || null,
      });
      toast.success("Site contacts saved");
      onChanged();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not save the contacts",
      );
    } finally {
      setSaving(null);
    }
  }

  async function saveAssignment() {
    if (inspectorId !== UNASSIGNED && managerId === UNASSIGNED) {
      toast.error("Select an approval manager before assigning an inspector");
      return;
    }

    // Saving clears technician_ids, so a change here quietly takes the
    // person currently on the job off it. Say whose job is being moved.
    const current = task.inspector_id ?? null;
    if (current && inspectorId !== current) {
      const previous = users.find((u) => u.id === current);
      const who =
        (previous?.full_name || previous?.email) ?? "The assigned inspector";
      const unassigning = inspectorId === UNASSIGNED;
      const ok = await confirm({
        title: unassigning
          ? "Unassign the inspector?"
          : "Change the assigned inspector?",
        description: unassigning
          ? `${who} will be taken off this job and it will have no inspector until someone else is assigned.`
          : `${who} will be taken off this job and replaced by the inspector you selected.`,
        confirmText: unassigning ? "Unassign" : "Change inspector",
        variant: "destructive",
      });
      if (!ok) return;
    }

    setSaving("assign");
    try {
      await snaggingService.updateTask(task.id, {
        technician_ids: inspectorId === UNASSIGNED ? [] : [inspectorId],
        approval_manager_id: managerId === UNASSIGNED ? null : managerId,
      });
      toast.success(
        inspectorId === UNASSIGNED
          ? "Inspector unassigned"
          : "Inspector assigned",
      );
      onChanged();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not update the assignment",
      );
    } finally {
      setSaving(null);
    }
  }

  const property = task.property;
  /**
   * FR-3.04 — attach or replace the NOC without leaving the job.
   *
   * The endpoint writes to the property record when the job has one, so
   * the document is the property's single copy rather than a second one
   * living on this job. Uploading again overwrites it, which is what
   * "the developer sent a corrected letter" actually means.
   */
  async function uploadNoc(file: File) {
    setSaving("noc");
    try {
      await snaggingService.uploadDocument(task.id, file, "noc");
      toast.success("NOC uploaded");
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not upload the NOC",
      );
    } finally {
      setSaving(null);
      // Clearing lets the same file be picked again after a failure.
      if (nocInputRef.current) nocInputRef.current.value = "";
    }
  }

  const nocRequired = Boolean(property?.noc_required);
  const nocOnFile = Boolean(property?.noc_path);

  return (
    // Four cards rather than four hairline-divided strips inside one.
    // Each block writes to a different endpoint and is read on its own,
    // so each gets its own surface and its own header — the same shape
    // the AMC forms use.
    <div className="flex flex-col gap-4">
      <InspectorAssignmentAlert
        task={task}
        onAssign={() =>
          document
            .getElementById("inspector-assignment")
            ?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
      />

      {/*
        Property and client (BR-1 / FR-1.09).

        The record the job is against was readable nowhere on this page:
        the header card carries the unit and the client's name, and
        everything else — property type, size, developer, and how to
        reach the client — existed only on the property record. An
        inspector's coordinator should not have to leave the job to find
        the number they are meant to call.
      */}
      <SetupSection
        icon={Building2}
        title="Property & client"
        description="The unit this job is against, and who to contact about it."
        action={
          property?.title_deed_url ? (
            <Button asChild size="sm" variant="outline">
              <a
                href={property.title_deed_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileText className="size-3.5" />
                Title deed
              </a>
            </Button>
          ) : null
        }
      >
        {/*
          Both lists stack on the left and the map fills the right.

          Property is nine rows and Client is three, so putting them side
          by side left the short column ending halfway up and the tall one
          running past it — a hole under one and a map floating mid-card.
          Stacked, the left column is one continuous read and the map has
          a full-height box to sit in.
        */}
        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="space-y-3">
              <SubHeading>Property</SubHeading>
              <DetailList
                rows={[
                  { label: "Unit", value: property?.unit_label },
                  { label: "Building", value: property?.building_name },
                  { label: "Community", value: property?.community },
                  {
                    label: "Type",
                    value: property?.property_type
                      ? (PROPERTY_TYPE_LABELS[property.property_type] ??
                        property.property_type)
                      : null,
                  },
                  {
                    label: "Bedrooms",
                    value:
                      property?.bedrooms !== null &&
                      property?.bedrooms !== undefined
                        ? String(property.bedrooms)
                        : null,
                  },
                  {
                    label: "Built-up area",
                    value: property?.built_up_area_sqft
                      ? `${property.built_up_area_sqft.toLocaleString()} sq ft`
                      : null,
                  },
                  {
                    label: "Plot area",
                    value: property?.plot_area_sqft
                      ? `${property.plot_area_sqft.toLocaleString()} sq ft`
                      : null,
                  },
                  { label: "Developer", value: property?.developer_name },
                  {
                    label: "External areas",
                    value: property?.external_areas_in_scope
                      ? "In scope"
                      : "Not in scope",
                  },
                ]}
              />
            </div>

            <div className="space-y-3">
              <SubHeading>Client</SubHeading>
              <DetailList
                rows={[
                  { label: "Name", value: property?.client_name },
                  {
                    label: "Email",
                    value: property?.client_email,
                    href: property?.client_email
                      ? `mailto:${property.client_email}`
                      : undefined,
                  },
                  {
                    label: "Phone",
                    value: property?.client_phone,
                    href: property?.client_phone
                      ? `tel:${property.client_phone}`
                      : undefined,
                  },
                ]}
              />
            </div>
          </div>

          {/*
            The map itself rather than a link out to one. Somebody
            checking where a unit is should not have to leave the job,
            open a tab and come back to answer a question the card can
            answer in place.
          */}
          <div className="flex min-w-0 flex-col space-y-3">
            <SubHeading>Location</SubHeading>
            {property?.location_lat && property?.location_lng ? (
              // Google Maps here only -- this Setup tab is the one place the
              // team asked for it. Every other map in the app (the picker,
              // the snag GPS links) stays on Leaflet. Falls back to Leaflet
              // when no key is configured, so a missing env var degrades to
              // the old map rather than an empty box.
              <MapForSetupTab
                className="flex-1"
                lat={property.location_lat}
                lng={property.location_lng}
                label={
                  [property.unit_label, property.building_name]
                    .filter(Boolean)
                    .join(", ") || null
                }
              />
            ) : (
              <div className="text-muted-foreground flex flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm">
                No location pinned on the property record.
              </div>
            )}
          </div>
        </div>
      </SetupSection>

      {/* Inspector assignment (FR-3.08) */}
      <div id="inspector-assignment" className="scroll-mt-24">
        <SetupSection
          icon={UserCog}
          title="Inspector assignment"
          description="Who walks the unit, and who signs the report off."
        >
          {!quotationApproved ? (
            <Alert>
              <Lock />
              <AlertTitle>
                Waiting on the client&apos;s quotation approval
              </AlertTitle>
              <AlertDescription>
                An inspector can be assigned once the client approves the
                quotation above.
              </AlertDescription>
            </Alert>
          ) : (
            <DataState
              loading={usersLoading}
              error={usersError}
              onRetry={() => void loadUsers()}
              retrying={usersLoading}
              errorTitle="Could not load the staff list"
              // Matches the two selects below, so the inspector picker no
              // longer renders empty and then pops full.
              skeleton={
                <FieldsSkeleton fields={2} columns={2} className="p-0" />
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Inspector" htmlFor="assign-inspector">
                  {/*
                  A disabled Select renders its value in placeholder grey,
                  so an inspector who *is* assigned looked exactly like
                  nobody assigned. When the assignment cannot be changed
                  the answer is not a greyed-out dropdown at all — it is
                  the name, stated plainly.
                */}
                  {canAssign ? (
                    <Select
                      value={inspectorId}
                      onValueChange={setInspectorId}
                      disabled={!canAssign}
                    >
                      <SelectTrigger id="assign-inspector" className="w-full">
                        <SelectValue placeholder="Assign an inspector" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                        {users.map((u) => {
                          const busyCode = busyMap[u.id];
                          const isBusy =
                            Boolean(busyCode) && u.id !== task.inspector_id;
                          return (
                            <SelectItem
                              key={u.id}
                              value={u.id}
                              disabled={isBusy}
                            >
                              {(u.full_name || u.email) ?? u.id}
                              {isBusy ? ` — busy (${busyCode})` : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  ) : (
                    <ReadOnlyValue
                      id="assign-inspector"
                      value={nameFor(users, task.inspector_id)}
                      empty="No inspector assigned"
                    />
                  )}
                  {canAssign ? (
                    availabilityError ? (
                      <p className="text-destructive mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        Could not check availability for {apptDate}; booked
                        inspectors are not flagged.
                        <button
                          type="button"
                          onClick={() => setAvailabilityNonce((n) => n + 1)}
                          className="inline-flex items-center gap-1 underline underline-offset-2"
                        >
                          <RefreshCw className="size-3" /> Try again
                        </button>
                      </p>
                    ) : apptDate ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        Availability shown for {apptDate}. Booked inspectors are
                        disabled.
                      </p>
                    ) : (
                      <p className="text-muted-foreground mt-1 text-xs">
                        Set an appointment date to check availability.
                      </p>
                    )
                  ) : null}
                </Field>
                <Field
                  label="Approval manager"
                  hint="Required before an inspector can be assigned."
                  htmlFor="assign-manager"
                >
                  {canAssign ? (
                    <Select
                      value={managerId}
                      onValueChange={setManagerId}
                      disabled={!canAssign}
                    >
                      <SelectTrigger id="assign-manager" className="w-full">
                        <SelectValue placeholder="Who signs this off?" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>None</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {(u.full_name || u.email) ?? u.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <ReadOnlyValue
                      id="assign-manager"
                      value={nameFor(users, task.approval_manager_id)}
                      empty="No approval manager set"
                    />
                  )}
                </Field>
              </div>
              {canAssign ? (
                <div className="flex justify-end">
                  <SubmitButton
                    size="sm"
                    onClick={() => void saveAssignment()}
                    disabled={saving !== null}
                    pending={saving === "assign"}
                    pendingLabel="Saving…"
                    icon={<UserCog className="size-4" />}
                  >
                    {task.inspector_id
                      ? "Update assignment"
                      : "Assign inspector"}
                  </SubmitButton>
                </div>
              ) : task.locked ? (
                /*
                Tinted grey rather than left on the card's own white: this
                sat directly under the assignment fields wearing the same
                surface, so a read-only notice looked like one more thing
                to fill in. Not red — being locked is a settled state, not
                a fault.
              */
                <Alert className="bg-muted/60 text-muted-foreground mt-4 border-transparent">
                  <Lock className="size-4" />
                  <AlertTitle className="text-foreground">
                    This inspection is locked
                  </AlertTitle>
                  <AlertDescription className="text-muted-foreground">
                    The report has been approved, so the assignment can no
                    longer be changed.
                  </AlertDescription>
                </Alert>
              ) : null}
            </DataState>
          )}
        </SetupSection>
      </div>

      {/* Appointment (FR-3.02) */}
      <SetupSection
        icon={CalendarClock}
        title="Appointment"
        description="When the inspector is expected on site. Quoted in Gulf time."
        footer={
          canEdit ? (
            <SubmitButton
              size="sm"
              variant="outline"
              onClick={() => void saveAppointment()}
              disabled={saving !== null}
              pending={saving === "appt"}
              pendingLabel="Saving…"
              icon={<Save className="size-4" />}
            >
              Save appointment
            </SubmitButton>
          ) : null
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor="appt-date">
            <DateSelect
              id="appt-date"
              value={apptDate}
              disabled={!canEdit}
              onChange={setApptDate}
              aria-label="Appointment date"
            />
          </Field>
          <Field label="Time (GST)" htmlFor="appt-time">
            <TimeSelect
              value={apptTime}
              disabled={!canEdit || !apptDate}
              onChange={setApptTime}
              aria-label="Appointment time"
            />
          </Field>
        </div>
      </SetupSection>

      {/* Site contacts (FR-3.03) */}
      <SetupSection
        icon={Contact}
        title="Site contacts"
        description="Who the inspector calls to get in on the day."
        footer={
          canEdit ? (
            <SubmitButton
              size="sm"
              variant="outline"
              onClick={() => void saveContacts()}
              disabled={saving !== null}
              pending={saving === "contacts"}
              pendingLabel="Saving…"
              icon={<Save className="size-4" />}
            >
              Save contacts
            </SubmitButton>
          ) : null
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-3">
            <SubHeading>Developer side</SubHeading>
            <Field label="Name" htmlFor="dev-name">
              <Input
                id="dev-name"
                value={devName}
                disabled={!canEdit}
                onChange={(e) => setDevName(e.target.value)}
              />
            </Field>
            <Field label="Phone" htmlFor="dev-phone">
              <Input
                id="dev-phone"
                value={devPhone}
                disabled={!canEdit}
                onChange={(e) => setDevPhone(e.target.value)}
              />
            </Field>
          </div>
          <div className="space-y-3">
            <SubHeading>Client / representative</SubHeading>
            <Field label="Name" htmlFor="cli-name">
              <Input
                id="cli-name"
                value={cliName}
                disabled={!canEdit}
                onChange={(e) => setCliName(e.target.value)}
              />
            </Field>
            <Field label="Phone" htmlFor="cli-phone">
              <Input
                id="cli-phone"
                value={cliPhone}
                disabled={!canEdit}
                onChange={(e) => setCliPhone(e.target.value)}
              />
            </Field>
          </div>
        </div>
      </SetupSection>

      {/* NOC (FR-3.04) — the property's copy (FR-1.09), attachable here */}
      <SetupSection
        icon={ShieldCheck}
        title="NOC"
        description="The no objection certificate the developer needs before the inspector is let in. Held on the property record, so uploading here replaces the property's copy."
        action={
          /*
            The badge used to report only whether a NOC was required, so a
            job with a document sitting right underneath it still read
            "Not required" — the header contradicting its own card. It now
            describes the document: on file, missing when it is needed, or
            genuinely not required.
          */
          <Badge
            variant="secondary"
            className={cn(
              "border-0 font-medium",
              nocOnFile
                ? "bg-success/10 text-success"
                : nocRequired
                  ? "bg-warning/10 text-warning"
                  : "bg-mist text-ink-soft",
            )}
          >
            {nocOnFile
              ? "On file"
              : nocRequired
                ? "Required — missing"
                : "Not required"}
          </Badge>
        }
      >
        {/*
          One row saying what the document is and what state it is in,
          rather than two label-and-chip pairs that made the reader join
          "Required: No" to "On file: Not uploaded" themselves.
        */}
        <div className="overflow-hidden rounded-lg border">
          <DataRow
            className="py-3"
            icon={<FileText aria-hidden />}
            active={nocOnFile}
            title="No objection certificate"
            subtitle={
              nocOnFile
                ? "On file and available to the inspector"
                : nocRequired
                  ? "Not uploaded — access may be refused on the day"
                  : "Not uploaded. This unit does not require one."
            }
            trailing={
              <div className="flex items-center gap-2">
                {nocOnFile && property?.noc_url ? (
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={property.noc_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download className="size-3.5" />
                      View
                    </a>
                  </Button>
                ) : null}
                {/*
                  Nothing to upload when the unit does not need one. An
                  Upload button beside the words "This unit does not
                  require one" invites somebody to attach a document
                  nobody asked for. Replacing an existing NOC stays
                  available either way, since a file that is on file is
                  presumably there for a reason.
                */}
                {canEdit && (nocRequired || nocOnFile) ? (
                  <SubmitButton
                    size="sm"
                    variant={nocOnFile ? "outline" : "default"}
                    onClick={() => nocInputRef.current?.click()}
                    disabled={saving !== null}
                    pending={saving === "noc"}
                    pendingLabel="Uploading…"
                    icon={<Upload className="size-3.5" />}
                  >
                    {nocOnFile ? "Replace" : "Upload NOC"}
                  </SubmitButton>
                ) : null}
              </div>
            }
          />
        </div>

        <input
          ref={nocInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadNoc(file);
          }}
        />

        {canEdit && (nocRequired || nocOnFile) ? (
          <p className="text-muted-foreground mt-2 text-xs">
            PNG, JPG, WEBP or PDF, up to 15MB.
          </p>
        ) : null}

        {nocRequired && !nocOnFile ? (
          <Alert variant="destructive" className="border-destructive/30 mt-4">
            <AlertTriangle />
            <AlertTitle>NOC required but not uploaded</AlertTitle>
            <AlertDescription>
              Upload it before the inspector attends, or access may be refused
              on the day.
            </AlertDescription>
          </Alert>
        ) : null}
      </SetupSection>

      {dialog}
    </div>
  );
}

/**
 * One block of the setup form: an icon'd title, a line saying what it is
 * for, the fields, and its own save on the right.
 *
 * Each block writes to a different endpoint, so they keep separate save
 * buttons — but they now share one header treatment instead of three
 * slightly different hand-rolled ones.
 */
function SetupSection({
  icon: Icon,
  title,
  description,
  action,
  footer,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SectionCard
      title={title}
      description={description}
      icon={<Icon />}
      action={action}
      bodyClassName="px-5 pb-5"
    >
      {children}
      {footer ? <div className="mt-4 flex justify-end">{footer}</div> : null}
    </SectionCard>
  );
}

/** Label + control + optional hint, so every field on the panel lines up. */
function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-muted-foreground text-xs font-medium"
      >
        {label}
      </Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/** The display name for an assigned user id, or null when unassigned. */
function nameFor(users: User[], id?: string | null): string | null {
  if (!id) return null;
  const match = users.find((user) => user.id === id);
  return (match?.full_name || match?.email) ?? id;
}

/**
 * A settled value that can no longer be edited.
 *
 * Reads in foreground text on a muted surface, so it is obviously a fact
 * rather than an input somebody has failed to fill in.
 */
function ReadOnlyValue({
  id,
  value,
  empty,
}: {
  id: string;
  value: string | null;
  empty: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "bg-muted/50 flex h-9 w-full items-center rounded-md border px-3 text-sm",
        value ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {value ?? empty}
    </div>
  );
}

/**
 * Label-and-value rows for a record somebody is reading, not editing.
 *
 * A missing value shows an em dash rather than collapsing the row, so
 * the shape of the record stays the same whichever fields are filled in
 * and a reader can tell "not recorded" from "not applicable here".
 */
function DetailList({
  rows,
}: {
  rows: Array<{ label: string; value?: string | null; href?: string }>;
}) {
  return (
    <dl className="divide-y">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-4 py-1.5"
        >
          <dt className="text-muted-foreground shrink-0 text-sm">
            {row.label}
          </dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium">
            {row.value ? (
              row.href ? (
                <a
                  href={row.href}
                  className="hover:text-brand underline underline-offset-2"
                >
                  {row.value}
                </a>
              ) : (
                row.value
              )
            ) : (
              <span className="text-muted-foreground font-normal">—</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
