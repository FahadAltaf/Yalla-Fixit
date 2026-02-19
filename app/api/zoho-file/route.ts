import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get("file_id");

  if (!fileId) {
    return NextResponse.json({ error: "file_id is required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://fsm.zoho.com/fsm/v1/files?file_id=${encodeURIComponent(fileId)}`,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${process.env.ZOHO_ACCESS_TOKEN}`,
        },
      }
    );

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

