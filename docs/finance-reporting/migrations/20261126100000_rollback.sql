-- Rollback of 20261126100000_finance_invoice_emails (never automatic; run by hand only if asked).
-- Drops the record of invoices emailed to clients (what was recorded is lost; the emails themselves were sent).
-- The code then shows no sends and refuses to send until the migration is applied again.
BEGIN;

DROP FUNCTION IF EXISTS finance.record_invoice_email(uuid, text, text[], text[], text, text, text, text[], text, uuid, text);
DROP TABLE IF EXISTS finance.invoice_emails;

COMMIT;
