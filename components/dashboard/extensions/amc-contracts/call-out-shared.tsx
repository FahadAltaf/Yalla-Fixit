"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Copy, ExternalLink, ImagePlus, LoaderCircleIcon, RefreshCwIcon, SearchIcon, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { StatusSelect } from "@/components/data-table/toolbars/status-select";
import { ActionDialogContent, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/use-debounce";
import {
  ADDITIONAL_WORK_STATUS_LABELS,
  CALL_OUT_PRIORITY_LABELS,
  CALL_OUT_STATUS_LABELS,
  WORK_RISK_LABELS,
  type AdditionalWorkStatus,
  type CallOutPriority,
  type CallOutStatus,
  type SlaState,
  type WorkRisk,
} from "@/lib/amc/call-outs";
import { AMC_PHOTO_MAX_BYTES } from "@/lib/amc/photos";
import { cn } from "@/lib/utils";
import { amcContractsService, type ContractListRow } from "@/modules/amc-contracts/amc-contracts-service";

/**
 * Pieces the call-out and additional-work screens share (Phase 11): the
 * status, priority, SLA, coverage and risk badges, a prepared WhatsApp
 * message, a photo grid with upload, the active-contract picker, and the
 * small layout helpers the AMC dialogs use. Theme tokens only.
 */

/* ------------------------------------------------------------------ */
/* Tones and badges                                                    */
/* ------------------------------------------------------------------ */

const CALL_OUT_STATUS_TONE: Record<CallOutStatus, string> = {
  logged: "bg-mist text-ink-soft",
  scheduled: "bg-brand-50 text-brand",
  attended: "bg-brand-100 text-brand",
  pending_works: "bg-warning/10 text-warning",
  quoted: "bg-warning/10 text-warning",
  resolved: "bg-success/10 text-success",
  closed: "bg-success/10 text-success",
  cancelled: "bg-mist text-ink-soft line-through",
};

const WORK_STATUS_TONE: Record<AdditionalWorkStatus, string> = {
  identified: "bg-mist text-ink-soft",
  quotation_prepared: "bg-brand-50 text-brand",
  shared: "bg-brand-100 text-brand",
  approved: "bg-success/10 text-success",
  rejected: "bg-danger/10 text-danger",
  scheduled: "bg-brand-50 text-brand",
  completed: "bg-success/10 text-success",
  invoiced: "bg-warning/10 text-warning",
  paid: "bg-success/10 text-success",
};

const RISK_TONE: Record<WorkRisk, string> = {
  low: "bg-mist text-ink-soft",
  medium: "bg-warning/10 text-warning",
  high: "bg-danger/10 text-danger",
  safety: "bg-danger text-on-tone",
};

const SLA_BADGE: Record<SlaState, { label: string; tone: string }> = {
  met: { label: "SLA met", tone: "bg-success/10 text-success" },
  missed: { label: "SLA missed", tone: "bg-danger/10 text-danger" },
  at_risk: { label: "SLA at risk", tone: "bg-warning/10 text-warning" },
  on_track: { label: "On track", tone: "bg-brand-50 text-brand" },
};

function Tint({ tone, title, children, className }: { tone: string; title?: string; children: ReactNode; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", tone, className)} title={title}>
      {children}
    </Badge>
  );
}

export function CallOutStatusBadge({ status }: { status: CallOutStatus }) {
  return <Tint tone={CALL_OUT_STATUS_TONE[status] ?? "bg-mist text-ink-soft"}>{CALL_OUT_STATUS_LABELS[status] ?? status}</Tint>;
}

export function PriorityBadge({ priority }: { priority: CallOutPriority }) {
  return (
    <Tint tone={priority === "emergency" ? "bg-danger/10 text-danger" : "bg-mist text-ink-soft"}>{CALL_OUT_PRIORITY_LABELS[priority] ?? priority}</Tint>
  );
}

export function SlaBadge({ state, dueAt, withDue = true }: { state: SlaState | null; dueAt: string | null; withDue?: boolean }) {
  if (!state) return <Muted>—</Muted>;
  const badge = SLA_BADGE[state];
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Tint tone={badge.tone}>{badge.label}</Tint>
      {withDue && dueAt ? <span className="text-muted-foreground text-xs whitespace-nowrap">Due {shortDateTime(dueAt)}</span> : null}
    </span>
  );
}

export function CoverageBadge({ coverage, reserved }: { coverage: "covered" | "chargeable"; reserved?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Tint tone={coverage === "covered" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}>
        {coverage === "covered" ? "Covered" : "Chargeable"}
      </Tint>
      {reserved ? (
        <Tint tone="bg-brand-50 text-brand" title="A unit of the allowance is held until the work is done">
          Booked
        </Tint>
      ) : null}
    </span>
  );
}

