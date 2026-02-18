"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  FileTextIcon,
  FileSpreadsheetIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";
import { Role } from "@/types/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { FilterIcon } from "lucide-react";
import { LoaderCircleIcon } from "lucide-react";
import { SearchIcon } from "lucide-react";
import AddUser from "@/components/dashboard/user/component/add-user";
import Papa from "papaparse";
import * as XLSX from "xlsx";

interface UserDataTableToolbarProps {
  fetchRecords: () => void;
  type: string;
  listRoles: Role[];
  onGlobalFilterChange: (filter: string) => void;
  isSearchLoading: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  activeFilterCount: number;
}

export function UserDataTableToolbar({
  fetchRecords,
  listRoles,
  onGlobalFilterChange,
  isSearchLoading,
  pageSize,
  onPageSizeChange,
  activeFilterCount,
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

  const exportToCSV = () => {
    const dataToExport: unknown[] = [];

    const csv = Papa.unparse(dataToExport, {
      header: true,
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `payments-export-${new Date().toISOString().split("T")[0]}.csv`
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToExcel = () => {
    const dataToExport: unknown[] = [];

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Payments");

    const cols = [
      { wch: 10 },
      { wch: 20 },
      { wch: 15 },
      { wch: 25 },
      { wch: 15 },
    ];

    worksheet["!cols"] = cols;

    XLSX.writeFile(
      workbook,
      `payments-export-${new Date().toISOString().split("T")[0]}.xlsx`
    );
  };

  const exportToJSON = () => {
    const dataToExport: unknown[] = [];

    const json = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `payments-export-${new Date().toISOString().split("T")[0]}.json`
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        <Dialog>
          <DialogTrigger asChild>
            <Button
              aria-label="Filters"
              className="bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-primary/20 dark:focus-visible:ring-primary/40 relative"
              type="button"
            >
              <FilterIcon className="size-4" />
              <span className="ms-2 hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <Badge className="-top-2 -right-2 absolute min-w-5 px-1 rounded-full">
                  {activeFilterCount > 9 ? "9+" : activeFilterCount}
                </Badge>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Filters</DialogTitle>
              <DialogDescription>
                Refine the users you see in the table.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4">
              <DialogClose asChild>
                <Button variant="outline" type="button">
                  Close
                </Button>
              </DialogClose>
              <DialogClose asChild>
                <Button type="button">Apply</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-primary/20 dark:focus-visible:ring-primary/40">
              <UploadIcon />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={exportToCSV}>
              <FileTextIcon className="mr-2 size-4" />
              Export as CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportToExcel}>
              <FileSpreadsheetIcon className="mr-2 size-4" />
              Export as Excel
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={exportToJSON}>
              <FileTextIcon className="mr-2 size-4" />
              Export as JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          onClick={() => setIsDialogOpen(true)}
          className="flex-1 sm:flex-initial"
        >
          <PlusIcon className="size-4 sm:mr-2" />
          <span className="hidden sm:inline">Add User</span>
        </Button>
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
