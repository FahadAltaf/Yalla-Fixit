"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, ClipboardCheck, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { hasResourceAction } from "@/lib/role-permissions";
import { snaggingService, type SnaggingTaskFilters } from "@/modules/snagging";
import { ActionType, ResourceType, type SnaggingTaskSummary } from "@/types/types";

import {
  PageHeading,
  SeverityCounts,
  TaskStatusBadge,
  timeAgo,
} from "./shared";

/**
 * The jobs table: every inspection task, its round, and what the field
 * has sent back so far.
 *
 * Filtering is by status pill rather than by dropdown because status is
 * the axis ops actually work along, and a pill row shows the shape of
 * the day at a glance. The table itself scrolls inside its own
 * container so a wide row never pushes the page sideways.
 */

const FILTERS = [
  { value: "all", label: "All", statuses: "all" },
  { value: "assigned", label: "Assigned", statuses: "assigned" },
  { value: "in_progress", label: "In progress", statuses: "in_progress" },
  { value: "submitted", label: "Submitted", statuses: "submitted,in_review" },
  { value: "approved", label: "Approved", statuses: "approved,delivered" },
  { value: "rejected", label: "Needs correction", statuses: "rejected" },
] as const;

type FilterValue = (typeof FILTERS)[number]["value"];

const PAGE_SIZE = 25;

export default function JobsTable() {
  const router = useRouter();
  const params = useSearchParams();
  const { userProfile } = useAuth();

  const initialFilter = (params.get("status") as FilterValue) ?? "all";
  const [filter, setFilter] = useState<FilterValue>(
    FILTERS.some((entry) => entry.value === initialFilter) ? initialFilter : "all",
  );
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tasks, setTasks] = useState<SnaggingTaskSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const canCreate = hasResourceAction(userProfile, ResourceType.SNAGGING, ActionType.CREATE);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = useMemo<SnaggingTaskFilters>(() => {
    const active = FILTERS.find((entry) => entry.value === filter);
    return {
      status: active?.statuses,
      search: debouncedSearch || undefined,
      sortBy: "updated_at",
      sortDirection: "desc",
    };
  }, [filter, debouncedSearch]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await snaggingService.listTasks(filters, page, PAGE_SIZE);
      setTasks(response.data ?? []);
      setTotalCount(response.totalCount ?? 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load jobs");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setSyncing(true);
    await load();
    setSyncing(false);
  }

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Property care"
        title="Jobs"
        description="Every inspection task, its round, and what the field has sent back so far."
        actions={
          <>
            <Button variant="outline" onClick={() => void refresh()} disabled={syncing}>
              <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />
              Pull changes
            </Button>
            {canCreate ? (
              <Button onClick={() => router.push("/snagging/jobs/new")}>
                <Plus className="size-4" />
                New job
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((entry) => {
            const active = entry.value === filter;
            return (
              <button
                key={entry.value}
                type="button"
                onClick={() => {
                  setFilter(entry.value);
                  setPage(0);
                }}
                className={cn(
                  "focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  active
                    ? "border-brand bg-brand text-white"
                    : "border-border text-ink-soft hover:bg-mist-soft",
                )}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Unit, client or code"
            className="pl-9"
            aria-label="Search jobs"
          />
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Inspector</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Round</TableHead>
                <TableHead>
                  <span title="High / medium / low">H / M / L</span>
                </TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : tasks.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState
                      icon={<ClipboardCheck className="size-6" />}
                      title="No jobs here"
                      description="Nothing matches this filter yet."
                      {...(canCreate
                        ? {
                            action: {
                              label: "New job",
                              onClick: () => router.push("/snagging/jobs/new"),
                            },
                          }
                        : {})}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task) => (
                  <TableRow
                    key={task.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/snagging/${task.id}`)}
                  >
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      <Link
                        href={`/snagging/${task.id}`}
                        className="hover:text-foreground"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {task.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {task.task_type === "full_building" ? (
                          <Building2 className="text-muted-foreground size-4" aria-hidden />
                        ) : null}
                        {task.unit_label}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {[task.building_name, task.task_type].filter(Boolean).join(" · ")}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{task.inspector_name ?? "—"}</TableCell>
                    <TableCell>
                      <TaskStatusBadge status={task.status} />
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {task.visit_type === "additional" ? "V" : "R"}
                      {task.round_number}
                    </TableCell>
                    <TableCell>
                      <SeverityCounts
                        high={task.high_severity_count}
                        medium={task.medium_severity_count ?? 0}
                        low={task.low_severity_count ?? 0}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-sm whitespace-nowrap">
                      {timeAgo(task.updated_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          Snag counts read high / medium / low. Severity colour is always paired with a position
          and a value, never colour alone.
        </p>

        {pageCount > 1 ? (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">
              Page {page + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">
            {totalCount} job{totalCount === 1 ? "" : "s"} · sorted by updated
          </span>
        )}
      </div>
    </div>
  );
}
