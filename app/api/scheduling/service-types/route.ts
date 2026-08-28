import { LOOKUP_KEYS, makeAttributeListRoute } from "@/lib/server/attribute-list-route";

export const { GET, POST, PUT, DELETE } = makeAttributeListRoute({
  listKey: LOOKUP_KEYS.technicianServiceType,
  foreignKey: "service_type_id",
  label: "service type",
});
