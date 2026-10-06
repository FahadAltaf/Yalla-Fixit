import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { provisionDefaultProfile } from "@/lib/server/admin/users-roles";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/supabase-server-client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // URL to redirect to after sign in process completes
  const next = searchParams.get("next") || "/";
  

  if (code) {
    const cookieStore = await cookies();
    const supabase = await createClient(cookieStore);
    const { error } =
      await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Get the user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        /*
          First sign-in: a profile with the default "user" role, written
          with the service role. This used pg_graphql with the anon key,
          which is closed to browsers by migration 20261006160000.
        */
        const admin = await createAdminServerClient();
        const { data: userProfile } = await admin.from("user_profile").select("id").eq("id", user.id).maybeSingle();

        if (!userProfile) {
          const result = await provisionDefaultProfile(admin, {
            id: user.id,
            email: user.email,
            first_name: user.user_metadata?.first_name || null,
            last_name: user.user_metadata?.last_name || null,
            full_name: user.user_metadata?.full_name || null,
          });
          if (!result.ok) {
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/auth/login/error?type=auth_callback_error`);
          }

          // Redirect to onboarding
          return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/`);
        }
      }

      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}${next}`
      );
    }
  }

  // Return the user to the error page if something goes wrong
  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_APP_URL}/auth/login/error?type=auth_callback_error`
  );
}
