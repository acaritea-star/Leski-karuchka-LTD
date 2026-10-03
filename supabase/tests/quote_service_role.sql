-- Run after core.sql in a rollback transaction. Explicitly exercise the role
-- used by Edge Functions, including a direct schema-qualified helper call.
RESET ROLE;
GRANT SELECT ON test_ids TO service_role;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF NOT private.in_bulgaria(43.0757,25.6172) THEN RAISE EXCEPTION 'FAIL Tarnovo rejected'; END IF;
 IF private.in_bulgaria(51.507,-0.128) THEN RAISE EXCEPTION 'FAIL foreign location accepted'; END IF;
END $$;
INSERT INTO public.ride_quotes(customer_id,company_id,vehicle_type_id,payload)
SELECT customer,company,vehicle_type,'{"pickup_latitude":43.0757,"pickup_longitude":25.6172,"destination_latitude":43.088,"destination_longitude":25.594,"pickup_address":"Test","destination_address":"Test","distance_km":3,"duration_min":8,"total":8}'::jsonb FROM test_ids;
RESET ROLE;
SELECT 'PASS: service-role schema access, Bulgaria helper and quote writer' result;
