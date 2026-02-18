export type RecordAccess = "All Records" | "Own Records" | string;

export type Permission =
  | "View"
  | "Create"
  | "Edit"
  | "Delete"
  | "Change Owner"
  | "Download"
  | "Print"
  | "Change Status";

export interface PermissionRow {
  id: string;
  name: string;
  enabled: boolean;
  recordAccess: RecordAccess;
  availableAccessOptions: RecordAccess[];
  permissions: Permission[];
  availablePermissions: Permission[];
  info?: string;
}

export const DEFAULT_PERMISSIONS: Permission[] = [
  "View",
  "Create",
  "Edit",
  "Delete",
  "Change Owner",
];

export const EXTENDED_PERMISSIONS: Permission[] = [
  ...DEFAULT_PERMISSIONS,
  "Download",
  "Print",
  "Change Status",
];
