import { NextRequest, NextResponse } from "next/server";

const EDGE_URL = `${process.env.SUPABASE_URL}/functions/v1/zoho-fsm-estimate-transitions`;
const ANON_KEY = process.env.SUPABASE_ANON_KEY!;

// POST /api/estimates/transition
// Body: { record_id: string, action: "approve" | "reject" | "mark_as_sent" }
export async function POST(req: NextRequest) {
  try {
    const { record_id, action } = await req.json();

    if (!record_id) {
      return NextResponse.json(
        { success: false, error: "record_id is required." },
        { status: 400 }
      );
    }

    if (!["approve", "reject", "mark_as_sent"].includes(action)) {
      return NextResponse.json(
        {
          success: false,
          error: 'action must be "approve", "reject", or "mark_as_sent".',
        },
        { status: 400 }
      );
    }

    const res = await fetch(EDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ record_id, action, ...(action === "reject" ? { notes: "Rejected by Customer" } : {}) }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      return NextResponse.json(
        {
          success: false,
          error: data.error ?? "Failed to execute transition.",
        },
        { status: res.status }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message ?? "Internal server error.",
      },
      { status: 500 }
    );
  }
}

