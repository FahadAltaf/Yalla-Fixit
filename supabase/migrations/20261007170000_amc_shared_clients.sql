-- =====================================================================
-- AMC uses Snagging's clients and addresses (one client master)
-- =====================================================================
-- NOT APPLIED. Row 20 in docs/production-migration-log.md, checks §12.
--
-- What changes
--   AMC kept its own client and property records (public.customers and
--   public.customer_properties). From now on a client is the Snagging
--   client (public.snagging_clients) and an address is the Snagging
--   property (public.snagging_properties), whichever module created it.
--   What only AMC needs about them -- the Customer ID, prospect/client,
--   trade licence and TRN, preferred channel, consent; the property's
--   finer type, occupancy, zones, combined units -- lives in two one-to-one
--   side tables keyed by the Snagging ids:
--
--     amc_client_profiles   (client_id   -> snagging_clients)
--     amc_property_profiles (property_id -> snagging_properties)
--
--   Every AMC foreign key that pointed at customers / customer_properties
--   now points at snagging_clients / snagging_properties, keeping its
--   name and its ON DELETE rule. The columns keep their names
--   (customer_id, property_id), so the AMC code reads as before.
--
--   Two views, amc_client_directory and amc_property_directory, give the
--   server one row per client / address with the AMC fields beside the
--   Snagging ones (a client AMC has never touched reads as lifecycle
--   'client' with no Customer ID).
--
-- Live safety
--   * snagging_clients and snagging_properties are NOT altered: no column,
--     constraint, index or policy is added to them. New tables point at
--     them, which is all. The inspector app and every Snagging route keep
--     reading exactly what they read.
--   * No second foreign key from snagging_jobs/snagging_properties to
--     snagging_clients is added, so Snagging's embeds stay unambiguous.
--   * public.customers and public.customer_properties are EMPTY in
--     production (checked 7 Oct 2026). This migration refuses to run if
--     either has a row, so no record can be orphaned. They are left in
--     place, unused, to be dropped with the release clean-up.
--   * amc_submissions (LIVE): only the two foreign keys on its nullable
--     customer_id / property_id columns are swapped. Both columns are NULL
--     on every row (live main never writes them), so validation reads the
--     table once and finds nothing. The swap takes a brief lock on
--     amc_submissions: apply out of hours, as rows 17 and 18.
--
-- Pre-check (expect 0 and 0):
--   SELECT (SELECT count(*) FROM public.customers), (SELECT count(*) FROM public.customer_properties);
-- Post-check: docs/production-migration-checks.md §12.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Refuse to run over real data in the old tables
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.customers') IS NOT NULL AND EXISTS (SELECT 1 FROM public.customers) THEN
    RAISE EXCEPTION 'public.customers has rows: move them onto snagging_clients before applying this migration';
  END IF;
  IF to_regclass('public.customer_properties') IS NOT NULL AND EXISTS (SELECT 1 FROM public.customer_properties) THEN
    RAISE EXCEPTION 'public.customer_properties has rows: move them onto snagging_properties before applying this migration';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. The AMC side of a client
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_client_profiles (
  client_id uuid PRIMARY KEY REFERENCES public.snagging_clients(id) ON DELETE RESTRICT,
  /* The business identifier staff use (e.g. YFI1806). */
  customer_ref text,
  /* Zoho FSM Contacts record id, when known. */
  fsm_contact_id text,
  customer_type text CHECK (customer_type IS NULL OR customer_type IN ('individual', 'company')),
  /* BRD 5.9: the prospect becomes the client on signing. */
  lifecycle text NOT NULL DEFAULT 'client' CHECK (lifecycle IN ('prospect', 'client', 'former')),
  became_client_at timestamptz,
  trade_license_no text,
  trade_license_expiry date,
  trn text,
  preferred_channel text CHECK (preferred_channel IS NULL OR preferred_channel IN ('whatsapp', 'email', 'call', 'sms')),
  preferred_language text,
  /* Marketing consent is kept apart from the contact details (BRD 5.9). */
  marketing_consent boolean,
  marketing_consent_at timestamptz,
  marketing_consent_source text,
  marketing_consent_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_client_profiles_ref
  ON public.amc_client_profiles (upper(trim(customer_ref))) WHERE customer_ref IS NOT NULL AND trim(customer_ref) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_client_profiles_fsm_contact
  ON public.amc_client_profiles (fsm_contact_id) WHERE fsm_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_client_profiles_lifecycle ON public.amc_client_profiles (lifecycle);
CREATE INDEX IF NOT EXISTS idx_amc_client_profiles_consent_by
  ON public.amc_client_profiles (marketing_consent_by) WHERE marketing_consent_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_client_profiles_created_by
  ON public.amc_client_profiles (created_by) WHERE created_by IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. The AMC side of an address
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_property_profiles (
  property_id uuid PRIMARY KEY REFERENCES public.snagging_properties(id) ON DELETE RESTRICT,
  /* Snagging's property_type has four values; AMC prices on a finer list.
     Unset, the directory derives both from property_type. */
  property_category text CHECK (property_category IS NULL OR property_category IN ('residential', 'commercial')),
  unit_type text CHECK (
    unit_type IS NULL OR unit_type IN ('villa', 'apartment', 'townhouse', 'restaurant', 'clinic', 'shop', 'office', 'warehouse', 'other')
  ),
  address text,
  unit_no text,
  floor text,
  street text,
  city text,
  zones text[] NOT NULL DEFAULT '{}',
  occupancy text CHECK (occupancy IS NULL OR occupancy IN ('owner', 'tenant', 'vacant')),
  access_constraints text,
  /* Combined units are linked, never merged: each keeps its owner, billing and history. */
  parent_property_id uuid REFERENCES public.snagging_properties(id) ON DELETE RESTRICT,
  notes text,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_property_profiles_not_own_parent CHECK (parent_property_id IS NULL OR parent_property_id <> property_id)
);
CREATE INDEX IF NOT EXISTS idx_amc_property_profiles_parent
  ON public.amc_property_profiles (parent_property_id) WHERE parent_property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_property_profiles_created_by
  ON public.amc_property_profiles (created_by) WHERE created_by IS NOT NULL;

-- Server-only, like every AMC table: the API reads with the service role.
ALTER TABLE public.amc_client_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_property_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_client_profiles FROM anon, authenticated;
REVOKE ALL ON public.amc_property_profiles FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Point every AMC reference at the Snagging records
-- ---------------------------------------------------------------------
-- Same constraint name, same column, same ON DELETE rule; only the target
-- table changes. Added NOT VALID then validated, so the check is one read
-- of each (empty or all-NULL) column. Idempotent: a second run finds no
-- constraint still pointing at the old tables.
DO $$
DECLARE
  r record;
  target text;
  on_delete text;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl, a.attname AS col, c.confrelid, c.confdeltype
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND array_length(c.conkey, 1) = 1
       AND c.confrelid IN (
         coalesce(to_regclass('public.customers'), 0::regclass),
         coalesce(to_regclass('public.customer_properties'), 0::regclass)
       )
       AND c.conrelid NOT IN (
         coalesce(to_regclass('public.customers'), 0::regclass),
         coalesce(to_regclass('public.customer_properties'), 0::regclass)
       )
  LOOP
    target := CASE WHEN r.confrelid = to_regclass('public.customers')
                   THEN 'public.snagging_clients' ELSE 'public.snagging_properties' END;
    on_delete := CASE r.confdeltype
                   WHEN 'r' THEN 'RESTRICT' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT'
                   ELSE 'NO ACTION' END;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s(id) ON DELETE %s NOT VALID',
                   r.tbl, r.conname, r.col, target, on_delete);
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. One row per client / address, AMC fields beside Snagging's
-- ---------------------------------------------------------------------
-- Read-only, for the server's lists and lookups. security_invoker, so the
-- view never lends a browser role more than the tables would.
CREATE OR REPLACE VIEW public.amc_client_directory WITH (security_invoker = true) AS
SELECT c.id,
       c.name,
       c.email,
       c.phone,
       c.company,
       c.notes,
       c.created_by,
       c.created_at,
       p.customer_ref,
       p.fsm_contact_id,
       p.customer_type,
       coalesce(p.lifecycle, 'client') AS lifecycle,
       p.became_client_at,
       p.trade_license_no,
       p.trade_license_expiry,
       p.trn,
       p.preferred_channel,
       p.preferred_language,
       p.marketing_consent,
       p.marketing_consent_at,
       p.marketing_consent_source,
       (p.client_id IS NOT NULL) AS has_amc_profile
  FROM public.snagging_clients c
  LEFT JOIN public.amc_client_profiles p ON p.client_id = c.id;

