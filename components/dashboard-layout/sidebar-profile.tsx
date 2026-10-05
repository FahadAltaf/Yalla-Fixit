"use client";

import { ChevronsUpDown } from "lucide-react";

import ProfileDropdown from "@/components/shadcn-studio/blocks/dropdown-profile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useAuth } from "@/context/AuthContext";
import { generateNameAvatar } from "@/utils/generateRandomAvatar";

/**
 * Who is signed in, at the foot of the sidebar.
 *
 * This was a bare avatar in the top bar: a 32px circle with no name
 * beside it, which told you there was an account but not which one --
 * on a portal where an approver and an inspector see different pages,
 * that is the one thing worth saying out loud. It sits at the foot of
 * the sidebar now, with the name and the email, and opens the same menu
 * it always did.
 */
export function SidebarProfile() {
  const { userProfile } = useAuth();

  const name = userProfile?.full_name?.trim() || "Signed in";
  const email = userProfile?.email?.trim() ?? "";
  const initial = name.charAt(0).toUpperCase() || "U";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <ProfileDropdown
          align="start"
          trigger={
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 shrink-0 rounded-md">
                <AvatarImage
                  src={userProfile?.profile_image || generateNameAvatar(name)}
                  alt={name}
                />
                <AvatarFallback className="rounded-md">{initial}</AvatarFallback>
              </Avatar>
              {/* Both lines truncate: an email is long and the sidebar is
                  not, and a wrapped address pushed the row to three lines. */}
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{name}</span>
                {email ? (
                  <span className="text-muted-foreground truncate text-xs">{email}</span>
                ) : null}
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-60" />
            </SidebarMenuButton>
          }
        />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
