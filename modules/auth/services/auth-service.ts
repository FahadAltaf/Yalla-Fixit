"use server";

import { emailService } from "@/lib/email-service";
import {
  createServerClientWithCookies,
  createAdminServerClient,
  getAppUrl,
} from "@/lib/supabase/supabase-helpers";

import { rolesService } from "@/modules/roles";
import { usersService } from "@/modules/users";
import { User } from "@/types/types";
import { AuthChangeEvent, Session } from "@supabase/supabase-js";

export interface AuthSignupData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role_id?: string;
}

export type AuthServiceError = {
  type: "error";
  message: string;
};

const createError = (message: string): AuthServiceError => ({
  type: "error",
  message,
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ✅ MUCH CLEANER - Using helper instead of repeating code!
export async function signUp({
  email,
  password,
  firstName,
  lastName,
  role_id = "",
}: AuthSignupData): Promise<AuthServiceError | unknown> {
  try {
    const supabase = await createServerClientWithCookies();

    // Check if user exists
    const existingUser = await usersService.getUserByEmail({
      email: { ilike: email },
    });

    if (existingUser) {
      return createError("User already registered with this email");
    }

    // Create auth user
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName, last_name: lastName } },
    });

    if (error) {
      console.error("Auth signUp error:", error);
      return createError(error.message);
    }

    if (data?.user) {
      try {
        const roleId = await rolesService.getRoleByName();
        const payload = {
          id: data.user.id,
          email: data.user.email,
          role_id: role_id || roleId,
          first_name: firstName || null,
          last_name: lastName || null,
          full_name: `${firstName ?? ""} ${lastName ?? ""}`.trim() || null,
          is_active: true,
        };

        const result = await usersService.insertUser(payload as User);
        if (result && typeof result === "string") {
          return createError(result);
        }
      } catch (profileError) {
        console.error("Error in user profile creation:", profileError);
        return createError(
          profileError instanceof Error
            ? profileError.message
            : "Failed to create user profile"
        );
      }
    }

    return data;
  } catch (error) {
    console.error("Unexpected signUp error:", error);
    return createError(
      error instanceof Error ? error.message : "Failed to sign up"
    );
  }
}

export async function signIn(email: string, password: string) {
  try {
    const supabase = await createServerClientWithCookies();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("Auth signIn error:", error);
      return createError(
        error.message || "Invalid login credentials. Please try again."
      );
    }

    return data;
  } catch (error) {
    console.error("Unexpected signIn error:", error);
    return createError(
      error instanceof Error ? error.message : "Failed to sign in"
    );
  }
}



export async function signOut() {
  const supabase = await createServerClientWithCookies();
  const { error } = await supabase.auth.signOut();
  if (error) return createError(error.message);
  return { success: true };
}

export async function sendInvites(emails: string[]) {
  try {
    const supabaseAdmin = await createAdminServerClient();
    const appUrl = getAppUrl();

    for (const email of emails) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: false,
      });

      if (error) {
        console.error("Auth sendInvites error:", error);
        return createError(error.message || "Failed to create invited user");
      }

      // Send invite email with server-side URL
      emailService.sendInviteEmail(
        email,
        `${appUrl}/auth/accept-invite/${data?.user?.id}`
      );

      if (data?.user) {
        await delay(2000);
        try {
          const roleId = await rolesService.getRoleByName();
          const payload = {
            id: data.user.id,
            email: data.user.email,
            role_id: roleId,
            first_name: null,
            last_name: null,
            is_active: true,
          };

          await usersService.insertUser(payload as User);
        } catch (profileError) {
          console.error("Error in profile creation:", profileError);
          return createError("Failed to create user profile for invite");
        }
      }
    }

    return { success: true };
  } catch (error) {
    console.error("sendInvites error:", error);
    return createError(
      error instanceof Error ? error.message : "Failed to send invites"
    );
  }
}

export async function resendVerificationEmail(email: string) {
  try {
    const supabase = await createServerClientWithCookies();

    const { data, error } = await supabase.auth.resend({
      type: "signup",
      email: email,
    });

    if (error || !data?.user) {
      console.error("Auth resendVerificationEmail error:", error);
      return createError(
        !data?.user
          ? "User not found"
          : error?.message ||
              "Failed to resend verification email. Try again later."
      );
    }

    return data;
  } catch (error) {
    console.error("Unexpected resendVerificationEmail error:", error);
    return createError(
      error instanceof Error
        ? error.message
        : "Failed to resend verification email"
    );
  }
}

