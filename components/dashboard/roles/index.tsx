"use client";

import { useEffect, useState } from "react";

import { rolesService } from "@/modules/roles";
import type { Role } from "@/modules/roles";
import { useDebounce } from "@/hooks/use-debounce";
import { DataTable } from "@/components/data-table";
import { getRoleColumns } from "@/components/data-table/columns/column-role";
import { RoleDataTableToolbar } from "@/components/data-table/toolbars/role-toolbar";
import { Plus } from "lucide-react";

import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function RoleManagementPage({ type }: { type: string }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [filteredRoles, setFilteredRoles] = useState<Role[]>([]);
  const [isRefetching, setIsRefetching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  // The "Add role" dialog, opened from the page heading.
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedSearchTerm = useDebounce(searchQuery, 500);

  const fetchRoles = async () => {
    setIsRefetching(true);
    try {
      const allRoles = await rolesService.getAllRoles();
      setRoles(allRoles);
      setFilteredRoles(allRoles);
    } catch (error) {
      console.error("Error fetching roles:", error);
    } finally {
      setIsRefetching(false);
    }
  };

  useEffect(() => {
    void fetchRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (debouncedSearchTerm) {
      const lower = debouncedSearchTerm.toLowerCase();
      const filtered = roles.filter((role) => {
        const matchesName = role.name.toLowerCase().includes(lower);
        const matchesDescription = role.description
          ? role.description.toLowerCase().includes(lower)
          : false;
        return matchesName || matchesDescription;
      });
      setFilteredRoles(filtered);
    } else {
      setFilteredRoles(roles);
    }
    setCurrentPage(0);
  }, [debouncedSearchTerm, roles]);

  const handleGlobalFilterChange = (filter: string) => {
    setSearchQuery(filter);
  };

  const handlePageChange = (pageIndex: number) => {
    setCurrentPage(pageIndex);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(0);
  };

  const rowCount = filteredRoles.length;
  const startIndex = currentPage * pageSize;
  const paginatedRoles =
    rowCount === 0
      ? []
      : filteredRoles.slice(startIndex, startIndex + pageSize);

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Access management"
        title="Roles"
        description="What each role can see and do across the portal."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Add role
          </Button>
        }
      />
    <Card className="py-0">
      <DataTable
        data={paginatedRoles}
        toolbar={
          <RoleDataTableToolbar
            fetchRecords={fetchRoles}
            onGlobalFilterChange={handleGlobalFilterChange}
            isSearchLoading={isRefetching}
            pageSize={pageSize}
            onPageSizeChange={handlePageSizeChange}
            createOpen={createOpen}
            onCreateOpenChange={setCreateOpen}
          />
        }
        columns={getRoleColumns(fetchRoles)}
        onGlobalFilterChange={handleGlobalFilterChange}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        pageSize={pageSize}
        currentPage={currentPage}
        loading={isRefetching}
        rowCount={rowCount}
        type={type}
        isPagination
      />
    </Card>
    </div>
  );
}
