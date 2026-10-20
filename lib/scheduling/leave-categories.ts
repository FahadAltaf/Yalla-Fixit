/**
 * Leave categories (BRD §5.3, DEV-456). Every category is excluded from
 * available hours and from check-in compliance.
 *
 * leave_records.leave_type, the free text live main writes and requires,
 * is kept: a categorised record stores the category's label there too, so
 * screens that only read leave_type still say what the leave is.
 */
export const LEAVE_CATEGORIES = [
  { value: "annual", label: "Annual leave" },
  { value: "sick", label: "Sick leave" },
  { value: "public_holiday", label: "Public holiday" },
  { value: "offset", label: "Offset (time off in lieu)" },
] as const;

export type LeaveCategory = (typeof LEAVE_CATEGORIES)[number]["value"];

export const LEAVE_CATEGORY_VALUES = LEAVE_CATEGORIES.map((c) => c.value) as [LeaveCategory, ...LeaveCategory[]];

export function leaveCategoryLabel(category: string | null | undefined): string | null {
  return LEAVE_CATEGORIES.find((c) => c.value === category)?.label ?? null;
}
