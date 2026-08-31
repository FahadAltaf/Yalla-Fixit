"use client";

import { useMemo, useState } from "react";
import { Download, FileText, PanelLeftClose, PanelLeftOpen, Wrench } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { SidebarGroupLabel } from "@/components/ui/sidebar";
import { cn } from "@/lib/actions/utils";
import { EXTENSIONS_NAV_COOKIE } from "@/lib/extensions/nav-preference";

import Link from "next/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/context/AuthContext";
import { ExtensionsPageClient } from "./bulk-download";
import { QuotationTemplatesPage } from "./quotation-templates/index";
import { AmcContractsPage } from "./amc/index";
import { canAccessAmcContracts } from "./amc/amc-constants";

const ALL_NAV_ITEMS = [
  { name: "Bulk Download", icon: Download },
  { name: "Quotation Templates", icon: FileText },
  { name: "AMC Proposals", icon: Wrench },
] as const;

export default function Extensions({ defaultNavOpen = false }: { defaultNavOpen?: boolean }) {
  const { userProfile } = useAuth();
  const [activeSection, setActiveSection] = useState("Bulk Download");
  // Collapsed by default, matching the Scheduling section nav. The
  // preference is a cookie so the server renders the right width on the
  // first paint rather than correcting it after mount.
  const [navOpen, setNavOpen] = useState(defaultNavOpen);

  const toggleNav = () =>
    setNavOpen((open) => {
      const next = !open;
      document.cookie = `${EXTENSIONS_NAV_COOKIE}=${next ? "open" : "closed"}; path=/; max-age=${60 * 60 * 24 * 365}`;
      return next;
    });

  const canAccessAmc = canAccessAmcContracts(userProfile?.email);

  const nav = useMemo(
    () =>
      ALL_NAV_ITEMS.filter(
        (item) => item.name !== "AMC Proposals" || canAccessAmc
      ),
    [canAccessAmc]
  );

  const resolvedActiveSection =
    activeSection === "AMC Proposals" && !canAccessAmc
      ? "Bulk Download"
      : activeSection;

  const renderSettingsContent = () => {
    switch (resolvedActiveSection) {
      case "Bulk Download":
        return <ExtensionsPageClient />;
      case "Quotation Templates":
        return <QuotationTemplatesPage />;
      case "AMC Proposals":
        return canAccessAmc ? <AmcContractsPage /> : <ExtensionsPageClient />;
      default:
        return null;
    }
  };

  return (
    <div className="">
      <div className="">
        <SidebarProvider className="items-start min-h-auto">
          <Sidebar
            collapsible="none"
            className={cn(
              "hidden shrink-0 transition-[width] duration-200 md:flex",
              navOpen ? "w-(--sidebar-width)" : "w-14",
            )}
          >
            <SidebarContent>
              <SidebarGroup>
                {/* Toggle lives in the group header beside the section label,
                    so it never floats alone; collapsed, it centres on the
                    rail at the same 36px square as the items below it. */}
                <SidebarGroupLabel
                  className={cn(
                    "mb-1 h-9 gap-2",
                    navOpen ? "justify-between px-2" : "justify-center px-0",
                  )}
                >
                  {navOpen && <span className="tracking-wide uppercase">Extensions</span>}
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
                    {nav.map((item) => (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          asChild
                          isActive={item.name === resolvedActiveSection}
                          onClick={() => setActiveSection(item.name)}
                          className={cn(
                            "group/menu-button font-medium gap-3 h-9 rounded-md border border-transparent bg-linear-to-r hover:bg-transparent hover:from-sidebar-accent hover:to-sidebar-accent/40 data-[active=true]:border-primary/20 data-[active=true]:from-primary/20 data-[active=true]:to-primary/5 [&>svg]:size-auto",
                            // Square and centred when collapsed, so the rail
                            // is one aligned column rather than wide pills
                            // wrapped around small glyphs.
                            !navOpen && "size-9 w-9 justify-center p-0 mx-auto",
                          )}
                        >
                          <Link href={"#"} title={navOpen ? undefined : item.name}>
                            {item.icon && (
                              <item.icon
                                className="text-muted-foreground/60 group-data-[active=true]/menu-button:text-primary"
                                size={20}
                                aria-hidden="true"
                              />
                            )}
                            {navOpen ? (
                              <span>{item.name}</span>
                            ) : (
                              <span className="sr-only">{item.name}</span>
                            )}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>

          <main className="flex flex-col w-full">
            <div className="md:hidden mb-4">
              <Tabs value={resolvedActiveSection} onValueChange={setActiveSection}>
                <TabsList
                  className="grid w-full h-auto! p-1"
                  style={{
                    gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))`,
                  }}
                >
                  {nav.map((item) => (
                    <TabsTrigger
                      key={item.name}
                      value={item.name}
                      className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-2 sm:py-2.5 text-xs sm:text-sm "
                    >
                      {item.icon && (
                        <item.icon
                          className="h-4 w-4 sm:h-5 sm:w-5"
                          aria-hidden="true"
                        />
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <ScrollArea className="h-[calc(100vh-110px)] sm:h-[calc(100vh-11Opx)] overflow-y-auto ">
              <div className="flex flex-col gap-4 md:pl-4 pr-0 pt-0 pb-0 ">
                {renderSettingsContent()}
              </div>
            </ScrollArea>
          </main>
        </SidebarProvider>
      </div>
    </div>
  );
}
