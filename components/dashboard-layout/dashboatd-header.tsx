import React from "react";
import { SidebarTrigger } from "../ui/sidebar";
import { Separator } from "../ui/separator";
import SearchDialog from "../shadcn-studio/blocks/dialog-search";
import { Button } from "../ui/button";
import {
  SearchIcon,
  LanguagesIcon,
  ActivityIcon,
  BellIcon,
} from "lucide-react";
import LanguageDropdown from "../shadcn-studio/blocks/dropdown-language";
import ActivityDialog from "../shadcn-studio/blocks/dialog-activity";
import NotificationDropdown from "../shadcn-studio/blocks/dropdown-notification";
import ProfileDropdown from "../shadcn-studio/blocks/dropdown-profile";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { useAuth } from "@/context/AuthContext";
import { generateNameAvatar } from "@/utils/generateRandomAvatar";

const DashboardHeader = () => {
  const { userProfile } = useAuth();
  return (
    <header className="before:bg-background/60 sticky top-0 z-50 before:absolute before:inset-0 before:mask-[linear-gradient(var(--card),var(--card)_18%,transparent_100%)] before:backdrop-blur-md">
      <div className="bg-card relative z-51 mx-auto mt-3 flex w-[calc(100%-2rem)] items-center justify-between rounded-xl border px-6 py-2 sm:w-[calc(100%-3rem)]">
        <div className="flex items-center gap-1.5 sm:gap-4">
          <SidebarTrigger className="[&_svg]:!size-5" />
          <Separator orientation="vertical" className="hidden !h-8 sm:block" />
          <SearchDialog
            trigger={
              <>
                <Button
                  variant="ghost"
                  className="hidden !bg-transparent px-1 py-0 font-normal sm:block"
                >
                  <div className="text-muted-foreground hidden items-center gap-1.5 text-sm sm:flex">
                    <SearchIcon />
                    <span>Type to search...</span>
                  </div>
                </Button>
                <Button variant="ghost" size="icon" className="sm:hidden">
                  <SearchIcon />
                  <span className="sr-only">Search</span>
                </Button>
              </>
            }
          />
        </div>
        <div className="flex items-center gap-1.5">
          <ActivityDialog
            trigger={
              <Button variant="ghost" size="icon">
                <ActivityIcon />
              </Button>
            }
          />
          <NotificationDropdown
            trigger={
              <Button variant="ghost" size="icon" className="relative">
                <BellIcon />
                <span className="bg-destructive absolute top-2 right-2.5 size-2 rounded-full" />
              </Button>
            }
          />
          <ProfileDropdown
            trigger={
              <Button variant="ghost" size="icon" className="size-8">
                <Avatar className="size-8 rounded-md">
                  <AvatarImage
                    src={
                      userProfile?.profile_image ||
                      generateNameAvatar(userProfile?.full_name || "")
                    }
                  />
                  <AvatarFallback>
                    {userProfile?.full_name?.split(" ")[0]?.charAt(0) || "U"}
                  </AvatarFallback>
                </Avatar>
              </Button>
            }
          />
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
