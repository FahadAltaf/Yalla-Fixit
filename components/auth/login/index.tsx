"use client";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { BorderBeam } from "@/components/ui/border-beam";
import AuthFullBackgroundShape from "@/assets/svg/auth-full-background-shape";
import Logo from "@/components/ui/logo";
import LoginForm from "./login-form";
import Link from "next/link";
import { toast } from "sonner";
import { useState } from "react";
import { AuthServiceError, signInWithOAuth } from "@/modules/auth/services/auth-service";
import { Loader2 } from "lucide-react";
import LoginImage from "@/public/yalla-login-image.png";
import siteLogo  from '@/public/site-logo.webp'
import Image from "next/image";


const Login2 = () => {
  const [isSocialLoading, setIsSocialLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleSocialLogin = async (
    provider: "google" | "apple" | "facebook"
  ) => {
    try {
      setIsSocialLoading(provider);
      setError(null);

      const data = await signInWithOAuth(
        provider,
        `${window.location.origin}/auth/callback`
      );

      // The user will be redirected to the OAuth provider
      // The callback will handle the rest of the flow
      if (data && typeof data === 'object' && 'url' in data) {
        window.location.href = (data as { url: string }).url;
      }
      if (data && typeof data === 'object' && 'type' in data && data.type === 'error') {
        setError((data as AuthServiceError).message);
        setIsSocialLoading(null);
      }
    } catch (error: unknown) {
      console.error(`${provider} login error:`, error);
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to sign in with ${provider}`
      );
      setIsSocialLoading(null);
    }
  };

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

      {/* 2 Form */}
      <div className="flex h-full flex-col items-center justify-center py-10 sm:px-5 lg:col-span-3 xl:col-span-2">
        <div className="w-full max-w-md px-6">
        

          <div className="flex flex-col gap-6">
            <Logo className="gap-3" />

            <div>
              <h2 className="mb-1.5 text-2xl font-semibold">Welcome back! </h2>
              <p className="text-muted-foreground">
                Please sign in to your account
              </p>
            </div>

            {/* Form */}
            <LoginForm />

            {/* <div className="space-y-4">
              <p className="text-muted-foreground text-center">
                New on our platform?{" "}
                <Link href="/auth/signup" className="text-foreground hover:underline">
                  Create an account
                </Link>
              </p>

              <div className="flex items-center gap-4">
                <Separator className="flex-1" />
                <p>or</p>
                <Separator className="flex-1" />
              </div>

              <Button disabled={isSocialLoading === "google"} variant="ghost" className="w-full cursor-pointer"               onClick={() => handleSocialLogin("google")}
              >
                {isSocialLoading === "google" ? (
                  <Loader2   className="w-4 h-4 animate-spin" />
                ) : (
                  "Sign in with google"
                )}
              </Button>
            </div> */}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login2;