export function WorkStatusBadge({ status }: { status: AdditionalWorkStatus | string }) {
  const s = status as AdditionalWorkStatus;
  return <Tint tone={WORK_STATUS_TONE[s] ?? "bg-mist text-ink-soft"}>{ADDITIONAL_WORK_STATUS_LABELS[s] ?? status}</Tint>;
}

export function RiskBadge({ risk }: { risk: WorkRisk | string }) {
  const r = risk as WorkRisk;
  return <Tint tone={RISK_TONE[r] ?? "bg-mist text-ink-soft"}>{WORK_RISK_LABELS[r] ?? risk}</Tint>;
}

/* ------------------------------------------------------------------ */
/* Times                                                               */
/* ------------------------------------------------------------------ */

/** "12 Oct 14:30". */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "d MMM HH:mm");
}

/** An ISO timestamp as a datetime-local value, in the browser's time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : format(d, "yyyy-MM-dd'T'HH:mm");
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Now, as a datetime-local value (for a form's first value). */
export const nowLocalInput = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");

export const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/* ------------------------------------------------------------------ */
/* Layout pieces                                                       */
/* ------------------------------------------------------------------ */

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground font-normal">{children}</span>;
}

export function Panel({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-3 rounded-lg border px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          {description ? <p className="text-muted-foreground mt-0.5 text-xs">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
    </div>
  );
}

export function ReadText({ value, empty = "—" }: { value: string | null | undefined; empty?: string }) {
  return value?.trim() ? <p className="text-sm whitespace-pre-wrap">{value}</p> : <p className="text-muted-foreground text-sm">{empty}</p>;
}

/* ------------------------------------------------------------------ */
/* A prepared WhatsApp message                                         */
/* ------------------------------------------------------------------ */

export function PreparedMessage({
  title = "The WhatsApp message",
  message,
  whatsapp,
  onDismiss,
  children,
}: {
  title?: string;
  message: string;
  whatsapp: string | null;
  onDismiss?: () => void;
  /** More actions beside Copy and Send. */
  children?: ReactNode;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Message copied");
    } catch {
      toast.error("Could not copy the message.");
    }
  };
  return (
    <div className="border-brand/30 bg-brand-50 grid gap-3 rounded-lg border px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        {onDismiss ? (
          <Button size="icon" variant="ghost" className="-mt-1 -mr-2 size-7" aria-label="Dismiss the message" onClick={onDismiss}>
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <p className="text-sm whitespace-pre-wrap">{message}</p>
      {!whatsapp ? <p className="text-warning text-xs">No phone number on file: copy the message and send it yourself.</p> : null}
      <div className="flex flex-wrap gap-2">
        {whatsapp ? (
          <Button size="sm" asChild>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              Send on WhatsApp
            </a>
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          <Copy className="size-3.5" />
          Copy text
        </Button>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

export interface PhotoItem {
  id: string;
  kind: string;
  caption: string | null;
  url: string | null;
}

/**
 * A photo grid with upload (kind chosen first) and removal, for a call out
 * or an additional work. The caller posts and reloads; a failure is a toast.
 */
export function PhotosPanel<K extends string>({
  title = "Photos",
  description,
  photos,
  kinds,
  labels,
  editable,
  disabled,
  upload,
  remove,
  onUploaded,
}: {
  title?: string;
  description?: string;
  photos: PhotoItem[];
  kinds: readonly K[];
  labels: Record<K, string>;
  editable: boolean;
  disabled?: boolean;
  upload: (file: File, kind: K) => Promise<unknown>;
  /** Called after the person confirms; reloads itself. */
  remove: (photoId: string) => Promise<unknown>;
  /** Run once after a batch of uploads (reload). */
  onUploaded?: () => unknown;
}) {
  const [kind, setKind] = useState<K>(kinds[0]);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const kindId = useId();
  const { confirm, dialog } = useConfirm();
  const labelOf = (k: string) => labels[k as K] ?? k;

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let added = 0;
    try {
      for (const file of Array.from(files)) {
        if (file.size > AMC_PHOTO_MAX_BYTES) {
          toast.error(`${file.name} is larger than 10 MB.`);
          continue;
        }
        await upload(file, kind);
        added += 1;
      }
      if (added) toast.success(added === 1 ? "Photo added" : `${added} photos added`);
    } catch (e) {
      toast.error(errorText(e, "Could not add the photo."));
    } finally {
      if (input.current) input.current.value = "";
      if (added) await onUploaded?.();
      setUploading(false);
    }
  };

  const ask = (photoId: string) =>
    void confirm({
      title: "Remove this photo?",
      description: "It is removed for good.",
      confirmText: "Remove",
      variant: "destructive",
      action: async () => {
        await remove(photoId);
        toast.success("Photo removed");
      },
    });

  return (
    <Panel title={title} description={description}>
      {photos.length === 0 ? (
        <p className="text-muted-foreground text-sm">No photos yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.id} className="relative overflow-hidden rounded-lg border">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable */}
                  <img src={p.url} alt={p.caption ?? `${labelOf(p.kind)} photo`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                </a>
              ) : (
                <div className="bg-muted text-muted-foreground flex aspect-[4/3] items-center justify-center text-xs">Unavailable</div>
              )}
              <Badge variant="secondary" className="bg-background/90 text-foreground absolute bottom-1.5 left-1.5 border-0 font-medium">
                {labelOf(p.kind)}
              </Badge>
              {editable ? (
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute top-1.5 right-1.5 size-7 opacity-90"
                  aria-label="Remove photo"
                  disabled={disabled || uploading}
                  onClick={() => ask(p.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
              {p.caption ? <p className="text-muted-foreground truncate px-2 py-1 text-xs">{p.caption}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-2">
            <Label htmlFor={kindId}>Photo of</Label>
            <Select value={kind} onValueChange={(k) => setKind(k as K)}>
              <SelectTrigger id={kindId} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    {labels[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => void add(e.target.files)} />
          <SubmitButton
            variant="outline"
            pending={uploading}
            pendingLabel="Uploading…"
            disabled={disabled}
            icon={<ImagePlus className="size-4" />}
            onClick={() => input.current?.click()}
          >
            Add photos
          </SubmitButton>
          <p className="text-muted-foreground w-full text-xs">JPEG, PNG or WebP, up to 10 MB each. Stored privately.</p>
        </div>
      ) : null}
      {dialog}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* The active-contract picker                                          */
/* ------------------------------------------------------------------ */

export type PickedContract = Pick<ContractListRow, "id" | "proposalNumber" | "customerName" | "propertyLabel">;

/* Call outs and additional work go on a contract in force (the server checks again). */
const LIVE_STATUSES: readonly string[] = ["active", "expiring", "on_hold"];

/**
 * Search the contracts list (the same call as Check coverage) and pick an
 * active one. Shows the pick with a Change link once chosen.
 */
export function ContractPicker({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: PickedContract | null;
  onChange: (contract: PickedContract | null) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const search = useDebounce(text.trim(), 300);
  const [found, setFound] = useState<{ key: string; rows: ContractListRow[] } | null>(null);

  useEffect(() => {
    if (!search || value) return;
    let stale = false;
    amcContractsService.list({ status: "all", search, page: 0, pageSize: 25 }).then(
      (r) =>
        !stale &&
        setFound({ key: search, rows: r.rows.filter((row) => row.kind === "contract" && LIVE_STATUSES.includes(row.displayStatus)).slice(0, 8) }),
      () => !stale && setFound({ key: search, rows: [] }),
    );
    return () => {
      stale = true;
    };
  }, [search, value]);

  const matches = found?.key === search ? found.rows : null;

  if (value) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
        <span className="min-w-0">
          <span className="font-medium">{value.proposalNumber}</span> · {value.customerName || "Client"}
          {value.propertyLabel ? <span className="text-muted-foreground block truncate text-xs">{value.propertyLabel}</span> : null}
        </span>
        <Button size="sm" variant="ghost" className="h-7 px-2" disabled={disabled} onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Input id={id} placeholder="Search by client, property or contract number" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
      {!search ? null : matches === null ? (
        <p className="text-muted-foreground text-xs">Searching…</p>
      ) : matches.length === 0 ? (
        <p className="text-muted-foreground text-xs">No active contract matches.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" className="hover:bg-muted w-full px-3 py-2 text-left" onClick={() => onChange(m)}>
                <span className="font-medium">{m.proposalNumber}</span> · {m.customerName}
                <span className="text-muted-foreground block truncate text-xs">{m.propertyLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A small form that performs one action                               */
/* ------------------------------------------------------------------ */

export interface ActionField {
  key: string;
  label: string;
  type?: "text" | "textarea" | "date" | "datetime";
  /** Fewer characters than this blocks the submit (0 or left out = optional). */
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
  hint?: ReactNode;
  initial?: string;
}

export interface ActionFormRequest {
  title: string;
  description: string;
  fields: ActionField[];
  confirmText: string;
  pendingLabel?: string;
  icon?: ReactNode;
  variant?: "default" | "destructive";
  /** Posts; a thrown error is a toast and the dialog stays open. Resolves to close. */
  submit: (values: Record<string, string>) => Promise<unknown>;
}

/**
 * One dialog for the reason / note / evidence / date asks (close, cancel,
 * flag misuse, approve, reject, schedule, invoice, paid). Mount it with a
 * `key` that changes on every open so its fields start from `initial`.
 */
export function ActionFormDialog({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ActionFormRequest | null;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((request?.fields ?? []).map((f) => [f.key, f.initial ?? ""])),
  );
  const [busy, setBusy] = useState(false);
  const base = useId();

  const fields = request?.fields ?? [];
  const valid = fields.every((f) => !f.minLength || (values[f.key] ?? "").trim().length >= f.minLength);

  const submit = async () => {
    if (!request || !valid) return;
    setBusy(true);
    try {
      await request.submit(Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? "").trim()])));
      onOpenChange(false);
    } catch (e) {
      toast.error(errorText(e, "That did not work. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          <DialogDescription>{request?.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          {fields.map((f) => {
            const id = `${base}-${f.key}`;
            const value = values[f.key] ?? "";
            const set = (v: string) => setValues((cur) => ({ ...cur, [f.key]: v }));
            const label = f.minLength ? f.label : `${f.label} (optional)`;
            return (
              <Field key={f.key} id={id} label={label} hint={f.hint}>
                {f.type === "textarea" ? (
                  <Textarea id={id} rows={3} maxLength={f.maxLength ?? 1000} placeholder={f.placeholder} value={value} onChange={(e) => set(e.target.value)} />
                ) : (
                  <Input
                    id={id}
                    type={f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text"}
                    maxLength={f.type === "text" || !f.type ? (f.maxLength ?? 200) : undefined}
                    placeholder={f.placeholder}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                  />
                )}
              </Field>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton
            variant={request?.variant === "destructive" ? "destructive" : "default"}
            pending={busy}
            pendingLabel={request?.pendingLabel ?? "Saving…"}
            disabled={!valid}
            icon={request?.icon}
            onClick={() => void submit()}
          >
            {request?.confirmText}
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/** Opens ActionFormDialog by request; render `dialog` once in the screen. */
export function useActionForm() {
  const [state, setState] = useState<{ open: boolean; request: ActionFormRequest | null; key: number }>({ open: false, request: null, key: 0 });
  const ask = (request: ActionFormRequest) => setState((s) => ({ open: true, request, key: s.key + 1 }));
  const dialog = (
    <ActionFormDialog key={state.key} open={state.open} request={state.request} onOpenChange={(open) => !open && setState((s) => ({ ...s, open: false }))} />
  );
  return { ask, dialog };
}

/* ------------------------------------------------------------------ */
/* A dialog opened from ?open=<id>                                     */
/* ------------------------------------------------------------------ */

/**
 * useDialog, seeded from ?open=<id> (notification links) and dropping the
 * parameter on close so a refresh does not open it again. Needs a
 * Suspense boundary above it (useSearchParams).
 */
export function useUrlDialog(param = "open") {
  const searchParams = useSearchParams();
  const [state, setState] = useState<{ open: boolean; target: string | null; key: number }>(() => {
    const id = searchParams.get(param);
    return { open: Boolean(id), target: id, key: 0 };
  });
  const show = useCallback((target: string) => setState((s) => ({ open: true, target, key: s.key + 1 })), []);
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      setState((s) => ({ ...s, open: false }));
      const query = new URLSearchParams(window.location.search);
      if (query.has(param)) {
        query.delete(param);
        const qs = query.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
      }
    },
    [param],
  );
  return { ...state, show, onOpenChange };
}

/* ------------------------------------------------------------------ */
/* The list toolbar                                                    */
/* ------------------------------------------------------------------ */

export interface ToolbarFilter {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string; count?: number }>;
  label: string;
}

/** The same shape as Snagging's jobs toolbar: search and filters on the left, page size and Refresh on the right. */
export function ListToolbar({
  search,
  onSearchChange,
  placeholder,
  searchLabel,
  loading,
  filters,
  pageSize,
  onPageSizeChange,
  onRefresh,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  searchLabel: string;
  loading: boolean;
  filters: ToolbarFilter[];
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
}) {
  const searchId = useId();
  const rowsId = useId();
  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80 sm:flex-none">
            <Input
              id={searchId}
              type="search"
              placeholder={placeholder}
              className="peer w-full ps-9"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label={searchLabel}
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
              {loading ? <LoaderCircleIcon aria-label="Loading..." className="animate-spin" role="status" size={16} /> : <SearchIcon aria-hidden="true" size={16} />}
            </div>
          </div>
          {filters.map((f) => (
            <StatusSelect key={f.label} options={f.options} value={f.value} onChange={f.onChange} label={f.label} />
          ))}
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
