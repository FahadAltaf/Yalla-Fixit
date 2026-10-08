"use client";

import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Car, Database, HardHat, IdCard, KeyRound, LoaderCircleIcon, RefreshCwIcon, SearchIcon, Save, X } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TRADE_LABELS, TRADES } from "@/lib/amc/client-profile";
import { todayInDubai } from "@/lib/amc/contracts";
import { SKILL_LEVEL_LABELS, SKILL_LEVELS, type SkillLevel, type Trade } from "@/lib/amc/visits";
import { visitsService, type TechnicianProfileInput, type TechnicianRecord } from "@/modules/amc-contracts/visits-service";

import { AmcNotificationsBell } from "./amc-notifications-bell";
import { formatContractDate } from "./contract-status";
import { useAmcData } from "./use-amc-data";
import { useDialog } from "./profile/use-dialog";
import { SKILL_TONE } from "./visit-status";

const TRADE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "any", label: "All trades" },
  ...TRADES.map((t) => ({ value: t, label: TRADE_LABELS[t] })),
];

const isExpired = (expires: string | null, today: string) => Boolean(expires && expires < today);

/**
 * AMC -> Technicians (DEV-356, 395): the FSM technicians with what AMC
 * knows about them: trades and level, certificates, areas, vehicle and
 * the access permissions they hold. The visit board suggests a crew from
 * this, so a technician missing a trade here is never suggested for it.
 * Everyone in AMC can read it; AMC Visits (Edit) changes it.
 */
