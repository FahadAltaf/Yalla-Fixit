"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  BadgeAlert,
  CalendarClock,
  Clock,
  ExternalLink,
  History,
  Info,
  Loader2,
  ReceiptText,
  RotateCcw,
  Save,
  ScrollText,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { FsmFreshness } from "@/components/dashboard/reporting/fsm-freshness";
import { PublicHolidays } from "@/components/dashboard/reporting/public-holidays";
import { PageHeading, PillTabs, SectionCard } from "@/components/dashboard/shared/kaizen";
import { DataTable } from "@/components/data-table";
import { IconText } from "@/components/data-table/columns/icon-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MultipleSelector, { type Option } from "@/components/ui/multiselect";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  overridesFrom,
  reportingSettingsSchema,
  validateReportingSettings,
  type ReportingSettings,
} from "@/lib/reporting/settings";
import type { ReportingSettingsHistoryEntry } from "@/lib/server/reporting/audit";
import type { PickableUser } from "@/lib/server/people/pickable-users";
import { cn } from "@/lib/utils";
import { reportingService } from "@/modules/reporting/reporting-service";

/**
 * Reporting Settings (BRD §6.4, §6.6; DEV-461).
 *
 * Every threshold the invoicing queue, the reports and the alerts read. The
 * BRD's suggested defaults apply until someone changes a field; a changed
 * field says so and can be put back. What is saved is only what differs
 * from the defaults (lib/reporting/settings.ts explains why).
 */

type View = "finance" | "quotations" | "attendance" | "compliance" | "planning" | "links" | "holidays" | "history" | "fsm";
type SectionKey = Exclude<View, "holidays" | "history" | "fsm">;

/*
  Hidden for now (30 Oct, to be worked on later): Capacity and exceptions,
  and FSM report links. Their saved values stay and are still used; only
  the tabs are not shown. Remove a key here to show its tab again.
*/
const HIDDEN_TABS = new Set<View>(["planning", "links"]);

type NumberField = {
  kind: "number";
  path: string;
  label: string;
  unit: string;
  hint?: string;
  min: number;
  max: number;
  step?: number;
};
type TimeField = { kind: "time"; path: string; label: string; hint?: string };
type PeopleField = { kind: "people"; path: string; label: string; hint?: string };
type ToggleField = { kind: "toggle"; path: string; label: string; hint?: string };
/* A web address; empty means not set. */
type UrlField = { kind: "url"; path: string; label: string; hint?: string };
type Field = NumberField | TimeField | PeopleField | ToggleField | UrlField;

