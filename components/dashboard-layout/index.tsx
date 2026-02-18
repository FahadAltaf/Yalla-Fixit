"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRightIcon, SearchIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { MenuSection, User } from "@/types/types";
import { getNavData } from "./menu-items";

import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@/components/ui/sidebar";

import LogoSvg from "@/assets/svg/logo";
import DashboardHeader from "./dashboatd-header";

const SidebarGroupedMenuItems = ({ section }: { section: MenuSection }) => {
  const pathname = usePathname();

  const renderIcon = (icon: React.ReactNode) => {
    // Icons are now pre-rendered as React elements in menu-items.tsx
    // Just return them directly
    return icon;
  };

  return (
    <SidebarGroup>
      {section.title && <SidebarGroupLabel>{section.title}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {section.items.map((item) =>
            item.items && item.items.length > 0 ? (
              <Collapsible className="group/collapsible" key={item.title}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip={item.title}
                      className="truncate"
                      isActive={item.items.some((subItem) =>
                        pathname.startsWith(subItem.url)
                      )}
                    >
                      {renderIcon(item.icon)}
                      <span>{item.title}</span>
                      <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.items.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            className="justify-between"
                            asChild
                            isActive={pathname.startsWith(subItem.url)}
                          >
                            <Link href={subItem.url}>
                              {subItem.title}
                              {subItem.unreadCount && (
                                <span className="bg-primary/10 flex h-5 min-w-5 items-center justify-center rounded-full text-xs">
                                  {subItem.unreadCount}
                                </span>
                              )}
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            ) : (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  asChild
                  isActive={pathname === item.url}
                >
                  <Link href={item.url}>
                    {renderIcon(item.icon)}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                {item.unreadCount && (
                  <SidebarMenuBadge className="bg-primary/10 rounded-full">
                    {item.unreadCount}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            )
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  const { userProfile } = useAuth();
  const { navMain } = getNavData(userProfile || ({} as User));

  return (
    <div className="flex min-h-dvh w-full">
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  className="gap-2.5 !bg-transparent [&>svg]:size-8"
                  asChild
                >
                  <Link href="/">
                    <LogoSvg className="[&_rect]:fill-sidebar [&_rect:first-child]:fill-primary" />
                    <span className="text-xl font-semibold">YALLA FIXIT</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem className="px-2 [[data-state=collapsed]_&]:hidden">
                {/* <div className="relative mt-4">
                  <div className="text-muted-foreground pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center pl-3 peer-disabled:opacity-50">
                    <SearchIcon className="size-4" />
                    <span className="sr-only">Search</span>
                  </div>
                  <Input
                    type="text"
                    placeholder="Search"
                    className="peer bg-card pl-9"
                  />
                </div> */}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            {navMain.map((section) => (
              <SidebarGroupedMenuItems key={section.title} section={section} />
            ))}
          </SidebarContent>
          <SidebarFooter className="[[data-state=collapsed]_&]:hidden"></SidebarFooter>
        </Sidebar>
        <div className="flex flex-1 flex-col">
          {/* <header className="bg-card sticky top-0 z-50 h-13.75 border-b">
            <div className="mx-auto flex h-full max-w-[1500px] items-center justify-between gap-6 px-4 sm:px-6">
              <SidebarTrigger className="[&_svg]:!size-5" />
            </div>
          </header> */}
          <DashboardHeader />

          <main className="mx-auto size-full flex-1 px-4 py-6 sm:px-6">
            {children}
          </main>
        </div>
      </SidebarProvider>
    </div>
  );
};

export default DashboardLayout;
