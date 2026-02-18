"use client";

import { useState, useEffect } from "react";

import { EyeIcon, EyeOffIcon, XIcon } from "lucide-react";
import { OTPInput, type SlotProps } from "input-otp";
import { useAuth } from "@/context/AuthContext";
import {
  resendVerificationEmail,
  signIn,
  signInWithOtp,
  verifyOtp,
  type AuthServiceError,
} from "@/modules/auth/services/auth-service";
import { usersService } from "@/modules/users";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

type LoginMethod = "password" | "otp";

const LoginForm = () => {
  const router = useRouter();
  // State management (mirrors main login form logic)
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailVerificationLoading, setIsEmailVerificationLoading] =
    useState(false);
  const [emailVerificationNeeded, setEmailVerificationNeeded] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("password");
  const [otpSent, setOtpSent] = useState(false);
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  // Timer effect for resend OTP
  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => {
        setResendTimer(resendTimer - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  const handleVerifyEmail = async () => {
    if (!email) {
      setError("Please enter your email address");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    setIsVerifyingEmail(true);
    setError(null);

    try {
      const user = await usersService.getUserByEmail({
        email: { ilike: email },
      });

      if (user) {
        setEmailVerified(true);
        toast.success("Email verified! Please continue with your login.");
      } else {
        setError("No account found with this email address");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to verify email. Please try again."
      );
    } finally {
      setIsVerifyingEmail(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleVerifyEmail();
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setEmailVerificationNeeded(false);

    try {
      const result = await signIn(email, password);
      if (result && typeof result === 'object' && 'type' in result && result.type === 'error') {
        setError((result as AuthServiceError).message);
        setIsLoading(false);
        return;
      }
      window.location.href = "/";
    } catch (err) {
      setIsLoading(false);
      const errorMessage =
        err instanceof Error ? err.message : "An error occurred during login";

      if (errorMessage.includes("Email not confirmed")) {
        setEmailVerificationNeeded(true);
        setError(
          "Email not confirmed. Please verify your email or resend the verification link."
        );
      } else if (errorMessage.includes("Invalid login credentials")) {
        setError("Invalid credentials. Please check your email and password.");
      } else {
        setError(errorMessage);
      }
    }
  };

  const handleResendVerification = async () => {
    try {
      setIsEmailVerificationLoading(true);
      const result = await resendVerificationEmail(email);
      if (result && "type" in result && result.type === "error") {
        setError((result as AuthServiceError).message);
        return;
      }
      toast.success("Verification email sent. Please check your inbox.");
      setEmailVerificationNeeded(false);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to resend verification email"
      );
    } finally {
      setIsEmailVerificationLoading(false);
    }
  };

  const handleSendOTP = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setIsLoading(true);
    setError(null);

    if (!email) {
      setError("Please enter your email address");
      setIsLoading(false);
      return;
    }

    try {
      const result = await signInWithOtp(email);
      if (result && "type" in result && result.type === "error") {
        setError((result as AuthServiceError).message);
        setIsLoading(false);
        return;
      }
      setOtpSent(true);
      setResendTimer(60);
      toast.success("OTP sent to your email!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    await handleSendOTP();
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const result = await verifyOtp(email, otp);

      if (result && "type" in result && result.type === "error") {
        setError((result as AuthServiceError).message);
        setIsLoading(false);
        return;
      }

      const data = result as {
        session: { access_token: string } | null;
        user: { id: string; email: string } | null;
      };
      if (data?.session && data?.user) {
        toast.success("Login successful! Redirecting...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        window.location.href = "/";
      } else {
        setError("Failed to create session");
        setIsLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid OTP");
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Error Display */}
      {error && (
        <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      {/* Email Verification Display */}
      {emailVerificationNeeded && (
        <div className="bg-muted border border-border rounded-md p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span>Please verify your email to continue.</span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResendVerification}
              disabled={isEmailVerificationLoading}
            >
              {isEmailVerificationLoading ? "Sending..." : "Resend"}
            </Button>
          </div>
        </div>
      )}

      {/* Step 1: Email Input */}
      {!emailVerified ? (
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="leading-5" htmlFor="userEmail">
              Email address*
            </Label>
            <Input
              type="email"
              id="userEmail"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isVerifyingEmail || isLoading}
            />
          </div>

          <Button
            className="w-full"
            type="submit"
            disabled={isVerifyingEmail || isLoading}
          >
            {isVerifyingEmail ? "Verifying..." : "Continue"}
          </Button>
        </form>
      ) : loginMethod === "password" ? (
        // Step 2a: Password login (keeps original layout)
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {/* Email display */}
          <div className="bg-muted rounded-md p-3 text-sm flex items-start justify-between gap-2">
            <div>
              <p className="text-muted-foreground">Logged in as</p>
              <p className="font-medium break-all">{email}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 -m-1 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setEmail("");
                setEmailVerified(false);
                setPassword("");
                setOtp("");
                setOtpSent(false);
                setResendTimer(0);
                setError(null);
              }}
            >
              <XIcon className="h-4 w-4" />
              <span className="sr-only">Change email</span>
            </Button>
          </div>

          {/* Password */}
          <div className="w-full space-y-1">
            <Label className="leading-5" htmlFor="password">
              Password*
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={isVisible ? "text" : "password"}
                placeholder="••••••••••••••••"
                className="pr-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsVisible((prevState) => !prevState)}
                className="text-muted-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-0 rounded-l-none hover:bg-transparent"
                disabled={isLoading}
              >
                {isVisible ? <EyeOffIcon /> : <EyeIcon />}
                <span className="sr-only">
                  {isVisible ? "Hide password" : "Show password"}
                </span>
              </Button>
            </div>
          </div>

          {/* Remember Me and Forgot Password */}
          <div className="flex items-center justify-between gap-y-2">
            <div className="flex items-center gap-3">
              <Checkbox id="rememberMe" className="size-6" />
              <Label htmlFor="rememberMe"> Remember Me</Label>
            </div>

            <Button
              type="button"
              variant="link"
              onClick={() =>
                router.push("/auth/forgot-password?email=" + email)
              }
              disabled={isLoading}
              className="h-auto p-0 text-sm"
            >
              Forgot Password?
            </Button>
          </div>

          <Button className="w-full" type="submit" disabled={isLoading}>
            {isLoading ? "Signing in..." : "Sign in"}
          </Button>

          {/* Switch to OTP */}
          <div className="text-center">
            <Button
              type="button"
              variant="link"
              className="text-sm"
              disabled={isLoading}
              onClick={() => {
                setLoginMethod("otp");
                setOtpSent(false);
                setOtp("");
                setResendTimer(0);
                setError(null);
              }}
            >
              Login with OTP instead
            </Button>
          </div>
        </form>
      ) : (
        // Step 2b: OTP login
        <div className="space-y-4">
          <div className="bg-muted rounded-md p-3 text-sm flex items-start justify-between gap-2">
            <div>
              <p className="text-muted-foreground">OTP will be sent to</p>
              <p className="font-medium break-all">{email}</p>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 -m-1 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setEmail("");
                setEmailVerified(false);
                setPassword("");
                setOtp("");
                setOtpSent(false);
                setResendTimer(0);
                setError(null);
              }}
            >
              <XIcon className="h-4 w-4" />
              <span className="sr-only">Change EMAIL</span>
            </Button>
          </div>

          {!otpSent ? (
            <form onSubmit={handleSendOTP} className="space-y-4">
              <Button className="w-full" type="submit" disabled={isLoading}>
                {isLoading ? "Sending OTP..." : "Send OTP"}
              </Button>

              <div className="text-center">
                <Button
                  type="button"
                  variant="link"
                  className="text-sm"
                  disabled={isLoading}
                  onClick={() => {
                    setLoginMethod("password");
                    setOtpSent(false);
                    setOtp("");
                    setResendTimer(0);
                    setError(null);
                  }}
                >
                  Login with Password instead
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP} className="space-y-4">
              <div className="space-y-1">
                <Label className="leading-5" htmlFor="otpCode">
                  Enter OTP Code*
                </Label>
                <OTPInput
                  id="otpCode"
                  maxLength={11}
                  value={otp}
                  onChange={(value) =>
                    setOtp(value.replace(/\D/g, "").slice(0, 6))
                  }
                  inputMode="numeric"
                  containerClassName="flex items-center gap-3 has-disabled:opacity-50"
                  disabled={isLoading}
                  render={({ slots }) => (
                    <div className="flex">
                      {slots.map((slot, idx) => (
                        <OtpSlot key={String(idx)} {...slot} />
                      ))}
                    </div>
                  )}
                />
              </div>

              {/* Resend OTP with timer */}

              {/* Remember Me and Forgot Password */}
              <div className="flex items-center justify-between gap-y-2">
                <div className="flex items-center gap-3">
                  <Checkbox id="rememberMe" className="size-6" />
                  <Label htmlFor="rememberMe"> Remember Me</Label>
                </div>

                {resendTimer > 0 ? (
                  <div className="text-center text-sm text-muted-foreground">
                    Resend OTP in {resendTimer} seconds
                  </div>
                ) : (
                  <div className="text-center">
                    <Button
                      type="button"
                      variant="link"
                      className="text-sm"
                      onClick={handleResendOTP}
                      disabled={isLoading}
                    >
                      Resend OTP
                    </Button>
                  </div>
                )}
              </div>

              <Button className="w-full" type="submit" disabled={isLoading}>
                {isLoading ? "Verifying..." : "Verify OTP"}
              </Button>

              {/* Switch to Password Login */}
              <div className="text-center">
                <Button
                  type="button"
                  variant="link"
                  className="text-sm"
                  disabled={isLoading}
                  onClick={() => {
                    setLoginMethod("password");
                    setOtpSent(false);
                    setOtp("");
                    setResendTimer(0);
                    setError(null);
                  }}
                >
                  Login with Password instead
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

function OtpSlot(props: SlotProps) {
  return (
    <div
      className={cn(
        "-ms-px relative flex size-9 items-center justify-center border border-input bg-background font-medium text-foreground shadow-xs transition-[color,box-shadow] first:ms-0 first:rounded-s-md last:rounded-e-md",
        { "z-10 border-ring ring-[3px] ring-ring/50": props.isActive }
      )}
    >
      {props.char !== null && <div>{props.char}</div>}
    </div>
  );
}

export default LoginForm;
