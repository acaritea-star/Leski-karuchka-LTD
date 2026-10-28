-- Disposable localhost regression only; every operation rolls back.
BEGIN;
CREATE FUNCTION pg_temp.reference_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
 BEGIN EXECUTE stmt;
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT LIKE 'Geographic reference data is read-only%' THEN RAISE EXCEPTION 'FAIL unrelated permission error: %',SQLERRM;END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'FAIL reference mutation allowed: %',stmt;
END $test$;
DO $test$
DECLARE actor text;stmt text;point public.geometry;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.spatial_ref_sys'::regclass AND tgname='client_geographic_reference_read_only' AND tgenabled='O') THEN RAISE EXCEPTION 'FAIL reference guard missing';END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid='private.guard_geographic_reference()'::regprocedure) THEN RAISE EXCEPTION 'FAIL reference guard hides caller role';END IF;
 FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
  EXECUTE format('SET LOCAL ROLE %I',actor);
  IF NOT EXISTS(SELECT 1 FROM public.spatial_ref_sys WHERE srid=4326) THEN RAISE EXCEPTION 'FAIL reference read blocked';END IF;
  point:=public.st_transform(public.st_setsrid(public.st_makepoint(25.14,43.35),4326),3857);
  IF public.st_srid(point)<>3857 OR NOT public.st_isvalid(point) THEN RAISE EXCEPTION 'FAIL projection broken';END IF;
  FOREACH stmt IN ARRAY ARRAY[
   'INSERT INTO public.spatial_ref_sys(srid) SELECT 999999 WHERE false',
   'UPDATE public.spatial_ref_sys SET srtext=srtext WHERE false',
   'DELETE FROM public.spatial_ref_sys WHERE false',
   'TRUNCATE public.spatial_ref_sys'
  ] LOOP PERFORM pg_temp.reference_denied(stmt);END LOOP;
  EXECUTE 'RESET ROLE';
 END LOOP;
 -- Trusted extension maintenance retains its existing privileges.
 UPDATE public.spatial_ref_sys SET srtext=srtext WHERE false;
END $test$;
SELECT 'PASS: public reference reads and projections work; client mutations denied' AS result;
ROLLBACK;
