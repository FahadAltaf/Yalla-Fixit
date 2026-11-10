-- Rollback for 20261023100000_hr_compliance: removes schema `hr` and everything in it.
-- Only before go-live: waivers and finalised statements are records HR relies on.
DROP SCHEMA IF EXISTS hr CASCADE;
NOTIFY pgrst, 'reload schema';
