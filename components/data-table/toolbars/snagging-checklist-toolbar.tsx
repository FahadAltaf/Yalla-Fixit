"use client";

import { useId, useState } from "react";
import {
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";

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

/**
 * Toolbar for the checklist library, in the same shape as the catalogue
 * one: search on the left with its filters, then page size, refresh and
 * the primary add action on the right.
 *
 * The property-type filter answers the question this screen exists for:
 * "what does a villa inspection actually get asked?"
 */
interface SnaggingChecklistToolbarProps {
  fetchRecords: () => void;
  onGlobalFilterChange: (filter: string) => void;
  isSearchLoading: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  groups: string[];
  groupValue: string;
  onGroupChange: (value: string) => void;
  propertyTypeValue: string;
  onPropertyTypeChange: (value: string) => void;
  /** Kept for callers; the create action now lives in the page heading. */
  canCreate?: boolean;
  onCreate?: () => void;
}

const PROPERTY_TYPES = [
  { value: "apartment", label: "Apartment" },
  { value: "villa", label: "Villa" },
  { value: "townhouse", label: "Townhouse" },
  { value: "commercial", label: "Commercial" },
];

export function SnaggingChecklistToolbar({
  fetchRecords,
  onGlobalFilterChange,
  isSearchLoading,
  pageSize,
  onPageSizeChange,
  groups,
  groupValue,
  onGroupChange,
  propertyTypeValue,
  onPropertyTypeChange,
}: SnaggingChecklistToolbarProps) {
  const searchInputId = useId();
  const [globalFilter, setGlobalFilter] = useState<string>("");

  function handleFilterChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setGlobalFilter(value);
    onGlobalFilterChange?.(value);
  }

  return (
    <div className="flex flex-row flex-wrap items-center justify-between gap-2 px-4 py-4 sm:gap-4 sm:py-6">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80 sm:flex-none">
          <Input
            id={searchInputId}
            type="search"
            placeholder="Search..."
            className="peer w-full ps-9"
            value={globalFilter}
            onChange={handleFilterChange}
            aria-label="Search the checklist library"
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

        <Select value={groupValue} onValueChange={onGroupChange}>
          <SelectTrigger className="w-48" aria-label="Filter by group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All groups</SelectItem>
            {groups.map((group) => (
              <SelectItem key={group} value={group}>
                {group}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={propertyTypeValue} onValueChange={onPropertyTypeChange}>
          <SelectTrigger className="w-44" aria-label="Filter by property type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any property type</SelectItem>
            {PROPERTY_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                Given to {type.label.toLowerCase()}s
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="hidden w-full items-center gap-2 sm:flex sm:w-auto">
          <Label htmlFor="snagging-checklist-rows" className="sr-only">
            Show
          </Label>
          <Select
            value={pageSize?.toString() || "10"}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger
              id="snagging-checklist-rows"
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
        </div>
      </div>
    </div>
  );
}
