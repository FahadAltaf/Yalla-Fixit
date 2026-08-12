export interface User {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string;
  password?: string;
  full_name?: string | null;
  role_id?: string;
  is_active?: boolean;

  last_login?: string | null;
  created_at?: string;
  updated_at?: string;
  profile_image?: string | null;
  status?: string;
  // When TRUE, this user receives the "schedule needs approval" email.
  receives_schedule_approval_email?: boolean;

  settings?: {
    edges: {
      node: {
        site_name: string | null;
        logo_url: string | null;
      };
    }[];
  };
  roles?: {
    name: string | null;
    description?: string;
    role_accessCollection?: {
      edges: Array<{
        node: {
          resource: string;
          action: string;
          enabled?: boolean | null;
          record_access?: string | null;
        };
      }>;
    };
  };
}

export interface MenuItem {
  title: string;
  url: string;
  icon?: React.ReactNode;
  isActive?: boolean;
  resource?: ResourceType;
  unreadCount?: number;
  items?: MenuItem[];
}

export interface MenuSection {
  title: string;
  url: string;
  items: MenuItem[];
}

export enum UserRoles {
  ADMIN = "admin",
  USER = "user",
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RoleAccess {
  id: string;
  role_id: string;
  resource: ResourceType;
  action: ActionType;
  enabled?: boolean;
  record_access?: string;
  created_at?: string;
  updated_at?: string;
  roles?: Role;
}

export enum ResourceType {
  // Dashboard
  DASHBOARD = "dashboard",
  // Work Management
  TODOS = "todos",
  // Admin Management
  USERS = "users",
  ROLES = "roles",
  PERMISSIONS = "permissions",
  SETTINGS = "settings",
  // Extensions
  EXTENSIONS = "extensions",
  // Scheduling
  SCHEDULING = "scheduling",
}

export type TodoStatus =
  | "todo"
  | "in_progress"
  | "done"
  | "canceled"
  | "blocked";

export type TodoRelatedType = "work_order" | "quotation" | "appointment";

export interface TodoAssignee {
  user_id: string;
  user_profile?: User;
}

export interface TodoComment {
  id: string;
  todo_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at?: string;
  author?: User;
}

export interface TodoUpdateLog {
  id: string;
  todo_id: string;
  actor_id?: string | null;
  action: string;
  field_name?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  created_at: string;
  actor?: User;
}

export interface TodoTag {
  id: string;
  name: string;
  color: string;
  created_at?: string;
  updated_at?: string | null;
}

export interface Todo {
  id: string;
  todo_key: string;
  owner_id: string;
  title: string;
  description: string;
  tags: string[];
  related_type?: TodoRelatedType | null;
  related_id?: string | null;
  deadline_at: string;
  reminder_at?: string | null;
  reminder_sent_at?: string | null;
  status: TodoStatus;
  created_at: string;
  updated_at?: string;
  completed_at?: string | null;
  owner?: User;
  assignees?: User[];
  comments?: TodoComment[];
  updates?: TodoUpdateLog[];
}

export const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  todo: "To-do",
  in_progress: "In progress",
  done: "Done",
  canceled: "Canceled",
  blocked: "Blocked",
};

export interface Attachment {
  "$file_id": string;
  File_Name: string;
}

export interface ServiceAppointment {
  id: string;
  name: string;
  address: string;
  contact_id: string;
  contact_name: string;
  summary: string;
  type: string;
  status: string;
  attachments?: Attachment[];
}

export type TechnicianShift = "morning" | "night";

export interface TechnicianRole {
  id: string;
  name: string;
  sort_order: number;
  technician_count?: number;
}

export interface TechnicianServiceType {
  id: string;
  name: string;
  sort_order: number;
  technician_count?: number;
}

export interface TechnicianReference {
  fsm_resource_id: string;
  display_name: string;
  is_active: boolean;
  last_synced_at: string;
  // Portal-managed attributes (kept across FSM sync).
  role_id?: string | null;
  role_name?: string | null;
  service_type_id?: string | null;
  service_type_name?: string | null;
  shift?: TechnicianShift | null;
  team_leader_fsm_id?: string | null;
  team_leader_name?: string | null;
}

export interface TechnicianTag {
  id: string;
  name: string;
  created_by?: string | null;
  created_at: string;
  updated_by?: string | null;
  updated_at: string;
  technician_count?: number;
}

export type LeaveStatus = "active" | "cancelled";

export interface LeaveRecord {
  id: string;
  technician_fsm_id: string;
  technician?: TechnicianReference;
  leave_type: string;
  start_at: string;
  end_at: string;
  status: LeaveStatus;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_by?: string | null;
  updated_at: string;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
}

export enum ActionType {
  CREATE = "create",
  EDIT = "edit",
  DELETE = "delete",
  VIEW = "view",
  EXPORT = "export",
  // Grants the holder the right to approve/reject a submitted schedule (#2).
  APPROVE = "approve",
}

export interface Settings {
  id: string;
  site_name?: string;
  site_description?: string;
  site_image?: string;
  appearance_theme?: string;
  primary_color?: string;
  secondary_color?: string;
  logo_url?: string;
  logo_horizontal_url?: string;
  favicon_url?: string;
  meta_keywords?: string;
  meta_description?: string;
  contact_email?: string;
  social_links?: string;
  created_at?: string;
  updated_at?: string;
  logo_setting?: string;
  type?: UserRoles;
  user_id?: User;
  oauth_access_token?: string;
  oauth_token_refreshed_at?: string;
}
