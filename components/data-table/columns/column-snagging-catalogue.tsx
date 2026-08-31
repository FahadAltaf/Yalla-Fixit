"use client";

import { ColumnDef } from "@tanstack/react-table";

import { SeverityBadge } from "@/components/dashboard/snagging/shared";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { SnaggingCatalogueEntry } from "@/types/types";

/**
 * Columns for the snag catalogue.
 *
 * The retire/reinstate switch is the only mutation on the row, and it
 * changes the vocabulary offered to every inspector on every future
 * inspection — so the cell only ever calls back to the screen, which
 * confirms before anything is written.
 */
export function getSnaggingCatalogueColumns({
  canEdit,
  togglingId,
  areasByElement,
  onToggle,
}: {
  canEdit: boolean;
  togglingId: string | null;
  areasByElement: Map<string, string[]>;
  onToggle: (entry: SnaggingCatalogueEntry, active: boolean) => void;
}): ColumnDef<SnaggingCatalogueEntry>[] {
  return [
    {
      id: "code",
      header: "Code",
      accessorKey: "code",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.code}</span>
      ),
      enableSorting: true,
    },
    {
      id: "element_label",
      header: "Element",
      accessorKey: "element_label",
      cell: ({ row }) => <span className="text-sm">{row.original.element_label}</span>,
      enableSorting: true,
    },
    {
      id: "defect_label",
      header: "Defect type",
      accessorKey: "defect_label",
      cell: ({ row }) => (
        <div className="min-w-48">
          <span className="font-medium">{row.original.defect_label}</span>
          {row.original.guidance ? (
            <p className="text-muted-foreground text-xs">{row.original.guidance}</p>
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
    {
      id: "applies_in",
      header: "Applies in",
      cell: ({ row }) => (
        <Badge variant="outline">
          {areasByElement.get(row.original.element_code)?.length ?? 0} areas
        </Badge>
      ),
      enableSorting: false,
    },
    {
      id: "active",
      header: () => <span className="block text-right">In use</span>,
      cell: ({ row }) => {
        const entry = row.original;
        return (
          <div className="text-right">
            <Switch
              checked={entry.active}
              disabled={!canEdit || togglingId === entry.id}
              onCheckedChange={(checked) => onToggle(entry, checked)}
              aria-label={`${entry.active ? "Retire" : "Reinstate"} ${entry.code}`}
            />
          </div>
        );
      },
      enableSorting: false,
    },
  ];
}
