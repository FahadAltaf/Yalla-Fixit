"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { Role } from "@/types/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoaderCircleIcon } from "lucide-react";
import { SearchIcon } from "lucide-react";
import AddUser from "@/components/dashboard/user/component/add-user";

interface UserDataTableToolbarProps {
  fetchRecords: () => void;
  type: string;
  listRoles: Role[];
  onGlobalFilterChange: (filter: string) => void;
  isSearchLoading: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}

export function UserDataTableToolbar({
  fetchRecords,
  listRoles,
  onGlobalFilterChange,
  isSearchLoading,
  pageSize,
  onPageSizeChange,
}: UserDataTableToolbarProps) {
  const searchInputId = useId();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [globalFilter, setGlobalFilter] = useState<string>("");
  const handleFilterChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setGlobalFilter(value);
    onGlobalFilterChange?.(value);
  };

  return (
    <div className="flex gap-2 sm:gap-4 py-4 sm:py-6 px-4 flex-row items-center justify-between">
      {/* Search Input */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 sm:min-w-[260px] sm:max-w-md">
          <Input
            id={searchInputId}
            ref={searchInputRef}
            type="search"
            placeholder="Search users..."
            className="peer ps-9 w-full"
            value={globalFilter}
            onChange={handleFilterChange}
          />
          <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground/80 peer-disabled:opacity-50">
            {isSearchLoading ? (
              <LoaderCircleIcon
                aria-label="Loading..."
                className="animate-spin"
                role="status"
                size={16}
              />
            ) : (
              <SearchIcon aria-hidden="true" size={16} />
            )}
          </div>
        </div>
      </div>

      {/* Controls Section */}
      <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
        {/* Page Size Selector */}
        <div className="hidden sm:flex items-center gap-2 w-full sm:w-auto">
          <Label htmlFor="#rowSelect" className="sr-only">
            Show
          </Label>
          <Select
            value={pageSize?.toString() || "5"}
            onValueChange={(value) => {
              onPageSizeChange(Number(value));
            }}
          >
            <SelectTrigger
              id="rowSelect"
              className="w-full sm:w-fit whitespace-nowrap"
            >
              <SelectValue placeholder="Select number of results" />
            </SelectTrigger>
            <SelectContent className="[&_*[role=option]]:pr-8 [&_*[role=option]]:pl-2 [&_*[role=option]>span]:right-2 [&_*[role=option]>span]:left-auto">
              {[10, 25, 50].map((pageSize) => (
                <SelectItem key={pageSize} value={pageSize.toString()}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={fetchRecords} variant="outline">
            <RefreshCwIcon className="size-4 sm:mr-1" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button onClick={() => setIsDialogOpen(true)} className="flex-1 sm:flex-initial">
            <PlusIcon className="size-4 sm:mr-2" />
            <span className="hidden sm:inline">Add User</span>
          </Button>
        </div>
      </div>

      <AddUser
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        listRoles={listRoles}
        onRefresh={fetchRecords}
      />
    </div>
  );
}
