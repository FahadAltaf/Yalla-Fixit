"use client";

import { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { User } from "@/types/types";
import { usersService } from "@/modules/users/services/users-service";
import type { Role } from "@/types/types";
import {
  Select,
  SelectItem,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import { UserAvatar } from "../../../ui/user-avatar";

// Define form validation schema
const formSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  role: z.string().min(1, "Role is required"),
});

interface EditUserProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  userData?: User;
  fetchUser: () => void;
  listRoles?: Role[];
}

export default function EditUser({
  open = false,
  onOpenChange,
  userData,
  fetchUser,
  listRoles,
}: EditUserProps) {
  const [profile_image, setProfile] = useState(userData?.profile_image || "");
  const [isLoading, setIsLoading] = useState(false);
  // Initialize form
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolver: any = zodResolver(formSchema as any);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver,
    defaultValues: {
      firstName: userData?.first_name || "",
      lastName: userData?.last_name || "",
      email: userData?.email || "",
      role: userData?.role_id || "",
    },
  });

  // Reset form when userData changes
  useEffect(() => {
    if (userData) {
      form.reset({
        firstName: userData.first_name || "",
        lastName: userData.last_name || "",
        email: userData.email || "",
        role: userData.role_id || "",
      });
      setProfile(userData.profile_image || "");
    }
  }, [userData, form]);

  // Handler for saving changes
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!userData) return;

    setIsLoading(true);
    try {
      // Update user profile_image
      const updatedUserData = {
        id: userData.id,
        first_name: values.firstName,
        last_name: values.lastName,
        email: values.email,
        profile_image: profile_image,
        full_name: values.firstName + " " + values.lastName,
        role_id: values.role,
        is_active: userData.is_active,
      };

      await usersService.updateUser(updatedUserData);
      toast.success("User updated successfully");
      if (onOpenChange) onOpenChange(false);
      fetchUser();
    } catch (error) {
      console.error("Error saving user data:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to update user"
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-0 overflow-y-visible p-0 sm:max-w-lg [&>button:last-child]:top-3.5">
        <DialogHeader className="contents space-y-0 text-left">
          <DialogTitle className="border-b px-6 py-4 text-base">
            Edit User
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center ">
            <UserAvatar
              profileImage={profile_image}
              onProfileChange={setProfile}
            />
            <span className="text-sm text-muted-foreground">
              {"Click or drag to upload profile picture"}
            </span>
          </div>
          <div className="px-6 pt-4 pb-6">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <div className="flex flex-col gap-4 sm:flex-row">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem className="flex-1 space-y-2 flex flex-col gap-1">
                        <FormLabel className="h-max">First name</FormLabel>
                        <FormControl>
                          <Input placeholder="First name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem className="flex-1 space-y-2 flex flex-col gap-1">
                        <FormLabel className="h-max">Last name</FormLabel>
                        <FormControl>
                          <Input placeholder="Last name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="space-y-2 gap-1 flex flex-col">
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Email"
                          type="email"
                          {...field}
                          disabled
                          className="peer pe-9"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem className="space-y-2 gap-1 w-full">
                      <FormLabel>Role</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="uppercase w-full">
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {listRoles?.map((role) => (
                            <SelectItem
                              className="uppercase "
                              key={role.id}
                              value={role.id}
                            >
                              {role.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter className="border-t px-0 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange?.(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? "Saving..." : "Save changes"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
