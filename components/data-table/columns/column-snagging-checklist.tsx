"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { SnaggingChecklistLibraryItem } from "@/types/types";

/**
 * Columns for the checklist library (N1).
 *
 * Two mutations live on the row: edit, and the in-use switch. Both only call
 * back to the screen, which confirms first, because either one changes what
 * every future inspection is asked to check.
 */

const PROPERTY_TYPES = [
  { key: "applies_apartment", short: "Apt" },
  { key: "applies_villa", short: "Villa" },
  { key: "applies_townhouse", short: "Town" },
  { key: "applies_commercial", short: "Com" },
] as const;

export function getSnaggingChecklistColumns({
  canEdit,
  togglingId,
  onToggle,
  onEdit,
}: {
  canEdit: boolean;
  togglingId: string | null;
  onToggle: (item: SnaggingChecklistLibraryItem, active: boolean) => void;
  onEdit: (item: SnaggingChecklistLibraryItem) => void;
}): ColumnDef<SnaggingChecklistLibraryItem>[] {
  return [
    {
      id: "group_name",
      header: "Group",
      accessorKey: "group_name",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.group_name}</span>
      ),
      enableSorting: true,
    },
    {
      id: "label",
      header: "Check",
      accessorKey: "label",
      cell: ({ row }) => (
        <div className="min-w-56">
          <span className="font-medium">{row.original.label}</span>
          <p className="text-muted-foreground font-mono text-xs">
            {row.original.code}
          </p>
        </div>
      ),
      enableSorting: true,
    },
    {
      id: "applies_to",
      header: "Applies to",
      cell: ({ row }) => {
        const item = row.original;
        const on = PROPERTY_TYPES.filter((type) => item[type.key]);
        // All four is the common case and listing it as four chips is noise;
        // the point of this column is spotting the exceptions.
        if (on.length === PROPERTY_TYPES.length) {
          return <span className="text-muted-foreground text-xs">All types</span>;
        }
        if (on.length === 0) {
          return (
            <span className="text-danger text-xs font-medium">No types</span>
          );
        }
        return (
          <div className="flex flex-wrap gap-1">
            {on.map((type) => (
              <Badge key={type.key} variant="secondary" className="border-0">
                {type.short}
              </Badge>
            ))}
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: "mandatory",
      header: "Mandatory",
      cell: ({ row }) =>
        row.original.mandatory ? (
          <Badge variant="secondary" className="bg-brand-50 text-brand border-0">
            Required
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">Optional</span>
        ),
      enableSorting: false,
    },
    {
      id: "active",
      header: () => <span className="block text-right">In use</span>,
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEdit(item)}
                aria-label={`Edit ${item.label}`}
              >
                <Pencil className="size-4" />
              </Button>
            ) : null}
            <Switch
              checked={item.active}
              disabled={!canEdit || togglingId === item.id}
              onCheckedChange={(checked) => onToggle(item, checked)}
              aria-label={`${item.active ? "Deactivate" : "Reactivate"} ${item.label}`}
            />
          </div>
        );
      },
      enableSorting: false,
    },
  ];
}
