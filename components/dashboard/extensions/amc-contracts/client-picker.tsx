"use client";

import { useEffect, useRef, useState, type UIEvent } from "react";
import { ChevronDown, Loader2, Plus, SearchIcon, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import {
  amcContractsService,
  type ClientListRow,
  type CustomerRecord,
} from "@/modules/amc-contracts/amc-contracts-service";

/** Clients loaded per page; scrolling to the end of the list loads the next page. */
const PAGE_SIZE = 10;

type ListState = {
  search: string | null;
  rows: ClientListRow[];
  more: boolean;
  pages: number;
  source: "fsm" | "portal";
};

/**
 * The client list every AMC picker reads, as Snagging's: Zoho FSM searched
 * ten at a time, newest first, with AMC's portal-only prospects on top.
 * Only the latest search may fill the list.
 */
export function useClientList(search: string, enabled = true) {
  const debounced = useDebounce(search.trim(), 250);
  const [list, setList] = useState<ListState>({
    search: null,
    rows: [],
    more: false,
    pages: 0,
    source: "fsm",
  });
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const ticket = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const mine = ++ticket.current;
    amcContractsService
      .clientsPage({ q: debounced, page: 0, pageSize: PAGE_SIZE })
      .then(
        (page) => {
          if (mine !== ticket.current) return;
          setList({
            search: debounced,
            rows: page.clients,
            more: page.hasMore,
            pages: 1,
            source: page.source,
          });
          setError(null);
        },
        (e) => {
          if (mine !== ticket.current) return;
          setList((current) => ({
            ...current,
            search: debounced,
            rows: [],
            more: false,
            pages: 0,
          }));
          setError(e instanceof Error ? e.message : "Could not load clients.");
        },
      );
  }, [debounced, enabled]);

  const loading = list.search !== debounced;

  async function loadMore() {
    if (loading || !list.more || loadingMore) return;
    const mine = ticket.current;
    setLoadingMore(true);
    try {
      const page = await amcContractsService.clientsPage({
        q: list.search ?? "",
        page: list.pages,
        pageSize: PAGE_SIZE,
      });
      if (mine !== ticket.current) return;
      setList((current) => {
        // A client added since the first page can shift the pages by one: never list anyone twice.
        const key = (row: ClientListRow) =>
          row.fsmContactId ?? row.id ?? row.name;
        const seen = new Set(current.rows.map(key));
        return {
          ...current,
          rows: [
            ...current.rows,
            ...page.clients.filter((row) => !seen.has(key(row))),
          ],
          more: page.hasMore,
          pages: current.pages + 1,
        };
      });
    } catch (e) {
      if (mine === ticket.current)
        setError(
          e instanceof Error ? e.message : "Could not load more clients.",
        );
    } finally {
      setLoadingMore(false);
    }
  }

  return {
    rows: list.rows,
    source: list.source,
    search: list.search,
    loading,
    error,
    hasMore: !loading && list.more,
    loadingMore,
    loadMore,
  };
}

/** The portal client for a listed row: an FSM contact the portal has not used yet gets its row now. */
export async function customerForRow(
  row: ClientListRow,
): Promise<CustomerRecord> {
  if (row.customer) return row.customer;
  if (row.fsmContactId)
    return (await amcContractsService.openFsmClient(row.fsmContactId)).customer;
  throw new Error("This client cannot be used.");
}

/** One row of the list: name over email, phone on the right. */
export function ClientRowLabel({
  row,
  busy,
}: {
  row: ClientListRow;
  busy?: boolean;
}) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{row.name}</span>
          {row.customerRef ? (
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              · {row.customerRef}
            </span>
          ) : null}
          {row.portalOnly ? (
            <Badge
              variant="secondary"
              className="h-5 shrink-0 px-1.5 text-[11px] font-medium"
            >
              Portal only
            </Badge>
          ) : null}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {row.email || "No email"}
        </span>
      </span>
      {busy ? (
        <Loader2
          className="text-muted-foreground size-4 shrink-0 animate-spin"
          aria-hidden
        />
      ) : row.phone ? (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {row.phone}
        </span>
      ) : null}
    </>
  );
}

