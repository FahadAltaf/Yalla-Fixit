/**
 * A link to a record in the Zoho FSM web app, for the reports' last
 * drill-through step (BRD 5.2 B1: "drill-through to the list and then to
 * the quotation in FSM"). The same NEXT_PUBLIC_FSM_APP_URL convention as
 * the scheduling board (shift-utils.ts): a template with {module} and
 * {id}, or a plain base that gets "#<module>/<id>". Null when it is not
 * configured, and the report shows the number without a link.
 */
export type FsmModule = "Estimates" | "Work_Orders" | "Service_Appointments";

export function fsmRecordLink(module: FsmModule, id: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_FSM_APP_URL;
  if (!base || !id) return null;
  const encodedId = encodeURIComponent(id);
  if (base.includes("{id}")) return base.replace(/\{module\}/g, module).replace(/\{id\}/g, encodedId);
  return `${base.replace(/\/+$/, "")}#${module}/${encodedId}`;
}