export async function acceptInvite(token: string, password: string) {
  try {
    const supabaseAdmin = await createAdminServerClient();

    const { data: sessionData, error: sessionError } =
      await supabaseAdmin.auth.admin.updateUserById(token, {
        password: password,
        email_confirm: true,
      });

    if (sessionError) {
      return createError("Invalid or expired invite token");
    }

    if (!sessionData?.user) {
      return createError("No user found for this token");
    }

    return sessionData;
  } catch (error) {
    console.error("Error in acceptInvite:", error);
    return createError(
      error instanceof Error ? error.message : "Failed to accept invite"
    );
  }
}

export async function deleteUser(id: string) {
  try {
    const appUrl = getAppUrl();

    const response = await fetch(`${appUrl}/api/auth/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id }),
    });

    if (!response.ok) {
      console.error("Auth deleteUser error:", response.statusText);
      return createError("Failed to delete user");
    }

    await signOut();
    return response.json();
  } catch (error) {
    console.error("deleteUser error:", error);
    return createError(
      error instanceof Error ? error.message : "Failed to delete user"
    );
  }
}

export async function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
) {
  const supabase = await createServerClientWithCookies();
  return supabase.auth.onAuthStateChange(callback);
}

export async function signInWithOtp(email: string) {
  try {
    const supabase = await createServerClientWithCookies();

    const { error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        shouldCreateUser: false,
      },
    });

    if (error) {
      console.error("Auth signInWithOtp error:", error);
      return createError(
        error.message || "Failed to send OTP. Please try again later."
      );
    }

    return { success: true };
  } catch (error) {
    console.error("Unexpected signInWithOtp error:", error);
    return createError(
      error instanceof Error ? error.message : "Failed to send OTP"
    );
  }
}

export async function verifyOtp(email: string, token: string) {
  try {
    const supabase = await createServerClientWithCookies();

    const { data, error } = await supabase.auth.verifyOtp({
      email: email,
      token: token,
      type: "email",
    });

    if (error) {
      console.error("Auth verifyOtp error:", error);
      return createError(error.message || "Invalid or expired OTP");
    }

    return data;
  } catch (error) {
    console.error("Unexpected verifyOtp error:", error);
    return createError(
      error instanceof Error ? error.message : "Failed to verify OTP"
    );
  }
}

export async function signInWithOAuth(
  provider: "google" | "apple" | "facebook",
  redirectTo: string
) {
  try {
    const supabase = await createServerClientWithCookies();

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectTo,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error) {
      console.error("Auth signInWithOAuth error:", error);
      return createError(
        error.message || "Failed to sign in with social provider"
      );
    }

    return data;
  } catch (error) {
    console.error("Unexpected signInWithOAuth error:", error);
    return createError(
      error instanceof Error ? error.message : "Failed to sign in with OAuth"
    );
  }
}

export async function resetPasswordForEmail(
  email: string,
  redirectTo: string
) {
  try {
    const supabase = await createServerClientWithCookies();

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo,
    });

    if (error) {
      console.error("Auth resetPasswordForEmail error:", error);
      return createError(
        error.message ||
          "Failed to send password reset email. Please try again later."
      );
    }

    return { success: true };
  } catch (error) {
    console.error("Unexpected resetPasswordForEmail error:", error);
    return createError(
      error instanceof Error ? error.message : "Failed to reset password"
    );
  }
}

export async function updatePassword(password: string) {
  try {
    const supabase = await createServerClientWithCookies();

    const { error } = await supabase.auth.updateUser({
      password: password,
    });

    if (error) {
      console.error("Auth updatePassword error:", error);
      return createError(error.message || "Failed to update password");
    }

    return { success: true };
  } catch (error) {
    console.error("Unexpected updatePassword error:", error);
    return createError(
      error instanceof Error ? error.message : "Failed to update password"
    );
  }
}

export async function verifyRecoveryOtp(tokenHash: string) {
  try {
    const supabase = await createServerClientWithCookies();

    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });

    if (error) {
      console.error("Auth verifyRecoveryOtp error:", error);
      return createError(
        error.message || "Invalid or expired recovery token. Please try again."
      );
    }

    return data;
  } catch (error) {
    console.error("Unexpected verifyRecoveryOtp error:", error);
    return createError(
      error instanceof Error ? error.message : "Failed to verify recovery OTP"
    );
  }
}

export async function setSession(accessToken: string, refreshToken: string) {
  try {
    const supabase = await createServerClientWithCookies();

    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      console.error("Auth setSession error:", error);
      return createError(error.message || "Failed to set session");
    }

    return data;
  } catch (error) {
    console.error("Unexpected setSession error:", error);
    return createError(
      error instanceof Error ? error.message : "Failed to set session"
    );
  }
}