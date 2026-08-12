import { makeAttributeListRoute } from "@/lib/server/attribute-list-route";

export const { GET, POST, PUT, DELETE } = makeAttributeListRoute({
  table: "technician_roles",
  foreignKey: "role_id",
  label: "role",
});
