"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { exportFilename, exportTable, type ExportColumn, type ExportRow } from "@/lib/snagging/export-table";

/** CSV or Excel of exactly the rows on screen (the portal's existing export). */
export function ExportMenu({ name, columns, rows }: { name: string; columns: ExportColumn[]; rows: ExportRow[] }) {
  const run = async (format: "csv" | "xlsx") => {
    try {
      await exportTable({
        columns,
        rows,
        format,
        filename: exportFilename(["amc", name, new Date().toISOString().slice(0, 10)]),
        sheetName: name,
      });
    } catch {
      toast.error("Could not create the file.");
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={rows.length === 0}>
          <Download className="size-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void run("csv")}>CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run("xlsx")}>Excel</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
