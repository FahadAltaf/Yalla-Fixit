"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Pencil } from "lucide-react";

import { SeverityBadge } from "@/components/dashboard/snagging/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { SnaggingSeverity } from "@/types/types";

/** One defect, with its two parents resolved for display. */
export type CatalogueRow = {
  id: string;
  code: string;
  label: string;
  default_severity: SnaggingSeverity;
  guidance?: string | null;
  active: boolean;
  source_code?: string | null;
  subcategory_id: string;
  subcategory_code: string;
  subcategory_label: string;
  subcategory_active: boolean;
  category_id: string;
  category_code: string;
  category_label: string;
  category_active: boolean;
  /** Category, sub-category and defect codes composed (Action Points P3). */
  full_code: string;
};

/**
 * Columns for the snag catalogue.
 *
 * One row per defect with its category and sub-category resolved beside
 * it, rather than a tree to walk: an operations lead comes here to find a
 * particular defect and correct it, and a table sorts, filters and pages
 * on all three levels at once — which a three-column browser cannot.
 *
 * The retire switch is the only mutation on the row, and it changes the
 * vocabulary offered to every inspector on every future inspection, so the
 * cell only calls back to the screen rather than writing anything itself.
 */
export function getCatalogueV2Columns({
  canEdit,
  togglingId,
  onToggle,
  onEdit,
}: {
  canEdit: boolean;
  togglingId: string | null;
  onToggle: (row: CatalogueRow, active: boolean) => void;
  onEdit: (row: CatalogueRow) => void;
}): ColumnDef<CatalogueRow>[] {
  return [
    {
      id: "full_code",
      header: "Code",
      accessorKey: "full_code",
      cell: ({ row }) => (
        <span className="text-muted-foreground font-mono text-xs whitespace-nowrap">
          {row.original.full_code}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: "category_label",
      header: "Category",
      accessorKey: "category_label",
      cell: ({ row }) => (
        <div className="min-w-44">
          <div className="text-sm font-medium">{row.original.category_label}</div>
          {/* A defect stays offered only while its parents are too, so a
              retired parent is worth seeing on the child's row. */}
          {!row.original.category_active ? (
            <span className="text-muted-foreground text-xs">
              Category retired
            </span>
          ) : null}
        </div>
      ),
      enableSorting: true,
    },
    {
      id: "subcategory_label",
      header: "Sub-category",
      accessorKey: "subcategory_label",
      cell: ({ row }) => (
        <div className="min-w-40">
          <div className="text-sm">{row.original.subcategory_label}</div>
          {!row.original.subcategory_active ? (
            <span className="text-muted-foreground text-xs">
              Sub-category retired
            </span>
          ) : null}
        </div>
      ),
      enableSorting: true,
    },
    {
      id: "label",
      header: "Defect",
      accessorKey: "label",
      cell: ({ row }) => (
        <div className="min-w-56">
          <div className="text-sm font-medium">{row.original.label}</div>
          {row.original.guidance ? (
            <div className="text-muted-foreground line-clamp-1 text-xs">
              {row.original.guidance}
            </div>
          ) : null}
        </div>
      ),
      enableSorting: true,
    },
    {
      id: "default_severity",
      header: "Default severity",
      accessorKey: "default_severity",
      cell: ({ row }) => <SeverityBadge severity={row.original.default_severity} />,
      enableSorting: true,
    },
    // {
    //   id: "source_code",
    //   header: "Library ref",
    //   accessorKey: "source_code",
    //   cell: ({ row }) =>
    //     row.original.source_code ? (
    //       <span className="text-muted-foreground font-mono text-xs whitespace-nowrap">
    //         {row.original.source_code}
    //       </span>
    //     ) : (
    //       <Badge variant="secondary" className="font-normal">
    //         Added here
    //       </Badge>
    //     ),
    //   enableSorting: true,
    // },
    {
      id: "active",
      header: "In use",
      accessorKey: "active",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={row.original.active}
            disabled={!canEdit || togglingId === row.original.id}
            onCheckedChange={(next) => onToggle(row.original, next)}
            aria-label={
              row.original.active
                ? `Retire ${row.original.label}`
                : `Reinstate ${row.original.label}`
            }
          />
          {canEdit ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEdit(row.original)}
              aria-label={`Edit ${row.original.label}`}
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ),
      enableSorting: false,
    },
  ];
}
