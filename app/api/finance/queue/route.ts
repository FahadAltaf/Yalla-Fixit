import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { summarise } from "@/lib/finance/metrics";
import { QUEUE_STATUSES, type QueueStatus } from "@/lib/server/finance/queue";
import { listQueue, listQueueFilterOptions, readQueueForMetrics } from "@/lib/server/finance/queue-read";
import { hasResourceAction } from "@/lib/role-permissions";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The Ready-to-Invoice queue (BRD §6.4; DEV-435): one page of items with
 * the filters applied on the server, the summary strip, and the options
 * the filters offer.
 *
 * ?status=pending,in_progress &client= &coordinator= &from=YYYY-MM-DD
 * &to=YYYY-MM-DD &aged=1 &q= &page= &pageSize=
 */

const querySchema = z.object({
  status: z.string().optional(),
  client: z.string().max(200).optional(),
  coordinator: z.string().max(200).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  aged: z.enum(["0", "1"]).optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(0).max(10_000).default(0),
  pageSize: z.coerce.number().int().refine((n) => [10, 25, 50].includes(n)).default(25),
});

export async function GET(req: NextRequest) {
  /* Finance and managers (queue View), and the coordinators and verifier
     who answer its queries and exclusions (BRD §6.7). Narrowing a
     coordinator to their own jobs waits on D-18 (who a coordinator is). */
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const user = gate.access.accessUser;
  if (
    !hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.VIEW) &&
    !hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE) &&
    !hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
  const p = parsed.data;
  const statuses = (p.status ?? "").split(",").filter((s): s is QueueStatus => (QUEUE_STATUSES as string[]).includes(s));

  try {
    const admin = await createAdminServerClient();
    const settings = await readReportingSettings(admin);
    const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00+04:00`) + 86_400_000).toISOString();
    const [page, options, all] = await Promise.all([
      listQueue(admin, {
        statuses,
        client: p.client || undefined,
        coordinator: p.coordinator || undefined,
        /* Dates are Dubai days. */
        enteredFrom: p.from ? new Date(Date.parse(`${p.from}T00:00:00+04:00`)).toISOString() : undefined,
        enteredTo: p.to ? nextDay(p.to) : undefined,
        agedOlderThanDays: p.aged === "1" ? settings.finance.agedAfterDays : null,
        search: p.q,
        page: p.page,
        pageSize: p.pageSize,
      }),
      listQueueFilterOptions(admin),
      readQueueForMetrics(admin),
    ]);
    return NextResponse.json(
      {
        ...page,
        summary: summarise(all.items, all.invoices),
        options,
        agedAfterDays: settings.finance.agedAfterDays,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Finance queue list error:", error);
    return NextResponse.json({ error: "Could not load the queue" }, { status: 500 });
  }
}
