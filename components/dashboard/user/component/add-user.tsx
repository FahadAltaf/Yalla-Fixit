"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { usersService } from "@/modules/users/services/users-service";
import { UserRoles, type Role } from "@/types/types";
import {
  Select,
  SelectItem,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAuthUser } from "@/modules/auth/auth-actions";
import { toast } from "sonner";
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
import { UserAvatar } from "../../../ui/user-avatar";

// Define form validation schema
const formSchema = z
  .object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    role: z.string().min(1, "Role is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

interface AddUserProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onRefresh?: () => void;
  listRoles?: Role[];
}

export default function AddUser({
  open = false,
  onOpenChange,
  onRefresh,
  listRoles,
}: AddUserProps) {
  const [profile_image, setProfile] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Initialize form
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolver: any = zodResolver(formSchema as any);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver,
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "",
    },
  });

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      form.reset();
      form.setValue(
        "role",
        listRoles?.find((role) => role.name === UserRoles.USER)?.id || ""
      );
      setProfile("");
    }
  }, [open, form, listRoles]);

  // Handler for creating user
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);

    try {
      // 1. Create user in authentication
      const metadata = {
        first_name: values.firstName,
        last_name: values.lastName,
      };

      const authResult = await createAuthUser(
        values.email,
        values.password,
        metadata,
        UserRoles.USER
      );

      if (!authResult.success || !authResult.user) {
        throw new Error(
          authResult.error || "Failed to create authentication user"
        );
      }

      // 2. Create user in profile_image table
      const userData = {
        id: authResult.user.id,
        first_name: values.firstName,
        last_name: values.lastName,
        full_name: values.firstName + " " + values.lastName,
        email: values.email,
        profile_image: profile_image || "",
        role_id: values.role,
      };

      await usersService.createUser(userData);

      toast.success("User created successfully");

      // Close dialog and refresh user list
      if (onOpenChange) onOpenChange(false);
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error("Error creating user:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to create user"
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
            Add New User
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto max-h-[80vh]">
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
                      <FormItem className="flex-1 space-y-1 flex flex-col gap-1">
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
                      <FormItem className="flex-1 space-y-1 flex flex-col gap-1">
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
                    <FormItem className="space-y-1 flex flex-col gap-1">
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input placeholder="Email" type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex flex-col gap-4 sm:flex-row">
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem className="flex-1 space-y-1 flex flex-col gap-1">
                        <FormLabel className="h-max">Password</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Password"
                            type="password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem className="flex-1 space-y-1 flex flex-col gap-1">
                        <FormLabel className="h-max">
                          Confirm Password
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Confirm password"
                            type="password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem className="space-y-1 gap-1 w-full">
                      <FormLabel>Role</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="uppercase w-full">
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {listRoles?.map((role) => (
                            <SelectItem
                              key={role.id}
                              value={role.id}
                              className="uppercase"
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

<DialogFooter className=" -mx-6 -mb-6">
<Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange?.(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? "Creating..." : "Create User"}
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