/*
  What each setting is about, in plain words (30 Oct), shown when the info
  icon beside its name is hovered: what it does and where it is used.
*/
const ABOUT: Record<string, string> = {
  "finance.digestTimeLocal": "When the daily email to Finance goes out: the work newly ready to invoice and what is still waiting. Dubai time.",
  "finance.digestRecipientUserIds": "Who receives the daily Ready to invoice email, and its notification in the portal.",
  "finance.agedAfterDays": "On Ready to invoice and in the daily email, a work order waiting in Pending longer than this is marked as aged.",
  "quotations.ageingDaysByStatus.notSent": "On the Quotation summary, a quotation still not sent after this many days is flagged as too old, and the ageing recipients are told.",
  "quotations.ageingDaysByStatus.sent": "On the Quotation summary, a quotation sent and still waiting for the client after this many days is flagged as too old.",
  "quotations.ageingDaysByStatus.approved": "On the Quotation summary, a quotation approved but not yet scheduled after this many days is flagged as too old.",
  "quotations.expiryWarningDays": "A quotation waiting on the client is highlighted this many days before its validity ends, and its owner is told.",
  "quotations.alertRecipientUserIds": "Who is told when a quotation has stayed in a status longer than its limit.",
  "attendance.shiftCheckInAlertDelayMinutes": "How long after a shift starts, with no check-in in the FSM app, the check-in alert recipients are told.",
  "attendance.appointmentCheckInAlertDelayMinutes": "How long after an appointment's scheduled start, with nobody checked in to it, the check-in alert recipients are told.",
  "attendance.lateArrivalToleranceMinutes": "Daily attendance marks a technician late only when they check in more than this many minutes after their shift starts.",
  "attendance.standardDailyHours": "How many hours a technician can work in a day. Utilization and Capacity measure the work against it.",
  "attendance.dataCentreDailyHours": "The working day of technicians whose Service Type is Data Center, used instead of the standard day. It is not overtime.",
  "attendance.unpaidBreakMinutes": "Taken off every working day before Utilization and Capacity count the hours available.",
  "attendance.checkInAlertRecipientUserIds": "Who is told when a technician has not checked in for a shift or an appointment.",
  "compliance.thresholdPercent": "On App compliance, a technician whose check-ins done, as a share of those needed, fall below this % gets a penalty for each miss.",
  "compliance.penaltyPerMissAed": "The amount worked out for each missed check-in when a technician is below the threshold. HR decides whether to apply it.",
  "compliance.monthlyCapAed": "The most a technician's penalty can come to in one month.",
  "compliance.disputeCutoffDay": "Technicians can dispute a missed check-in until this day of the following month. After it the month can be finalised and nothing changes.",
  "compliance.hrRecipientUserIds": "Who receives the final monthly compliance report by email when a month is finalised.",
  "compliance.disputeReviewerUserIds": "Who can accept or reject a technician's dispute of a missed check-in, on App compliance.",
  "compliance.belowThresholdRecipientUserIds": "Who is told when a technician's compliance falls below the threshold.",
  "capacity.horizonDays": "How many days ahead the Capacity report opens on, and how far ahead the over-booking alert looks.",
  "capacity.spareBelowPercent": "On Capacity, a day with less than this share of its available hours booked is shown as spare.",
  "capacity.alertRecipientUserIds": "Who is told when a team has more hours booked than available on a day in the coming days.",
  "exceptions.completedWithoutFlagAfterDays": "On Exception reports, a completed work order still not marked To Be Invoiced after this many days is overdue, and its coordinator is told.",
};
const aboutOf = (path: string) =>
  ABOUT[path] ?? (path.startsWith("fsmLinks.") ? "Where Reports → Zoho FSM reports takes you for this report. Paste the report's address from Zoho FSM." : null);

