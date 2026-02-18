"use client";

import type { ColumnDef } from "@tanstack/react-table";
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
              <span className="font-semibold capitalize">
                {row.original.name || "-"}
              </span>
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
          <div className="hidden sm:flex items-center whitespace-pre-wrap pr-4">
            <div className="grid flex-1 text-left text-sm leading-tight pr-4">
              <span>{row.original.description || "-"}</span>
            </div>
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
          <span className="text-sm">
            {new Date(createdAt).toLocaleDateString()}
          </span>
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
