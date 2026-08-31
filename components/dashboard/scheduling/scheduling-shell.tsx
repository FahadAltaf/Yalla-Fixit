"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, PanelLeftClose, PanelLeftOpen, UsersRound } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/actions/utils";
import { SCHEDULING_NAV_COOKIE } from "@/lib/scheduling/nav-preference";

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

// Collapsing is deliberately NOT wired through SidebarProvider's open state:
// that writes a shared `sidebar_state` cookie, so this nested provider would
// fight the main dashboard sidebar for it.
//
// The preference lives in a cookie rather than localStorage so the server can
// read it and render the correct width on the first paint -- localStorage
// would force a post-mount correction, which both flashes the wrong width and
// means setting state inside an effect. The cookie NAME lives in a plain
// module (see the import) so a Server Component can read it.

export default function SchedulingShell({
  children,
  defaultNavOpen = false,
}: {
  children: React.ReactNode;
  defaultNavOpen?: boolean;
}) {
  const pathname = usePathname();
  const active = NAV.find((item) => item.href === pathname)?.name ?? NAV[0].name;
  const [navOpen, setNavOpen] = useState(defaultNavOpen);

  const toggleNav = () =>
    setNavOpen((open) => {
      const next = !open;
      document.cookie = `${SCHEDULING_NAV_COOKIE}=${next ? "open" : "closed"}; path=/; max-age=${60 * 60 * 24 * 365}`;
      return next;
    });

  // The wall display is a full-bleed screen inside this route subtree; it
  // must not inherit the section sidebar.
  if (pathname.startsWith("/scheduling/display")) return <>{children}</>;

  return (
    <SidebarProvider className="min-h-auto items-start">
      <Sidebar
        collapsible="none"
        className={cn(
          "hidden shrink-0 transition-[width] duration-200 md:flex print:hidden",
          navOpen ? "w-(--sidebar-width)" : "w-14",
        )}
      >
        <SidebarContent>
          <SidebarGroup>
              {/* The toggle sits in the group's header row rather than
                  floating alone above the items: paired with the section
                  label it reads as part of the header, and collapsed it
                  centres on the rail instead of hanging off one edge. */}
              <SidebarGroupLabel
                className={cn(
                  "mb-1 h-9 gap-2",
                  navOpen ? "justify-between px-2" : "justify-center px-0",
                )}
              >
                {navOpen && <span className="tracking-wide uppercase">Scheduling</span>}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={toggleNav}
                  aria-expanded={navOpen}
                  aria-label={navOpen ? "Collapse section menu" : "Expand section menu"}
                  title={navOpen ? "Collapse section menu" : "Expand section menu"}
                  className={cn(
                    "text-muted-foreground hover:text-foreground size-9 shrink-0 p-0",
                    navOpen && "-mr-1",
                  )}
                >
                  {navOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                </Button>
              </SidebarGroupLabel>

            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => (
                  <SidebarMenuItem key={item.name}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.name === active}
                      className={cn(
                        "group/menu-button bg-linear-to-r hover:from-sidebar-accent hover:to-sidebar-accent/40 data-[active=true]:border-primary/20 data-[active=true]:from-primary/20 data-[active=true]:to-primary/5 h-9 gap-3 rounded-md border border-transparent font-medium hover:bg-transparent [&>svg]:size-auto",
                        // Square, centred, and the same size as the toggle
                        // above it, so the rail reads as one aligned column.
                        !navOpen && "size-9 w-9 justify-center p-0 mx-auto",
                      )}
                    >
                      {/* Collapsed, the icon is the only label -- so it keeps
                          an accessible name and a hover title. */}
                      <Link href={item.href} title={navOpen ? undefined : item.name}>
                        <item.icon
                          className="text-muted-foreground/60 group-data-[active=true]/menu-button:text-primary"
                          size={20}
                          aria-hidden="true"
                        />
                        {navOpen ? <span>{item.name}</span> : <span className="sr-only">{item.name}</span>}
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
