-- Rollback for 20261020130000_fsm_read_model. Review before running; never
-- run automatically. Drops the read model and everything synced into it.
-- Safe until go-live: nothing on live main reads these tables, and a fresh
-- backfill rebuilds them.
BEGIN;
DROP FUNCTION IF EXISTS fsm.sync_release(text, uuid, boolean, text, timestamptz, integer, boolean, timestamptz);
DROP FUNCTION IF EXISTS fsm.sync_claim(text, uuid, integer);
DROP FUNCTION IF EXISTS fsm.set_appointment_crew(text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS fsm.upsert_appointments(jsonb);
DROP FUNCTION IF EXISTS fsm.sync_line_items(text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS fsm.upsert_work_orders(jsonb);
DROP FUNCTION IF EXISTS fsm.upsert_estimates(jsonb);
DROP TABLE IF EXISTS fsm.appointment_resources;
DROP TABLE IF EXISTS fsm.appointments;
DROP TABLE IF EXISTS fsm.line_status_events;
DROP TABLE IF EXISTS fsm.line_items;
DROP TABLE IF EXISTS fsm.work_orders;
DROP TABLE IF EXISTS fsm.estimate_status_events;
DROP TABLE IF EXISTS fsm.estimates;
DROP TABLE IF EXISTS fsm.sync_runs;
DROP TABLE IF EXISTS fsm.sync_state;
-- Fails, on purpose, if anything else was put in the schema since.
DROP SCHEMA IF EXISTS fsm;
COMMIT;
-- Then remove fsm from Exposed schemas (Project Settings > API).
