"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, UsersRound } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";

// Section navigation for the Scheduling module, following the same layout as
// the Extensions page (components/dashboard/extensions/index.tsx): a plain
// non-collapsible sidebar on desktop, an icon tab bar on mobile, and the
// content in a ScrollArea so the sidebar stays put while the page scrolls.
//
// The one departure from Extensions: it swaps sections with local state on a
// single route, whereas these two sections are real routes because each loads
// its own data on the server. So the items are Links and the active item comes
// from the pathname, which keeps deep links and the back button working.
const NAV = [
  { name: "Daily Schedule", href: "/scheduling", icon: CalendarDays },
  { name: "Technicians & Leave", href: "/scheduling/technicians", icon: UsersRound },
] as const;

export default function SchedulingShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = NAV.find((item) => item.href === pathname)?.name ?? NAV[0].name;

  return (
    <SidebarProvider className="min-h-auto items-start">
      <Sidebar collapsible="none" className="hidden md:flex print:hidden">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => (
                  <SidebarMenuItem key={item.name}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.name === active}
                      className="group/menu-button bg-linear-to-r hover:from-sidebar-accent hover:to-sidebar-accent/40 data-[active=true]:border-primary/20 data-[active=true]:from-primary/20 data-[active=true]:to-primary/5 h-9 gap-3 rounded-md border border-transparent font-medium hover:bg-transparent [&>svg]:size-auto"
                    >
                      <Link href={item.href}>
                        <item.icon
                          className="text-muted-foreground/60 group-data-[active=true]/menu-button:text-primary"
                          size={22}
                          aria-hidden="true"
                        />
                        <span>{item.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <main className="flex w-full min-w-0 flex-col">
        <div className="mb-4 md:hidden print:hidden">
          <Tabs value={active}>
            <TabsList
              className="grid h-auto! w-full p-1"
              style={{ gridTemplateColumns: `repeat(${NAV.length}, minmax(0, 1fr))` }}
            >
              {NAV.map((item) => (
                <TabsTrigger
                  key={item.name}
                  value={item.name}
                  asChild
                  className="flex items-center gap-2 py-2 text-xs sm:text-sm"
                >
                  <Link href={item.href}>
                    <item.icon className="size-4" aria-hidden="true" />
                    {item.name}
                  </Link>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Radix gives the viewport an inner wrapper with `display: table`,
            which sizes to its widest child. The schedule board is wider than
            the viewport by design, so that wrapper grew past the visible area
            and -- since this ScrollArea only renders a VERTICAL scrollbar --
            the overflow was silently cut off with no way to reach it.
            Forcing the wrapper back to a full-width block keeps children
            inside the viewport, so the board scrolls sideways in its own
            container the way it was built to. */}
        <ScrollArea className="h-[calc(100vh-110px)] [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full">
          <div className="flex min-w-0 flex-col gap-4 pt-0 pr-0 pb-0 md:pl-4">
            <Card className="relative top-px right-px w-full min-w-0 flex-1 gap-4 p-4">{children}</Card>
          </div>
        </ScrollArea>
      </main>
    </SidebarProvider>
  );
}
