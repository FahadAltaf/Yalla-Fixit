"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookMarked, Plus } from "lucide-react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService, type CatalogueResponse } from "@/modules/snagging";
import { catalogueEntrySchema, type CatalogueEntryInput } from "@/modules/snagging/schemas";
import { ActionType, ResourceType, type SnaggingCatalogueEntry } from "@/types/types";

import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/data-table";
import { getSnaggingCatalogueColumns } from "@/components/data-table/columns/column-snagging-catalogue";
import { SnaggingCatalogueToolbar } from "@/components/data-table/toolbars/snagging-catalogue-toolbar";

import {
  ErrorState,
  PageHeading,
  StatCard,
  StatCardGrid,
  StatGridSkeleton,
  SubmitButton,
  useConfirm,
} from "./shared";

/**
 * Snag catalogue administration (BRD §9).
 *
 * The BRD calls this the single most critical master-data artifact,
 * because every analytics objective depends on it. Two things follow
 * from that and are enforced here: entries are retired rather than
 * deleted (BR-8), and the code is fixed at creation — renaming a defect
 * is fine, silently re-pointing a code is not, because issued reports
 * still reference it.
 */
export default function CatalogueAdmin() {
  const { userProfile } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [data, setData] = useState<CatalogueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [element, setElement] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  // Which row is mid-flight, so the switch cannot be fired twice across
  // the confirmation gap.
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const canEdit = hasResourceAction(userProfile, ResourceType.SNAGGING_CATALOGUE, ActionType.EDIT);
  const canCreate = hasResourceAction(userProfile, ResourceType.SNAGGING_CATALOGUE, ActionType.CREATE);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await snaggingService.listCatalogue());
    } catch (err) {
      // Held on screen instead of toasted: an empty catalogue table and
      // a catalogue that failed to load look identical otherwise.
      setError(err instanceof Error ? err.message : "Could not load the catalogue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const elements = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of data?.entries ?? []) map.set(entry.element_code, entry.element_label);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  // Filtering happens here rather than server-side: the whole catalogue
  // is a few hundred rows, it is already loaded, and a round trip per
  // keystroke would be slower than the filter.
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.entries ?? []).filter((entry) => {
      if (element !== "all" && entry.element_code !== element) return false;
      if (!term) return true;
      return (
        entry.code.toLowerCase().includes(term) ||
        entry.defect_label.toLowerCase().includes(term) ||
        entry.element_label.toLowerCase().includes(term)
      );
    });
  }, [data, element, search]);

  // The catalogue is a few hundred rows and already in memory, so the
  // page is sliced here rather than round-tripping per page — the same
  // shape the roles table uses against the shared DataTable.
  const paginated = useMemo(() => {
    const start = currentPage * pageSize;
    return visible.slice(start, start + pageSize);
  }, [visible, currentPage, pageSize]);

  function handleGlobalFilterChange(value: string) {
    setSearch(value);
    setCurrentPage(0);
  }

  function handleElementChange(value: string) {
    setElement(value);
    setCurrentPage(0);
  }

  function handlePageChange(pageIndex: number) {
    setCurrentPage(pageIndex);
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    setCurrentPage(0);
  }

  const areasByElement = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const pair of data?.area_elements ?? []) {
      const list = map.get(pair.element_code) ?? [];
      list.push(pair.area_code);
      map.set(pair.element_code, list);
    }
    return map;
  }, [data]);

  async function toggle(entry: SnaggingCatalogueEntry, active: boolean) {
    if (togglingId) return;

    // The switch changes the vocabulary for every inspector on every
    // future inspection, not just this screen, so a stray click on a
    // row must not carry it through.
    const ok = await confirm(
      active
        ? {
          title: `Put ${entry.code} back in use?`,
          description: `Inspectors will be able to choose "${entry.defect_label}" again when capturing new snags.`,
          confirmText: "Reinstate",
        }
        : {
          title: "Retire this defect type?",
          description: `Inspectors can no longer choose "${entry.defect_label}" on new inspections. Snags already recorded against ${entry.code} keep it, and issued reports still resolve.`,
          confirmText: "Retire",
          variant: "destructive",
        },
    );
    if (!ok) return;

    setTogglingId(entry.id);
    try {
      await snaggingService.setCatalogueEntryActive(entry.id, active);
      setData((current) =>
        current
          ? {
            ...current,
            entries: current.entries.map((row) =>
              row.id === entry.id ? { ...row, active } : row,
            ),
          }
          : current,
      );
      toast.success(active ? `${entry.code} is back in use` : `${entry.code} retired`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the entry");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Master data"
        title="Snag catalogue"
        description="The controlled vocabulary every snag is classified against. Owned by Operations."
      // actions={
      //   canCreate ? (
      //     <Button onClick={() => setCreateOpen(true)}>
      //       <Plus className="size-4" />
      //       Add defect type
      //     </Button>
      //   ) : null
      // }
      />

      {error ? (
        <ErrorState
          title="Could not load the catalogue"
          message={error}
          onRetry={() => void load()}
          retrying={loading}
        />
      ) : null}

      {/*
        The table is always mounted and shows its own in-body loading, so
        the page never renders a full-page skeleton and then a second
        loading state inside the table. Only the counters above it, which
        are not part of the table, get a placeholder.
      */}
      <div className="flex flex-col gap-6">
        {loading ? (
          <StatGridSkeleton count={3} />
        ) : (
          <StatCardGrid columns={3}>
            <StatCard
              label="Defect types"
              value={data?.entries?.length ?? 0}
              caption={`${(data?.entries ?? []).filter((entry) => !entry.active).length} retired`}
            />
            <StatCard
              label="Areas"
              value={data?.areas?.length ?? 0}
              caption="Level 1 of the taxonomy"
            />
            <StatCard
              label="Area / element pairs"
              value={data?.area_elements?.length ?? 0}
              caption="Decides what the capture sheet offers in each room"
            />
          </StatCardGrid>
        )}

        <Card className="py-0">
          <DataTable
            data={paginated}
            toolbar={
              <SnaggingCatalogueToolbar
                fetchRecords={() => void load()}
                onGlobalFilterChange={handleGlobalFilterChange}
                isSearchLoading={loading}
                pageSize={pageSize}
                onPageSizeChange={handlePageSizeChange}
                elements={elements}
                elementValue={element}
                onElementChange={handleElementChange}
                canCreate={canCreate}
                onCreate={() => setCreateOpen(true)}
              />
            }
            columns={getSnaggingCatalogueColumns({
              canEdit,
              togglingId,
              areasByElement,
              onToggle: (entry, active) => void toggle(entry, active),
            })}
            onGlobalFilterChange={handleGlobalFilterChange}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            pageSize={pageSize}
            currentPage={currentPage}
            loading={loading}
            rowCount={visible.length}
            type="snagging-catalogue"
            isPagination={true}
            emptyState={
              <EmptyState
                icon={<BookMarked />}
                title="Nothing matches this filter"
                description={
                  data?.entries?.length
                    ? "No defect type matches this search or element. Clear the filter to see the whole catalogue."
                    : "The catalogue is empty. Add a defect type to give inspectors something to classify against."
                }
              />
            }
          />
        </Card>

        <p className="text-muted-foreground text-xs">
          Entries are retired, never deleted, so reports issued against them keep resolving.
        </p>
      </div>

      <AddEntryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void load()}
      />

      {dialog}
    </div>
  );
}

function AddEntryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  // `sort_order` is coerced, so the schema's input and output types
  // differ. react-hook-form needs both: the raw shape it holds while
  // editing, and the parsed shape the submit handler receives.
  const form = useForm<z.input<typeof catalogueEntrySchema>, unknown, CatalogueEntryInput>({
    resolver: zodResolver(catalogueEntrySchema),
    defaultValues: {
      element_code: "",
      element_label: "",
      defect_code: "",
      defect_label: "",
      default_severity: "medium",
      guidance: "",
      sort_order: 0,
    },
  });

  async function onSubmit(values: CatalogueEntryInput) {
    setSubmitting(true);
    try {
      await snaggingService.createCatalogueEntry(values);
      toast.success(`${values.element_code}-${values.defect_code} added`);
      form.reset();
      onOpenChange(false);
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the entry");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a defect type</DialogTitle>
          <DialogDescription>
            The code is permanent once saved. Labels can be reworded at any time.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="element_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Element code</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="WL"
                        maxLength={2}
                        {...field}
                        onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="element_label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Element</FormLabel>
                    <FormControl>
                      <Input placeholder="Walls" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="defect_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Defect code</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="CRK"
                        maxLength={3}
                        {...field}
                        onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="default_severity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default severity</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>The inspector can override it on site.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="defect_label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Defect type</FormLabel>
                  <FormControl>
                    <Input placeholder="Crack in wall" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="guidance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Guidance (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="When to grade this high rather than medium" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton type="submit" pending={submitting} pendingLabel="Saving…">
                Add entry
              </SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