export function TechniciansPage() {
  const { data, error, loading, reload } = useAmcData(() => visitsService.technicians(), "technicians");
  const [search, setSearch] = useState("");
  const [trade, setTrade] = useState("any");
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const editing = useDialog<TechnicianRecord>();
  const today = todayInDubai();

  const canEdit = data?.canEdit ?? false;
  const term = search.trim().toLowerCase();
  const all = useMemo(() => data?.technicians ?? [], [data]);
  const matching = useMemo(
    () =>
      all.filter(
        (t) =>
          (!activeOnly || t.active) &&
          (trade === "any" || t.skills.some((s) => s.trade === trade)) &&
          (!term || [t.name, t.role, t.shift, ...t.areas].some((v) => v?.toLowerCase().includes(term))),
      ),
    [all, activeOnly, trade, term],
  );
  const rows = matching.slice(page * pageSize, (page + 1) * pageSize);
  const filtered = Boolean(term) || trade !== "any" || activeOnly;

  const columns = useMemo<ColumnDef<TechnicianRecord>[]>(
    () => [
      {
        id: "name",
        header: "Technician",
        cell: ({ row }) => (
          <IdentityCell
            title={row.original.name}
            subtitle={row.original.role ?? "No role in FSM"}
            icon={HardHat}
            badge={
              row.original.active ? null : (
                <Badge variant="secondary" className="bg-mist text-ink-soft border-0 font-medium">
                  Inactive
                </Badge>
              )
            }
          />
        ),
      },
      {
        id: "shift",
        header: "Shift",
        cell: ({ row }) => (row.original.shift ? <span className="text-sm">{row.original.shift}</span> : <span className="text-muted-foreground text-sm">—</span>),
      },
      {
        id: "trades",
        header: "Trades",
        cell: ({ row }) => <SkillBadges skills={row.original.skills} today={today} />,
      },
      {
        id: "areas",
        header: "Areas",
        cell: ({ row }) =>
          row.original.areas.length ? (
            <span className="line-clamp-2 max-w-[220px] text-sm">{row.original.areas.join(", ")}</span>
          ) : (
            <span className="text-muted-foreground text-sm">Any</span>
          ),
      },
      {
        id: "transport",
        header: "Vehicle",
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            {row.original.hasVehicle ? (
              <span title="Has a vehicle" className="text-foreground">
                <Car className="size-4" aria-hidden />
                <span className="sr-only">Has a vehicle</span>
              </span>
            ) : null}
            {row.original.isDriver ? (
              <span title="Can drive" className="text-foreground">
                <IdCard className="size-4" aria-hidden />
                <span className="sr-only">Can drive</span>
              </span>
            ) : null}
            {!row.original.hasVehicle && !row.original.isDriver ? <span className="text-muted-foreground text-sm">—</span> : null}
          </span>
        ),
      },
      {
        id: "access",
        header: "Access",
        cell: ({ row }) =>
          row.original.accessPermissions.length ? (
            <span className="inline-flex items-center gap-1.5 text-sm" title={row.original.accessPermissions.join(", ")}>
              <KeyRound className="text-muted-foreground size-3.5" aria-hidden />
              {row.original.accessPermissions.length}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
      },
    ],
    [today],
  );

  const clearFilters = () => {
    setSearch("");
    setTrade("any");
    setActiveOnly(false);
    setPage(0);
  };

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Configuration"
        title="Technicians"
        description="Each technician's trades, level, certificates and access permissions decide who the visit board suggests for a visit."
        actions={<AmcNotificationsBell />}
      />

      {data && !data.migrated ? (
        <Alert className="border-warning/30 bg-warning/5 items-start p-4">
          <Database className="text-warning" />
          <AlertTitle>Technician skills need a database update</AlertTitle>
          <AlertDescription>
            The technician skills tables are not on this database yet (migration 20261008120000). Ask an admin to apply it.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? <ErrorState title="Could not load the technicians" message={error} onRetry={reload} /> : null}

      <Card className="py-0">
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          rowCount={matching.length}
          pageSize={pageSize}
          currentPage={page}
          isPagination
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          onGlobalFilterChange={setSearch}
          handleRowClick={canEdit && data?.migrated ? (row) => editing.show(row) : undefined}
          toolbar={
            <TechniciansToolbar
              search={search}
              onSearchChange={(v) => {
                setSearch(v);
                setPage(0);
              }}
              loading={loading}
              trade={trade}
              onTradeChange={(v) => {
                setTrade(v);
                setPage(0);
              }}
              activeOnly={activeOnly}
              onActiveOnlyChange={(v) => {
                setActiveOnly(v);
                setPage(0);
              }}
              pageSize={pageSize}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              onRefresh={reload}
            />
          }
          emptyState={
            <EmptyState
              icon={<HardHat />}
              title={all.length && filtered ? "No matching technicians" : "No technicians yet"}
              description={
                all.length && filtered
                  ? "Nobody matches this search and filter."
                  : "Technicians come from the FSM roster. Once it syncs, they appear here to add their skills."
              }
              action={all.length && filtered ? { label: "Clear filters", variant: "outline", onClick: clearFilters } : undefined}
            />
          }
        />
      </Card>

      <EditTechnicianDialog
        key={editing.key}
        open={editing.open}
        onOpenChange={editing.onOpenChange}
        technician={editing.target}
        today={today}
        onSaved={reload}
      />
    </div>
  );
}

function SkillBadges({ skills, today }: { skills: TechnicianRecord["skills"]; today: string }) {
  if (!skills.length) return <span className="text-muted-foreground text-sm">None yet</span>;
  return (
    <div className="flex max-w-[320px] flex-wrap gap-1">
      {[...skills]
        .sort((a, b) => TRADES.indexOf(a.trade) - TRADES.indexOf(b.trade))
        .map((s) => {
          const expired = isExpired(s.certificateExpires, today);
          return (
            <Badge
              key={s.trade}
              variant="secondary"
              className={`border-0 font-medium ${expired ? "bg-danger/10 text-danger" : SKILL_TONE[s.level]}`}
              title={s.certificateExpires ? `Certificate ${expired ? "expired" : "valid until"} ${formatContractDate(s.certificateExpires)}` : undefined}
            >
              {TRADE_LABELS[s.trade]} · {SKILL_LEVEL_LABELS[s.level]}
              {expired ? " · expired" : ""}
            </Badge>
          );
        })}
    </div>
  );
}