/**
 * The client search box, as on Snagging's new quotation: type to search
 * Zoho FSM (or scroll its newest clients), pick one, or use + to add a new
 * client. The caller shows the chosen client as a settled card.
 */
export function ClientPicker({
  onPick,
  onAddNew,
  autoFocus,
}: {
  onPick: (customer: CustomerRecord) => void;
  /** Adds a brand-new client, starting from what was typed; `fromFsm` when the list is Zoho FSM's. */
  onAddNew?: (typed: string, fromFsm: boolean) => void;
  autoFocus?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const list = useClientList(search, open);
  const fromFsm = list.source === "fsm";

  async function choose(row: ClientListRow) {
    const key = row.fsmContactId ?? row.id ?? "";
    setLinking(key);
    try {
      onPick(await customerForRow(row));
      setOpen(false);
      setSearch("");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not use this client.",
      );
    } finally {
      setLinking(null);
    }
  }

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48)
      void list.loadMore();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2">
        <PopoverAnchor asChild>
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              value={search}
              autoFocus={autoFocus}
              onChange={(e) => {
                setSearch(e.target.value);
                setOpen(true);
              }}
              // Not on focus: a dialog focuses this box as it opens, and the list would cover the form.
              onClick={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setOpen(true);
                if (e.key === "Escape" && open) {
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
              placeholder={
                fromFsm
                  ? "Search clients in Zoho FSM"
                  : "Search clients on file"
              }
              className="pr-9 pl-9"
              aria-label="Search clients"
              aria-expanded={open}
              role="combobox"
            />
            <ChevronDown
              className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
              aria-hidden
            />
          </div>
        </PopoverAnchor>
        {onAddNew ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onAddNew(search.trim(), fromFsm)}
            aria-label="Add a new client"
            title="Add a new client"
          >
            <Plus className="size-4" />
          </Button>
        ) : null}
      </div>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-72 gap-0 overflow-hidden p-0"
        // Typing stays in the search box.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (
            e.target instanceof Element &&
            e.target.closest("[data-slot=popover-anchor]")
          )
            e.preventDefault();
        }}
      >
        <div className="max-h-64 overflow-y-auto py-1" onScroll={onScroll}>
          {list.loading ? (
            <div className="space-y-1 px-3 py-2" aria-label="Loading clients">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="space-y-1.5 py-1.5">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : list.error && list.rows.length === 0 ? (
            <p className="text-destructive px-3 py-2 text-sm">{list.error}</p>
          ) : list.rows.length === 0 ? (
            <p className="text-muted-foreground px-3 py-2 text-sm">
              {fromFsm
                ? "No client in Zoho FSM matches. FSM searches the last name, email and phone."
                : "No client on file matches."}
              {onAddNew ? " Use + to add a new one." : ""}
            </p>
          ) : (
            list.rows.map((row) => {
              const key = row.fsmContactId ?? row.id ?? row.name;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={linking !== null}
                  onClick={() => void choose(row)}
                  className="hover:bg-muted/60 flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm disabled:opacity-60"
                >
                  <ClientRowLabel row={row} busy={linking === key} />
                </button>
              );
            })
          )}
          {!list.loading && list.rows.length > 0 ? (
            <div className="text-muted-foreground px-3 py-2 text-xs">
              {list.loadingMore ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Loading more clients…
                </span>
              ) : list.hasMore ? (
                <button
                  type="button"
                  onClick={() => void list.loadMore()}
                  className="hover:text-foreground underline-offset-2 hover:underline"
                >
                  Showing {list.rows.length}. Scroll for more
                </button>
              ) : (
                <span>
                  {list.rows.length === 1
                    ? "1 client"
                    : `All ${list.rows.length} clients`}
                  {list.search ? " matching your search" : ""}
                </span>
              )}
            </div>
          ) : null}
        </div>
        {onAddNew ? (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onAddNew(search.trim(), fromFsm);
            }}
            className="text-brand hover:bg-muted/60 flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm font-medium"
          >
            <UserPlus className="size-4" aria-hidden />
            Add a new client
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
