import { LOOKUP_KEYS, makeAttributeListRoute } from "@/lib/server/attribute-list-route";

export const { GET, POST, PUT, DELETE } = makeAttributeListRoute({
  listKey: LOOKUP_KEYS.technicianRole,
  foreignKey: "role_id",
  label: "role",
});