/** The info icon beside a setting's name: what it is about, on hover. */
function AboutSetting({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground hover:text-foreground inline-flex" aria-label={`About ${label}`}>
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-72">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

const SECTIONS: Record<SectionKey, { title: string; description: string; icon: React.ReactNode; fields: Field[] }> = {
  finance: {
    title: "Invoicing queue and digest",
    description: "When Finance hears about new items, and when a waiting item counts as aged.",
    icon: <ReceiptText />,
    fields: [
      { kind: "time", path: "finance.digestTimeLocal", label: "Daily digest time", hint: "Dubai time." },
      { kind: "people", path: "finance.digestRecipientUserIds", label: "Digest recipients", hint: "The Finance list. Nobody receives the digest until this is set." },
      { kind: "number", path: "finance.agedAfterDays", label: "Item aged after", unit: "days in Pending", min: 0, max: 365 },
    ],
  },
  quotations: {
    title: "Quotation ageing and expiry",
    description: "When a quotation is flagged for sitting too long in a status, or nearing the end of its validity.",
    icon: <CalendarClock />,
    fields: [
      { kind: "number", path: "quotations.ageingDaysByStatus.notSent", label: "Not sent", unit: "days", min: 0, max: 365 },
      { kind: "number", path: "quotations.ageingDaysByStatus.sent", label: "Sent, awaiting the client", unit: "days", min: 0, max: 365 },
      { kind: "number", path: "quotations.ageingDaysByStatus.approved", label: "Approved, not yet scheduled", unit: "days", min: 0, max: 365 },
      { kind: "number", path: "quotations.expiryWarningDays", label: "Expiry warning", unit: "days before validity ends", min: 0, max: 365 },
      { kind: "people", path: "quotations.alertRecipientUserIds", label: "Ageing alert recipients", hint: "The managers told when a quotation has been in a status too long. The expiry warning goes to the quotation's owner. Nobody is told about ageing until this is set." },
    ],
  },
  attendance: {
    title: "Check-in alerts and working hours",
    description: "How long after a shift or appointment starts a missing check-in is raised, what counts as late, and how long a working day is.",
    icon: <Clock />,
    fields: [
      { kind: "number", path: "attendance.shiftCheckInAlertDelayMinutes", label: "Shift check-in alert after", unit: "minutes", min: 0, max: 240 },
      { kind: "number", path: "attendance.appointmentCheckInAlertDelayMinutes", label: "Appointment check-in alert after", unit: "minutes", min: 0, max: 240 },
      { kind: "number", path: "attendance.lateArrivalToleranceMinutes", label: "Late arrival tolerance", unit: "minutes", min: 0, max: 240 },
      {
        kind: "number",
        path: "attendance.standardDailyHours",
        label: "Standard working day",
        unit: "hours",
        hint: "Available hours for each working day, with no break. A technician with other hours has them set in Workforce → People → ⋮ → Working hours.",
        min: 1,
        max: 24,
      },
      {
        kind: "number",
        path: "attendance.dataCentreDailyHours",
        label: "Data Center working day",
        unit: "hours",
        hint: "For technicians whose Service Type is Data Center. These are their available hours, not overtime. Hours set on the technician come first.",
        min: 1,
        max: 24,
      },
      {
        kind: "number",
        path: "attendance.unpaidBreakMinutes",
        label: "Unpaid break per day",
        unit: "minutes",
        hint: "Taken off each working day's hours. 0 when the working day is already counted without a break.",
        min: 0,
        max: 240,
      },
      {
        kind: "people",
        path: "attendance.checkInAlertRecipientUserIds",
        label: "Check-in alert recipients",
        hint: "The coordinators told when a technician misses a shift check-in or an appointment check-in. Nobody is told until this is set.",
      },
    ],
  },
  compliance: {
    title: "Check-in compliance and penalties",
    description: "Penalties are calculated and reported only. Nothing is deducted from pay by the portal.",
    icon: <BadgeAlert />,
    fields: [
      {
        kind: "number",
        path: "compliance.thresholdPercent",
        label: "Compliance threshold",
        unit: "%",
        hint: "Penalties apply below this. If it is cleared, no penalty is worked out.",
        min: 0,
        max: 100,
        step: 0.1,
      },
      { kind: "number", path: "compliance.penaltyPerMissAed", label: "Penalty per missed check-in", unit: "AED", min: 0, max: 100000, step: 0.01 },
      { kind: "number", path: "compliance.monthlyCapAed", label: "Monthly cap per technician", unit: "AED", min: 0, max: 100000, step: 0.01 },
      { kind: "number", path: "compliance.disputeCutoffDay", label: "Disputes close on day", unit: "of the month", min: 1, max: 28 },
      { kind: "people", path: "compliance.hrRecipientUserIds", label: "Monthly report recipients", hint: "HR and managers get the final monthly report when the month is finalised. Nobody receives it until this is set." },
      {
        kind: "people",
        path: "compliance.disputeReviewerUserIds",
        label: "Dispute reviewers",
        hint: "Who accepts or rejects a technician's dispute, and is told when one is raised. Only they can decide one. Nobody can until this is set.",
      },
      {
        kind: "people",
        path: "compliance.belowThresholdRecipientUserIds",
        label: "Below-threshold recipients",
        hint: "Supervisors told when a technician's compliance falls below the threshold, besides the technician and their team leader.",
      },
    ],
  },
  planning: {
    title: "Capacity and exceptions",
    description: "How far ahead capacity looks, what counts as a spare day, who hears about over-booking, and when a completed job without the invoice flag is reported.",
    icon: <CalendarClock />,
    fields: [
      { kind: "number", path: "capacity.horizonDays", label: "Capacity horizon", unit: "days", min: 1, max: 90 },
      {
        kind: "number",
        path: "capacity.spareBelowPercent",
        label: "Spare day below",
        unit: "% of available hours booked",
        hint: "A day with less than this share of its hours booked is shown as spare.",
        min: 0,
        max: 100,
      },
      { kind: "people", path: "capacity.alertRecipientUserIds", label: "Over-booking alert recipients", hint: "The coordinators told when a team's day is over-booked. Nobody is told until this is set." },
      { kind: "number", path: "exceptions.completedWithoutFlagAfterDays", label: "Completed without invoice flag after", unit: "days", min: 0, max: 365 },
    ],
  },
  links: {
    title: "Zoho FSM report links",
    description:
      "The reports kept in Zoho FSM, opened from Reports → Zoho FSM reports. Open each report in FSM, copy the address from the browser and paste it here. A report without an address shows as not linked yet.",
    icon: <ExternalLink />,
    fields: [
      { kind: "url", path: "fsmLinks.checkInLog", label: "Check-in and check-out log", hint: "FSM standard report: the raw check-in events from the mobile app." },
      { kind: "url", path: "fsmLinks.appointmentsByStatus", label: "Appointments by status", hint: "FSM standard report." },
      { kind: "url", path: "fsmLinks.workOrdersByStatus", label: "Work orders by type and by status", hint: "FSM standard report." },
      { kind: "url", path: "fsmLinks.revenue", label: "Revenue per technician, per client, AMC vs one-time", hint: "FSM custom report: to be built in FSM." },
      { kind: "url", path: "fsmLinks.ratings", label: "Rating and feedback trend", hint: "FSM custom report: to be built in FSM." },
    ],
  },
};

const FIELD_LABELS = new Map(
  Object.values(SECTIONS).flatMap((section) => section.fields.map((field) => [field.path, field.label] as const)),
);

function getPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], source);
}

