"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  BadgeAlert,
  CalendarClock,
  Clock,
  History,
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

type View = "finance" | "quotations" | "attendance" | "compliance" | "planning" | "holidays" | "history" | "fsm";
type SectionKey = Exclude<View, "holidays" | "history" | "fsm">;

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
type Field = NumberField | TimeField | PeopleField;

const SECTIONS: Record<SectionKey, { title: string; description: string; icon: React.ReactNode; fields: Field[] }> = {
  finance: {
    title: "Invoicing queue and digest",
    description: "When Finance hears about new items, and when a waiting item counts as aged (E1, N1, N2).",
    icon: <ReceiptText />,
    fields: [
      { kind: "time", path: "finance.digestTimeLocal", label: "Daily digest time", hint: "Dubai time." },
      { kind: "people", path: "finance.digestRecipientUserIds", label: "Digest recipients", hint: "The Finance list. Nobody receives the digest until this is set." },
      { kind: "number", path: "finance.agedAfterDays", label: "Item aged after", unit: "days in Pending", min: 0, max: 365 },
    ],
  },
  quotations: {
    title: "Quotation ageing and expiry",
    description: "When a quotation is flagged for sitting too long in a status, or nearing the end of its validity (N7, N8). The status names are the BRD's; how they map onto FSM's statuses is still to confirm (D-13).",
    icon: <CalendarClock />,
    fields: [
      { kind: "number", path: "quotations.ageingDaysByStatus.notSent", label: "Not sent", unit: "days", min: 0, max: 365 },
      { kind: "number", path: "quotations.ageingDaysByStatus.sent", label: "Sent, awaiting the client", unit: "days", min: 0, max: 365 },
      { kind: "number", path: "quotations.ageingDaysByStatus.approved", label: "Approved, not yet scheduled", unit: "days", min: 0, max: 365 },
      { kind: "number", path: "quotations.expiryWarningDays", label: "Expiry warning", unit: "days before validity ends", min: 0, max: 365 },
      { kind: "people", path: "quotations.alertRecipientUserIds", label: "Ageing alert recipients", hint: "Behrouz and the managers (N7). The expiry warning (N8) goes to the quotation's owner. Nobody receives N7 until this is set." },
    ],
  },
  attendance: {
    title: "Check-in alerts and working hours",
    description: "How long after a shift or appointment starts a missing check-in is raised (N5, N6), and what counts as late.",
    icon: <Clock />,
    fields: [
      { kind: "number", path: "attendance.shiftCheckInAlertDelayMinutes", label: "Shift check-in alert after", unit: "minutes", min: 0, max: 240 },
      { kind: "number", path: "attendance.appointmentCheckInAlertDelayMinutes", label: "Appointment check-in alert after", unit: "minutes", min: 0, max: 240 },
      { kind: "number", path: "attendance.lateArrivalToleranceMinutes", label: "Late arrival tolerance", unit: "minutes", min: 0, max: 240 },
      {
        kind: "number",
        path: "attendance.unpaidBreakMinutes",
        label: "Unpaid break per shift",
        unit: "minutes",
        hint: "Taken off each shift for available hours. 0 until it is confirmed whether a working day is 8 or 9 hours (D-22).",
        min: 0,
        max: 240,
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
        hint: "Penalties apply below this. Not set by default: the BRD gives 90 % and 97 % in different places, and it is still to be decided (D-09).",
        min: 0,
        max: 100,
        step: 0.1,
      },
      { kind: "number", path: "compliance.penaltyPerMissAed", label: "Penalty per missed check-in", unit: "AED", min: 0, max: 100000, step: 0.01 },
      { kind: "number", path: "compliance.monthlyCapAed", label: "Monthly cap per technician", unit: "AED", min: 0, max: 100000, step: 0.01 },
      { kind: "number", path: "compliance.disputeCutoffDay", label: "Disputes close on day", unit: "of the month", min: 1, max: 28 },
      { kind: "people", path: "compliance.hrRecipientUserIds", label: "Monthly report recipients", hint: "HR and managers. Nobody receives the final report until this is set." },
    ],
  },
  planning: {
    title: "Capacity and exceptions",
    description: "How far ahead capacity looks, and when a completed job without the invoice flag is reported (N13).",
    icon: <CalendarClock />,
    fields: [
      { kind: "number", path: "capacity.horizonDays", label: "Capacity horizon", unit: "days", min: 1, max: 90 },
      { kind: "number", path: "exceptions.completedWithoutFlagAfterDays", label: "Completed without invoice flag after", unit: "days", min: 0, max: 365 },
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
      if (tab) setView(tab);
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
      description="Thresholds, alert timings, recipients and penalty settings for invoicing, reports and check-in compliance."
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
        tabs={[
          { value: "finance", label: "Invoicing", count: changedIn("finance") || undefined },
          { value: "quotations", label: "Quotations", count: changedIn("quotations") || undefined },
          { value: "attendance", label: "Check-in alerts", count: changedIn("attendance") || undefined },
          { value: "compliance", label: "Compliance", count: changedIn("compliance") || undefined },
          { value: "planning", label: "Capacity and exceptions", count: changedIn("planning") || undefined },
          { value: "holidays", label: "Public holidays" },
          { value: "history", label: "Change history", count: history.length },
          { value: "fsm", label: "FSM data" },
        ]}
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
  /* Recipients and the threshold have no BRD value; they start empty. */
  const hasSuggestion = !(defaultValue === null || (Array.isArray(defaultValue) && defaultValue.length === 0));

  const userOptions: Option[] = useMemo(() => users.map((u) => ({ value: u.id, label: u.name })), [users]);

  return (
    <div className={cn("grid content-start gap-1.5", field.kind === "people" && "md:col-span-2")}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{field.label}</Label>
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
            ? "Suggested value (BRD §6.6), to be confirmed."
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
