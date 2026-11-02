import { executeGraphQLBackend } from "@/lib/graphql-server";
import { GET_SETTINGS_BY_ID } from "./setting-graphql";

const settingsService = {
  getSettingsById: async (values: { type: string }) => {
    const response = await executeGraphQLBackend(GET_SETTINGS_BY_ID, {
      filter: { type: { eq: values?.type } },
    });
    return response?.settingsCollection?.edges[0]?.node || null;
  },
  /*
    Appearance (theme and colours) only. Browsers cannot write the settings
    table any more (migration 20261005160000), so this goes through
    /api/settings/appearance, which checks the caller. `id` is kept for the
    existing callers' signature; the route updates the portal's own row.
  */
  updateSettingsById: async (data: unknown, _id?: string) => {
    void _id;
    const response = await fetch("/api/settings/appearance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error ?? "Could not save the settings");
    }
    return body.settings;
  },
};

export default settingsService;