function setPath<T>(source: T, path: string, value: unknown): T {
  const copy = structuredClone(source) as Record<string, unknown>;
  const keys = path.split(".");
  let node = copy;
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
  node[keys[keys.length - 1]] = value;
  return copy as T;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function display(value: unknown, field: Field, users: PickableUser[]): string {
  if (value === null || value === undefined) return "not set";
  if (field.kind === "people") {
    const ids = value as string[];
    if (ids.length === 0) return "nobody";
    return ids.map((id) => users.find((u) => u.id === id)?.name ?? "someone").join(", ");
  }
  if (field.kind === "number") return `${value} ${field.unit}`;
  if (field.kind === "toggle") return value ? "on" : "off";
  if (field.kind === "url") return value ? String(value) : "not set";
  return String(value);
}

export function ReportingSettingsPage() {
  const [view, setView] = useState<View>("finance");
  const [defaults, setDefaults] = useState<ReportingSettings | null>(null);
  const [saved, setSaved] = useState<ReportingSettings | null>(null);
  const [draft, setDraft] = useState<ReportingSettings | null>(null);
  const [history, setHistory] = useState<ReportingSettingsHistoryEntry[]>([]);
  const [users, setUsers] = useState<PickableUser[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await reportingService.getSettings();
      setDefaults(response.defaults);
      setSaved(response.settings);
      setDraft(response.settings);
      setHistory(response.history);
      setUsers(response.users);
      setCanEdit(response.canEdit);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* A holiday change shows in the history without reloading the draft. */
  const refreshHistory = useCallback(async () => {
    try {
      setHistory((await reportingService.getSettings()).history);
    } catch {
      /* The history is supporting detail; the next load brings it. */
    }
  }, []);

  const dirty = Boolean(draft && saved && !same(draft, saved));

  const handleSave = async () => {
    if (!draft || !defaults) return;
    /* The server checks all of this too; checking here first puts the
       message beside the field instead of in a toast. */
    const parsed = reportingSettingsSchema.safeParse(draft);
    const found: Record<string, string> = parsed.success
      ? validateReportingSettings(parsed.data)
      : Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]));
    setProblems(found);
    if (Object.keys(found).length > 0) {
      const first = Object.keys(found)[0];
      const tab = (Object.keys(SECTIONS) as SectionKey[]).find((key) =>
        SECTIONS[key].fields.some((field) => field.path === first),
      );
      if (tab && !HIDDEN_TABS.has(tab)) setView(tab);
      toast.error("Some settings need attention before they can be saved.");
      return;
    }
    setSaving(true);
    try {
      const response = await reportingService.saveSettings(overridesFrom(defaults, draft));
      setSaved(response.settings);
      setDraft(response.settings);
      setHistory(response.history);
      toast.success(
        response.changedKeys.length > 0
          ? `Saved. ${response.changedKeys.length} setting${response.changedKeys.length === 1 ? "" : "s"} changed.`
          : "Saved. There was nothing to change.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save Reporting Settings");
    } finally {
      setSaving(false);
    }
  };

  const heading = (
    <PageHeading
      eyebrow="Settings"
      title="Reporting"
      description="Thresholds, alerts, recipients and penalties for invoicing, reports and compliance."
      actions={
        canEdit && draft ? (
          <div className="flex items-center gap-3">
            {dirty ? (
              <span className="text-warning flex items-center gap-1.5 text-xs font-medium">
                <span className="bg-warning size-1.5 rounded-full" aria-hidden />
                Unsaved changes
              </span>
            ) : null}
            <Button onClick={() => void handleSave()} disabled={saving || !dirty}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save changes
            </Button>
          </div>
        ) : undefined
      }
    />
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <div className="flex gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-28 rounded-full" />
          ))}
        </div>
        <Card className="space-y-4 p-5">
          <Skeleton className="h-5 w-52" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  if (loadFailed || !draft || !defaults) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <EmptyState
          icon={<ShieldAlert className="size-5" />}
          title="Couldn't load Reporting Settings"
          description="If this keeps happening, your role may not include Reporting settings. Ask an administrator."
          action={{ label: "Try again", onClick: () => void load() }}
        />
      </div>
    );
  }

  const changedIn = (section: SectionKey) =>
    SECTIONS[section].fields.filter((field) => !same(getPath(draft, field.path), getPath(defaults, field.path))).length;

  return (
    <div className="flex flex-col gap-6">
      {heading}

      {!canEdit ? (
        <p className="text-muted-foreground text-sm">You can view these settings. Changing them needs the Reporting settings Edit permission.</p>
      ) : null}

      <PillTabs<View>
        value={view}
        onChange={setView}
        tabs={(
          [
          { value: "finance", label: "Invoicing", count: changedIn("finance") || undefined },
          { value: "quotations", label: "Quotations", count: changedIn("quotations") || undefined },
          { value: "attendance", label: "Check-in alerts", count: changedIn("attendance") || undefined },
          { value: "compliance", label: "Compliance", count: changedIn("compliance") || undefined },
          { value: "planning", label: "Capacity and exceptions", count: changedIn("planning") || undefined },
          { value: "links", label: "FSM report links", count: changedIn("links") || undefined },
          { value: "holidays", label: "Public holidays" },
          { value: "history", label: "Change history", count: history.length },
          { value: "fsm", label: "FSM data" },
          ] as Array<{ value: View; label: string; count?: number }>
        ).filter((tab) => !HIDDEN_TABS.has(tab.value))}
      />

      {view === "fsm" ? (
        <FsmFreshness />
      ) : view === "holidays" ? (
        <PublicHolidays canEdit={canEdit} onChanged={() => void refreshHistory()} />
      ) : view === "history" ? (
        <SettingsHistory history={history} />
      ) : (
        <SectionCard
          icon={SECTIONS[view].icon}
          title={SECTIONS[view].title}
          description={SECTIONS[view].description}
          bodyClassName="px-5 pb-5"
        >
          <div className="grid gap-5 md:grid-cols-2">
            {SECTIONS[view].fields.map((field) => (
              <SettingField
                key={field.path}
                field={field}
                value={getPath(draft, field.path)}
                defaultValue={getPath(defaults, field.path)}
                users={users}
                disabled={!canEdit || saving}
                problem={problems[field.path]}
                onChange={(value) => setDraft((current) => (current ? setPath(current, field.path, value) : current))}
              />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function SettingField({
  field,
  value,
  defaultValue,
  users,
  disabled,
  problem,
  onChange,
}: {
  field: Field;
  value: unknown;
  defaultValue: unknown;
  users: PickableUser[];
  disabled: boolean;
  problem?: string;
  onChange: (value: unknown) => void;
}) {
  const id = `reporting-${field.path.replace(/\./g, "-")}`;
  const changed = !same(value, defaultValue);
  /* Recipients start empty: there is no suggested value for them. */
  const hasSuggestion =
    field.kind !== "toggle" && !(defaultValue === null || (Array.isArray(defaultValue) && defaultValue.length === 0));

  const userOptions: Option[] = useMemo(() => users.map((u) => ({ value: u.id, label: u.name })), [users]);

  return (
    <div className={cn("grid content-start gap-1.5", (field.kind === "people" || field.kind === "url") && "md:col-span-2")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>{field.label}</Label>
          {aboutOf(field.path) ? <AboutSetting label={field.label} text={aboutOf(field.path)!} /> : null}
        </div>
        {changed && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-6 px-1.5 text-xs"
            onClick={() => onChange(structuredClone(defaultValue))}
          >
            <RotateCcw className="size-3" />
            Use suggested
          </Button>
        ) : null}
      </div>

      {field.kind === "number" ? (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            className="w-32"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            disabled={disabled}
            value={value === null || value === undefined ? "" : String(value)}
            placeholder="Not set"
            aria-invalid={Boolean(problem) || undefined}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw === "") {
                // Only the threshold may be empty; elsewhere an empty box keeps the old value.
                if (field.path === "compliance.thresholdPercent") onChange(null);
                return;
              }
              const parsed = Number(raw);
              if (Number.isFinite(parsed)) onChange(parsed);
            }}
          />
          <span className="text-muted-foreground text-sm">{field.unit}</span>
        </div>
      ) : field.kind === "toggle" ? (
        <div className="flex items-center gap-2">
          <Switch id={id} checked={Boolean(value)} disabled={disabled} onCheckedChange={(checked) => onChange(checked)} />
          <span className="text-muted-foreground text-sm">{value ? "On" : "Off"}</span>
        </div>
      ) : field.kind === "url" ? (
        <Input
          id={id}
          type="url"
          inputMode="url"
          disabled={disabled}
          value={String(value ?? "")}
          placeholder="https://fsm.zoho.com/..."
          aria-invalid={Boolean(problem) || undefined}
          onChange={(event) => onChange(event.target.value.trim() ? event.target.value.trim() : null)}
        />
      ) : field.kind === "time" ? (
        <Input
          id={id}
          type="time"
          className="w-32"
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(event) => event.target.value && onChange(event.target.value)}
        />
      ) : (
        <MultipleSelector
          value={userOptions.filter((o) => (value as string[]).includes(o.value))}
          options={userOptions}
          disabled={disabled}
          placeholder="Choose people"
          onChange={(options) => onChange(options.map((o) => o.value))}
          emptyIndicator={<span className="text-muted-foreground">No active users found</span>}
        />
      )}

      {problem ? <p className="text-destructive text-xs">{problem}</p> : null}
      {field.hint ? <p className="text-muted-foreground text-xs">{field.hint}</p> : null}
      <p className="text-muted-foreground text-xs empty:hidden">
        {changed
          ? `Changed. ${hasSuggestion ? "Suggested" : "Default"}: ${display(defaultValue, field, users)}.`
          : hasSuggestion
            ? "Suggested value, to be confirmed."
            : null}
      </p>
    </div>
  );
}

const HISTORY_COLUMNS: ColumnDef<ReportingSettingsHistoryEntry>[] = [
  {
    id: "actor",
    header: "Changed by",
    cell: ({ row }) => <IdentityCell title={row.original.actorLabel ?? "Unknown user"} subtitle={null} icon={UserRound} />,
    enableSorting: false,
  },
  {
    id: "when",
    header: "When",
    cell: ({ row }) => (
      <IconText icon={Clock} muted>
        <time dateTime={row.original.createdAt}>
          {new Date(row.original.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
        </time>
      </IconText>
    ),
    enableSorting: false,
  },
  {
    id: "changed",
    header: "What changed",
    cell: ({ row }) => (
      <div className="flex max-w-xl flex-wrap gap-1">
        {row.original.changedKeys.map((key) => (
          <Badge key={key} variant="secondary" className="border-0 font-normal">
            {FIELD_LABELS.get(key) ?? key}
          </Badge>
        ))}
      </div>
    ),
    enableSorting: false,
  },
];

function SettingsHistory({ history }: { history: ReportingSettingsHistoryEntry[] }) {
  return (
    <SectionCard
      icon={<History />}
      title="Change history"
      description="The latest changes: who made them, what they changed, and when."
      bodyClassName="border-t"
    >
      <DataTable
        columns={HISTORY_COLUMNS}
        data={history}
        loading={false}
        rowCount={history.length}
        pageSize={Math.max(history.length, 1)}
        currentPage={0}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        onGlobalFilterChange={() => undefined}
        emptyState={
          <EmptyState
            className="border-0"
            icon={<ScrollText className="size-5" />}
            title="No changes yet"
            description="Every setting still uses its suggested value."
          />
        }
      />
    </SectionCard>
  );
}
