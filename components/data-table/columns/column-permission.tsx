"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import { ResourceType, ActionType } from "@/types/types";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/dashboard/permissions/multi-select";
import {
  RESOURCE_PARENT,
  getResourceDisplayName,
  hasChildren,
  getActionDisplayName,
} from "@/components/dashboard/permissions/constants";

export interface PermissionRowData {
  resource: ResourceType;
  enabled: boolean;
  recordAccess: string;
  availableRecordAccessOptions: string[];
  selectedActions: ActionType[];
  availableActions: ActionType[];
}

export function getPermissionColumns(
  onToggleEnabled: (resource: ResourceType, enabled: boolean) => void,
  onActionsChange: (resource: ResourceType, actions: ActionType[]) => void,
  /*
    A module's pages are hidden until its row is opened. Given together:
    which modules are open, and how to open one. Left out, every row is a
    plain row, which is what the other tables want.
  */
  expansion?: {
    isOpen: (resource: ResourceType) => boolean;
    onToggle: (resource: ResourceType) => void;
  }
): ColumnDef<PermissionRowData>[] {
  return [
    {
      id: "resource",
      header: "Module",
      accessorKey: "resource",
      cell: ({ row }) => {
        const resource = row.original.resource;
        const name = getResourceDisplayName(resource);
        const parent = RESOURCE_PARENT[resource];
        const expandable = expansion && hasChildren(resource);

        if (expandable) {
          const open = expansion.isOpen(resource);
          return (
            <button
              type="button"
              onClick={() => expansion.onToggle(resource)}
              aria-expanded={open}
              className="focus-visible:ring-ring -ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left font-medium focus-visible:ring-2 focus-visible:outline-none"
            >
              <ChevronRight
                className={cn(
                  "text-muted-foreground size-4 shrink-0 transition-transform",
                  open && "rotate-90"
                )}
                aria-hidden
              />
              {name}
            </button>
          );
        }

        return (
          <span className={cn("font-medium", parent && "text-muted-foreground ps-6")}>
            {name}
          </span>
        );
      },
      enableSorting: true,
      size: 200,
    },
    {
      id: "enabled",
      header: "Enabled",
      accessorKey: "enabled",
      cell: ({ row }) => {
        /*
          A module with pages of its own shows no controls here. The
          pages carry the grants; a switch on this row would set a
          permission that nothing reads.
        */
        if (expansion && hasChildren(row.original.resource)) return null;
        const { resource, enabled } = row.original;
        const isDashboard = resource === ResourceType.DASHBOARD;
        return (
          <div className="flex ">
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => onToggleEnabled(resource, checked)}
              disabled={isDashboard}
            />
          </div>
        );
      },
      enableSorting: true,
      size: 100,
    },
    {
      id: "permissions",
      header: "Permissions",
      cell: ({ row }) => {
        /*
          A module with pages of its own shows no controls here. The
          pages carry the grants; a switch on this row would set a
          permission that nothing reads.
        */
        if (expansion && hasChildren(row.original.resource)) return null;
        const { resource, selectedActions, availableActions, enabled } =
          row.original;
        const isDashboard = resource === ResourceType.DASHBOARD;

        const actionStrings = availableActions.map((action) =>
          getActionDisplayName(action)
        );
        const selectedActionStrings = selectedActions.map((action) =>
          getActionDisplayName(action)
        );

        return (
          <div className="">
            <MultiSelect
              options={actionStrings}
              selected={selectedActionStrings}
              onChange={(selected) => {
                // Convert back to ActionType enum
                const selectedActions = availableActions.filter((action) =>
                  selected.includes(getActionDisplayName(action))
                );
                onActionsChange(resource, selectedActions);
              }}
              disabled={!enabled || isDashboard}
              placeholder="Select permissions"
            />
          </div>
        );
      },
      enableSorting: false,
      size: 200,
    },
  ];
}
