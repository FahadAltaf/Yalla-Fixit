"use server";

import { UserRoles } from "@/types/types";
import { emailService } from "../../lib/email-service";
import crypto from "crypto";
import { createAdminServerClient, createServerClientWithCookies } from "../../lib/supabase/supabase-helpers";

/**
 * Delete a user from Supabase auth
 * This must be run as a server action
 */
export async function deleteAuthUser(userId: string, type: string) {
  try {
    const supabaseAdmin = await createAdminServerClient()
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
  try {
    // 1. Find user by email
    let userId: string | null = null;
    const supabase  = await createServerClientWithCookies()
    if (type === "user") {
      const { data, error } = await supabase
        .from("user_profile")
        .select("id")
        .eq("email", email)
        .single();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("User not found"); // Don't reveal
      userId = data.id;
    }
    if (!userId) throw new Error("User not found");

    // 2. Generate secure token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    // 3. Store token in password_resets table
    const { error: insertError } = await supabase
      .from("password_resets")
      .insert({
        user_id: userId,
        email,
        token,
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
    console.log("🚀 ~ requestPasswordReset ~ error:", error);
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
    const supabase = await createServerClientWithCookies()
    const { data, error } = await supabase
      .from("password_resets")
      .select("id, user_id, expires_at, used_at")
      .eq("token", token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Invalid or expired token");
    if (data.used_at) throw new Error("Token already used");
    if (new Date(data.expires_at) < new Date())
      throw new Error("Token expired");

    // 2. Update password using Supabase() admin
    if (type !== "user") throw new Error("Only user type supported");
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      data.user_id,
      { password: newPassword }
    );
    if (updateError) throw new Error(updateError.message);

    // 3. Mark token as used
    await supabase
      .from("password_resets")
      .update({ used_at: new Date().toISOString() })
      .eq("id", data.id);
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
    const supabaseAdmin = await createAdminServerClient()
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
    const supabaseAdmin = await createAdminServerClient();
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