import { addYears, differenceInCalendarDays, format } from "date-fns";

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

/*
  How long the contract runs, in whole months (Jonathan, Oct 2026).

  The documents assumed a year everywhere: the period of service printed
  "1 Year Only" as fixed text, the term clause said "1 year", and the
  monthly figure divided by 12 -- all three on a contract whose own dates
  said six months. They read from the dates now, and this is the one
  place that turns a pair of dates into a number of months.

  Counted in days and rounded to the nearest month rather than by
  calendar month, because both conventions are in use: a year is written
  as 1 Jan to 1 Jan by some and 1 Jan to 31 Dec by others, and counting
  calendar months calls the second of those eleven months.
*/
const DAYS_PER_MONTH = 30.4375;

export function contractTermMonths(
  startDate: string,
  endDate: string,
): number {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) return 12;
  const days = differenceInCalendarDays(end, start);
  if (days <= 0) return 12;
  return Math.max(1, Math.round(days / DAYS_PER_MONTH));
}

/** "1 year", "6 months", "1 year 6 months" -- for the middle of a sentence. */
export function contractTermPhrase(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? "month" : "months"}`);
  return parts.join(" ") || "1 year";
}

/** "1 Year Only" -- the contract's own Period of Service row. */
export function contractTermLabel(months: number): string {
  const phrase = contractTermPhrase(months)
    .replace(/\byear\b/g, "Year")
    .replace(/\byears\b/g, "Years")
    .replace(/\bmonth\b/g, "Month")
    .replace(/\bmonths\b/g, "Months");
  return `${phrase} Only`;
}
