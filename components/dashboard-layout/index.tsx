"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRightIcon, SearchIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { MenuItem, MenuSection, User } from "@/types/types";
import { getNavData } from "./menu-items";
import Image from "next/image";
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

import DashboardHeader from "./dashboatd-header";
import CompanyLogo from "@/public/site-logo.webp";

/**
 * How specifically a sub-item claims the current path, as the length of
 * the prefix it matched. 0 means it does not claim it at all.
 *
 * A `match` prefix only applies further down the tree, never on the
 * prefix itself, so a list claiming its section root cannot steal the
 * highlight from the landing page that lives there.
 */
function claimedDepth(pathname: string, item: MenuItem): number {
  if (pathname === item.url) return item.url.length;
  if (!item.exact && pathname.startsWith(`${item.url}/`)) return item.url.length;

  for (const prefix of item.match ?? []) {
    if (pathname.startsWith(`${prefix}/`)) return prefix.length;
  }
  return 0;
}

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
          {section.items.map((item) => {
            // Within a group, exactly one sub-item is selected: the one
            // whose claimed path is the longest prefix of where you are.
            // Plain startsWith lit up every ancestor at once (on
            // /snagging/jobs/new it marked Overview, Jobs and New job all
            // active), so the selection never told you where you were.
            //
            // `exact` keeps a section landing page from claiming its own
            // children; `match` lets a list claim the record pages that
            // open outside its own url, so opening an inspection keeps
            // Jobs selected rather than jumping the highlight to Overview.
            const activeSubUrl =
              item.items
                ?.map((subItem) => ({
                  url: subItem.url,
                  depth: claimedDepth(pathname, subItem),
                }))
                .filter((entry) => entry.depth > 0)
                .sort((a, b) => b.depth - a.depth)[0]?.url ?? null;

            return item.items && item.items.length > 0 ? (
              <Collapsible className="group/collapsible" key={item.title}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip={item.title}
                      className="truncate"
                      isActive={activeSubUrl !== null}
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
                            isActive={subItem.url === activeSubUrl}
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
            );
          })}
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
                  className="gap-2.5 !bg-transparent [&>svg]:size-8 flex items-center justify-center"
                  asChild
                >
                  <Link href="/">
                  <Image src={CompanyLogo} alt="Company Logo" width={140} height={140} className="w-[140px] h-auto" unoptimized />

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
        {/*
          min-w-0 stops this column being sized by its widest child. A
          flex item defaults to min-width:auto, so one wide element
          inside a page — a chart that measures its own container, a
          table of nowrap columns — pushed the whole shell past the
          viewport and made the window scroll sideways instead of the
          element scrolling inside its own box.
        */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* <header className="bg-card sticky top-0 z-50 h-13.75 border-b">
            <div className="mx-auto flex h-full max-w-[1500px] items-center justify-between gap-6 px-4 sm:px-6">
              <SidebarTrigger className="[&_svg]:!size-5" />
            </div>
          </header> */}
          <DashboardHeader />

          <main className="@container/main mx-auto size-full flex-1 px-4 py-6 sm:px-6">
            {children}
          </main>
        </div>
      </SidebarProvider>
    </div>
  );
};

export default DashboardLayout;
