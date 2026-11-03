"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CalendarDays, ShieldCheck } from "lucide-react";

import { IconText } from "@/components/data-table/columns/icon-text";
import { TruncatedText } from "@/components/ui/truncated-text";
import type { Role } from "@/types/types";
import { RoleRowActions } from "@/components/data-table/actions/role-actions";

export function getRoleColumns(onChanged: () => void): ColumnDef<Role>[] {
  return [
    {
      id: "name",
      header: "Role",
      accessorKey: "name",
      cell: ({ row }) => {
        return (
          <div className="flex items-center w-full">
            <div className="grid flex-1 text-left text-sm leading-tight">
              <IconText icon={ShieldCheck} className="font-semibold capitalize">
                {row.original.name || "-"}
              </IconText>
            </div>
          </div>
        );
      },
    },
    {
      id: "description",
      header: () => <span className="hidden sm:inline">Description</span>,
      accessorKey: "description",
      cell: ({ row }) => {
        const description = row.original.description;
        if (!description) {
          return (
            <span className="hidden sm:inline text-xs text-muted-foreground">
              No description
            </span>
          );
        }
        return (
          <div className="hidden max-w-96 pr-4 sm:block">
            <TruncatedText text={row.original.description || "-"} className="text-sm" />
          </div>
        );
      },
      size: 350,
      enableSorting: false,
    },
    {
      id: "created_at",
      header: "Created At",
      accessorKey: "created_at",
      cell: ({ row }) => {
        const createdAt = row.original?.created_at;
        if (!createdAt) {
          return <span className="text-xs text-muted-foreground">N/A</span>;
        }
        return (
          <IconText icon={CalendarDays}>
            {new Date(createdAt).toLocaleDateString()}
          </IconText>
        );
      },
      enableSorting: true,
    },
    {
      id: "actions",
      header: () => "Actions",
      cell: ({ row }) => (
        <RoleRowActions role={row.original} fetchRoles={onChanged} />
      ),
      enableHiding: false,
      enableSorting: false,
    },
  ];
}
