"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, FileText, PanelLeftClose, PanelLeftOpen, Settings2, Wrench } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarGroupLabel } from "@/components/ui/sidebar";
import { cn } from "@/lib/actions/utils";
import { EXTENSIONS_NAV_COOKIE } from "@/lib/extensions/nav-preference";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { ExtensionsPageClient } from "./bulk-download";
import { QuotationTemplatesPage } from "./quotation-templates/index";
import { AmcContractsPage } from "./amc/index";
import { AmcSettingsPage } from "./amc/amc-settings-page";
import { canUseAmc } from "./amc/amc-constants";

const ALL_NAV_ITEMS = [
  { name: "Bulk Download", icon: Download },
  { name: "Quotation Templates", icon: FileText },
  { name: "AMC Proposals", icon: Wrench },
  /* FR6.1 — admin-only, and a stricter gate than the module itself: the
     allowlist decides who writes a proposal, but only an admin changes
     the text every proposal is written from. */
  { name: "AMC Settings", icon: Settings2 },
] as const;

/*
  Each section's address, so a reload or a shared link opens the section
  it was on (?section=amc-proposals) rather than always the first one.
*/
const SECTION_SLUGS: Record<(typeof ALL_NAV_ITEMS)[number]["name"], string> = {
  "Bulk Download": "bulk-download",
  "Quotation Templates": "quotation-templates",
  "AMC Proposals": "amc-proposals",
  "AMC Settings": "amc-settings",
};

function sectionFromSlug(slug: string | null): string {
  const found = Object.entries(SECTION_SLUGS).find(([, value]) => value === slug);
  return found ? found[0] : "Bulk Download";
}

export default function Extensions({ defaultNavOpen = false }: { defaultNavOpen?: boolean }) {
  const { userProfile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSection = sectionFromSlug(searchParams.get("section"));
  /*
    Switching section is a new entry in the history, so Back returns to
    the section before. A section's own state (the AMC tab, the open
    proposal) is dropped, since it belongs to the section being left.
  */
  const setActiveSection = useCallback(
    (name: string) => {
      const slug = SECTION_SLUGS[name as keyof typeof SECTION_SLUGS];
      if (!slug || name === activeSection) return;
      router.push(`${pathname}?section=${slug}`, { scroll: false });
    },
    [router, pathname, activeSection],
  );
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

  /* AMC Proposals: admins, and roles with the AMC Proposals permission.
     AMC Settings: admins only. */
  const isAdmin = userProfile?.roles?.name === "admin";
  const canAccessAmc = canUseAmc(userProfile);

  const nav = useMemo(
    () =>
      ALL_NAV_ITEMS.filter((item) => {
        if (item.name === "AMC Proposals") return canAccessAmc;
        /* Hidden outright rather than shown-and-refused: a non-admin has
           nothing to do on this screen. */
        if (item.name === "AMC Settings") return canAccessAmc && isAdmin;
        return true;
      }),
    [canAccessAmc, isAdmin]
  );

  const resolvedActiveSection =
    (activeSection === "AMC Proposals" && !canAccessAmc) ||
    (activeSection === "AMC Settings" && !(canAccessAmc && isAdmin))
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
      case "AMC Settings":
        return canAccessAmc && isAdmin ? (
          <AmcSettingsPage />
        ) : (
          <ExtensionsPageClient />
        );
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
              /*
                Pinned: it stays put while the page scrolls under it. The
                offset clears the sticky page header (about 5rem tall), so
                the rail never slides beneath it, and a long list scrolls
                inside the rail rather than running off the screen.

                Styled like the Settings rail: the sidebar's own ground, a
                gradient pill on the open section.
              */
              "hidden shrink-0 transition-[width] duration-200 md:sticky md:top-[5.5rem] md:flex md:max-h-[calc(100dvh-6.5rem)] md:self-start md:overflow-y-auto",
              navOpen ? "w-56" : "w-14",
            )}
          >
            <SidebarContent>
              <SidebarGroup className="p-1.5">
                {/* Toggle in the header row beside the section label;
                    collapsed, it centres on the rail at the same 40px
                    square as the items below it. */}
                <SidebarGroupLabel
                  className={cn(
                    "mb-1 h-9 gap-2",
                    navOpen ? "justify-between pl-2 pr-0" : "justify-center px-0",
                  )}
                >
                  {navOpen && (
                    <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                      Extensions
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={toggleNav}
                    aria-expanded={navOpen}
                    aria-label={navOpen ? "Collapse section menu" : "Expand section menu"}
                    title={navOpen ? "Collapse section menu" : "Expand section menu"}
                    className="text-muted-foreground hover:text-foreground size-8 shrink-0 p-0"
                  >
                    {navOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                  </Button>
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
                    {nav.map((item) => {
                      const active = item.name === resolvedActiveSection;
                      const button = (
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          className={cn(
                            "group/menu-button h-9 gap-3 rounded-md bg-linear-to-r font-medium hover:bg-transparent hover:from-sidebar-accent hover:to-sidebar-accent/40 data-[active=true]:from-primary/20 data-[active=true]:to-primary/5 [&>svg]:size-auto",
                            // Square and centred when collapsed, so the rail
                            // is one aligned column of equal buttons.
                            !navOpen && "mx-auto size-9 justify-center p-0",
                          )}
                        >
                          {/*
                            A real link to the section's address. It used to
                            point at "#", and following that link undid the
                            section change the click had just made.
                          */}
                          <Link
                            href={`${pathname}?section=${SECTION_SLUGS[item.name]}`}
                            scroll={false}
                            aria-current={active ? "page" : undefined}
                          >
                            <item.icon
                              className={cn(
                                "size-4 shrink-0",
                                active ? "text-primary" : "text-muted-foreground/70",
                              )}
                              aria-hidden="true"
                            />
                            {navOpen ? (
                              <span className="truncate">{item.name}</span>
                            ) : (
                              <span className="sr-only">{item.name}</span>
                            )}
                          </Link>
                        </SidebarMenuButton>
                      );
                      return (
                        <SidebarMenuItem key={item.name}>
                          {navOpen ? (
                            button
                          ) : (
                            // Collapsed, the name appears beside the icon on hover.
                            <Tooltip>
                              <TooltipTrigger asChild>{button}</TooltipTrigger>
                              <TooltipContent side="right">{item.name}</TooltipContent>
                            </Tooltip>
                          )}
                        </SidebarMenuItem>
                      );
                    })}
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

            {/*
              The page scrolls, as every other page does. A fixed-height
              inner scroll box (screen height minus 110px) inside a page that
              also scrolls left a band of empty space under any short section.
            */}
            <div className="flex flex-col gap-4 md:pl-4">
              {renderSettingsContent()}
            </div>
          </main>
        </SidebarProvider>
      </div>
    </div>
  );
}
