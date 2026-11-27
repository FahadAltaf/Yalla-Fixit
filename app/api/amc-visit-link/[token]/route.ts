import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ACCESS_TYPES, accessRuleSchema } from "@/lib/amc/client-profile";
import { addClientAccessRules, answerVisitConfirmation, clientLinkView, finishClientPasses, resolveClientLink, uploadVisitPass } from "@/lib/server/amc/client-links";
import { readAmcConfig } from "@/lib/server/amc/config";
import { ContractError } from "@/lib/server/amc/contracts";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/*
  The client's side of a visit link, without a login (22 Nov 2026).

    GET                                   the visit as the client sees it
    POST { answer, name, preferredDate?, note? }   DEV-507: confirm, or ask to reschedule
    POST multipart { file, name, note?, accessType?, label?, validUntil?, quiet? }
                                          DEV-494: upload a gate pass or permit (27 Nov 2026:
                                          what it is and until when; one file per request)
    POST { action: "rules", name, rules }  27 Nov 2026: the property's access rules, from the client
    POST { action: "finish", name, passes, rules, note? }  the coordinator told once, after the last

  The token is the only key: unguessable, stored hashed, expires, and is
  replaced when the coordinator sends a new one. Never indexed.
*/

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const PROBLEM_TEXT: Record<string, string> = {
  not_found: "This link is not valid.",
  expired: "This link has expired. Ask Yalla Fix It to send a new one.",
  revoked: "A newer link was sent for this visit. Use the latest message from Yalla Fix It.",
  not_ready: "This link is not available yet.",
};

const answerSchema = z
  .object({
    answer: z.enum(["confirm", "reschedule"]),
    name: z.string().trim().min(2, "Write your name").max(120),
    preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const rulesSchema = z
  .object({
    action: z.literal("rules"),
    name: z.string().trim().min(2, "Write your name").max(120),
    rules: z.array(accessRuleSchema).min(1, "Add a rule").max(10),
  })
  .strict();
const finishSchema = z
  .object({
    action: z.literal("finish"),
    name: z.string().trim().min(2, "Write your name").max(120),
    passes: z.number().int().min(0).max(20),
    rules: z.number().int().min(0).max(10),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
const passMetaSchema = z.object({
  accessType: z.enum(ACCESS_TYPES),
  label: z.string().trim().max(120).nullable().optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the end date as a date").nullable().optional(),
});

async function load(token: string) {
  const admin = await createAdminServerClient();
  const { link, problem } = await resolveClientLink(admin, token);
  return { admin, link, problem };
}

const fail = (problem: string) => NextResponse.json({ error: PROBLEM_TEXT[problem] ?? PROBLEM_TEXT.not_found }, { status: problem === "not_found" ? 404 : 410, headers: HEADERS });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    const { admin, link, problem } = await load(token);
    if (!link) return fail(problem ?? "not_found");
    return NextResponse.json({ visit: await clientLinkView(admin, link, await readAmcConfig(admin)) }, { headers: HEADERS });
  } catch (error) {
    console.error("[amc:client-link] view failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not open this visit. Try again later." }, { status: 500, headers: HEADERS });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    const { admin, link, problem } = await load(token);
    if (!link) return fail(problem ?? "not_found");
    const config = await readAmcConfig(admin);
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const name = String(form.get("name") ?? "").trim();
      if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose the file to upload." }, { status: 400, headers: HEADERS });
      if (name.length < 2) return NextResponse.json({ error: "Write your name." }, { status: 400, headers: HEADERS });
      /* What the pass is and until when (27 Nov 2026); without them, a pass as before. */
      const rawType = String(form.get("accessType") ?? "");
      const meta = rawType
        ? passMetaSchema.safeParse({ accessType: rawType, label: String(form.get("label") ?? "") || null, validUntil: String(form.get("validUntil") ?? "") || null })
        : null;
      if (meta && !meta.success) return NextResponse.json({ error: meta.error.issues[0]?.message ?? "Check the pass details" }, { status: 400, headers: HEADERS });
      const result = await uploadVisitPass(
        admin,
        link,
        { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name },
        { name, note: String(form.get("note") ?? "") || null, meta: meta?.success ? meta.data : null, quiet: form.get("quiet") === "1" },
        config,
      );
      return NextResponse.json(result, { headers: HEADERS });
    }
    const body = await req.json().catch(() => null);
    if (body && typeof body === "object" && (body as { action?: unknown }).action === "rules") {
      const rules = rulesSchema.safeParse(body);
      if (!rules.success) return NextResponse.json({ error: rules.error.issues[0]?.message ?? "Check the access rules" }, { status: 400, headers: HEADERS });
      return NextResponse.json(await addClientAccessRules(admin, link, rules.data, config), { headers: HEADERS });
    }
    if (body && typeof body === "object" && (body as { action?: unknown }).action === "finish") {
      const finish = finishSchema.safeParse(body);
      if (!finish.success) return NextResponse.json({ error: finish.error.issues[0]?.message ?? "Invalid request" }, { status: 400, headers: HEADERS });
      return NextResponse.json(await finishClientPasses(admin, link, finish.data, config), { headers: HEADERS });
    }
    const parsed = answerSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid answer" }, { status: 400, headers: HEADERS });
    return NextResponse.json(await answerVisitConfirmation(admin, link, parsed.data, config), { headers: HEADERS });
  } catch (error) {
    if (error instanceof ContractError) return NextResponse.json({ error: error.message }, { status: error.status, headers: HEADERS });
    console.error("[amc:client-link] answer failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not save your answer. Try again later." }, { status: 500, headers: HEADERS });
  }
}
