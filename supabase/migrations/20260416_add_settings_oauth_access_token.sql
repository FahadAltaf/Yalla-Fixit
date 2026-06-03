-- Adds the Zoho OAuth token field used by settings GraphQL queries and API routes.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS oauth_access_token TEXT;
