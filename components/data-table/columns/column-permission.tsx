"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ResourceType, ActionType } from "@/types/types";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/dashboard/permissions/multi-select";
import {
  getResourceDisplayName,
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
  onRecordAccessChange: (resource: ResourceType, recordAccess: string) => void,
  onActionsChange: (resource: ResourceType, actions: ActionType[]) => void
): ColumnDef<PermissionRowData>[] {
  return [
    {
      id: "resource",
      header: "Module",
      accessorKey: "resource",
      cell: ({ row }) => {
        const resource = row.original.resource;
        return (
          <span className="font-medium">
            {getResourceDisplayName(resource)}
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
      id: "recordAccess",
      header: "Record Access",
      accessorKey: "recordAccess",
      cell: ({ row }) => {
        const {
          resource,
          recordAccess,
          availableRecordAccessOptions,
          enabled,
        } = row.original;
        const isDashboard = resource === ResourceType.DASHBOARD;
        return (
          <Select
            value={recordAccess}
            onValueChange={(value) => onRecordAccessChange(resource, value)}
            disabled={!enabled || isDashboard}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableRecordAccessOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
      enableSorting: false,
      size: 200,
    },
    {
      id: "permissions",
      header: "Permissions",
      cell: ({ row }) => {
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
