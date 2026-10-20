-- Rollback only. No production schema movement or coordinate data modification.
BEGIN;
SET LOCAL statement_timeout='15s';
CREATE FUNCTION pg_temp.spatial_write_denied(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN insufficient_privilege THEN RETURN;
 END;
 RAISE EXCEPTION 'FAIL application role modified spatial reference data: %',statement;
END $$;
DO $test$
DECLARE app_role text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.spatial_ref_sys'::regclass
  AND tgname='leski_spatial_reference_write_guard' AND tgenabled='O') THEN
  RAISE EXCEPTION 'FAIL spatial reference write guard missing';
 END IF;
 FOREACH app_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  EXECUTE format('SET LOCAL ROLE %I',app_role);
  IF NOT EXISTS(SELECT 1 FROM public.spatial_ref_sys WHERE srid=4326) THEN
   RAISE EXCEPTION 'FAIL coordinate reference lookup was broken';
  END IF;
  PERFORM pg_temp.spatial_write_denied('UPDATE public.spatial_ref_sys SET srtext=srtext WHERE srid=-1');
  PERFORM pg_temp.spatial_write_denied('DELETE FROM public.spatial_ref_sys WHERE srid=-1');
  PERFORM pg_temp.spatial_write_denied('INSERT INTO public.spatial_ref_sys(srid) VALUES(999000)');
  PERFORM pg_temp.spatial_write_denied('TRUNCATE public.spatial_ref_sys');
  EXECUTE 'RESET ROLE';
 END LOOP;
 -- Maintenance by the database owner remains possible; this matches no rows.
 UPDATE public.spatial_ref_sys SET srtext=srtext WHERE srid=-1;
 IF public.ST_Distance(public.ST_SetSRID(public.ST_MakePoint(25.6,43.2),4326)::public.geography,
   public.ST_SetSRID(public.ST_MakePoint(25.61,43.21),4326)::public.geography) <= 0 THEN
  RAISE EXCEPTION 'FAIL geographic distance calculation';
 END IF;
END $test$;
ROLLBACK;
