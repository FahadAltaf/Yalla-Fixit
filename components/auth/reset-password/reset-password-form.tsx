"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EyeIcon, EyeOffIcon} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  setSession,
  verifyRecoveryOtp,
  updatePassword,
  signOut,
  type AuthServiceError,
} from "@/modules/auth/services/auth-service";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

interface ResetPasswordFormProps {
  isValidSession: boolean | null;
  setIsValidSession: (valid: boolean | null) => void;
}

const ResetPasswordForm = ({
  isValidSession,
  setIsValidSession,
}: ResetPasswordFormProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { settings } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] =
    useState(false);
  const [passwordStrength, setPasswordStrength] = useState({
    hasMinLength: false,
    hasUpperCase: false,
    hasLowerCase: false,
    hasNumber: false,
    hasSpecialChar: false,
  });

  // Check if user has valid session from reset email
  useEffect(() => {
    const checkSession = async () => {
      try {
        // Wait a bit for Supabase to process the redirect
        await new Promise((resolve) => setTimeout(resolve, 500));
console.log("🚀 ~ checkSession ~ window.location.hash:", window.location)
        // Method 1: Check for hash fragment (access_token in URL)
        if (window.location.hash) {
          const hashParams = new URLSearchParams(
            window.location.hash.substring(1)
          );
          const accessToken = hashParams.get("access_token");
          console.log("🚀 ~ checkSession ~ accessToken:", accessToken)
          const refreshToken = hashParams.get("refresh_token");
          console.log("🚀 ~ checkSession ~ refreshToken:", refreshToken)
          const type = hashParams.get("type");
          console.log("🚀 ~ checkSession ~ type:", type)

          if (type === "recovery" && accessToken) {
            const result = await setSession(accessToken, refreshToken || "");
            console.log("🚀 ~ checkSession ~ result:", result)
            if (result && "type" in result && result.type === "error") {
              console.error(
                "Session set error:",
                (result as AuthServiceError).message
              );
              setIsValidSession(false);
              toast.error(
                (result as AuthServiceError).message ||
                  "Invalid or expired reset link. Please request a new one."
              );
              return;
            }
            const data = result as { session: { access_token: string } | null };
            if (data?.session) {
              setIsValidSession(true);
              window.history.replaceState(null, "", window.location.pathname);
              return;
            }
            setIsValidSession(false);
            toast.error(
              "Invalid or expired reset link. Please request a new one."
            );
            return;
          }
        }

        // Method 2: Check for query parameters (token_hash and type)
        const tokenHash = searchParams.get("token_hash");
        console.log("🚀 ~ checkSession ~ tokenHash:", tokenHash)
        const type = searchParams.get("type");
        console.log("🚀 ~ checkSession ~ type:", type)

        if (type === "recovery" && tokenHash) {
          // Exchange the token_hash for a session
          const result = await verifyRecoveryOtp(tokenHash);
          console.log("🚀 ~ checkSession ~ result:", result)
          if (result && "type" in result && result.type === "error") {
            console.error(
              "Token verification error:",
              (result as AuthServiceError).message
            );
            setIsValidSession(false);
            toast.error(
              (result as AuthServiceError).message ||
                "Invalid or expired reset link. Please request a new one."
            );
            return;
          }
          const data = result as { session: { access_token: string } | null };
          console.log("🚀 ~ checkSession ~ data:", data)
          // if (data?.session) {
          //   setIsValidSession(true);
          //   // Clean URL
          //   window.history.replaceState(null, "", window.location.pathname);
          //   return;
          // }
          // setIsValidSession(false);
          // toast.error(
          //   "Invalid or expired reset link. Please request a new one."
          // );
          return;
        }

        // If no valid recovery token found
        if (!window.location.hash && !tokenHash) {
          setIsValidSession(false);
        }
      } catch (err) {
        console.error("Session check error:", err);
        setIsValidSession(false);
        toast.error("Something went wrong. Please try again.");
      }
    };

    if (isValidSession === null) {
      checkSession();
    }
  }, []);

  // Password strength validation
  useEffect(() => {
    setPasswordStrength({
      hasMinLength: password.length >= 8,
      hasUpperCase: /[A-Z]/.test(password),
      hasLowerCase: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    });
  }, [password]);

  const isPasswordStrong =
    passwordStrength.hasMinLength &&
    passwordStrength.hasUpperCase &&
    passwordStrength.hasLowerCase &&
    passwordStrength.hasNumber;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (!isPasswordStrong) {
      toast.error("Please meet all password requirements");
      return;
    }

    setIsLoading(true);

    try {
      const updateResult = await updatePassword(password);
      if (
        updateResult &&
        "type" in updateResult &&
        updateResult.type === "error"
      ) {
        toast.error((updateResult as AuthServiceError).message);
        setIsLoading(false);
        return;
      }

      toast.success("Password reset successfully!");

      // Sign out user after password reset
      const signOutResult = await signOut();
      if (
        signOutResult &&
        "type" in signOutResult &&
        signOutResult.type === "error"
      ) {
        console.error(
          "Sign out error:",
          (signOutResult as AuthServiceError).message
        );
        // Continue with redirect even if sign out fails
      }

      // Redirect to login
      setTimeout(() => {
        router.push("/auth/login?reset=success");
      }, 1500);
    } catch (err) {
      console.error("Password reset error:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to reset password"
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidSession === null || isValidSession === false) {
    return;
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {/* Password */}
      <div className="w-full space-y-1">
        <Label className="leading-5" htmlFor="password">
          New Password*
        </Label>
        <div className="relative">
          <Input
            id="password"
            type={isPasswordVisible ? "text" : "password"}
            placeholder="Enter new password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
            className="pr-9"
          />
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={() => setIsPasswordVisible((prevState) => !prevState)}
            className="text-muted-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-0 rounded-l-none hover:bg-transparent"
          >
            {isPasswordVisible ? <EyeOffIcon /> : <EyeIcon />}
            <span className="sr-only">
              {isPasswordVisible ? "Hide password" : "Show password"}
            </span>
          </Button>
        </div>
      </div>

      {/* Confirm Password */}
      <div className="w-full space-y-1">
        <Label className="leading-5" htmlFor="confirmPassword">
          Confirm Password*
        </Label>
        <div className="relative">
          <Input
            id="confirmPassword"
            type={isConfirmPasswordVisible ? "text" : "password"}
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={isLoading}
            className="pr-9"
          />
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={() =>
              setIsConfirmPasswordVisible((prevState) => !prevState)
            }
            className="text-muted-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-0 rounded-l-none hover:bg-transparent"
          >
            {isConfirmPasswordVisible ? <EyeOffIcon /> : <EyeIcon />}
            <span className="sr-only">
              {isConfirmPasswordVisible ? "Hide password" : "Show password"}
            </span>
          </Button>
        </div>
      </div>

      <Button
        className="w-full"
        type="submit"
        disabled={isLoading || !isPasswordStrong}
        style={{
          backgroundColor: settings?.primary_color || undefined,
        }}
      >
        {isLoading ? "Resetting Password..." : "Reset Password"}
      </Button>
    </form>
  );
};

export default ResetPasswordForm;
