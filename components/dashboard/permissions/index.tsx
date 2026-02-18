"use client";
import { useState, useEffect } from "react";

import {
  getPermissionColumns,
  PermissionRowData,
} from "@/components/data-table/columns/column-permission";
import { PermissionDataTableToolbar } from "@/components/data-table/toolbars/permission-toolbar";
import { permissionsService } from "@/modules/permissions/services/permissions-service";
import { rolesService } from "@/modules/roles/services/roles-service";
import { ResourceType, ActionType, Role, RoleAccess } from "@/types/types";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/data-table";
import { RESOURCE_ACTIONS } from "./constants";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { RouteIcon } from "lucide-react";

const RECORD_ACCESS_OPTIONS = ["All Records", "Own Records"];

export default function PermissionManagementPage() {
  const [listRoles, setListRoles] = useState<Role[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<RoleAccess[]>([]);
  const [isRefetching, setIsRefetching] = useState<boolean>(true);

  // Fetch roles on mount
  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const roles = await rolesService.getAllRoles();
        setListRoles([...roles]);
      } catch (error) {
        console.error("Error fetching roles:", error);
      }
    };
    fetchRoles();
  }, []);

  // Fetch permissions when role is selected
  useEffect(() => {
    if (selectedRoleId) {
      fetchPermissions();
    } else {
      setPermissions([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoleId]);

  async function fetchPermissions() {
    if (!selectedRoleId) return;

    // setIsRefetching(true);
    try {
      const rolePermissions = await permissionsService.getPermissionsByRole(
        selectedRoleId
      );
      setPermissions(rolePermissions);
    } catch (error) {
      console.error("Error fetching permissions:", error);
      toast.error("Failed to fetch permissions");
    } finally {
      setIsRefetching(false);
    }
  }

  // Transform permissions into table data
  // Exclude SETTINGS, ROLES, and PERMISSIONS from the table
  const excludedResources = [
    ResourceType.SETTINGS,
    ResourceType.ROLES,
    ResourceType.PERMISSIONS,
    ResourceType.USERS,
  ];

  const tableData: PermissionRowData[] = Object.values(ResourceType)
    .filter((resource) => !excludedResources.includes(resource))
    .map((resource) => {
      const isDashboard = resource === ResourceType.DASHBOARD;
      const defaultActions = [ActionType.VIEW];

      const availableActions = RESOURCE_ACTIONS[resource] || defaultActions;

      // Get permissions for this resource
      const resourcePermissions = permissions.filter(
        (p) => p.resource === resource
      );

      const selectedActions = isDashboard
        ? defaultActions
        : resourcePermissions.map((p) => p.action as ActionType);

      // Get enabled status (if any permission exists, consider it enabled)
      // For now, we'll track enabled per resource, not per action
      const enabled = isDashboard
        ? true
        : resourcePermissions.length > 0
        ? resourcePermissions[0]?.enabled ?? true
        : false;

      // Get record access (use first permission's record_access or default)
      const recordAccess = isDashboard
        ? "All Records"
        : resourcePermissions.length > 0
        ? resourcePermissions[0]?.record_access || "All Records"
        : "All Records";

      return {
        resource,
        enabled,
        recordAccess,
        availableRecordAccessOptions: RECORD_ACCESS_OPTIONS,
        selectedActions,
        availableActions,
      };
    });

  const handleToggleEnabled = async (
    resource: ResourceType,
    enabled: boolean
  ) => {
    // Dashboard module should always be enabled and not toggleable
    if (resource === ResourceType.DASHBOARD) return;
    if (!selectedRoleId) return;

    try {
      if (enabled) {
        // Enable: create permissions for all available actions
        const availableActions = RESOURCE_ACTIONS[resource];
        const permissionsToCreate = availableActions.map((action) => ({
          role_id: selectedRoleId,
          resource,
          action,
          enabled: true,
          record_access: "All Records",
        }));

        await permissionsService.bulkCreatePermissions(
          selectedRoleId,
          permissionsToCreate
        );
        toast.success("Module enabled");
      } else {
        // Disable: delete all permissions for this resource
        const resourcePermissions = permissions.filter(
          (p) => p.resource === resource
        );
        for (const perm of resourcePermissions) {
          await permissionsService.deletePermission(perm.id);
        }
        toast.success("Module disabled");
      }
      await fetchPermissions();
    } catch (error) {
      console.error("Error toggling module:", error);
      toast.error("Failed to update module");
    }
  };

  const handleRecordAccessChange = async (
    resource: ResourceType,
    recordAccess: string
  ) => {
    // Dashboard module record access is fixed
    if (resource === ResourceType.DASHBOARD) return;
    if (!selectedRoleId) return;

    try {
      // Update record_access for all permissions of this resource
      const resourcePermissions = permissions.filter(
        (p) => p.resource === resource
      );

      // Get current selected actions
      const currentActions = resourcePermissions.map(
        (p) => p.action as ActionType
      );
      const currentEnabled = resourcePermissions[0]?.enabled ?? true;

      // Delete existing and recreate with new record_access but preserve actions
      for (const perm of resourcePermissions) {
        await permissionsService.deletePermission(perm.id);
      }

      // Recreate with new record_access but only for selected actions
      if (currentActions.length > 0 && currentEnabled) {
        const permissionsToCreate = currentActions.map((action) => ({
          role_id: selectedRoleId,
          resource,
          action,
          enabled: currentEnabled,
          record_access: recordAccess,
        }));

        await permissionsService.bulkCreatePermissions(
          selectedRoleId,
          permissionsToCreate
        );
      }

      toast.success("Record access updated");
      await fetchPermissions();
    } catch (error) {
      console.error("Error updating record access:", error);
      toast.error("Failed to update record access");
    }
  };

  const handleActionsChange = async (
    resource: ResourceType,
    actions: ActionType[]
  ) => {
    // Dashboard module actions are fixed to VIEW
    if (resource === ResourceType.DASHBOARD) return;
    if (!selectedRoleId) return;

    try {
      // Get current permissions for this resource
      const resourcePermissions = permissions.filter(
        (p) => p.resource === resource
      );
      const currentRecordAccess =
        resourcePermissions[0]?.record_access || "All Records";
      const currentEnabled = resourcePermissions[0]?.enabled ?? true;

      // Delete all existing permissions for this resource
      for (const perm of resourcePermissions) {
        await permissionsService.deletePermission(perm.id);
      }

      // Create new permissions for selected actions
      if (actions.length > 0 && currentEnabled) {
        const permissionsToCreate = actions.map((action) => ({
          role_id: selectedRoleId,
          resource,
          action,
          enabled: currentEnabled,
          record_access: currentRecordAccess,
        }));

        await permissionsService.bulkCreatePermissions(
          selectedRoleId,
          permissionsToCreate
        );
      }

      toast.success("Permissions updated");
      await fetchPermissions();
    } catch (error) {
      console.error("Error updating permissions:", error);
      toast.error("Failed to update permissions");
    }
  };

  return (
    <Card className="py-0 gap-0">
      <PermissionDataTableToolbar
        fetchRecords={fetchPermissions}
        roles={listRoles}
        selectedRoleId={selectedRoleId}
        onRoleChange={setSelectedRoleId}
      />
      {selectedRoleId && (
        <>
          <DataTable
            data={tableData}
            columns={getPermissionColumns(
              handleToggleEnabled,
              handleRecordAccessChange,
              handleActionsChange
            )}
            pageSize={tableData.length}
            currentPage={0}
            loading={isRefetching}
            rowCount={tableData.length}
            type="permissions"
            isPagination={false}
            onGlobalFilterChange={() => {}}
            onPageChange={() => {}}
            onPageSizeChange={() => {}}
            onSortingChange={() => {}}
          />
        </>
      )}
      {!selectedRoleId && (
        <div className="px-4 pb-6">
          <EmptyState
            icon={<RouteIcon />}
            title="No Role Selected"
            description="Please select a role from the dropdown above to manage its permissions."
          />
        </div>
      )}
    </Card>
  );
}
