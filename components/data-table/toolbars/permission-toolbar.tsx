"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCwIcon, Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/actions/utils";
import { Role } from "@/types/types";

interface PermissionDataTableToolbarProps {
  fetchRecords: () => void;
  roles: Role[];
  selectedRoleId: string | null;
  onRoleChange: (roleId: string | null) => void;
}

export function PermissionDataTableToolbar({
  fetchRecords,
  roles,
  selectedRoleId,
  onRoleChange,
}: PermissionDataTableToolbarProps) {
  const [open, setOpen] = useState(false);

  // Filter out admin role and "Select Role" placeholder
  const availableRoles = roles.filter(
    (role) =>
      role.name.toLowerCase() !== "admin" &&
      role.id !== "select-role" &&
      role.name.toLowerCase() !== "select role"
  );

  const selectedRole = availableRoles.find(
    (role) => role.id === selectedRoleId
  );

  // Custom filter function for case-insensitive includes matching
  const filterFunction = useCallback((value: string, search: string) => {
    const searchLower = search.toLowerCase();
    const valueLower = value.toLowerCase();
    return valueLower.includes(searchLower) ? 1 : 0;
  }, []);

  return (
    <div className="flex gap-2 sm:gap-4 py-4 sm:py-6 px-4 flex-row items-center justify-between">
      {/* Role Selector */}
      <div className="w-full sm:max-w-sm">
        <div className="space-y-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full justify-between capitalize"
              >
                {selectedRole
                  ? selectedRole.name
                  : "Select a role to manage permissions"}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-(--radix-popover-trigger-width) p-0 overflow-hidden"
              align="start"
            >
              <Command shouldFilter={true} filter={filterFunction}>
                <CommandInput placeholder="Search roles..." />
                <CommandList className="max-h-[300px]">
                  <CommandEmpty>No roles found.</CommandEmpty>
                  <CommandGroup>
                    {availableRoles.map((role) => {
                      const isSelected = selectedRoleId === role.id;
                      return (
                        <CommandItem
                          key={role.id}
                          value={`${role.name} ${role.id}`}
                          onSelect={() => {
                            onRoleChange(isSelected ? null : role.id);
                            setOpen(false);
                          }}
                          className="cursor-pointer capitalize"
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4 shrink-0",
                              isSelected ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className={cn(isSelected && "font-medium")}>
                            {role.name}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Controls Section */}
      <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex items-center gap-2">
          <Button
            onClick={fetchRecords}
            variant="outline"
            disabled={!selectedRoleId}
          >
            <RefreshCwIcon className="size-4 sm:mr-1" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
