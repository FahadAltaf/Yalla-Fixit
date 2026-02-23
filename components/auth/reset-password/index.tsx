"use client";
import { Suspense, useState } from "react";
import { ChevronLeftIcon } from "lucide-react";

import { BorderBeam } from "@/components/ui/border-beam";

import Logo from "@/components/ui/logo";
import AuthFullBackgroundShape from "@/assets/svg/auth-full-background-shape";
import ResetPasswordForm from "./reset-password-form";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import LoginImage from "@/public/yalla-login-image.png";

const ResetPasswordContent = () => {
  const router = useRouter();
  const [isValidSession, setIsValidSession] = useState<boolean | null>(null);
  return (
    <div className="h-dvh lg:grid lg:grid-cols-6">
      {/* Dashboard Preview */}
      <div className="max-lg:hidden lg:col-span-3 xl:col-span-4">
        <div className="bg-muted relative z-1 flex h-full items-center justify-center px-6">
          <div className="outline-border relative shrink rounded-[20px] p-2.5 outline-2 -outline-offset-[2px]">
          <Image
                src={LoginImage}
              className="max-h-111 w-full rounded-lg object-contain dark:hidden h-auto"
              width={1000}
              height={1000}
              unoptimized
              alt="Yalla Login Image"
            />
           
            <BorderBeam duration={8} borderWidth={2} size={100} />
          </div>

          <div className="absolute -z-1">
            <AuthFullBackgroundShape />
          </div>
        </div>
      </div>

      {/* ResetPassword Form */}
      <div className="flex h-full flex-col items-center justify-center py-10 sm:px-5 lg:col-span-3 xl:col-span-2">
        <div className="w-full max-w-md px-6">
          {/* <a
            href="#"
            className="text-muted-foreground group mb-12 flex items-center gap-2 sm:mb-16 lg:mb-24"
          >
            <ChevronLeftIcon className="transition-transform duration-200 group-hover:-translate-x-0.5" />
            <p>Back to the website</p>
          </a> */}

          <div className="flex flex-col gap-6">
            <Logo className="gap-3" />

            <div>
              <h2 className="mb-1.5 text-2xl font-semibold">
                {isValidSession === true
                  ? "Create New Password"
                  : isValidSession === null
                  ? "Verifying Reset Link..."
                  : "Invalid Reset Link"}
              </h2>
              <p className="text-muted-foreground">
                {isValidSession === true
                  ? "Your new password must be different from previously used passwords."
                  : isValidSession === null
                  ? "Please wait while we verify your reset link. This may take a few seconds."
                  : "This password reset link is invalid or has expired."}
              </p>
            </div>

            <div className="space-y-4">
              <ResetPasswordForm
                isValidSession={isValidSession}
                setIsValidSession={setIsValidSession}
              />

              {isValidSession === false && (
                <div className="space-y-4">
                  <Button
                    className="w-full"
                    type="button"
                    onClick={() => router.push("/auth/forgot-password")}
                  >
                    Request New Reset Link
                  </Button>
                </div>
              )}

              <a
                onClick={() => router.push("/auth/login")}
                href="#"
                className="group mx-auto flex w-fit items-center gap-2"
              >
                <ChevronLeftIcon className="size-5 transition-transform duration-200 group-hover:-translate-x-0.5" />
                <p>Back to login</p>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ResetPassword = () => {
  return (
    <Suspense
      fallback={
        <div className="h-dvh flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
};

export default ResetPassword;
