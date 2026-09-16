"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

import { ErrorState } from "./shared";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [category, setCategory] = useState("all");
  const [subcategory, setSubcategory] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const [editing, setEditing] = useState<
    { level: Level; row?: CatalogueRow | CatalogueCategory | CatalogueSubcategory } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tree = await snaggingService.getCatalogueTree();
      setCategories(tree.categories);
      setSubcategories(tree.subcategories);
      setDefects(tree.defects);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the catalogue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (category !== "all" && row.category_id !== category) return false;
      if (subcategory !== "all" && row.subcategory_id !== subcategory) return false;
      if (!term) return true;
      return (
        row.label.toLowerCase().includes(term) ||
        row.full_code.toLowerCase().includes(term) ||
        row.subcategory_label.toLowerCase().includes(term) ||
        row.category_label.toLowerCase().includes(term) ||
        (row.source_code ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, category, subcategory, search]);

  const paginated = useMemo(
    () => visible.slice(page * pageSize, page * pageSize + pageSize),
    [visible, page, pageSize],
  );

  async function toggle(level: Level, id: string, active: boolean, label: string) {
    setTogglingId(id);
    try {
      await snaggingService.setCatalogueNodeActive(level, id, active);
      toast.success(active ? `${label} is back in use` : `${label} retired`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setTogglingId(null);
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load the catalogue"
        message={error}
        onRetry={() => void load()}
        retrying={loading}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Snag catalogue</h1>
          <p className="text-muted-foreground text-sm">
            Category, then sub-category, then defect.{" "}
            {defects.length.toLocaleString()} defects across {categories.length}{" "}
            categories.
          </p>
        </div>
        {canCreate ? (
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
        ) : null}
      </div>

      <Card className="py-0">
        <DataTable
          data={paginated}
          toolbar={
            <div className="flex flex-wrap items-center gap-2 p-3">
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="Search code, defect, sub-category…"
                className="w-72"
                aria-label="Search the catalogue"
              />
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
            </div>
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
          rowCount={visible.length}
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

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        code: code.trim().toUpperCase(),
        label: label.trim(),
      };
      if (level === "subcategory") payload.category_id = categoryId;
      if (level === "defect") {
        payload.subcategory_id = subcategoryId;
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
    (level !== "defect" || subcategoryId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {level !== "category" ? (
            <div className="grid gap-2">
              <Label htmlFor="node-category">Category</Label>
              <Select
                value={categoryId}
                onValueChange={(value) => {
                  setCategoryId(value);
                  setSubcategoryId("");
                }}
              >
                <SelectTrigger id="node-category">
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
              <Select value={subcategoryId} onValueChange={setSubcategoryId}>
                <SelectTrigger id="node-subcategory">
                  <SelectValue placeholder="Pick a sub-category" />
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
              className="font-mono"
            />
            <p className="text-muted-foreground text-xs">
              Two to four characters. It becomes part of the snag code at this
              level, so changing it later changes how existing snags read.
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
                <SelectTrigger id="node-severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
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
      </DialogContent>
    </Dialog>
  );
}
