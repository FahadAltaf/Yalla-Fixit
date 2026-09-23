"use client";
import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeading, SectionCard } from "@/components/dashboard/shared/kaizen";
import { getUserProfile } from "@/lib/utils";
import { usersService } from "@/modules/users/services/users-service";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { saveFile } from "@/lib/supabase/actions/save-file";
import { AvatarCropper } from "@/components/ui/avatar-cropper";
import { Camera, Loader2, Save, User } from "lucide-react";

export type UserProfile = {
  first_name: string;
  last_name: string;
  email: string;
  profile_image?: string;
};

export function ProfileSettings() {
  const { userProfile: userProfileAuth, setUserProfile: setUserProfileAuth } =
    useAuth();
  const [userProfile, setUserProfile] = useState<UserProfile>(getUserProfile());

  useEffect(() => {
    const fetchUserData = async () => {
      if (userProfileAuth) {
        setUserProfile(userProfileAuth as UserProfile);
      }
    };
    fetchUserData();
  }, [userProfileAuth]);

  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Handle image change from AvatarCropper
  const handleProfileImageChange = async (file: File | null) => {
    setIsUploading(true);
    try {
      if (file) {
        const fileUrl = await saveFile(file);
        if (fileUrl) {
          setUserProfile((prev) => ({
            ...prev,
            profile_image: fileUrl,
          }));
        }
      } else {
        // If file is null, remove the profile image
        setUserProfile((prev) => ({
          ...prev,
          profile_image: undefined,
        }));
      }
    } catch (error) {
      console.error("Error uploading profile image:", error);
      toast.error("Failed to upload profile image");
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpdateUserProfile = async () => {
    if (!userProfileAuth?.id) {
      toast.error("User ID is missing. Please try again.");
      return;
    }
    const userId = userProfileAuth.id;
    setIsLoading(true);
    try {
      await usersService.updateUser({
        id: userId,
        first_name: userProfile?.first_name,
        last_name: userProfile?.last_name,
        full_name: userProfile?.first_name + " " + userProfile?.last_name,
        profile_image: userProfile?.profile_image ?? null,
      });
      setUserProfileAuth({
        ...userProfileAuth,
        id: userId,
        first_name: userProfile?.first_name,
        last_name: userProfile?.last_name,
        full_name: userProfile?.first_name + " " + userProfile?.last_name,
        profile_image: userProfile?.profile_image ?? null,
      });
      toast.success("Profile updated successfully");
    } catch (error) {
      console.error("Failed to update profile_image:", error);
      toast.error("Failed to update profile_image. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const saveButton = (
    <Button onClick={handleUpdateUserProfile} disabled={isLoading || isUploading}>
      {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {isLoading ? "Saving…" : "Save changes"}
    </Button>
  );

  /*
    The house page: the heading with its one action, then a section card
    per group -- the same shape as every other settings and admin page,
    instead of a bespoke card whose header carried the Save button.
  */
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="Settings"
        title="Profile"
        description="Your name and photo, as the rest of the team sees them."
        actions={saveButton}
      />

      <SectionCard
        icon={<Camera />}
        title="Profile photo"
        description="Shown beside your name across the portal. A square photo works best."
        bodyClassName="px-5 pb-5"
      >
        <div className="flex items-center gap-4">
          <AvatarCropper
            profileImage={userProfile?.profile_image}
            onImageChange={handleProfileImageChange}
            isUploading={isUploading}
            size="md"
            shape="circle"
          />
          <p className="text-muted-foreground text-sm">
            {isUploading ? "Uploading…" : "Click or drag an image onto the circle to change it."}
          </p>
        </div>
      </SectionCard>

      <SectionCard
        icon={<User />}
        title="Personal details"
        description="Your name appears on the jobs, quotations and proposals you work on."
        bodyClassName="space-y-4 px-5 pb-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="first-name">First name</Label>
            <Input
              id="first-name"
              placeholder="First name"
              value={userProfile?.first_name ?? ""}
              onChange={(e) =>
                setUserProfile((prev) => ({ ...prev, first_name: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last-name">Last name</Label>
            <Input
              id="last-name"
              placeholder="Last name"
              value={userProfile?.last_name ?? ""}
              onChange={(e) =>
                setUserProfile((prev) => ({ ...prev, last_name: e.target.value }))
              }
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={userProfile?.email ?? ""}
            disabled
            className="bg-muted/50"
          />
          <p className="text-muted-foreground text-xs">
            Your email is your sign-in, so only an admin can change it.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
