import { redirect } from "next/navigation";

/* Clients is one module for AMC and Snagging now (26 Nov 2026): links already sent forward to it. */
export default function AmcClientsRoute() {
  redirect("/clients");
}
