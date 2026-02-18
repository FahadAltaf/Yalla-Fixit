"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Ban,
  CheckCircle2,
  EllipsisVerticalIcon,
  LockIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { User } from "@/types/types";
import { Role } from "@/types/types";
import EditUser from "@/components/dashboard/user/component/edit-user";
import ChangePassword from "@/components/dashboard/user/component/change-password";
import { usersService } from "@/modules/users/services/users-service";
import { deleteAuthUser } from "@/modules/auth/auth-actions";
import { toast } from "sonner";
import { ConfirmationAlertDialog } from "@/components/ui/confirmation-alert-dialog";
import { useAuth } from "@/context/AuthContext";

interface UserRowActionsProps {
  user: User;
  fetchUsers: () => void;
  listRoles: Role[];
  isAdmin: boolean;
}

export function UserRowActions({
  user,
  fetchUsers,
  listRoles,
  isAdmin,
}: UserRowActionsProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isToggleStatusDialogOpen, setIsToggleStatusDialogOpen] =
    useState(false);

  const { userProfile } = useAuth();

  if (user.email === userProfile?.email) {
    return;
  }

  const handleDelete = () => {
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      // Delete from auth first
      await deleteAuthUser(user.id, "user");

      // Delete from database
      await usersService.deleteUser(user.id);

      toast.success("User deleted successfully");
      fetchUsers();
      setIsDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error deleting user:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to delete user"
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleStatus = () => {
    setIsToggleStatusDialogOpen(true);
  };

  const confirmToggleStatus = async () => {
    const nextActive = !user.is_active;
    setIsTogglingStatus(true);
    try {
      const updatedUserData = {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        profile_image: user.profile_image,
        full_name: user.full_name,
        role_id: user.role_id,
        is_active: nextActive,
      };

      await usersService.updateUser(updatedUserData);
      toast.success(`User ${nextActive ? "enabled" : "disabled"} successfully`);
      fetchUsers();
      setIsToggleStatusDialogOpen(false);
    } catch (error) {
      console.error("Error updating user status:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to update user status"
      );
    } finally {
      setIsTogglingStatus(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Open menu"
          >
            <EllipsisVerticalIcon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max">
          <DropdownMenuItem onClick={() => setIsEditOpen(true)}>
            <PencilIcon className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem onClick={() => setIsChangePasswordOpen(true)}>
              <LockIcon className="mr-2 h-4 w-4" />
              Change Password
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <DropdownMenuItem
              onClick={handleToggleStatus}
              disabled={isTogglingStatus}
            >
              {user.is_active ? (
                <Ban className="mr-2 h-4 w-4" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              {isTogglingStatus
                ? user.is_active
                  ? "Disabling..."
                  : "Enabling..."
                : user.is_active
                ? "Disable User"
                : "Enable User"}
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-destructive focus:text-destructive"
              >
                <Trash2Icon className="mr-2 h-4 w-4" />
                {isDeleting ? "Deleting..." : "Delete"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditUser
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        userData={user}
        fetchUser={fetchUsers}
        listRoles={listRoles}
      />
      {isAdmin && (
        <ChangePassword
          open={isChangePasswordOpen}
          onOpenChange={setIsChangePasswordOpen}
          userId={user.id}
        />
      )}

      {isAdmin && (
        <ConfirmationAlertDialog
          isOpen={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          title="Delete User"
          description={`Are you sure you want to delete user ${
            user?.full_name || user?.email
          }? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          onConfirm={confirmDelete}
          loading={isDeleting}
          icon={<Trash2Icon className="h-4 w-4 text-destructive" />}
          variant="destructive"
        />
      )}

      {isAdmin && (
        <ConfirmationAlertDialog
          isOpen={isToggleStatusDialogOpen}
          onOpenChange={setIsToggleStatusDialogOpen}
          title={user.is_active ? "Disable User" : "Enable User"}
          description={`Are you sure you want to ${
            user.is_active ? "disable" : "enable"
          } user ${user?.full_name || user?.email}?`}
          confirmText={user.is_active ? "Disable" : "Enable"}
          cancelText="Cancel"
          onConfirm={confirmToggleStatus}
          loading={isTogglingStatus}
          icon={
            user.is_active ? (
              <Ban className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )
          }
          variant="default"
        />
      )}
    </>
  );
}
