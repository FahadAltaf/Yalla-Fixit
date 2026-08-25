"use client";

import { useId, useState } from "react";
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

interface SnaggingCatalogueToolbarProps {
  fetchRecords: () => void;
  onGlobalFilterChange: (filter: string) => void;
  isSearchLoading: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  /** Element filter — the second level of the taxonomy. */
  elements: Array<[string, string]>;
  elementValue: string;
  onElementChange: (value: string) => void;
  canCreate: boolean;
  onCreate: () => void;
}

/**
 * Toolbar for the snag catalogue, in the same shape as the users
 * toolbar: search on the left, then the element filter, page size,
 * refresh and the primary add action on the right.
 */
export function SnaggingCatalogueToolbar({
  fetchRecords,
  onGlobalFilterChange,
  isSearchLoading,
  pageSize,
  onPageSizeChange,
  elements,
  elementValue,
  onElementChange,
  canCreate,
  onCreate,
}: SnaggingCatalogueToolbarProps) {
  const searchInputId = useId();
  const [globalFilter, setGlobalFilter] = useState<string>("");

  function handleFilterChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setGlobalFilter(value);
    onGlobalFilterChange?.(value);
  }

  return (
    <div className="flex flex-row flex-wrap items-center justify-between gap-2 px-4 py-4 sm:gap-4 sm:py-6">
      <div className="flex flex-1 items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs sm:min-w-[240px]">
          <Input
            id={searchInputId}
            type="search"
            placeholder="Search code or defect..."
            className="peer w-full ps-9"
            value={globalFilter}
            onChange={handleFilterChange}
            aria-label="Search the catalogue"
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

        <Select value={elementValue} onValueChange={onElementChange}>
          <SelectTrigger className="w-44" aria-label="Filter by element">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All elements</SelectItem>
            {elements.map(([code, label]) => (
              <SelectItem key={code} value={code}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="hidden w-full items-center gap-2 sm:flex sm:w-auto">
          <Label htmlFor="snagging-catalogue-rows" className="sr-only">
            Show
          </Label>
          <Select
            value={pageSize?.toString() || "10"}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger id="snagging-catalogue-rows" className="w-full whitespace-nowrap sm:w-fit">
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
              <span className="hidden sm:inline">Add defect type</span>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
