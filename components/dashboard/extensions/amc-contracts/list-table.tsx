"use client";

import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { DataTable } from "@/components/data-table";

const noop = () => undefined;

/**
 * A short list shown in full, in the house table (18 Nov 2026): the same
 * DataTable as Cheques, Receipts and every list in the product, for the
 * cards that drew their own plain table (a contract's allowances, what each
 * service covers, a property's current AMC).
 */
export function ListTable<T>({ columns, data, empty }: { columns: ColumnDef<T>[]; data: readonly T[]; empty?: ReactNode }) {
  return (
    <DataTable
      columns={columns}
      data={[...data]}
      loading={false}
      rowCount={data.length}
      pageSize={500}
      currentPage={0}
      onPageChange={noop}
      onPageSizeChange={noop}
      onGlobalFilterChange={noop}
      emptyState={empty}
    />
  );
}
