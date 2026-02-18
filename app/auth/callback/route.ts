import { rolesService, usersService } from "@/modules";
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
        // Check if the user has a profile
        const userProfile = await usersService.getUserById(user.id);

        if (!userProfile) {
          // Get the default user role using GraphQL
          const roleId = await rolesService.getRoleByName();
          const payload = {
            id: user?.id,
            email: user?.email,
            role_id: roleId,
            first_name: user?.user_metadata.first_name || null,
            last_name: user?.user_metadata.last_name || null,
            full_name: user?.user_metadata.full_name || null,
            is_active: true,
          };

          const result = await usersService.insertUser(payload);
          if (result && typeof result === 'string') {
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
