"use server";

import { ActionType, ResourceType, UserRoles } from "@/types/types";
import { requireActionCaller, targetIsAdmin } from "@/lib/server/action-guard";
import { hashResetToken } from "@/lib/server/password-reset-token";
import { rateLimited } from "@/lib/server/request-origin";
import { emailService } from "../../lib/email-service";
import crypto from "crypto";
import { createAdminServerClient } from "../../lib/supabase/supabase-helpers";

/**
 * Delete a user from Supabase auth
 * This must be run as a server action
 */
export async function deleteAuthUser(userId: string, type: string) {
  try {
    /* A public endpoint: only a user manager, never on themselves, and only
       an admin on an admin. */
    const caller = await requireActionCaller(ResourceType.USERS, ActionType.DELETE);
    if (userId === caller.id) return { success: false, error: "You cannot delete your own account." };
    const supabaseAdmin = await createAdminServerClient()
    if (!caller.isAdmin && (await targetIsAdmin(supabaseAdmin, userId))) {
      return { success: false, error: "Only an admin can delete an admin." };
    }
    let error: Error | null = null;
    let data: unknown | null = null;
    // First check if user exists in auth
    if (type === "user") {
      const { data: user, error: checkError } =
        await supabaseAdmin.auth.admin.deleteUser(userId);
      error = checkError;
      data = user;
    }

    if (error) {
      return { success: false, error: error.message };
    }

    // If user doesn't exist in auth, return success (already deleted)
    if (!data) {
      return {
        success: true,
        message: "User not found in auth, already deleted.",
      };
    }

    return { success: true };
  } catch (error) {
    console.error("Unexpected error deleting auth user:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error deleting auth user",
    };
  }
}

/**
 * Create a new user in Supabase auth
 * This must be run as a server action
 */
export async function createAuthUser(
  email: string,
  password: string,
  metadata: object = {},
  type: string
) {
  try {
    /* A public endpoint: only a user manager may create accounts. */
    await requireActionCaller(ResourceType.USERS, ActionType.CREATE);
    const supabaseAdmin = await createAdminServerClient()
    let error: Error | null = null;
    let data: unknown | null = null;
    if (type === UserRoles.USER) {
      const { data: userData, error: userError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: metadata,
        });
      error = userError;
      data = userData;
    }
    if (error) {
      console.error("Error creating auth user:", error);
      return { success: false, error: error.message, user: null };
    }
// @ts-expect-error - data is of type User
    return { success: true, user: data?.user  };
  } catch (error) {
    console.error("Unexpected error creating auth user:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error creating auth user",
      user: null,
    };
  }
}

/**
 * Request a password reset: generates a token, stores it, and sends an email
 */
export async function requestPasswordReset(email: string, type: string) {
  /*
    The same answer whether or not the address has an account, so the form
    cannot be used to find out who works here. Throttled per address.
  */
  const normalised = String(email ?? "").trim().toLowerCase();
  if (rateLimited(`password-reset:${normalised}`, 3, 15 * 60_000)) return { success: true };
  try {
    // 1. Find user by email
    let userId: string | null = null;
    /* Service role: this runs for signed-out users, and password_resets
       is not reachable by browser roles (migration 20261005180000). */
    const supabase = await createAdminServerClient();
    if (type === "user") {
      const { data, error } = await supabase
        .from("user_profile")
        .select("id")
        .eq("email", email)
        .single();
      if (error || !data) return { success: true }; // Don't reveal
      userId = data.id;
    }
    if (!userId) return { success: true };

    // 2. Generate secure token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    // 3. Store only the token's hash: whoever reads the table cannot use it.
    const { error: insertError } = await supabase
      .from("password_resets")
      .insert({
        user_id: userId,
        email,
        token: hashResetToken(token),
        expires_at: expiresAt.toISOString(),
      });
    if (insertError) throw new Error(insertError.message);

    // 4. Send email with reset link
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3012";
    const resetLink = `${baseUrl}/auth/reset-password?token=${token}`;
    const res = await emailService.sendEmail({
      to: email,
      subject: "Reset your password",
      html: `<p>Click <a href="${resetLink}">here</a> to reset your password. This link expires in 1 hour.</p><p>If you did not request this, ignore this email.</p>`,
    });
    if (res.error) throw new Error(res.error.message);
    return { success: true };
  } catch (error) {
    console.error("requestPasswordReset failed:", error instanceof Error ? error.message : "unknown");
    throw new Error("Something went wrong, so please try again later.");
  }
}

/**
 * Reset password using a token
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  type: string
) {
  try {
    // 1. Find token in password_resets table
    /* Service role: reading reset tokens and auth.admin both need it; the
       anon client this used could not update a password at all. */
    if (type !== "user") throw new Error("Only user type supported");
    if (typeof newPassword !== "string" || newPassword.length < 8) throw new Error("Choose a password of at least 8 characters");
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) throw new Error("Invalid or expired token");
    const supabase = await createAdminServerClient();
    /*
      Claimed first, in one statement: unused, unexpired, matched by hash.
      Two requests with the same link cannot both get here.
    */
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("password_resets")
      .update({ used_at: now })
      .eq("token", hashResetToken(token))
      .is("used_at", null)
      .gt("expires_at", now)
      .select("id, user_id")
      .maybeSingle();
    if (error || !data) throw new Error("Invalid or expired token");

    // 2. Update password using Supabase() admin
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      data.user_id,
      { password: newPassword }
    );
    if (updateError) throw new Error(updateError.message);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Unknown error");
  }
}

/**
 * Update user password using admin API
 * This must be run as a server action
 */
export async function updateUserPassword(userId: string, newPassword: string) {
  try {
    /*
      A public endpoint. Your own password, or someone else's with Users:
      Edit (an admin's only by an admin). It used to set any user's password
      for anyone who called it.
    */
    const caller = await requireActionCaller();
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return { success: false, error: "Choose a password of at least 8 characters" };
    }
    const supabaseAdmin = await createAdminServerClient()
    if (userId !== caller.id) {
      const manager = await requireActionCaller(ResourceType.USERS, ActionType.EDIT).catch(() => null);
      if (!manager) return { success: false, error: "You can only change your own password." };
      if (!manager.isAdmin && (await targetIsAdmin(supabaseAdmin, userId))) {
        return { success: false, error: "Only an admin can change an admin's password." };
      }
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) {
      console.error("Error updating password:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error("Unexpected error updating password:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error updating password",
    };
  }
}


export async function deleteAuthUserById(id: string) {
  try {
    const caller = await requireActionCaller(ResourceType.USERS, ActionType.DELETE);
    if (id === caller.id) return { success: false, error: "You cannot delete your own account." };
    const supabaseAdmin = await createAdminServerClient();
    if (!caller.isAdmin && (await targetIsAdmin(supabaseAdmin, id))) {
      return { success: false, error: "Only an admin can delete an admin." };
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) {
      throw new Error(error.message);
    }
    return { success: true };
  } catch (error) {
    console.error("Unexpected error deleting auth user:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error deleting auth user",
    };
  }
}