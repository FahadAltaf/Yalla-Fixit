import { addYears, format } from "date-fns";

export function parseIsoDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

export function toIsoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function isEndDateBeforeStartDate(
  startDate: string,
  endDate: string,
): boolean {
  if (!startDate || !endDate) return false;
  return endDate < startDate;
}

export function getDefaultEndDateFromStart(startDate: string): string {
  const parsed = parseIsoDate(startDate);
  if (!parsed) return "";
  return toIsoDate(addYears(parsed, 1));
}
