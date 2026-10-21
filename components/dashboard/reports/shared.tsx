"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bookmark, BookmarkPlus, Check, ChevronDown, DatabaseZap, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { timeAgo } from "@/components/dashboard/shared/kaizen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SavedFilter } from "@/lib/server/reports/access";
import { cn } from "@/lib/utils";
import { reportsService, type ReportFilters, type ReportKey } from "@/modules/reports/reports-service";

/**
 * What every report screen shares (BRD 5.2 B5; DEV-455): filters that
 * persist per user, saved filters, and how old the FSM data is.
 */

// ---------------------------------------------------------------------
// Filters that persist per user
// ---------------------------------------------------------------------

/**
 * The report's filters, as strings. On opening: a link's own filters win
 * (a notification opens the report on what it is about); otherwise the
 * person's last-used selection. Every change is remembered, quietly.
 */
export function useReportFilters<F extends ReportFilters>(report: ReportKey, defaults: F) {
  const searchParams = useSearchParams();
  const fromLink = useMemo(() => {
    const picked: Partial<F> = {};
    for (const key of Object.keys(defaults)) {
      const value = searchParams.get(key);
      if (value !== null) (picked as Record<string, string>)[key] = value;
    }
    return Object.keys(picked).length ? picked : null;
    // Read once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [filters, setFiltersState] = useState<F>(() => ({ ...defaults, ...(fromLink ?? {}) }));
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<SavedFilter[]>([]);

  const known = useCallback(
    (source: Record<string, unknown>): Partial<F> =>
      Object.fromEntries(
        Object.keys(defaults)
          .filter((key) => typeof source[key] === "string")
          .map((key) => [key, source[key] as string]),
      ) as Partial<F>,
    [defaults],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await reportsService.savedFilters(report);
        if (cancelled) return;
        setSaved(response.saved);
        if (!fromLink && response.lastUsed) setFiltersState({ ...defaults, ...known(response.lastUsed) });
      } catch {
        /* Saved filters are a convenience: the report still opens without them. */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [report, defaults, fromLink, known]);

  /* Remember the selection, a moment after the last change. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setFilters = useCallback(
    (next: F) => {
      setFiltersState(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void reportsService.rememberFilters(report, next).catch(() => undefined);
      }, 800);
    },
    [report],
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const saveAs = useCallback(
    async (name: string) => {
      const entry = await reportsService.saveFilters(report, name, filters);
      setSaved((current) =>
        [...current.filter((s) => s.id !== entry.id && s.name.toLowerCase() !== name.toLowerCase()), entry].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
    },
    [report, filters],
  );

  const remove = useCallback(async (id: string) => {
    await reportsService.deleteFilters(id);
    setSaved((current) => current.filter((s) => s.id !== id));
  }, []);

  const apply = useCallback(
    (entry: SavedFilter) => setFilters({ ...defaults, ...known(entry.filters) }),
    [defaults, known, setFilters],
  );

  return { filters, setFilters, ready, saved, saveAs, remove, apply };
}

// ---------------------------------------------------------------------
// Saved filters menu
// ---------------------------------------------------------------------

export function SavedFiltersMenu({
  saved,
  current,
  onApply,
  onSave,
  onRemove,
}: {
  saved: SavedFilter[];
  current: ReportFilters;
  onApply: (entry: SavedFilter) => void;
  onSave: (name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const isCurrent = (entry: SavedFilter) =>
    Object.keys({ ...entry.filters, ...current }).every((key) => (entry.filters[key] ?? "") === (current[key] ?? ""));

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave(name.trim());
      toast.success(`Saved as "${name.trim()}"`);
      setDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the filters");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Bookmark className="size-4" />
            <span className="hidden sm:inline">Saved filters</span>
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Your saved filters</DropdownMenuLabel>
          {saved.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-sm">None yet.</p>
          ) : (
            saved.map((entry) => (
              <DropdownMenuItem key={entry.id} onClick={() => onApply(entry)} className="justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  {isCurrent(entry) ? <Check className="size-4" /> : <span className="size-4" />}
                  <span className="truncate">{entry.name}</span>
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive rounded p-0.5"
                  aria-label={`Delete ${entry.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    void onRemove(entry.id)
                      .then(() => toast.success(`Deleted "${entry.name}"`))
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not delete"));
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setName("");
              setDialogOpen(true);
            }}
          >
            <BookmarkPlus className="size-4" />
            Save current filters…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save these filters</DialogTitle>
            <DialogDescription>Only you see your saved filters. Using a name you already have replaces it.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="saved-filter-name">Name</Label>
            <Input
              id="saved-filter-name"
              maxLength={60}
              value={name}
              placeholder="e.g. Sent, over AED 20,000"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------
// How old the FSM data is
// ---------------------------------------------------------------------

const RESOURCE_LABELS: Record<string, string> = {
  estimates: "quotations",
  work_orders: "work orders",
  appointments: "appointments",
};
const STALE_MS = 60 * 60 * 1000;
/* The sync runs every 15 minutes at go-live; an hour behind is worth a second look. */
const isStale = (at: string | null) => !at || Date.now() - Date.parse(at) > STALE_MS;

/** "FSM quotations updated 5 minutes ago", warning-coloured when stale. */
export function DataAsOf({ asOf, resources }: { asOf: Record<string, string | null> | null; resources: string[] }) {
  if (!asOf) return null;
  return (
    <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <DatabaseZap className="size-3.5" />
      {resources.map((resource) => {
        const at = asOf[resource] ?? null;
        const stale = isStale(at);
        return (
          <span key={resource} className={cn(stale && "text-warning")}>
            FSM {RESOURCE_LABELS[resource] ?? resource} {at ? `updated ${timeAgo(at)}` : "not loaded yet"}
          </span>
        );
      })}
    </p>
  );
}

// ---------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------

const QUOTATION_STATUS_STYLES: Record<string, string> = {
  notSent: "bg-mist text-ink-soft",
  sent: "bg-brand-50 text-brand",
  approved: "bg-success/10 text-success",
  converted: "bg-success/10 text-success",
  rejected: "bg-destructive/10 text-destructive",
  revised: "bg-warning/10 text-warning",
  expired: "bg-mist text-ink-soft",
};

export function QuotationStatusBadge({ statusKey, label }: { statusKey: string; label: string }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", QUOTATION_STATUS_STYLES[statusKey] ?? "bg-mist text-ink-soft")}>
      {label}
    </Badge>
  );
}

/** A soft warning pill: past a limit, lapsing, missing data. */
export function FlagBadge({ tone = "warning", children }: { tone?: "warning" | "danger" | "muted"; children: React.ReactNode }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "border-0 font-medium whitespace-nowrap",
        tone === "danger" && "bg-destructive/10 text-destructive",
        tone === "warning" && "bg-warning/10 text-warning",
        tone === "muted" && "bg-mist text-ink-soft",
      )}
    >
      {children}
    </Badge>
  );
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
