import { NextRequest } from "next/server";
import { ActionType } from "@/types/types";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { requireCompliance } from "@/lib/server/compliance/access";
import { createEmployee, findByMaherId, isServiceError, listEmployees, type ListQuery } from "@/lib/server/compliance/employees";
import { complianceToday, fail, intParam, ok, parseBody, serverError } from "@/lib/server/compliance/http";
import { employeeInputSchema } from "@/lib/compliance/validation";

/*
  Manpower Compliance employees (FRD FR-1, FR-6, FR-9).
  GET  ?maher_id=  exact lookup (FR-6), or a filtered, paged list.
  POST             create (FR-1, FR-2); 409 on a duplicate Maher ID (AC-02).
  Identity numbers are masked to the last four in every response (AC-23).
*/

export async function GET(req: NextRequest) {
  const g = await requireCompliance(ActionType.VIEW);
  if (g.error) return g.error;
  try {
    const admin = await createAdminServerClient();
    const today = complianceToday();
    const p = req.nextUrl.searchParams;
    const maherId = p.get("maher_id");
    if (maherId !== null) {
      const record = await findByMaherId(admin, maherId, today);
      return ok(record ? [record] : []);
    }
    const query: ListQuery = {
      q: p.get("q") ?? undefined,
      employmentStatus: (p.get("employment_status") ?? "") as ListQuery["employmentStatus"],
      itemStatus: (p.get("item_status") ?? "") as ListQuery["itemStatus"],
      siteClientId: p.get("site") ?? undefined,
      includeArchived: p.get("include_archived") === "true",
      page: intParam(p.get("page"), 0, 0, 10_000),
      pageSize: intParam(p.get("pageSize"), 25, 1, 500),
      sortBy: (p.get("sortBy") ?? "full_name") as ListQuery["sortBy"],
      sortOrder: p.get("sortOrder") === "desc" ? "desc" : "asc",
    };
    const result = await listEmployees(admin, query, today);
    return Response.json(result);
  } catch (error) {
    return serverError("list employees", error);
  }
}

export async function POST(req: NextRequest) {
  const g = await requireCompliance(ActionType.CREATE);
  if (g.error) return g.error;
  const body = await parseBody(req, employeeInputSchema);
  if ("response" in body) return body.response;
  try {
    const admin = await createAdminServerClient();
    const result = await createEmployee(admin, g.actor, body.data, complianceToday());
    if (isServiceError(result)) return fail(result);
    return ok(result, { status: 201 });
  } catch (error) {
    return serverError("create employee", error);
  }
}
