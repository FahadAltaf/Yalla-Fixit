import { NextRequest, NextResponse } from "next/server";
import { requireResourceAccess } from "@/lib/server/require-access";
import { getFsmContext } from "@/lib/server/zoho/fsm-client";
import { ActionType, ResourceType } from "@/types/types";

/*
  Streams one Zoho FSM file for Extensions -> Bulk download. It used to run
  for anyone and read the Zoho token with the caller's own Supabase role;
  now it needs a signed-in user who can open Extensions, and the token is
  read server-side with the service role.
*/
export async function GET(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.EXTENSIONS, ActionType.VIEW);
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get("file_id");

  let settings: { oauth_access_token: string };
  try {
    const { token } = await getFsmContext();
    settings = { oauth_access_token: token };
  } catch {
    return NextResponse.json({ error: "Zoho FSM is not configured" }, { status: 503 });
  }

  if (!fileId) {
    return NextResponse.json({ error: "file_id is required" }, { status: 400 });
  }

  try {
    const MAX_ZOHO_RETRIES = 3;
    const RETRY_BASE_DELAY_MS = 500;

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    let res: Response | null = null;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ZOHO_RETRIES; attempt++) {
      try {
        res = await fetch(
          `https://fsm.zoho.com/fsm/v1/files?file_id=${encodeURIComponent(fileId)}`,
          {
            headers: {
              Authorization: `Zoho-oauthtoken ${settings?.oauth_access_token}`,
            },
          }
        );

        if (!res.ok && res.status >= 500 && res.status < 600 && attempt < MAX_ZOHO_RETRIES) {
          // Retry only for 5xx errors
          const backoff = RETRY_BASE_DELAY_MS * attempt;
          await delay(backoff);
          continue;
        }

        // Either ok or non-retriable error
        break;
      } catch (error) {
        lastError = error;
        console.error(`Zoho file fetch error on attempt ${attempt}:`, error);
        if (attempt < MAX_ZOHO_RETRIES) {
          const backoff = RETRY_BASE_DELAY_MS * attempt;
          await delay(backoff);
        }
      }
    }

    if (!res) {
      console.error("Zoho file download failed after retries:", lastError);
      return NextResponse.json(
        { error: "Failed to fetch file from Zoho after multiple attempts" },
        { status: 502 }
      );
    }

    const contentType =
      res.headers.get("Content-Type") || "application/octet-stream";

    if (!res.ok) {
      let errorBody: unknown;
      try {
        errorBody = await res.json();
      } catch {
        errorBody = { error: "Failed to fetch file from Zoho" };
      }
      return NextResponse.json(errorBody, { status: res.status });
    }

    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: res.status,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition":
          res.headers.get("Content-Disposition") || "attachment",
      },
    });
  } catch (error) {
    console.error("Zoho file download error:", error);
    return NextResponse.json(
      { error: "Failed to fetch file" },
      { status: 500 }
    );
  }
}

