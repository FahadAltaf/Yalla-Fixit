import { TODO_STATUS_LABELS, Todo, TodoRelatedType, TodoStatus, User } from "@/types/types";

// Shared between the todos page (board, list) and the todo dialog.

export const TODO_STATUSES: TodoStatus[] = ["todo", "in_progress", "done", "blocked", "canceled"];
export const RELATED_TYPES: TodoRelatedType[] = ["work_order", "quotation", "appointment"];

export const RELATED_TYPE_LABELS: Record<TodoRelatedType, string> = {
  work_order: "Work order",
  quotation: "Quotation",
  appointment: "Appointment",
};

/*
  AMC to-dos carry the record they are about as related_type "amc_<kind>"
  and its id. Where that record has a page of its own, "Open" goes there
  (visits and call outs: AMC -> Visits); instalments open their list.
*/
const AMC_RECORD_LINKS: Record<string, (id: string) => string> = {
  amc_submission: (id) => `/extensions/amc/${id}`,
  amc_contract: (id) => `/extensions/amc-contracts/${id}`,
  amc_visit: (id) => `/extensions/amc-contracts/visits/${encodeURIComponent(id)}`,
  amc_instalment: () => "/extensions/amc-contracts/payments",
  amc_call_out: (id) => `/extensions/amc-contracts/visits/${encodeURIComponent(id)}`,
  amc_additional_work: (id) => `/extensions/amc-contracts/additional-works/${encodeURIComponent(id)}`,
  amc_enquiry: (id) => `/extensions/amc-contracts/enquiries/${id}`,
};

export function amcRecordHref(todo: Pick<Todo, "related_type" | "related_id">): string | null {
  const type = String(todo.related_type ?? "");
  if (!type.startsWith("amc_") || !todo.related_id) return null;
  return AMC_RECORD_LINKS[type]?.(todo.related_id) ?? null;
}

export function toDatetimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromDatetimeLocal(value: string) {
  return value ? new Date(value).toISOString() : "";
}

export function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

/** "Today 14:30", "Tomorrow 09:00", else a short date and time. */
export function formatWhen(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay(date, now)) return `Today ${time}`;
  if (sameDay(date, tomorrow)) return `Tomorrow ${time}`;
  return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatUpdateField(fieldName?: string | null) {
  const labels: Record<string, string> = {
    title: "Title",
    description: "Description",
    tags: "Tags",
    related_type: "Related type",
    related_id: "Related ID",
    deadline: "Deadline",
    reminder: "Reminder",
    status: "Status",
    assignees: "Assignees",
  };
  return fieldName ? labels[fieldName] || fieldName.replace("_", " ") : "Todo";
}

export function formatUpdateValue(value: unknown, fieldName?: string | null) {
  if (value === null || value === undefined || value === "") return "empty";
  if (fieldName === "status" && typeof value === "string" && value in TODO_STATUS_LABELS) {
    return TODO_STATUS_LABELS[value as TodoStatus];
  }
  if ((fieldName === "deadline" || fieldName === "reminder") && typeof value === "string") {
    return formatDateTime(value);
  }
  if (fieldName === "related_type" && typeof value === "string") {
    return value.replace("_", " ");
  }
  if (Array.isArray(value)) {
    return (
      value
        .map((item) => {
          if (typeof item === "object" && item && "name" in item) {
            return String((item as { name: unknown }).name);
          }
          return String(item);
        })
        .join(", ") || "empty"
    );
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatUpdateSummary(update: NonNullable<Todo["updates"]>[number]) {
  if (update.action === "created") return "created this todo";
  // FR-16: attachment events carry {file_name, size_bytes} on one side only.
  if (update.action === "attachment_added" || update.action === "attachment_removed") {
    const value = (update.action === "attachment_added" ? update.new_value : update.old_value) as
      | { file_name?: string }
      | null
      | undefined;
    const name = value?.file_name ? `"${value.file_name}"` : "a file";
    return update.action === "attachment_added" ? `attached ${name}` : `removed the attachment ${name}`;
  }
  const fieldName = formatUpdateField(update.field_name);
  return `changed ${fieldName} from ${formatUpdateValue(update.old_value, update.field_name)} to ${formatUpdateValue(update.new_value, update.field_name)}`;
}

export function tagBadgeStyle(color?: string) {
  if (!color) return undefined;
  return {
    backgroundColor: `${color}1A`,
    borderColor: `${color}66`,
    color,
  };
}

// Anything with a name: a full User, or the slimmer uploader/author embeds.
export type NamedUser = {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

export function userLabel(user?: NamedUser | User | null) {
  if (!user) return "Unknown user";
  return user.full_name || [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email || "Unknown user";
}

export function userInitials(user?: NamedUser | User | null) {
  const label = userLabel(user);
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
