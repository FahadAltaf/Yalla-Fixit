"use client";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "./multi-select";
import type { PermissionRow as PermissionRowType, Permission } from "./types";

interface PermissionRowProps {
  permission: PermissionRowType;
  onUpdate: (id: string, updates: Partial<PermissionRowType>) => void;
}

export function PermissionRow({ permission, onUpdate }: PermissionRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto_200px_1fr_auto] gap-4 items-center px-4 py-3 hover:bg-muted/50 transition-colors",
        !permission.enabled && "opacity-50"
      )}
    >
      {/* Permission Name */}
      <div className="text-sm font-medium">{permission.name}</div>

      {/* Toggle Switch */}
      <div className="flex items-center justify-center">
        <Switch
          checked={permission.enabled}
          onCheckedChange={(checked) =>
            onUpdate(permission.id, { enabled: checked })
          }
        />
      </div>

      {/* Record Access Dropdown */}
      <div>
        <Select
          value={permission.recordAccess}
          onValueChange={(value) =>
            onUpdate(permission.id, { recordAccess: value })
          }
          disabled={!permission.enabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {permission.availableAccessOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Permissions Multi-Select */}
      <div>
        <MultiSelect
          options={permission.availablePermissions}
          selected={permission.permissions}
          onChange={(selected) =>
            onUpdate(permission.id, { permissions: selected as Permission[] })
          }
          disabled={!permission.enabled}
        />
      </div>

      {/* Actions Dropdown Menu */}
      <div className="flex items-center justify-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>View Details</DropdownMenuItem>
            <DropdownMenuItem>Edit Permission</DropdownMenuItem>
            <DropdownMenuItem>Clone Permission</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive">
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
