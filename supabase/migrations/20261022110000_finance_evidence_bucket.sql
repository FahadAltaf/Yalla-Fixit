-- =====================================================================
-- Finance & Reports P4 follow-up: evidence files for exclusions.
--
-- BRD §5.1 Step 5 asks for "a reason and evidence" when a coordinator
-- marks work as not to be invoiced (TC05). finance.exclusions.evidence
-- already holds storage paths (20261021100000); this adds the private
-- bucket they live in.
--
-- No storage policies on purpose: nobody reads or writes this bucket
-- with their own token. The API checks the permission, then hands out a
-- one-time signed upload URL or a short-lived signed download URL.
--
-- Live-safe (one new bucket, nothing else touched). Idempotent.
-- Post-check: expect `f | 10485760` from
--   select public, file_size_limit from storage.buckets where id = 'finance-evidence';
-- Rollback (only while empty): delete from storage.buckets where id = 'finance-evidence';
-- =====================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'finance-evidence',
  'finance-evidence',
  FALSE,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'message/rfc822',
    'application/vnd.ms-outlook',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.ms-excel',
    'text/plain'
  ]
)
ON CONFLICT (id) DO NOTHING;
