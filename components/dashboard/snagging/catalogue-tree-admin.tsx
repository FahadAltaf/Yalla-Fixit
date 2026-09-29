"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import { BookMarked, Plus } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import {
  getCatalogueV2Columns,
  type CatalogueRow,
} from "@/components/data-table/columns/column-snagging-catalogue-v2";
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
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { snaggingService } from "@/modules/snagging";
import {
  ActionType,
  ResourceType,
  type CatalogueCategory,
  type CatalogueDefect,
  type CatalogueSubcategory,
} from "@/types/types";

import { RecordsToolbar } from "@/components/data-table/toolbars/records-toolbar";

import {
  ActionDialogContent,
  ErrorState,
  PageHeading,
  useConfirm,
} from "./shared";

type Level = "category" | "subcategory" | "defect";

/**
 * The snag catalogue (Action Points P1, P6).
 *
 * CATEGORY > SUB-CATEGORY > DEFECT, one row per defect with both parents
 * resolved beside it. A table rather than a tree to walk: an operations
 * lead comes here to find a particular defect and correct it, and the
 * library runs to a thousand of them across twenty categories — sorting,
 * filtering and paging on all three levels at once is what makes that
 * findable. The two selects narrow the same way an inspector narrows on
 * site, so the screen teaches the hierarchy it manages.
 *
 * Every level is editable, because P6 requires categories, sub-categories
 * and defects all be changed without a release. Nothing is deleted: a
 * retired row stops being offered but keeps resolving for snags already
 * recorded against it (BR-8).
 */
