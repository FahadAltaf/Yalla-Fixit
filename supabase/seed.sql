-- Local-only seed data. Keep this safe for development and avoid real customer data.

INSERT INTO public.roles (id, description, name)
VALUES
  ('a0eeb1f4-6b6e-4d1a-b1f7-72e1bb78c8d4', 'System administrator with full access', 'admin'),
  ('d9a0935b-9fe1-4550-8f7e-67639fd0c6f0', 'Regular user with basic access', 'user')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.settings (
  id,
  site_name,
  appearance_theme,
  primary_color,
  logo_setting,
  type
)
VALUES (
  1,
  'Yalla Fixit Local',
  'light',
  '#83201e',
  'square',
  'admin'
)
ON CONFLICT (id) DO UPDATE SET
  site_name = EXCLUDED.site_name,
  appearance_theme = EXCLUDED.appearance_theme,
  primary_color = EXCLUDED.primary_color,
  logo_setting = EXCLUDED.logo_setting,
  type = EXCLUDED.type;

WITH admin_role AS (
  SELECT id FROM public.roles WHERE name = 'admin'
),
user_role AS (
  SELECT id FROM public.roles WHERE name = 'user'
),
admin_permissions AS (
  SELECT
    admin_role.id AS role_id,
    resource,
    action
  FROM admin_role
  CROSS JOIN (
    VALUES
      ('dashboard'),
      ('todos'),
      ('extensions'),
      ('users'),
      ('roles'),
      ('permissions'),
      ('settings')
  ) AS resources(resource)
  CROSS JOIN (
    VALUES
      ('view'),
      ('create'),
      ('edit'),
      ('delete'),
      ('export')
  ) AS actions(action)
),
user_permissions AS (
  SELECT
    user_role.id AS role_id,
    resource,
    action
  FROM user_role
  CROSS JOIN (
    VALUES
      ('dashboard', 'view'),
      ('todos', 'view'),
      ('todos', 'create'),
      ('todos', 'edit'),
      ('todos', 'delete'),
      ('extensions', 'view')
  ) AS permissions(resource, action)
)
INSERT INTO public.role_access (
  role_id,
  resource,
  action,
  enabled,
  record_access
)
SELECT role_id, resource, action, true, 'All Records'
FROM admin_permissions
UNION ALL
SELECT role_id, resource, action, true, 'All Records'
FROM user_permissions
ON CONFLICT (role_id, resource, action) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  record_access = EXCLUDED.record_access,
  updated_at = NOW();
