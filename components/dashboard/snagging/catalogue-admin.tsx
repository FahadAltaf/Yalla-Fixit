"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookMarked, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService, type CatalogueResponse } from "@/modules/snagging";
import { catalogueEntrySchema, type CatalogueEntryInput } from "@/modules/snagging/schemas";
import { ActionType, ResourceType, type SnaggingCatalogueEntry } from "@/types/types";

import { PageHeading, SeverityBadge } from "./shared";

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
  const [data, setData] = useState<CatalogueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [element, setElement] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);

  const canEdit = hasResourceAction(userProfile, ResourceType.SNAGGING_CATALOGUE, ActionType.EDIT);
  const canCreate = hasResourceAction(userProfile, ResourceType.SNAGGING_CATALOGUE, ActionType.CREATE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await snaggingService.listCatalogue());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the catalogue");
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the entry");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Master data"
        title="Snag catalogue"
        description="The controlled vocabulary every snag is classified against. Owned by Operations."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Add defect type
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">Defect types</p>
          <p className="mt-1 text-2xl font-semibold">{data?.entries?.length ?? 0}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {(data?.entries ?? []).filter((entry) => !entry.active).length} retired
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">Areas</p>
          <p className="mt-1 text-2xl font-semibold">{data?.areas?.length ?? 0}</p>
          <p className="text-muted-foreground mt-1 text-xs">Level 1 of the taxonomy</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">Area / element pairs</p>
          <p className="mt-1 text-2xl font-semibold">{data?.area_elements?.length ?? 0}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Decides what the capture sheet offers in each room
          </p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Code or defect"
              className="pl-9"
              aria-label="Search the catalogue"
            />
          </div>

          <Select value={element} onValueChange={setElement}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All elements</SelectItem>
              {elements.map(([code, label]) => (
                <SelectItem key={code} value={code}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-muted-foreground ml-auto text-sm">{visible.length} shown</span>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Element</TableHead>
                <TableHead>Defect type</TableHead>
                <TableHead>Default severity</TableHead>
                <TableHead>Applies in</TableHead>
                <TableHead className="text-right">In use</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground py-10 text-center">
                    <BookMarked className="mx-auto mb-2 size-6" />
                    Nothing matches this filter.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((entry) => (
                  <TableRow key={entry.id} className={entry.active ? "" : "opacity-60"}>
                    <TableCell className="font-mono text-xs">{entry.code}</TableCell>
                    <TableCell>{entry.element_label}</TableCell>
                    <TableCell className="font-medium">
                      {entry.defect_label}
                      {entry.guidance ? (
                        <p className="text-muted-foreground text-xs">{entry.guidance}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={entry.default_severity} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {areasByElement.get(entry.element_code)?.length ?? 0} areas
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={entry.active}
                        disabled={!canEdit}
                        onCheckedChange={(checked) => void toggle(entry, checked)}
                        aria-label={`${entry.active ? "Retire" : "Reinstate"} ${entry.code}`}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground border-t p-3 text-xs">
          Entries are retired, never deleted, so reports issued against them keep resolving.
        </p>
      </Card>

      <AddEntryDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void load()} />
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
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Add entry"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
