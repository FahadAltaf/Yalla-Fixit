-- 20261126100000_finance_invoice_emails
--
-- The MAHER invoice emailed to the client from the portal (BRD v1.4/v1.5 Step 10, TC28).
--
-- Until Zoho Finance is live, Finance creates the invoice in MAHER, uploads it against the work order in the portal
-- and sends it to the client from the portal by email, not WhatsApp. The portal records who sent it, when and to
-- which addresses. Operations can then see, for any job, the date the invoice was shared.
--
-- finance.invoice_emails: one row per email sent (a resend is another row), append-only like the rest of the ledger.
-- Written only through finance.record_invoice_email (SECURITY DEFINER), called by the server after the email
-- service accepted the message. "delivery" says where it really went: 'live' to the client, or 'redirect' to the
-- development inbox (NOTIFY_REDIRECT_TO) when FINANCE_NOTIFY_LIVE is not on; "delivered_to" holds the addresses it
-- reached.
--
-- Live-safe: a new table and a new function; nothing existing changes. The code live now never calls it, and the new
-- code shows no sends (and refuses to send) until it is applied. One transaction. Idempotent.
--
-- Post-check: expect `1 | 1 | t` from
--   select (select count(*) from information_schema.tables where table_schema = 'finance' and table_name = 'invoice_emails'),
--          (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--             where n.nspname = 'finance' and p.proname = 'record_invoice_email'),
--          (select relrowsecurity from pg_class where oid = 'finance.invoice_emails'::regclass);
-- Rollback: docs/finance-reporting/migrations/20261126100000_rollback.sql

BEGIN;

CREATE TABLE IF NOT EXISTS finance.invoice_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES finance.line_invoices(id),
  fsm_work_order_id text NOT NULL CHECK (length(fsm_work_order_id) BETWEEN 1 AND 40),
  to_emails text[] NOT NULL CHECK (cardinality(to_emails) BETWEEN 1 AND 10),
  cc_emails text[] NOT NULL DEFAULT '{}' CHECK (cardinality(cc_emails) <= 10),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
  message text CHECK (message IS NULL OR length(message) <= 2000),
  delivery text NOT NULL CHECK (delivery IN ('live', 'redirect')),
  delivered_to text[] NOT NULL CHECK (cardinality(delivered_to) >= 1),
  provider_message_id text,
  sent_by uuid,
  sent_by_label text,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_emails_invoice_idx ON finance.invoice_emails (invoice_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS invoice_emails_work_order_idx ON finance.invoice_emails (fsm_work_order_id, sent_at DESC);

DROP TRIGGER IF EXISTS invoice_emails_append_only ON finance.invoice_emails;
CREATE TRIGGER invoice_emails_append_only BEFORE UPDATE OR DELETE ON finance.invoice_emails
  FOR EACH ROW EXECUTE FUNCTION finance.append_only();
DROP TRIGGER IF EXISTS invoice_emails_append_only_truncate ON finance.invoice_emails;
CREATE TRIGGER invoice_emails_append_only_truncate BEFORE TRUNCATE ON finance.invoice_emails
  FOR EACH STATEMENT EXECUTE FUNCTION finance.append_only();

/* ---------------------------------------------------------------------
   One email, as sent. The invoice must cover a line of the work order
   (the same check the invoice file link makes).
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION finance.record_invoice_email(
  p_invoice_id uuid,
  p_work_order_id text,
  p_to text[],
  p_cc text[],
  p_subject text,
  p_message text,
  p_delivery text,
  p_delivered_to text[],
  p_provider_message_id text,
  p_actor uuid,
  p_actor_label text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM finance.line_invoice_allocations a
                 WHERE a.invoice_id = p_invoice_id AND a.fsm_work_order_id = p_work_order_id) THEN
    RAISE EXCEPTION 'record_invoice_email: invoice % is not on work order %', p_invoice_id, p_work_order_id
      USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO finance.invoice_emails (invoice_id, fsm_work_order_id, to_emails, cc_emails, subject, message, delivery,
                                      delivered_to, provider_message_id, sent_by, sent_by_label)
  VALUES (p_invoice_id, p_work_order_id, p_to, coalesce(p_cc, '{}'), p_subject, nullif(trim(coalesce(p_message, '')), ''),
          p_delivery, p_delivered_to, p_provider_message_id, p_actor, p_actor_label)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

ALTER TABLE finance.invoice_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.invoice_emails FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.record_invoice_email(uuid, text, text[], text[], text, text, text, text[], text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.invoice_emails TO service_role;
GRANT EXECUTE ON FUNCTION finance.record_invoice_email(uuid, text, text[], text[], text, text, text, text[], text, uuid, text)
  TO service_role;

COMMIT;
