import { makeAttributeListRoute } from "@/lib/server/attribute-list-route";

export const { GET, POST, PUT, DELETE } = makeAttributeListRoute({
  table: "technician_service_types",
  foreignKey: "service_type_id",
  label: "service type",
});
