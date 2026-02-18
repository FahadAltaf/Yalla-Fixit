"use client";
import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getUserProfile } from "@/lib/utils";
import { usersService } from "@/modules/users/services/users-service";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { saveFile } from "@/lib/supabase/actions/save-file";
import { AvatarCropper } from "@/components/ui/avatar-cropper";

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

  return (
    <Card className="w-full flex-1  relative top-px right-px gap-6">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex  gap-1 flex-col">
          <CardTitle className=" ">Profile Settings</CardTitle>
          <CardDescription>
            Update your personal details and profile picture
          </CardDescription>
        </div>
        <Button
          onClick={handleUpdateUserProfile}
          disabled={isLoading}
          className="w-full sm:w-auto hidden sm:block"
        >
          {isLoading ? "Saving..." : "Save Changes"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Profile Picture with Avatar Cropper */}
        <div className="space-y-4">
          <div className="flex items-center space-x-4">
            <AvatarCropper
              profileImage={userProfile?.profile_image}
              onImageChange={handleProfileImageChange}
              isUploading={isUploading}
              size="md"
              shape="circle"
            />
            <span className="text-sm text-muted-foreground">
              {isUploading
                ? "Uploading..."
                : "Click or drag to upload profile picture"}
            </span>
          </div>
        </div>

        {/* Name Fields in Responsive Row */}
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-base font-medium">Full Name</Label>
            <p className="text-sm text-muted-foreground">
              Your first and last name as you&apos;d like it to appear
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="first-name">First Name</Label>
              <Input
                id="first-name"
                placeholder="Enter first name"
                value={userProfile?.first_name}
                onChange={(e) =>
                  setUserProfile((prev) => ({
                    ...prev,
                    first_name: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last-name">Last Name</Label>
              <Input
                id="last-name"
                placeholder="Enter last name"
                value={userProfile?.last_name}
                onChange={(e) =>
                  setUserProfile((prev) => ({
                    ...prev,
                    last_name: e.target.value,
                  }))
                }
              />
            </div>
          </div>
        </div>

        {/* Email Field */}
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-base font-medium">Email Address</Label>
            <p className="text-sm text-muted-foreground">
              Your email address is used for signing in
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="Enter email address"
              value={userProfile?.email}
              disabled
              className="bg-muted/50"
            />
            <p className="text-xs text-muted-foreground">
              Email cannot be changed. Contact an administrator for assistance.
            </p>
          </div>
        </div>

        <Button
          onClick={handleUpdateUserProfile}
          disabled={isLoading}
          className="w-full sm:w-auto block sm:hidden"
        >
          {isLoading ? "Saving..." : "Save Changes"}
        </Button>
      </CardContent>
    </Card>
  );
}
