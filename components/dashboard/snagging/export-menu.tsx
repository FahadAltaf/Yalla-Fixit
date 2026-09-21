"use client";

import { ChevronDown, Download, FileSpreadsheet } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ExportFormat } from "@/lib/snagging/export-table";

/**
 * CSV or Excel, for one table (FR-10.06): one Export button with the
 * format picked from its menu, rather than two buttons side by side.
 */
export function ExportMenu({
  onExport,
  disabled,
  size = "sm",
}: {
  onExport: (format: ExportFormat) => void;
  disabled?: boolean;
  /** "default" to sit level with the toolbar's Refresh button. */
  size?: "sm" | "default";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={disabled}>
          <Download className="size-4" />
          <span className="hidden sm:inline">Export</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onExport("csv")}>
          <Download className="size-4" />
          CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("xlsx")}>
          <FileSpreadsheet className="size-4" />
          Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