CREATE OR REPLACE VIEW public.amc_property_directory WITH (security_invoker = true) AS
SELECT sp.id,
       sp.client_id AS customer_id,
       sp.unit_label AS label,
       sp.building_name AS building,
       sp.community,
       sp.property_type,
       sp.bedrooms,
       sp.built_up_area_sqft AS size_sqft,
       sp.floors AS floors_count,
       sp.created_by,
       sp.created_at,
       coalesce(pp.property_category,
                CASE WHEN sp.property_type = 'commercial' THEN 'commercial'
                     WHEN sp.property_type IS NOT NULL THEN 'residential' END) AS property_category,
       coalesce(pp.unit_type,
                CASE WHEN sp.property_type IN ('villa', 'apartment', 'townhouse') THEN sp.property_type END) AS unit_type,
       pp.address,
       pp.unit_no,
       pp.floor,
       pp.street,
       pp.city,
       coalesce(pp.zones, '{}'::text[]) AS zones,
       pp.occupancy,
       pp.access_constraints,
       pp.parent_property_id,
       pp.notes
  FROM public.snagging_properties sp
  LEFT JOIN public.amc_property_profiles pp ON pp.property_id = sp.id;

REVOKE ALL ON public.amc_client_directory FROM anon, authenticated;
REVOKE ALL ON public.amc_property_directory FROM anon, authenticated;
