"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, ClipboardList, Plus } from "lucide-react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/data-table";
import { getSnaggingChecklistColumns } from "@/components/data-table/columns/column-snagging-checklist";
import { SnaggingChecklistToolbar } from "@/components/data-table/toolbars/snagging-checklist-toolbar";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/actions/utils";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService, type ChecklistLibraryResponse } from "@/modules/snagging";
import {
  checklistItemSchema,
  type ChecklistItemInput,
} from "@/modules/snagging/schemas";
import {
  ActionType,
  ResourceType,
  type SnaggingChecklistLibraryItem,
} from "@/types/types";

import {
  ErrorState,
  PageHeading,
  SubmitButton,
  useConfirm,
} from "./shared";

/**
 * The checklist library (N1, FR-4.13).
 *
 * The master list of checks an inspector is asked to answer on site. A job
 * takes a copy of the applicable rows when it is created, so what is edited
 * here decides what future inspections are given and leaves every job
 * already raised untouched.
 *
 * Two rules follow from that and are enforced rather than documented. A
 * check is deactivated, never deleted, because job checklists still point at
 * it. And the code is fixed at creation: renaming a check is fine, silently
 * re-pointing its code is not.
 */

const PROPERTY_TYPES = [
  { key: "applies_apartment", label: "Apartment" },
  { key: "applies_villa", label: "Villa" },
  { key: "applies_townhouse", label: "Townhouse" },
  { key: "applies_commercial", label: "Commercial" },
] as const;

export default function ChecklistAdmin() {
  const { userProfile } = useAuth();
  const { confirm, dialog } = useConfirm();

  const [data, setData] = useState<ChecklistLibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [propertyType, setPropertyType] = useState("all");
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  // Which row is mid-flight, so the switch cannot fire twice across the
  // confirmation gap.
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Null means create; an item means edit. One dialog serves both, because
  // the fields are identical apart from the code.
  const [editing, setEditing] = useState<SnaggingChecklistLibraryItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const canEdit = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING_CATALOGUE,
    ActionType.EDIT,
  );
  const canCreate = hasResourceAction(
    userProfile,
    ResourceType.SNAGGING_CATALOGUE,
    ActionType.CREATE,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await snaggingService.listChecklistLibrary());
    } catch (err) {
      // Held on screen rather than toasted: an empty library and a library
      // that failed to load look identical otherwise.
      setError(
        err instanceof Error ? err.message : "Could not load the checklist library",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    Filtered here rather than server-side.

    The library is under a hundred rows and already loaded, so a round trip
    per keystroke would be slower than the filter. The route still supports
    the same filters for anything that wants to page it properly later.
  */
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const appliesKey =
      propertyType === "all"
        ? null
        : (`applies_${propertyType}` as keyof SnaggingChecklistLibraryItem);

    return (data?.items ?? []).filter((item) => {
      if (group !== "all" && item.group_name !== group) return false;
      if (appliesKey && !item[appliesKey]) return false;
      if (!term) return true;
      return (
        item.code.toLowerCase().includes(term) ||
        item.label.toLowerCase().includes(term) ||
        item.group_name.toLowerCase().includes(term)
      );
    });
  }, [data, group, propertyType, search]);

  const paginated = useMemo(() => {
    const start = currentPage * pageSize;
    return visible.slice(start, start + pageSize);
  }, [visible, currentPage, pageSize]);

  function handleGlobalFilterChange(value: string) {
    setSearch(value);
    setCurrentPage(0);
  }

  function handleGroupChange(value: string) {
    setGroup(value);
    setCurrentPage(0);
  }

  function handlePropertyTypeChange(value: string) {
    setPropertyType(value);
    setCurrentPage(0);
  }

  async function toggle(item: SnaggingChecklistLibraryItem, active: boolean) {
    if (togglingId) return;

    // This changes what every future inspection is asked, not just this
    // screen, so a stray click on a row must not carry it through.
    const ok = await confirm(
      active
        ? {
          title: `Put "${item.label}" back in use?`,
          description:
            "New inspections will include this check again. Jobs already raised are unaffected.",
          confirmText: "Reactivate",
        }
        : {
          title: "Deactivate this check?",
          description: `New inspections will not include "${item.label}". Jobs already raised keep it, and issued reports stay readable.`,
          confirmText: "Deactivate",
          variant: "destructive",
        },
    );
    if (!ok) return;

    setTogglingId(item.id);
    try {
      await snaggingService.setChecklistItemActive(item.id, active);
      setData((current) =>
        current
          ? {
            ...current,
            items: current.items.map((row) =>
              row.id === item.id ? { ...row, active } : row,
            ),
          }
          : current,
      );
      toast.success(active ? `"${item.label}" is back in use` : `"${item.label}" deactivated`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the check");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Master data"
        title="Checklist library"
        description="The checks an inspector works through on site. Owned by Operations."
      />

      {error ? (
        <ErrorState
          title="Could not load the checklist library"
          message={error}
          onRetry={() => void load()}
          retrying={loading}
        />
      ) : null}

      <div className="flex flex-col gap-6">
        <Card className="py-0">
          <DataTable
            data={paginated}
            toolbar={
              <SnaggingChecklistToolbar
                fetchRecords={() => void load()}
                onGlobalFilterChange={handleGlobalFilterChange}
                isSearchLoading={loading}
                pageSize={pageSize}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setCurrentPage(0);
                }}
                groups={data?.groups ?? []}
                groupValue={group}
                onGroupChange={handleGroupChange}
                propertyTypeValue={propertyType}
                onPropertyTypeChange={handlePropertyTypeChange}
                canCreate={canCreate}
                onCreate={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              />
            }
            columns={getSnaggingChecklistColumns({
              canEdit,
              togglingId,
              onToggle: (item, active) => void toggle(item, active),
              onEdit: (item) => {
                setEditing(item);
                setFormOpen(true);
              },
            })}
            onGlobalFilterChange={handleGlobalFilterChange}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(0);
            }}
            pageSize={pageSize}
            currentPage={currentPage}
            loading={loading}
            rowCount={visible.length}
            type="snagging-checklist"
            isPagination={true}
            emptyState={
              <EmptyState
                icon={<ClipboardList />}
                title="Nothing matches this filter"
                description={
                  data?.items?.length
                    ? "No check matches this search, group or property type. Clear the filter to see the whole library."
                    : "The library is empty. Add a check to give inspectors something to work through."
                }
              />
            }
          />
        </Card>

        <p className="text-muted-foreground text-xs">
          Checks are deactivated, never deleted. A job takes its own copy of the
          list when it is created, so historic inspections stay readable exactly
          as they were answered.
        </p>
      </div>

      <ChecklistItemDialog
        open={formOpen}
        item={editing}
        groups={data?.groups ?? []}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        onSaved={() => void load()}
      />

      {dialog}
    </div>
  );
}

