"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { User } from "@/types/types";
import { Role } from "@/types/types";
import { UserRowActions } from "../actions/user-actions";
import { IconText } from "./icon-text";
import { cn } from "@/lib/actions/utils";
import { IdentityCell } from "@/components/ui/entity-avatar";
import {
  BrushIcon,
  CalendarDaysIcon,
  PencilRulerIcon,
  CrownIcon,
  PencilLineIcon,
  UserRoundIcon,
  UserIcon,
  UserStarIcon,
} from "lucide-react";

export function getUserColumns(
  fetchUsers: () => void,
  listRoles: Role[],
  isAdmin: boolean
): ColumnDef<User>[] {
  return [
    {
      id: "full_name",
      header: "User",
      accessorKey: "full_name",
      cell: ({ row }) => {
        const user = row.original;
        /*
          The same neutral user mark as every other table, not a coloured
          generated avatar. A photo the person uploaded themselves is still
          shown, since that is them rather than decoration.
        */
        if (user?.profile_image) {
          return (
            <div className="flex items-center gap-2.5">
              <Avatar className="size-8">
                <AvatarImage src={user.profile_image} alt={user.full_name || "User"} />
                <AvatarFallback className="bg-muted text-muted-foreground">
                  <UserRoundIcon className="size-4" />
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{user.full_name || "N/A"}</span>
                <span className="text-muted-foreground truncate text-xs">{user.email || ""}</span>
              </div>
            </div>
          );
        }
        return (
          <IdentityCell
            title={user?.full_name || "N/A"}
            subtitle={user?.email || null}
            icon={UserRoundIcon}
          />
        );
      },
      enableSorting: true,
    },
    {
      id: "roles.name",
      header: "Role",
      accessorKey: "roles.name",
      cell: ({ row }) => {
        const role = row.getValue("roles.name") as string;

        const roles = {
          admin: <UserStarIcon className="size-4 text-primary" />,
          author: <PencilLineIcon className="size-4 text-primary" />,
          editor: <BrushIcon className="size-4 text-primary" />,
          maintainer: <PencilRulerIcon className="size-4 text-primary" />,
          subscriber: <CrownIcon className="size-4 text-primary" />,
          user: <UserIcon className="size-4 text-primary" />,
        }[role];

        return (
          <div className="flex items-center gap-2">
            {roles}
            <span className="capitalize">{role}</span>
          </div>
        );
      },
      enableSorting: true,
    },
    {
      id: "is_active",
      header: "Status",
      accessorKey: "is_active",
      cell: ({ row }) => {
        const isActive = row.original?.is_active;
        return (
          <Badge
            className={cn(
              "rounded-sm border-none capitalize",
              isActive
                ? "bg-green-600/10 text-green-600 dark:bg-green-400/10 dark:text-green-400"
                : "bg-destructive/10 text-destructive"
            )}
          >
            {isActive ? "Active" : "Inactive"}
          </Badge>
        );
      },
      enableSorting: false,
    },

    {
      id: "created_at",
      header: "Created At",
      accessorKey: "created_at",
      cell: ({ row }) => {
        const createdAt = row.original?.created_at;
        if (!createdAt)
          return <span className="text-muted-foreground">N/A</span>;
        return (
          <IconText icon={CalendarDaysIcon}>
            {new Date(createdAt).toLocaleDateString()}
          </IconText>
        );
      },
      enableSorting: true,
    },
    {
      id: "actions",
      header: () => "Actions",
      cell: ({ row }) => {
        return (
          <UserRowActions
            user={row.original}
            fetchUsers={fetchUsers}
            listRoles={listRoles}
            isAdmin={isAdmin}
          />
        );
      },
      enableHiding: false,
      enableSorting: false,
    },
  ];
}
