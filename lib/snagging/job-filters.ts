/**
 * The Jobs list's status filters, and the first page it opens on.
 *
 * Shared by the table (in the browser) and the Jobs page (on the server),
 * which reads that first page before the page is sent, so both have to
 * agree exactly on what "the first page" is.
 */
export const JOB_FILTERS = [
  { value: "all", label: "All", statuses: "all" },
  { value: "assigned", label: "Assigned", statuses: "assigned" },
  { value: "in_progress", label: "In progress", statuses: "in_progress" },
  // Submitted and In review are separate stops on the approval chain
  // (FR-6.01): submitted is waiting to be picked up, in_review has been.
  // They used to share one pill, which hid whether anyone had started.
  { value: "submitted", label: "Submitted", statuses: "submitted" },
  { value: "in_review", label: "In review", statuses: "in_review" },
  { value: "approved", label: "Approved", statuses: "approved,delivered" },
  { value: "rejected", label: "Needs correction", statuses: "rejected" },
] as const;

export type JobFilterValue = (typeof JOB_FILTERS)[number]["value"];

/** Rows on the first page, and the order it opens in. */
export const JOBS_FIRST_PAGE_SIZE = 10;
export const JOBS_DEFAULT_SORT = { sortBy: "created_at", sortDirection: "desc" } as const;

/** The status filter the address asks for, or All. */
export function jobFilterFrom(status: string | null | undefined): JobFilterValue {
  return JOB_FILTERS.some((entry) => entry.value === status) ? (status as JobFilterValue) : "all";
}

/**
 * The API query for the first page the Jobs table shows, from the address
 * it was opened with -- the same parameters the table itself would send.
 */
export function firstJobsPageParams(address: {
  status?: string | null;
  assignee?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
}): URLSearchParams {
  const filter = JOB_FILTERS.find((entry) => entry.value === jobFilterFrom(address.status));
  const params = new URLSearchParams({
    page: "0",
    pageSize: String(JOBS_FIRST_PAGE_SIZE),
    sortBy: JOBS_DEFAULT_SORT.sortBy,
    sortDirection: JOBS_DEFAULT_SORT.sortDirection,
  });
  if (filter && filter.statuses !== "all") params.set("status", filter.statuses);
  if (address.assignee) params.set("assigneeId", address.assignee);
  if (address.createdFrom) params.set("createdFrom", address.createdFrom);
  if (address.createdTo) params.set("createdTo", address.createdTo);
  return params;
}