/** The same shape as Snagging's jobs toolbar: search and filters on the left, page size and Refresh on the right. */
function TechniciansToolbar({
  search,
  onSearchChange,
  loading,
  trade,
  onTradeChange,
  activeOnly,
  onActiveOnlyChange,
  pageSize,
  onPageSizeChange,
  onRefresh,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  trade: string;
  onTradeChange: (value: string) => void;
  activeOnly: boolean;
  onActiveOnlyChange: (value: boolean) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
}) {
  const searchId = useId();
  const rowsId = useId();
  const activeId = useId();

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80 sm:flex-none">
            <Input
              id={searchId}
              type="search"
              placeholder="Search name, role, shift or area…"
              className="peer w-full ps-9"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label="Search technicians"
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
              {loading ? <LoaderCircleIcon aria-label="Loading..." className="animate-spin" role="status" size={16} /> : <SearchIcon aria-hidden="true" size={16} />}
            </div>
          </div>
          <StatusSelect options={TRADE_OPTIONS} value={trade} onChange={onTradeChange} label="Filter by trade" />
          <div className="flex items-center gap-2 px-1">
            <Switch id={activeId} checked={activeOnly} onCheckedChange={onActiveOnlyChange} />
            <Label htmlFor={activeId} className="text-sm font-normal whitespace-nowrap">
              Active only
            </Label>
          </div>
        </div>

        <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="hidden w-full items-center gap-2 sm:flex sm:w-auto">
            <Label htmlFor={rowsId} className="sr-only">
              Show
            </Label>
            <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger id={rowsId} className="w-full whitespace-nowrap sm:w-fit">
                <SelectValue placeholder="Select number of results" />
              </SelectTrigger>
              <SelectContent className="[&_*[role=option]]:pr-8 [&_*[role=option]]:pl-2 [&_*[role=option]>span]:right-2 [&_*[role=option]>span]:left-auto">
                {[10, 25, 50].map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={onRefresh} variant="outline" disabled={loading}>
            <RefreshCwIcon className="size-4 sm:mr-1" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Edit                                                                */
/* ------------------------------------------------------------------ */

type SkillRow = { on: boolean; level: SkillLevel; certificate: string; expires: string };

function skillRows(t: TechnicianRecord | null): Record<Trade, SkillRow> {
  return Object.fromEntries(
    TRADES.map((trade) => {
      const s = t?.skills.find((k) => k.trade === trade);
      return [trade, { on: Boolean(s), level: s?.level ?? "competent", certificate: s?.certificate ?? "", expires: s?.certificateExpires ?? "" }];
    }),
  ) as Record<Trade, SkillRow>;
}

/* Remounted per open (key), so the form starts from the technician it was opened for. */
function EditTechnicianDialog({
  open,
  onOpenChange,
  technician,
  today,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technician: TechnicianRecord | null;
  today: string;
  onSaved: () => void;
}) {
  const [skills, setSkills] = useState(() => skillRows(technician));
  const [areas, setAreas] = useState<string[]>(technician?.areas ?? []);
  const [tools, setTools] = useState<string[]>(technician?.tools ?? []);
  const [access, setAccess] = useState<string[]>(technician?.accessPermissions ?? []);
  const [hasVehicle, setHasVehicle] = useState(technician?.hasVehicle ?? false);
  const [isDriver, setIsDriver] = useState(technician?.isDriver ?? false);
  const [notes, setNotes] = useState(technician?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const vehicleId = useId();
  const driverId = useId();
  const notesId = useId();

  const setSkill = (trade: Trade, patch: Partial<SkillRow>) => setSkills((cur) => ({ ...cur, [trade]: { ...cur[trade], ...patch } }));

  const save = async () => {
    if (!technician) return;
    const input: TechnicianProfileInput = {
      areas,
      tools,
      accessPermissions: access,
      hasVehicle,
      isDriver,
      notes: notes.trim() || null,
      skills: TRADES.filter((t) => skills[t].on).map((t) => ({
        trade: t,
        level: skills[t].level,
        certificate: skills[t].certificate.trim() || null,
        certificateExpires: skills[t].expires || null,
      })),
    };
    setSaving(true);
    try {
      await visitsService.saveTechnician(technician.fsmId, input);
      toast.success(`${technician.name} saved`);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the technician.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <ActionDialogContent busy={saving} className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit technician</DialogTitle>
          <DialogDescription>
            {technician ? `${technician.name}: ` : ""}the trades and permissions the visit board checks before it suggests or accepts them for a visit.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <span className="text-sm font-medium">Trades</span>
            <div className="divide-y rounded-lg border">
              {TRADES.map((trade) => {
                const row = skills[trade];
                const expired = row.on && isExpired(row.expires || null, today);
                return (
                  <div key={trade} className="grid gap-3 px-3 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Checkbox checked={row.on} onCheckedChange={(v) => setSkill(trade, { on: v === true })} />
                      {TRADE_LABELS[trade]}
                    </label>
                    <Select value={row.level} onValueChange={(v) => setSkill(trade, { level: v as SkillLevel })} disabled={!row.on}>
                      <SelectTrigger className="w-full" aria-label={`${TRADE_LABELS[trade]} level`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SKILL_LEVELS.map((l) => (
                          <SelectItem key={l} value={l}>
                            {SKILL_LEVEL_LABELS[l]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Certificate"
                      aria-label={`${TRADE_LABELS[trade]} certificate`}
                      value={row.certificate}
                      maxLength={200}
                      disabled={!row.on}
                      onChange={(e) => setSkill(trade, { certificate: e.target.value })}
                    />
                    <Input
                      type="date"
                      aria-label={`${TRADE_LABELS[trade]} certificate expiry`}
                      value={row.expires}
                      disabled={!row.on}
                      className={expired ? "border-danger text-danger" : undefined}
                      onChange={(e) => setSkill(trade, { expires: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-muted-foreground text-xs">
              A trainee, or a certificate past its expiry, is never suggested for that trade. Leave the expiry empty when the certificate does not run out.
            </p>
          </div>

          <ChipsField label="Areas" hint="Communities or areas they usually cover. Empty means anywhere." values={areas} onChange={setAreas} max={30} />
          <ChipsField label="Tools" values={tools} onChange={setTools} max={50} />
          <ChipsField
            label="Access permissions"
            hint="Gate pass types they hold, spelled as on the property's access rules."
            values={access}
            onChange={setAccess}
            max={50}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <Switch id={vehicleId} checked={hasVehicle} onCheckedChange={setHasVehicle} />
              <Label htmlFor={vehicleId} className="font-normal">
                Has a vehicle
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id={driverId} checked={isDriver} onCheckedChange={setIsDriver} />
              <Label htmlFor={driverId} className="font-normal">
                Can drive
              </Label>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={notesId}>Notes</Label>
            <Textarea id={notesId} rows={3} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <SubmitButton pending={saving} pendingLabel="Saving…" icon={<Save className="size-4" />} disabled={!technician} onClick={() => void save()}>
            Save
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/** Values typed one at a time: Enter or a comma adds one, the cross removes it. */
function ChipsField({
  label,
  hint,
  values,
  onChange,
  max,
}: {
  label: string;
  hint?: ReactNode;
  values: string[];
  onChange: (values: string[]) => void;
  max: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const next = raw
      .split(",")
      .map((v) => v.trim().slice(0, 80))
      .filter((v) => v && !values.some((x) => x.toLowerCase() === v.toLowerCase()));
    if (next.length) onChange([...values, ...new Set(next)].slice(0, max));
    setDraft("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="focus-within:ring-ring/50 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 focus-within:ring-[3px]">
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="gap-1 pr-1 font-normal">
            {v}
            <button
              type="button"
              className="hover:bg-muted-foreground/20 rounded-sm p-0.5"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          id={id}
          className="placeholder:text-muted-foreground min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
          placeholder={values.length >= max ? "" : "Type and press Enter"}
          value={draft}
          disabled={values.length >= max}
          onChange={(e) => {
            /* A pasted list splits on its commas. */
            if (e.target.value.includes(",")) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
        />
      </div>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}
