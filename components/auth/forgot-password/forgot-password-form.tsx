"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { resetPasswordForEmail } from "@/modules/auth/services/auth-service";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

interface ForgotPasswordFormProps {
  email: string;
  setEmail: (email: string) => void;
  isEmailSent: boolean;
  setIsEmailSent: (sent: boolean) => void;
}

const ForgotPasswordForm = ({
  email,
  setEmail,
  isEmailSent,
  setIsEmailSent,
}: ForgotPasswordFormProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const { settings } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Use Supabase's built-in password reset
      await resetPasswordForEmail(
        email,
        `${window.location.origin}/auth/reset-password`
      );

      setIsEmailSent(true);
      toast.success(
        "If your email exists in our system, a reset link has been sent."
      );
    } catch (err) {
      console.error("Password reset error:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to send reset email"
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isEmailSent) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-0">
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>Check your inbox and spam folder</li>
              <li>The link will expire in 1 hour</li>
              <li>Click the link to create a new password</li>
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              setIsEmailSent(false);
              setEmail("");
            }}
          >
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {/* Email */}
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
          disabled={isLoading}
        />
      </div>

      <Button
        className="w-full"
        type="submit"
        disabled={isLoading}
        style={{
          backgroundColor: settings?.primary_color || undefined,
        }}
      >
        {isLoading ? "Sending..." : "Send Reset Link"}
      </Button>
    </form>
  );
};

export default ForgotPasswordForm;
