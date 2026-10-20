-- 20261020100000_reporting_platform: settings, audit, notifications.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Server-only: RLS on, no API-role privileges on any new table.
SELECT harness.expect(
  (SELECT bool_and(relrowsecurity) FROM pg_class
    WHERE oid IN ('public.reporting_settings'::regclass, 'public.reporting_audit_events'::regclass,
                  'public.portal_notifications'::regclass)),
  'RLS enabled on the three platform tables');
SELECT harness.expect(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
      AND table_name IN ('reporting_settings', 'reporting_audit_events', 'portal_notifications')),
  'no anon/authenticated grants on the platform tables');
SELECT harness.expect(
  NOT has_sequence_privilege('anon', 'public.reporting_audit_events_id_seq', 'USAGE'),
  'anon cannot use the audit sequence');

-- reporting_settings: one row, an object.
SELECT harness.expect((SELECT count(*) = 1 FROM public.reporting_settings), 'settings seeded exactly once (after two passes)');
SELECT harness.expect_error($q$INSERT INTO public.reporting_settings (id) VALUES (2)$q$, '23514', 'second settings row refused');
SELECT harness.expect_error($q$UPDATE public.reporting_settings SET overrides = '[]' WHERE id = 1$q$, '23514', 'non-object overrides refused');

-- reporting_audit_events: append-only, even for the owner, and loudly.
INSERT INTO public.reporting_audit_events (entity_type, event_type, actor_id, actor_label, payload)
VALUES ('settings', 'settings_updated', '00000000-0000-0000-0000-000000000002', 'Office',
        '{"changedKeys": ["digest.hourLocal"]}');
SELECT harness.expect_error($q$UPDATE public.reporting_audit_events SET actor_label = 'tampered'$q$, 'P0001', 'audit UPDATE refused');
SELECT harness.expect_error($q$DELETE FROM public.reporting_audit_events$q$, 'P0001', 'audit DELETE refused');
SELECT harness.expect_error($q$TRUNCATE public.reporting_audit_events$q$, 'P0001', 'audit TRUNCATE refused');
SELECT harness.expect(
  (SELECT count(*) = 1 AND bool_and(actor_label = 'Office') FROM public.reporting_audit_events),
  'audit row unchanged');
SELECT harness.expect_error($q$INSERT INTO public.reporting_audit_events (entity_type, event_type) VALUES ('Settings!', 'x')$q$,
  '23514', 'malformed entity_type refused');

-- portal_notifications: dedupe per (key, channel, recipient).
INSERT INTO public.portal_notifications (event, recipient_user_id, channel, dedupe_key, title, body, status)
VALUES ('finance.digest', '00000000-0000-0000-0000-000000000002', 'in_app', 'digest:2026-10-20', 'Digest', 'x', 'delivered')
ON CONFLICT DO NOTHING;
INSERT INTO public.portal_notifications (event, recipient_user_id, channel, dedupe_key, title, body, status)
VALUES ('finance.digest', '00000000-0000-0000-0000-000000000002', 'in_app', 'digest:2026-10-20', 'Digest again', 'x', 'delivered')
ON CONFLICT DO NOTHING;
SELECT harness.expect((SELECT count(*) = 1 FROM public.portal_notifications WHERE dedupe_key = 'digest:2026-10-20'),
  'a repeated notification is a no-op');
INSERT INTO public.portal_notifications (event, recipient_user_id, channel, dedupe_key, title, body)
VALUES ('finance.digest', '00000000-0000-0000-0000-000000000002', 'email', 'digest:2026-10-20', 'Digest', 'x');
SELECT harness.expect((SELECT count(*) = 2 FROM public.portal_notifications WHERE dedupe_key = 'digest:2026-10-20'),
  'the same key on another channel is a separate row');
INSERT INTO public.portal_notifications (event, recipient_email, channel, dedupe_key, title, body)
VALUES ('finance.digest', 'Finance@Test.Local', 'email', 'digest:2026-10-21', 'Digest', 'x');
SELECT harness.expect_error($q$INSERT INTO public.portal_notifications (event, recipient_email, channel, dedupe_key, title, body)
  VALUES ('finance.digest', 'finance@test.local', 'email', 'digest:2026-10-21', 'Digest', 'x')$q$, '23505',
  'email recipients dedupe case-insensitively');
SELECT harness.expect_error($q$INSERT INTO public.portal_notifications (event, channel, dedupe_key, title, body)
  VALUES ('finance.digest', 'in_app', 'k1', 't', 'b')$q$, '23514', 'a notification needs a recipient');
SELECT harness.expect_error($q$INSERT INTO public.portal_notifications (event, recipient_email, channel, dedupe_key, title, body, link)
  VALUES ('finance.digest', 'a@test.local', 'email', 'k2', 't', 'b', 'https://evil.example')$q$, '23514', 'external link refused');
SELECT harness.expect_error($q$INSERT INTO public.portal_notifications (event, recipient_email, channel, dedupe_key, title, body, link)
  VALUES ('finance.digest', 'a@test.local', 'email', 'k3', 't', 'b', '//evil.example')$q$, '23514', 'protocol-relative link refused');
SELECT harness.expect_error($q$INSERT INTO public.portal_notifications (event, recipient_email, channel, dedupe_key, title, body)
  VALUES ('finance.digest', 'a@test.local', 'sms', 'k4', 't', 'b')$q$, '23514', 'unknown channel refused');
SELECT harness.expect_error($q$INSERT INTO public.portal_notifications (event, recipient_email, channel, dedupe_key, title, body, status)
  VALUES ('finance.digest', 'a@test.local', 'email', 'k5', 't', 'b', 'redirected')$q$, '23514', 'unknown status refused');

-- The public key reaches nothing.
SET ROLE anon;
SELECT harness.expect_error($q$SELECT 1 FROM public.portal_notifications$q$, '42501', 'anon cannot read notifications');
SELECT harness.expect_error($q$SELECT 1 FROM public.reporting_settings$q$, '42501', 'anon cannot read settings');
RESET ROLE;
SET ROLE authenticated;
SELECT harness.expect_error($q$INSERT INTO public.reporting_audit_events (entity_type, event_type) VALUES ('settings', 'x')$q$,
  '42501', 'authenticated cannot write audit');
SELECT harness.expect_error($q$UPDATE public.portal_notifications SET read_at = now()$q$, '42501', 'authenticated cannot mark notifications read directly');
RESET ROLE;

-- Deleting a user who has notifications and appears in the audit trail
-- still works (the bug the silent rules caused), and keeps the history.
INSERT INTO public.user_profile (id, email, role_id)
VALUES ('00000000-0000-0000-0000-000000000009', 'leaver@test.local', '00000000-0000-0000-0000-0000000000a1');
INSERT INTO public.portal_notifications (event, recipient_user_id, channel, dedupe_key, title, body, status)
VALUES ('finance.digest', '00000000-0000-0000-0000-000000000009', 'in_app', 'digest:2026-10-20', 'Digest', 'x', 'delivered');
INSERT INTO public.reporting_audit_events (entity_type, event_type, actor_id, actor_label)
VALUES ('settings', 'settings_updated', '00000000-0000-0000-0000-000000000009', 'Leaver');
DELETE FROM public.user_profile WHERE id = '00000000-0000-0000-0000-000000000009';
SELECT harness.expect(
  NOT EXISTS (SELECT 1 FROM public.portal_notifications WHERE recipient_user_id = '00000000-0000-0000-0000-000000000009')
  AND EXISTS (SELECT 1 FROM public.reporting_audit_events WHERE actor_label = 'Leaver'),
  'user deletion succeeds: notifications go, audit history stays');