export default function CatalogueTreeAdmin() {
  const { userProfile } = useAuth();
  const canEdit =
    isAdminUser(userProfile) ||
    hasResourceAction(userProfile, ResourceType.SNAGGING_CATALOGUE, ActionType.EDIT);
  const canCreate =
    isAdminUser(userProfile) ||
    hasResourceAction(userProfile, ResourceType.SNAGGING_CATALOGUE, ActionType.CREATE);

  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [subcategories, setSubcategories] = useState<CatalogueSubcategory[]>([]);
  const [defects, setDefects] = useState<CatalogueDefect[]>([]);
  /** Defects matching the filters across every page, for the pager. */
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const [category, setCategory] = useState("all");
  const [subcategory, setSubcategory] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const [editing, setEditing] = useState<
    { level: Level; row?: CatalogueRow | CatalogueCategory | CatalogueSubcategory } | null
  >(null);

  /*
    A page of defects at a time, filtered in the database.

    The whole taxonomy used to arrive on mount -- already past a thousand
    defects -- and the screen filtered and sliced it to show ten. The two
    upper levels still come back whole, because they are a handful of rows
    and the screen needs all of them: both filters are built from them and
    every defect resolves its parents through them.
  */
  const debouncedSearch = useDebounce(search, 400);

  /* Discards a response a later filter has already overtaken. */
  const ticket = useRef(0);

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const tree = await snaggingService.getCatalogueTree(false, {
        page,
        pageSize,
        search: debouncedSearch,
        category,
        subcategory,
      });
      if (mine !== ticket.current) return;
      setCategories(tree.categories);
      setSubcategories(tree.subcategories);
      setDefects(tree.defects);
      setTotal(tree.total ?? tree.defects.length);
    } catch (err) {
      if (mine !== ticket.current) return;
      setError(err instanceof Error ? err.message : "Could not load the catalogue");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [page, pageSize, debouncedSearch, category, subcategory]);

  useEffect(() => {
    void load();
  }, [load]);

  // A new filter or search starts at page one.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, category, subcategory]);

  /** Every defect with its parents resolved, which is what the table shows. */
  const rows = useMemo<CatalogueRow[]>(() => {
    const subById = new Map(subcategories.map((s) => [s.id, s]));
    const catById = new Map(categories.map((c) => [c.id, c]));

    return defects.flatMap((defect) => {
      const sub = subById.get(defect.subcategory_id);
      const cat = sub ? catById.get(sub.category_id) : undefined;
      // A defect whose parents are missing is a broken row, not a row to
      // render with blanks where the hierarchy should be.
      if (!sub || !cat) return [];

      return [
        {
          ...defect,
          subcategory_code: sub.code,
          subcategory_label: sub.label,
          subcategory_active: sub.active,
          category_id: cat.id,
          category_code: cat.code,
          category_label: cat.label,
          category_active: cat.active,
          full_code: `${cat.code}-${sub.code}-${defect.code}`,
        } as CatalogueRow,
      ];
    });
  }, [defects, subcategories, categories]);

  const subcategoryOptions = useMemo(
    () =>
      category === "all"
        ? subcategories
        : subcategories.filter((s) => s.category_id === category),
    [subcategories, category],
  );

  /*
    `rows` is already this page, filtered and ordered by the database, so
    there is nothing left to narrow here. It still resolves each defect's
    parents from the two complete upper levels above.
  */
  const paginated = rows;

  async function toggle(level: Level, id: string, active: boolean, label: string) {
    if (togglingId) return;
    // This changes what every inspector can choose on new inspections, so a
    // stray click on a row must not carry it through.
    /*
      The dialog does the work and stays open until it is done, so a
      failure is answered on the dialog that asked rather than in a toast
      over a row that still reads the old way.
    */
    const run = async () => {
      setTogglingId(id);
      try {
        await snaggingService.setCatalogueNodeActive(level, id, active);
        /*
          Only that one row changed on the server (a toggle does not
          cascade to the rows under it), so it changes here too. This used
          to download the whole catalogue -- over a thousand defects --
          after every click.
        */
        const flip = <T extends { id: string; active: boolean }>(list: T[]) =>
          list.map((item) => (item.id === id ? { ...item, active } : item));
        if (level === "category") setCategories(flip);
        else if (level === "subcategory") setSubcategories(flip);
        else setDefects(flip);
      } finally {
        setTogglingId(null);
      }
    };

    const done = await confirm(
      active
        ? {
            title: `Put "${label}" back in use?`,
            description: `Inspectors will be able to choose "${label}" again when capturing new snags.`,
            confirmText: "Reinstate",
            action: run,
          }
        : {
            title: `Retire "${label}"?`,
            description: `Inspectors can no longer choose "${label}" on new inspections. Snags already recorded against it keep it, and issued reports still resolve.`,
            confirmText: "Retire",
            variant: "destructive",
            action: run,
          },
    );
    if (done) toast.success(active ? `${label} is back in use` : `${label} retired`);
  }

  /*
    The same page shape as the other snagging pages: the house heading
    with its actions on the right, then the table in a card with the
    house toolbar.
  */
  /*
    What the heading counts.

    `total` rather than the rows on screen: the table reads a page of
    defects now, so counting what is rendered would announce a catalogue
    of ten. `total` follows the filters, so it says "matching" once one is
    set rather than presenting a search result as the whole catalogue.
    Categories still arrive complete, so they are counted as they are.
  */
  const narrowed =
    Boolean(debouncedSearch.trim()) || category !== "all" || subcategory !== "all";
  const defectCount = `${total.toLocaleString()} ${narrowed ? "matching " : ""}defects`;

  const heading = (
    <PageHeading
      eyebrow="Master data"
      title="Snag catalogue"
      description={`Category, then sub-category, then defect. ${defectCount} across ${categories.length} categories.`}
      actions={
        canCreate ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing({ level: "category" })}>
              <Plus className="size-4" />
              Category
            </Button>
            <Button
              variant="outline"
              onClick={() => setEditing({ level: "subcategory" })}
            >
              <Plus className="size-4" />
              Sub-category
            </Button>
            <Button onClick={() => setEditing({ level: "defect" })}>
              <Plus className="size-4" />
              Defect
            </Button>
          </div>
        ) : null
      }
    />
  );

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <ErrorState
          title="Could not load the catalogue"
          message={error}
          onRetry={() => void load()}
          retrying={loading}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {heading}
      {dialog}

      <Card className="py-0">
        <DataTable
          data={paginated}
          toolbar={
            <RecordsToolbar
              fetchRecords={() => void load()}
              globalFilter={search}
              onGlobalFilterChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              isSearchLoading={loading}
              pageSize={pageSize}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(0);
              }}
              searchPlaceholder="Search..."
              filters={
              <>
              <Select
                value={category}
                onValueChange={(value) => {
                  setCategory(value);
                  // The chosen sub-category may not belong to the new
                  // category, which would filter the table to nothing.
                  setSubcategory("all");
                  setPage(0);
                }}
              >
                <SelectTrigger className="w-56" aria-label="Filter by category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={subcategory}
                onValueChange={(value) => {
                  setSubcategory(value);
                  setPage(0);
                }}
              >
                <SelectTrigger className="w-56" aria-label="Filter by sub-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sub-categories</SelectItem>
                  {subcategoryOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              </>
              }
            />
          }
          columns={getCatalogueV2Columns({
            canEdit,
            togglingId,
            onToggle: (row, active) =>
              void toggle("defect", row.id, active, row.label),
            onEdit: (row) => setEditing({ level: "defect", row }),
          })}
          // The toolbar owns the search box, so the table's own global
          // filter is a no-op here rather than a second, competing one.
          onGlobalFilterChange={() => undefined}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          pageSize={pageSize}
          currentPage={page}
          loading={loading}
          rowCount={total}
          type="snagging-catalogue"
          isPagination={true}
          emptyState={
            <EmptyState
              icon={<BookMarked />}
              title="Nothing matches this filter"
              description="Clear the search or pick another category."
            />
          }
        />
      </Card>

      {editing ? (
        <NodeDialog
          level={editing.level}
          row={editing.row}
          categories={categories}
          subcategories={subcategories}
          defaultCategoryId={category !== "all" ? category : categories[0]?.id}
          defaultSubcategoryId={
            subcategory !== "all" ? subcategory : subcategoryOptions[0]?.id
          }
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/* The severities a defect can start at, each with the dot the tables use. */
const SEVERITY_OPTIONS: { value: CatalogueDefect["default_severity"]; label: string; dot: string }[] = [
  { value: "high", label: "High", dot: "bg-red-500" },
  { value: "medium", label: "Medium", dot: "bg-amber-500" },
  { value: "low", label: "Low", dot: "bg-emerald-500" },
];

/** Adds or edits one node, at whichever level. */
function NodeDialog({
  level,
  row,
  categories,
  subcategories,
  defaultCategoryId,
  defaultSubcategoryId,
  onClose,
  onSaved,
}: {
  level: Level;
  row?: CatalogueRow | CatalogueCategory | CatalogueSubcategory;
  categories: CatalogueCategory[];
  subcategories: CatalogueSubcategory[];
  defaultCategoryId?: string;
  defaultSubcategoryId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = row as CatalogueRow | undefined;
  const [code, setCode] = useState(row?.code ?? "");
  const [label, setLabel] = useState(row?.label ?? "");
  const [severity, setSeverity] = useState<CatalogueDefect["default_severity"]>(
    existing?.default_severity ?? "medium",
  );
  const [categoryId, setCategoryId] = useState(
    existing?.category_id ?? defaultCategoryId ?? "",
  );
  const [subcategoryId, setSubcategoryId] = useState(
    existing?.subcategory_id ?? defaultSubcategoryId ?? "",
  );
  const [busy, setBusy] = useState(false);

  const title = `${row ? "Edit" : "New"} ${
    level === "subcategory" ? "sub-category" : level
  }`;

  const options = subcategories.filter((s) => s.category_id === categoryId);
  /*
    A defect always has a sub-category picked. The default came from the
    table's filter, which could belong to another category than the one
    chosen here, so the field showed empty and Save stayed disabled. The
    first sub-category of the chosen category stands in until one is picked.
  */
  const chosenSubcategoryId = options.some((s) => s.id === subcategoryId)
    ? subcategoryId
    : (options[0]?.id ?? "");

  /* The code this node will print as, built from its parents' codes. */
  const categoryCode = categories.find((c) => c.id === categoryId)?.code ?? "";
  const subcategoryCode = options.find((s) => s.id === chosenSubcategoryId)?.code ?? "";
  const typed = code.trim().toUpperCase() || "__";
  const codePreview =
    level === "category"
      ? typed
      : level === "subcategory"
        ? `${categoryCode || "SN__"}-${typed}`
        : `${categoryCode || "SN__"}-${subcategoryCode || "__"}-${typed}`;

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        code: code.trim().toUpperCase(),
        label: label.trim(),
      };
      if (level === "subcategory") payload.category_id = categoryId;
      if (level === "defect") {
        payload.subcategory_id = chosenSubcategoryId;
        payload.default_severity = severity;
      }

      if (row) {
        await snaggingService.updateCatalogueNode(level, { ...payload, id: row.id });
      } else {
        await snaggingService.createCatalogueNode(level, payload);
      }
      toast.success(row ? "Saved" : "Added");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setBusy(false);
    }
  }

  const ready =
    code.trim().length >= 2 &&
    label.trim().length >= 2 &&
    (level !== "subcategory" || categoryId) &&
    (level !== "defect" || chosenSubcategoryId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {level === "defect"
              ? "Where it sits in the catalogue, its code and the severity an inspector starts from."
              : level === "subcategory"
                ? "The category it belongs to, its code and its name."
                : "Its code and its name. Sub-categories and defects are added under it."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {level !== "category" ? (
            <div className="grid gap-2">
              <Label htmlFor="node-category">Category</Label>
              <Select
                value={categoryId}
                onValueChange={(value) => {
                  setCategoryId(value);
                  // The new category's first sub-category, not an empty field.
                  setSubcategoryId(subcategories.find((s) => s.category_id === value)?.id ?? "");
                }}
              >
                <SelectTrigger id="node-category" className="w-full">
                  <SelectValue placeholder="Pick a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {level === "defect" ? (
            <div className="grid gap-2">
              <Label htmlFor="node-subcategory">Sub-category</Label>
              <Select value={chosenSubcategoryId} onValueChange={setSubcategoryId} disabled={options.length === 0}>
                <SelectTrigger id="node-subcategory" className="w-full">
                  <SelectValue placeholder={options.length ? "Pick a sub-category" : "No sub-categories in this category yet"} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="node-code">Code</Label>
            <Input
              id="node-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder={level === "category" ? "SN21" : "07"}
              maxLength={4}
              className="w-full font-mono"
            />
            <p className="text-muted-foreground text-xs">
              Two to four characters. It becomes part of the snag code at this
              level, so changing it later changes how existing snags read.
            </p>
            <p className="text-muted-foreground text-xs">
              Snag code:{" "}
              <span className="text-foreground bg-muted rounded px-1.5 py-0.5 font-mono">{codePreview}</span>
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="node-label">Name</Label>
            <Input
              id="node-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={
                level === "category" ? "Civil & Structural" : "Concrete elements"
              }
              className="w-full"
            />
          </div>

          {level === "defect" ? (
            <div className="grid gap-2">
              <Label htmlFor="node-severity">Default severity</Label>
              <Select
                value={severity}
                onValueChange={(value) =>
                  setSeverity(value as CatalogueDefect["default_severity"])
                }
              >
                <SelectTrigger id="node-severity" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <span className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${option.dot}`} aria-hidden />
                        {option.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                What the inspector starts from. They can raise or lower it on
                the day.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !ready}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
