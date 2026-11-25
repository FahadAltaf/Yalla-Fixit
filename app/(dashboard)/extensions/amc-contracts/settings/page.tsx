import { redirect } from "next/navigation";

/*
  Operations settings moved into AMC configuration (24 Nov 2026), as its
  Operations tab: an old link or bookmark lands there.
*/
export default function Route() {
  redirect("/settings/amc/configuration?view=operations");
}
