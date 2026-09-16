"use client";

import { useId } from "react";
import { LoaderCircleIcon, PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SnaggingClientsToolbarProps {
  fetchRecords: () => void;
  onGlobalFilterChange: (filter: string) => void;
  globalFilter: string;
  isSearchLoading: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  canCreate: boolean;
  onCreate: () => void;
}

/**
 * Toolbar for the clients table.
 *
 * Deliberately the same shape as the jobs and users toolbars rather than
 * its own arrangement: search on the left, page size, refresh and the
 * primary create action on the right. A coordinator moves between these
 * screens all day, and a toolbar that reshuffles itself per table makes
 * them look for the same control twice.
 */
export function SnaggingClientsToolbar({
  fetchRecords,
  onGlobalFilterChange,
  globalFilter,
  isSearchLoading,
  pageSize,
  onPageSizeChange,
  canCreate,
  onCreate,
}: SnaggingClientsToolbarProps) {
  const searchInputId = useId();

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:py-6">
      <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:max-w-md sm:min-w-[260px]">
            <Input
              id={searchInputId}
              type="search"
              placeholder="Search name, phone, email or company..."
              className="peer w-full ps-9"
              value={globalFilter}
              onChange={(event) => onGlobalFilterChange(event.target.value)}
              aria-label="Search clients"
            />
            <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
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

        <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="hidden w-full items-center gap-2 sm:flex sm:w-auto">
            <Label htmlFor="snagging-clients-rows" className="sr-only">
              Show
            </Label>
            <Select
              value={pageSize?.toString() || "10"}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger
                id="snagging-clients-rows"
                className="w-full whitespace-nowrap sm:w-fit"
              >
                <SelectValue placeholder="Select number of results" />
              </SelectTrigger>
              <SelectContent className="[&_*[role=option]]:pr-8 [&_*[role=option]]:pl-2 [&_*[role=option]>span]:right-2 [&_*[role=option]>span]:left-auto">
                {[10, 25, 50].map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={fetchRecords} variant="outline" disabled={isSearchLoading}>
              <RefreshCwIcon className="size-4 sm:mr-1" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {canCreate ? (
              <Button onClick={onCreate} className="flex-1 sm:flex-initial">
                <PlusIcon className="size-4 sm:mr-2" />
                <span className="hidden sm:inline">Add client</span>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
