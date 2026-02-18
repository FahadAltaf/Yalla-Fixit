import { executeGraphQLBackend } from "@/lib/graphql-server";
import {
  GET_SETTINGS_BY_ID,
  INSERT_SETTINGS,
  UPDATE_SETTINGS_BY_ID,
} from "./setting-graphql";

const settingsService = {
  getSettingsById: async (values: { type: string }) => {
    const response = await executeGraphQLBackend(GET_SETTINGS_BY_ID, {
      filter: { type: { eq: values?.type } },
    });
    return response?.settingsCollection?.edges[0]?.node || null;
  },
  updateSettingsById: async (data: unknown, id: string) => {
    const response = await executeGraphQLBackend(UPDATE_SETTINGS_BY_ID, {
      data,
      filter: { id: { eq: id } },
    });
    return response.updatesettingsCollection.records[0];
  },
  insertSettings: async (data: unknown) => {
    const response = await executeGraphQLBackend(INSERT_SETTINGS, { data });
    return response.insertIntosettingsCollection.records[0];
  },
};

export default settingsService;
