-- Restore the previous response after reverting the frontend to its previous release.
CREATE OR REPLACE FUNCTION private.marketplace_availability(p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE categories jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='CUSTOMER' AND is_active)
 THEN RAISE EXCEPTION 'Active customer required' USING ERRCODE='42501'; END IF;
 IF private.in_bulgaria(p_lat,p_lng) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Location outside service area'; END IF;
 WITH ready AS MATERIALIZED (SELECT service_class,count(*) amount FROM private.marketplace_drivers(p_lat,p_lng) GROUP BY service_class)
 SELECT jsonb_agg(jsonb_build_object('id',s.class,'configured',coalesce(ready.amount,0)>0,'drivers',coalesce(ready.amount,0)) ORDER BY s.rank) INTO categories
 FROM (VALUES('standard',1),('comfort',2),('van',3)) s(class,rank) LEFT JOIN ready ON ready.service_class=s.class;
 RETURN jsonb_build_object('company_id','marketplace','sampled_at',clock_timestamp(),'categories',categories);
END $function$;
