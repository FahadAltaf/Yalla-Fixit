import { redirect } from "next/navigation";

/* Clients is one module for AMC and Snagging now (26 Nov 2026): the old address forwards to it. */
export default function SnaggingClientsRoute() {
  redirect("/clients");
}
