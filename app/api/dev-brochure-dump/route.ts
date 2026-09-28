// TEMPORARY, development only: saves the brochure PDF the test page builds,
// so it can be checked. Delete after checking.
import { writeFile } from "node:fs/promises";

import { NextResponse, type NextRequest } from "next/server";

const OUT =
  "C:/Users/TECHNI~1/AppData/Local/Temp/claude/C--Users-Technisia-Documents-Prohelp-Work-Yalla-Fixit/8c85b1f4-1880-43d9-b3ab-25281ad5aa3c/scratchpad/tpl";

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const bytes = Buffer.from(await req.arrayBuffer());
  await writeFile(`${OUT}/ours.pdf`, bytes);
  return NextResponse.json({ saved: "ours.pdf", bytes: bytes.length });
}
