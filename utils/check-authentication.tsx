"use server";

import { createClient } from "@/lib/supabase/supabase-server-client";
import { cookies } from "next/headers";

export async function checkAuthentication() {
  try {
    const cookieStore = await cookies();
    const supabase = await createClient(cookieStore);
    const { data } = await supabase.auth.getUser();
    // @ts-expect-error - user is not typed
    const { user }: unknown = data;
    return { user: user, status: true, session: data };
  } catch (error: unknown) {
    console.log(error);
    return { user: "", status: false, session: "" };
  }
}
