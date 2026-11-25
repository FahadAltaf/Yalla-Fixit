-- =====================================================================
-- Client links without a login for a PPM visit (DEV-507, DEV-494; 22 Nov 2026)
--
-- DEV-507: the client's confirmation request carries a link with Confirm
-- and Reschedule; the answer is stored on the visit (as an attempt, with
-- the client's note) and the coordinator is told.
-- DEV-494: the coordinator sends a link where the client uploads the gate
-- pass or work permit; the file is kept on the visit (amc_documents,
-- level visit, category Gate pass) and the coordinator is told.
--
-- One table for both: only the SHA-256 of the token is stored (as the
-- proposal links, lib/server/link-token.ts). Only the service role reads
-- it: RLS on, no policies, no grants to anon or authenticated.
--
-- Live-safe: a new table, nothing else changes. Rollback at the end.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.amc_client_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('visit_confirmation', 'access_upload')),
  entity_type text NOT NULL CHECK (entity_type IN ('visit')),
  entity_id uuid NOT NULL,
  /* How the coordinator sent it (the client's answer is logged on that channel). */
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'email', 'sms', 'call')),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  token_hint text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  /* The client's last answer: { answer, name, note, preferredDate } or { uploads: n }. */
  response jsonb,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_amc_client_links_entity ON public.amc_client_links (entity_type, entity_id, purpose);

ALTER TABLE public.amc_client_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_client_links FROM anon, authenticated;

-- Rollback:
-- DROP TABLE IF EXISTS public.amc_client_links;