/**
 * Picks an existing group, or names a new one.
 *
 * There is no groups table -- a group is just the `group_name` text on the
 * checks that carry it, and it exists the moment a check is saved into it.
 * So this is one control doing both jobs: the list keeps Operations from
 * inventing "Electric", "Electrical" and "Electricals" as three groups by
 * hand, and the create row means a genuinely new group does not need one.
 */
function GroupCombobox({
  groups,
  value,
  onChange,
}: {
  groups: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const typed = query.trim();
  // Matched without case, so typing "electrical" finds the existing
  // "Electrical" instead of offering to open a second group beside it.
  const alreadyExists = groups.some(
    (group) => group.toLowerCase() === typed.toLowerCase(),
  );
  // Two characters is the schema's own minimum for a group name, so the
  // create row never offers something the form would then reject.
  const canCreate = typed.length >= 2 && !alreadyExists;

  function choose(group: string) {
    onChange(group);
    setQuery("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          // Shaped like the Input beside it: Button is a pill by default,
          // which would be the only round-ended field in the dialog.
          className="w-full justify-between rounded-[12px] px-3 font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || "Choose a group"}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] overflow-hidden p-0"
      >
        <Command>
          <CommandInput
            placeholder="Search or type a new group..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {typed
                ? "No group matches. Keep typing to add it."
                : "No groups yet. Type to add the first one."}
            </CommandEmpty>
            {groups.length ? (
              <CommandGroup heading="In use">
                {groups.map((group) => (
                  <CommandItem
                    key={group}
                    value={group}
                    onSelect={() => choose(group)}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4 shrink-0",
                        value === group ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {group}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {canCreate ? (
              <CommandGroup>
                <CommandItem
                  /*
                    cmdk scores each item against the search text, so the
                    typed term has to be this row's value -- anything else
                    and the one row that should always be visible is the
                    one that gets filtered out.
                  */
                  value={typed}
                  onSelect={() => choose(typed)}
                >
                  <Plus className="mr-2 size-4 shrink-0" />
                  <span className="truncate">Add &ldquo;{typed}&rdquo;</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Create or edit one check.
 *
 * The same dialog does both: the fields are identical apart from the code,
 * which is shown but locked once the row exists, because job checklists
 * already reference it.
 */
function ChecklistItemDialog({
  open,
  item,
  groups,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  item: SnaggingChecklistLibraryItem | null;
  /** Every group already in use, so the field can offer them back. */
  groups: string[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const editingExisting = item !== null;

  // `sort_order` is coerced, so the schema's input and output types differ.
  // react-hook-form needs both: the raw shape it holds while editing, and
  // the parsed shape the submit handler receives.
  const form = useForm<
    z.input<typeof checklistItemSchema>,
    unknown,
    ChecklistItemInput
  >({
    resolver: zodResolver(checklistItemSchema),
    defaultValues: {
      code: "",
      group_name: "",
      label: "",
      applies_apartment: true,
      applies_villa: true,
      applies_townhouse: true,
      applies_commercial: true,
      mandatory: true,
      sort_order: 0,
    },
  });

  // Reset when the dialog is opened, so a second edit never shows the
  // previous row's values for the instant before the form catches up.
  useEffect(() => {
    if (!open) return;
    form.reset(
      item
        ? {
          code: item.code,
          group_name: item.group_name,
          label: item.label,
          applies_apartment: item.applies_apartment,
          applies_villa: item.applies_villa,
          applies_townhouse: item.applies_townhouse,
          applies_commercial: item.applies_commercial,
          mandatory: item.mandatory,
          sort_order: item.sort_order,
        }
        : {
          code: "",
          group_name: "",
          label: "",
          applies_apartment: true,
          applies_villa: true,
          applies_townhouse: true,
          applies_commercial: true,
          mandatory: true,
          sort_order: 0,
        },
    );
  }, [open, item, form]);

  // Set by hand rather than by the schema, because the rule spans four
  // fields; it hangs off the first of them so the group has somewhere to
  // put it.
  const appliesError = form.formState.errors.applies_apartment?.message;

  async function submit(values: ChecklistItemInput) {
    // Mirrors the server rule, so the message arrives before the round trip
    // rather than as a 400.
    form.clearErrors("applies_apartment");
    const appliesToSomething = PROPERTY_TYPES.some((type) => values[type.key]);
    if (!appliesToSomething) {
      form.setError("applies_apartment", {
        message: "Pick at least one property type, or the check never reaches a job.",
      });
      return;
    }

    try {
      if (item) {
        const { code: _code, ...changes } = values;
        void _code;
        await snaggingService.updateChecklistItem(item.id, changes);
        toast.success(`"${values.label}" updated`);
      } else {
        await snaggingService.createChecklistItem(values);
        toast.success(`"${values.label}" added`);
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the check");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingExisting ? "Edit check" : "Add a check"}</DialogTitle>
          <DialogDescription>
            {editingExisting
              ? "Changes apply to inspections raised from now on. Jobs already created keep the wording they were given."
              : "New inspections of the selected property types will include this check."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(submit)}
            className="flex flex-col gap-4"
          >
            {/*
              `items-start` is load-bearing. FormItem is itself a grid, so a
              stretched column distributes its spare height across its own
              rows -- which pushed "Group" half a row below "Code", because
              only Code carries a hint underneath.
            */}
            <div className="grid gap-4 sm:grid-cols-[9rem_1fr] sm:items-start">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="CHK-048"
                        disabled={editingExisting}
                        className="font-mono"
                      />
                    </FormControl>
                    {editingExisting ? (
                      <FormDescription>Fixed once created.</FormDescription>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="group_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group</FormLabel>
                    <FormControl>
                      <GroupCombobox
                        groups={groups}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormDescription>
                      Pick one, or type to start a new group.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Check</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Socket polarity" />
                  </FormControl>
                  <FormDescription>
                    What the inspector confirms on site.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/*
              Four fields under one heading, so this is a plain label and
              hint rather than the form primitives, which each expect to
              sit inside a single FormField. Same label / control / hint
              order as every other row.
            */}
            <div className="grid gap-2">
              <Label>Applies to</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PROPERTY_TYPES.map((type) => (
                  <FormField
                    key={type.key}
                    control={form.control}
                    name={type.key}
                    render={({ field }) => (
                      <FormItem className="flex h-8 flex-row items-center gap-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(checked) => field.onChange(checked === true)}
                          />
                        </FormControl>
                        <FormLabel className="font-normal">{type.label}</FormLabel>
                      </FormItem>
                    )}
                  />
                ))}
              </div>
              {appliesError ? (
                <p className="text-destructive text-sm">{appliesError}</p>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Only these property types are given this check.
                </p>
              )}
            </div>

            {/*
              Same two columns as the Code / Group row above, so the dialog
              reads as one grid rather than three unrelated layouts. The
              boxed Mandatory card is gone: it was the only bordered thing
              in a dialog of plain fields, which is what made the row look
              lopsided next to a bare number input.
            */}
            <div className="grid gap-4 sm:grid-cols-[9rem_1fr] sm:items-start">
              <FormField
                control={form.control}
                name="sort_order"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Order</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={0}
                        step={10}
                        value={String(field.value ?? 0)}
                      />
                    </FormControl>
                    <FormDescription>Position in the list.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="mandatory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mandatory</FormLabel>
                    <FormControl>
                      {/* Held at the Input height so the switch lands on
                          the same line as the number field beside it. */}
                      <div className="flex h-8 items-center gap-2.5">
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                        <span className="text-sm">
                          {field.value ? "Required" : "Optional"}
                        </span>
                      </div>
                    </FormControl>
                    <FormDescription>
                      {field.value
                        ? "Must be answered before the inspection is signed off."
                        : "The inspector can leave this one blank."}
                    </FormDescription>
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <SubmitButton
                type="submit"
                pending={form.formState.isSubmitting}
                pendingLabel="Saving..."
              >
                {editingExisting ? "Save changes" : "Add check"}
              </SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
