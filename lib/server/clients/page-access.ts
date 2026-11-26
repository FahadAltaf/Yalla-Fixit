import { clientsAccess } from "@/lib/clients/access";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";

/** Whether the person opening a Clients page holds AMC's or Snagging's Clients permission (read on the server). */
export async function canSeeClientsPage(): Promise<boolean> {
  try {
    const { accessUser } = await getAuthenticatedUserAccess();
    return Boolean(accessUser && clientsAccess(accessUser).view);
  } catch {
    return false;
  }
}
