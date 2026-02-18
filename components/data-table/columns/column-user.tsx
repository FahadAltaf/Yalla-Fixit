"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { User } from "@/types/types";
import { Role } from "@/types/types";
import { UserRowActions } from "../actions/user-actions";
import { cn } from "@/lib/actions/utils";
import { generateNameAvatar } from "@/utils/generateRandomAvatar";
import {
  BrushIcon,
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
        const initials = user?.full_name
          ? user.full_name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)
          : user?.email?.[0]?.toUpperCase() || "U";

        return (
          <div className="flex items-center gap-2">
            <Avatar className="size-8">
              <AvatarImage
                src={
                  user?.profile_image ||
                  generateNameAvatar(user?.full_name || "")
                }
                alt={user?.full_name || "User"}
              />
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium">{user?.full_name || "N/A"}</span>
              <span className="text-muted-foreground text-sm">
                {user?.email || ""}
              </span>
            </div>
          </div>
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
