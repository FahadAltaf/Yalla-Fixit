"use client";

import { useState } from "react";
import { User, Building, Paintbrush } from "lucide-react";
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

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProfileSettings } from "./profile-settings";
import { OrganizationSettings } from "./organization-settings";
import { AppearanceSettings } from "./appearance-settings";

export default function Settings() {
  const [activeSection, setActiveSection] = useState("Profile");
  const { settings } = useAuth();

  // Navigation data
  const data = {
    nav: [
      { name: "Profile", icon: User },
      // { name: "Organization", icon: Building },
      { name: "Appearance", icon: Paintbrush },
    ],
  };

  // Render different setting sections
  const renderSettingsContent = () => {
    switch (activeSection) {
      case "Profile":
        return <ProfileSettings />;
      // case "Organization":
      //   return settings ? <OrganizationSettings settings={settings} /> : null;
      case "Appearance":
        return settings ? <AppearanceSettings settings={settings} /> : null;
    
      default:
        return null;
    }
  };

  return (
    <div className="">
      <div className="">
        <SidebarProvider className="items-start min-h-auto">
          <Sidebar collapsible="none" className="hidden md:flex ">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {data.nav.map((item) => (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          asChild
                          isActive={item.name === activeSection}
                          onClick={() => setActiveSection(item.name)}
                          className="group/menu-button font-medium gap-3 h-9 rounded-md bg-linear-to-r hover:bg-transparent hover:from-sidebar-accent hover:to-sidebar-accent/40 data-[active=true]:from-primary/20 data-[active=true]:to-primary/5 [&>svg]:size-auto"
                        >
                          <Link href={"#"}>
                            {item.icon && (
                              <item.icon
                                className="text-muted-foreground/60 group-data-[active=true]/menu-button:text-primary"
                                size={22}
                                aria-hidden="true"
                              />
                            )}
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

          <main className="flex flex-col w-full">
            {/* Mobile Tabs - Visible on mobile, hidden on desktop */}
            <div className="md:hidden mb-4">
              <Tabs value={activeSection} onValueChange={setActiveSection}>
                <TabsList className="grid w-full grid-cols-4 h-auto! p-1">
                  {data.nav.map((item) => (
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
                      {/* <span className="hidden xs:inline">
                        {item.name === "Agent Mapping" ? "Mapping" : item.name}
                      </span>
                      <span className="xs:hidden text-[13px]">
                        {item.name === "Agent Mapping" ? "Mapping" : item.name}
                      </span> */}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <ScrollArea className="h-[calc(100vh-118px)] sm:h-[calc(100vh-118px)] overflow-y-auto ">
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
