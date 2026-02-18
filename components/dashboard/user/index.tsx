"use client";
import { useState, useEffect } from "react";

import { getUserColumns } from "@/components/data-table/columns/column-user";
import { UserDataTableToolbar } from "@/components/data-table/toolbars";
import { usersService } from "@/modules/users/services/users-service";
import { User } from "@/types/types";
import { rolesService } from "@/modules/roles/services/roles-service";
import { Role } from "@/types/types";
import { useDebounce } from "@/hooks/use-debounce";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/data-table";

export default function UserManagementPage({ type }: { type: string }) {
  const [listUsers, setListUsers] = useState<User[]>([]);
  const [listRoles, setListRoles] = useState<Role[]>([]);
  const [recordCount, setRecordCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(10);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isRefetching, setIsRefetching] = useState<boolean>(false);
  const debouncedSearchTerm = useDebounce(searchQuery, 500);
  const [sorting, setSorting] = useState<{
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }>({});

  const { userProfile } = useAuth();

  interface UsersPaginationResponse {
    users: User[];
    totalCount: number;
  }

  async function fetchUsers() {
    setIsRefetching(true);
    try {
      const usersResponse: UsersPaginationResponse =
        await usersService.getUsersPagination(
          `%${debouncedSearchTerm}%`,
          pageSize,
          currentPage,

          sorting
        );

      setListUsers(usersResponse.users);
      setRecordCount(usersResponse.totalCount);
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setIsRefetching(false);
    }
  }
  const fetchRoles = async () => {
    const rolesResponse: Role[] = await rolesService.getAllRoles();
    setListRoles(rolesResponse);
  };

  useEffect(() => {
    fetchUsers();
  }, [currentPage, pageSize, debouncedSearchTerm, sorting]);

  const handleGlobalFilterChange = (filter: string) => {
    if (!searchQuery && !filter) {
      setIsRefetching(true);
      fetchUsers();
    } else {
      setSearchQuery(filter);
    }
    setCurrentPage(0);
  };

  const handlePageChange = (pageIndex: number) => {
    setCurrentPage(pageIndex);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(0);
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const handleSortingChange = (sortBy?: string, sortOrder?: "asc" | "desc") => {
    setSorting({ sortBy, sortOrder });
    setCurrentPage(0);
  };

  return (
    <Card className="py-0">
      <DataTable
        data={listUsers || []}
        toolbar={
          <UserDataTableToolbar
            fetchRecords={fetchUsers}
            type={type}
            listRoles={listRoles}
            onGlobalFilterChange={handleGlobalFilterChange}
            isSearchLoading={isRefetching}
            pageSize={pageSize}
            onPageSizeChange={handlePageSizeChange}
          />
        }
        columns={getUserColumns(
          fetchUsers,
          listRoles as Role[],
          userProfile?.roles?.name === "admin"
        )}
        onGlobalFilterChange={handleGlobalFilterChange}
        onSortingChange={handleSortingChange}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        pageSize={pageSize}
        currentPage={currentPage}
        loading={isRefetching}
        rowCount={recordCount}
        type="users"
        isPagination={true}
      />
    </Card>
  );
}
