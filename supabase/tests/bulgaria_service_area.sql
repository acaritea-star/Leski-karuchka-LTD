-- Rollback-only geographic and trigger checks; no real driver/customer data.
BEGIN;
DO $test$
BEGIN
 IF NOT private.in_bulgaria(42.6977,23.3219) OR NOT private.in_bulgaria(43.3592,25.1358)
 OR private.in_bulgaria(44.1598,28.6348) OR private.in_bulgaria(51.507,-.128) THEN RAISE EXCEPTION 'Boundary test failed'; END IF;
 BEGIN
  INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
  VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',51.507,-.128,10,now());
  RAISE EXCEPTION 'Outside GPS was allowed';
 EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE '%България%' THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO public.taxi_requests(pickup_latitude,pickup_longitude,destination_latitude,destination_longitude)
  VALUES(42.6977,23.3219,51.507,-.128);
  RAISE EXCEPTION 'Outside destination was allowed';
 EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE '%България%' THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO public.drivers(is_online) VALUES(true);
  RAISE EXCEPTION 'Online without GPS was allowed';
 EXCEPTION WHEN check_violation THEN IF SQLERRM NOT LIKE '%България%' THEN RAISE; END IF; END;
END $test$;
ROLLBACK;
