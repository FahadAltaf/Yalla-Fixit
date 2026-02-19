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
  // Admin Management
  USERS = "users",
  ROLES = "roles",
  PERMISSIONS = "permissions",
  SETTINGS = "settings",
  // Extensions
  EXTENSIONS = "extensions",
}

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

export enum ActionType {
  CREATE = "create",
  EDIT = "edit",
  DELETE = "delete",
  VIEW = "view",
  EXPORT = "export",
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
}
