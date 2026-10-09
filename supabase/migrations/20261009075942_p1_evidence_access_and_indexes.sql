-- Keep privileged implementation in the unexposed schema. Public RPCs retain
-- their signatures and authorization behavior through SECURITY INVOKER wrappers.
CREATE INDEX ride_evidence_customer ON public.ride_evidence(customer_id);
CREATE INDEX ride_evidence_driver ON public.ride_evidence(driver_id);

ALTER FUNCTION public.confirm_ride_start(uuid) SET SCHEMA private;
ALTER FUNCTION public.ride_observations(uuid,timestamptz,integer) SET SCHEMA private;
ALTER FUNCTION public.record_operation_metrics(uuid,jsonb) SET SCHEMA private;
ALTER FUNCTION public.operational_health(uuid) SET SCHEMA private;
ALTER FUNCTION public.reserve_route_request_v2(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text,uuid) SET SCHEMA private;

REVOKE ALL ON FUNCTION private.confirm_ride_start(uuid),private.ride_observations(uuid,timestamptz,integer),
 private.record_operation_metrics(uuid,jsonb),private.operational_health(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.confirm_ride_start(uuid),private.ride_observations(uuid,timestamptz,integer),
 private.record_operation_metrics(uuid,jsonb),private.operational_health(uuid) TO authenticated;
REVOKE ALL ON FUNCTION private.reserve_route_request_v2(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.reserve_route_request_v2(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text,uuid) TO service_role;

CREATE FUNCTION public.confirm_ride_start(p_request_id uuid) RETURNS timestamptz
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.confirm_ride_start(p_request_id); $$;
CREATE FUNCTION public.ride_observations(p_request_id uuid,p_after timestamptz DEFAULT '-infinity',p_limit integer DEFAULT 500) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.ride_observations(p_request_id,p_after,p_limit); $$;
CREATE FUNCTION public.record_operation_metrics(p_id uuid,p_rows jsonb) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.record_operation_metrics(p_id,p_rows); $$;
CREATE FUNCTION public.operational_health(p_company_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.operational_health(p_company_id); $$;
CREATE FUNCTION public.reserve_route_request_v2(
 p_user_id uuid,p_request_id uuid,p_quote boolean,p_origin_lat double precision,p_origin_lng double precision,
 p_destination_lat double precision,p_destination_lng double precision,p_purpose text,p_company_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.reserve_route_request_v2(p_user_id,p_request_id,p_quote,p_origin_lat,p_origin_lng,p_destination_lat,p_destination_lng,p_purpose,p_company_id);
$$;
REVOKE ALL ON FUNCTION public.confirm_ride_start(uuid),public.ride_observations(uuid,timestamptz,integer),
 public.record_operation_metrics(uuid,jsonb),public.operational_health(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.confirm_ride_start(uuid),public.ride_observations(uuid,timestamptz,integer),
 public.record_operation_metrics(uuid,jsonb),public.operational_health(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.reserve_route_request_v2(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_route_request_v2(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text,uuid) TO service_role;
