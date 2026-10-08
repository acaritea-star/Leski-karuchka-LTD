CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
-- Test bootstrap captured from application DDL on 2026-10-08 before P1.
-- No user data, API keys or production cron schedules. NOT a production restore.
CREATE SCHEMA IF NOT EXISTS private; SET check_function_bodies=false;
CREATE TYPE public.cancelled_by AS ENUM ('customer','driver','admin','system');
CREATE TYPE public.discount_type AS ENUM ('percent','fixed');
CREATE TYPE public.document_status AS ENUM ('pending','approved','rejected');
CREATE TYPE public.document_type AS ENUM ('license','id_card','insurance','vehicle_registration');
CREATE TYPE public.driver_status AS ENUM ('available','busy','offline');
CREATE TYPE public.payment_method AS ENUM ('cash','card','online');
CREATE TYPE public.payment_status AS ENUM ('pending','paid','refunded');
CREATE TYPE public.request_status AS ENUM ('pending','accepted','arrived','in_progress','completed','cancelled');
CREATE TYPE public.transaction_status AS ENUM ('pending','completed','failed','refunded');
CREATE TYPE public.user_role AS ENUM ('CUSTOMER','DRIVER','COMPANY_ADMIN','SUPER_ADMIN');
CREATE TABLE private.api_budget (user_id uuid NOT NULL,window_at timestamp with time zone NOT NULL,hits integer NOT NULL);
CREATE TABLE private.legal_versions (terms_version text NOT NULL,privacy_version text NOT NULL,source_digest text NOT NULL,is_current boolean DEFAULT true NOT NULL,created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL);
CREATE TABLE private.nearby_read_limits (user_id uuid NOT NULL,last_read timestamp with time zone NOT NULL);
CREATE TABLE private.push_outbox (id uuid DEFAULT gen_random_uuid() NOT NULL,request_id uuid NOT NULL,recipient_id uuid NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL,status text DEFAULT 'pending'::text NOT NULL,attempts integer DEFAULT 0 NOT NULL,available_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,expires_at timestamp with time zone NOT NULL,lease_token uuid,lease_until timestamp with time zone,claimed_at timestamp with time zone,http_request_id bigint,last_error text,created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL);
CREATE TABLE private.road_fetch_budget (day date NOT NULL,requests integer NOT NULL);
CREATE TABLE private.road_tiles (key text NOT NULL,roads jsonb,expires_at timestamp with time zone DEFAULT '-infinity'::timestamp with time zone NOT NULL,lease_until timestamp with time zone DEFAULT '-infinity'::timestamp with time zone NOT NULL);
CREATE TABLE private.route_budget_settings (singleton boolean DEFAULT true NOT NULL,daily_limit integer DEFAULT 120 NOT NULL,quote_reserve integer DEFAULT 20 NOT NULL,user_daily_limit integer DEFAULT 60 NOT NULL,ride_limit integer DEFAULT 10 NOT NULL);
CREATE TABLE private.route_budget_usage (bucket text NOT NULL,budget_day date NOT NULL,hits integer DEFAULT 0 NOT NULL,updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL);
CREATE TABLE public.app_config (id integer DEFAULT 1 NOT NULL,vapid_public_key text,vapid_private_key text,created_at timestamp with time zone DEFAULT now(),updated_at timestamp with time zone DEFAULT now());
CREATE TABLE public.audit_log (id uuid DEFAULT gen_random_uuid() NOT NULL,company_id uuid,actor_id uuid,entity_type text NOT NULL,entity_id uuid NOT NULL,action text NOT NULL,old_value jsonb,new_value jsonb,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.companies (id uuid DEFAULT gen_random_uuid() NOT NULL,name text NOT NULL,slug text NOT NULL,logo_url text,brand_color_primary text DEFAULT '#E8B42D'::text,brand_color_secondary text DEFAULT '#1F2937'::text,phone text,email text,address text,currency text DEFAULT 'EUR'::text NOT NULL,base_fare numeric(10,2) DEFAULT 0 NOT NULL,price_per_km numeric(10,2) DEFAULT 0 NOT NULL,price_per_minute numeric(10,2) DEFAULT 0 NOT NULL,min_fare numeric(10,2) DEFAULT 0 NOT NULL,dispatch_radius_km numeric(5,2) DEFAULT 5 NOT NULL,is_active boolean DEFAULT true NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL,legal_name text,registration_id text,permit_number text,permit_expires_on date,legal_verified_at timestamp with time zone,legal_verified_by uuid,document_checks_required boolean DEFAULT false NOT NULL);
CREATE TABLE public.coupons (id uuid DEFAULT gen_random_uuid() NOT NULL,company_id uuid NOT NULL,code text NOT NULL,discount_type discount_type DEFAULT 'percent'::discount_type NOT NULL,value numeric(10,2) DEFAULT 0 NOT NULL,min_order_amount numeric(10,2) DEFAULT 0,max_uses integer,used_count integer DEFAULT 0 NOT NULL,valid_from timestamp with time zone,valid_until timestamp with time zone,is_active boolean DEFAULT true NOT NULL);
CREATE TABLE public.driver_applications (id uuid DEFAULT gen_random_uuid() NOT NULL,user_id uuid NOT NULL,company_id uuid NOT NULL,full_name text NOT NULL,phone text NOT NULL,email text,experience text NOT NULL,has_vehicle boolean NOT NULL,message text DEFAULT ''::text NOT NULL,status text DEFAULT 'pending'::text NOT NULL,review_note text,reviewed_by uuid,reviewed_at timestamp with time zone,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.driver_documents (id uuid DEFAULT gen_random_uuid() NOT NULL,driver_id uuid NOT NULL,company_id uuid NOT NULL,type document_type NOT NULL,file_url text,status document_status DEFAULT 'pending'::document_status NOT NULL,reviewed_at timestamp with time zone,expires_at date,created_at timestamp with time zone DEFAULT now() NOT NULL,reviewed_by uuid);
CREATE TABLE public.driver_locations (driver_id uuid NOT NULL,company_id uuid NOT NULL,latitude double precision NOT NULL,longitude double precision NOT NULL,heading double precision DEFAULT 0,speed double precision DEFAULT 0,accuracy double precision DEFAULT 0,updated_at timestamp with time zone DEFAULT now() NOT NULL,geo geography(Point,4326) GENERATED ALWAYS AS ((st_setsrid(st_makepoint(longitude, latitude), 4326))::geography) STORED,position_at timestamp with time zone);
CREATE TABLE public.driver_money_entries (id uuid NOT NULL,company_id uuid NOT NULL,driver_id uuid,driver_user_id uuid NOT NULL,actor_id uuid,kind text NOT NULL,amount numeric(12,2) NOT NULL,currency text DEFAULT 'EUR'::text NOT NULL,note text NOT NULL,request_id uuid,reference_id uuid,recorded_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,evidence_source text DEFAULT 'declaration'::text NOT NULL,evidence_reference text);
CREATE TABLE public.drivers (id uuid DEFAULT gen_random_uuid() NOT NULL,user_id uuid NOT NULL,company_id uuid NOT NULL,vehicle_id uuid,is_online boolean DEFAULT false NOT NULL,is_verified boolean DEFAULT false NOT NULL,rating numeric(3,2) DEFAULT 5.00 NOT NULL,total_trips integer DEFAULT 0 NOT NULL,status driver_status DEFAULT 'offline'::driver_status NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL,document_verification_required boolean DEFAULT true NOT NULL);
CREATE TABLE public.ledger (id uuid DEFAULT gen_random_uuid() NOT NULL,company_id uuid,transaction_id uuid,account text NOT NULL,entry_type text NOT NULL,amount numeric(12,2) NOT NULL,currency text DEFAULT 'EUR'::text NOT NULL,description text,balance_after numeric(12,2),created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.legal_acceptances (id uuid DEFAULT gen_random_uuid() NOT NULL,user_id uuid NOT NULL,terms_version text NOT NULL,privacy_version text NOT NULL,source_digest text NOT NULL,method text NOT NULL,accepted_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL);
CREATE TABLE public.news_articles (id uuid DEFAULT gen_random_uuid() NOT NULL,title text NOT NULL,slug text NOT NULL,excerpt text NOT NULL,content text NOT NULL,category text,featured_image_url text,featured_image_alt text,author_name text DEFAULT 'Лески Каручка'::text NOT NULL,status text DEFAULT 'draft'::text NOT NULL,is_featured boolean DEFAULT false NOT NULL,seo_title text,seo_description text,published_at timestamp with time zone,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL,title_en text,excerpt_en text,content_en text,category_en text,seo_title_en text,seo_description_en text);
CREATE TABLE public.notifications (id uuid DEFAULT gen_random_uuid() NOT NULL,user_id uuid NOT NULL,company_id uuid,type text,title text,message text,data jsonb,is_read boolean DEFAULT false NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.payment_transactions (id uuid DEFAULT gen_random_uuid() NOT NULL,request_id uuid NOT NULL,company_id uuid NOT NULL,amount numeric(10,2) NOT NULL,method payment_method NOT NULL,status transaction_status DEFAULT 'pending'::transaction_status NOT NULL,provider text,provider_ref text,paid_at timestamp with time zone,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.privacy_requests (id uuid DEFAULT gen_random_uuid() NOT NULL,user_id uuid NOT NULL,kind text NOT NULL,status text DEFAULT 'pending'::text NOT NULL,created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,resolved_at timestamp with time zone,resolution text);
CREATE TABLE public.profiles (id uuid NOT NULL,first_name text,last_name text,phone text,email text,avatar_url text,role user_role DEFAULT 'CUSTOMER'::user_role NOT NULL,company_id uuid,is_active boolean DEFAULT true NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL,language text DEFAULT 'bg'::text NOT NULL);
CREATE TABLE public.push_subscriptions (id uuid DEFAULT gen_random_uuid() NOT NULL,user_id uuid NOT NULL,endpoint text NOT NULL,p256dh text NOT NULL,auth text NOT NULL,user_agent text,created_at timestamp with time zone DEFAULT now(),updated_at timestamp with time zone DEFAULT now(),is_active boolean DEFAULT true NOT NULL);
CREATE TABLE public.ratings (id uuid DEFAULT gen_random_uuid() NOT NULL,request_id uuid NOT NULL,company_id uuid NOT NULL,customer_id uuid NOT NULL,driver_id uuid NOT NULL,score integer NOT NULL,feedback text,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.request_declines (id uuid DEFAULT gen_random_uuid() NOT NULL,request_id uuid NOT NULL,driver_id uuid NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.request_outcomes (id uuid DEFAULT gen_random_uuid() NOT NULL,request_id uuid NOT NULL,company_id uuid NOT NULL,driver_id uuid,driver_user_id uuid,vehicle_id uuid,outcome text NOT NULL,previous_status text NOT NULL,cancelled_by text,cancel_reason text,actor_id uuid,occurred_at timestamp with time zone NOT NULL,accepted_at timestamp with time zone,started_at timestamp with time zone,booked_amount numeric(12,2),estimated_distance_km double precision,reconstructed boolean DEFAULT false NOT NULL);
CREATE TABLE public.ride_quotes (id uuid DEFAULT gen_random_uuid() NOT NULL,customer_id uuid NOT NULL,company_id uuid NOT NULL,vehicle_type_id uuid NOT NULL,payload jsonb NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,expires_at timestamp with time zone DEFAULT (now() + '00:02:00'::interval) NOT NULL,request_id uuid);
CREATE TABLE public.saved_places (id uuid DEFAULT gen_random_uuid() NOT NULL,user_id uuid NOT NULL,name text NOT NULL,latitude double precision NOT NULL,longitude double precision NOT NULL,address text,is_home boolean DEFAULT false NOT NULL,is_work boolean DEFAULT false NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.taxi_requests (id uuid DEFAULT gen_random_uuid() NOT NULL,company_id uuid NOT NULL,customer_id uuid NOT NULL,driver_id uuid,vehicle_type_id uuid,pickup_latitude double precision NOT NULL,pickup_longitude double precision NOT NULL,pickup_address text,destination_latitude double precision,destination_longitude double precision,destination_address text,status request_status DEFAULT 'pending'::request_status NOT NULL,estimated_price numeric(10,2),final_price numeric(10,2),fare_breakdown jsonb,payment_method payment_method DEFAULT 'cash'::payment_method NOT NULL,payment_status payment_status DEFAULT 'pending'::payment_status NOT NULL,requested_at timestamp with time zone DEFAULT now(),accepted_at timestamp with time zone,arrived_at timestamp with time zone,started_at timestamp with time zone,completed_at timestamp with time zone,cancelled_at timestamp with time zone,cancel_reason text,cancelled_by cancelled_by,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL,estimated_distance_km double precision,estimated_duration_min integer,expires_at timestamp with time zone DEFAULT (clock_timestamp() + '00:02:00'::interval));
CREATE TABLE public.trips (id uuid DEFAULT gen_random_uuid() NOT NULL,request_id uuid NOT NULL,company_id uuid NOT NULL,driver_id uuid,customer_id uuid NOT NULL,distance_km numeric(8,2),duration_min numeric(8,2),total_amount numeric(10,2),payment_method payment_method,started_at timestamp with time zone,ended_at timestamp with time zone,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.vehicle_types (id uuid DEFAULT gen_random_uuid() NOT NULL,company_id uuid NOT NULL,name text NOT NULL,capacity integer DEFAULT 4 NOT NULL,multiplier numeric(4,2) DEFAULT 1.00 NOT NULL,image_url text,is_active boolean DEFAULT true NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.vehicles (id uuid DEFAULT gen_random_uuid() NOT NULL,company_id uuid NOT NULL,vehicle_type_id uuid,make text NOT NULL,model text NOT NULL,year integer,color text,registration_number text NOT NULL,capacity integer DEFAULT 4 NOT NULL,insurance_expiry_date date,inspection_expiry_date date,is_active boolean DEFAULT true NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE OR REPLACE FUNCTION private.accept_legal_versions(p_terms text, p_privacy text, p_method text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result uuid; digest text; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_method IS NULL OR p_method NOT IN ('google','facebook','continue') THEN RAISE EXCEPTION 'Invalid acceptance method'; END IF;
 SELECT source_digest INTO digest FROM private.legal_versions WHERE is_current AND terms_version=p_terms AND privacy_version=p_privacy;
 IF NOT FOUND THEN RAISE EXCEPTION 'Legal versions changed. Refresh the app.'; END IF;
 INSERT INTO public.legal_acceptances(user_id,terms_version,privacy_version,source_digest,method)
 VALUES(uid,p_terms,p_privacy,digest,p_method) ON CONFLICT(user_id,terms_version,privacy_version) DO NOTHING;
 SELECT id INTO result FROM public.legal_acceptances WHERE user_id=uid AND terms_version=p_terms AND privacy_version=p_privacy;
 RETURN result;
END $function$

CREATE OR REPLACE FUNCTION private.audit_document_validity_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF (NEW.expires_at,NEW.file_url) IS DISTINCT FROM (OLD.expires_at,OLD.file_url) THEN
  INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,old_value,new_value)
  VALUES(NEW.company_id,auth.uid(),'document',NEW.id,'document_validity_changed',
   jsonb_build_object('expires_at',OLD.expires_at,'file_url',OLD.file_url),
   jsonb_build_object('expires_at',NEW.expires_at,'file_url',NEW.file_url));
 END IF;
 RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.can_read_driver_document(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.drivers d JOIN public.profiles p ON p.id=d.user_id
 WHERE d.user_id::text=split_part(p_name,'/',1)
 AND ((d.user_id=auth.uid() AND p.is_active AND p.role='DRIVER') OR public.is_company_admin(d.company_id) OR public.is_super_admin()));
$function$

CREATE OR REPLACE FUNCTION private.can_receive_request(p_company uuid, p_type uuid, p_lat double precision, p_lng double precision)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS(
    SELECT 1 FROM private.eligible_drivers(p_company,p_type,p_lat,p_lng,auth.uid()));
$function$

CREATE OR REPLACE FUNCTION private.current_driver_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT d.id FROM public.drivers d JOIN public.profiles p ON p.id=d.user_id
 WHERE p.id=(SELECT auth.uid()) AND p.role='DRIVER' AND p.is_active;
$function$

CREATE OR REPLACE FUNCTION private.dispatch_push_outbox()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE j private.push_outbox; token uuid; http_id bigint; kicked integer:=0;
BEGIN
  UPDATE private.push_outbox SET status='skipped',last_error='EXPIRED',lease_token=NULL,lease_until=NULL
    WHERE status IN ('pending','processing') AND expires_at<=clock_timestamp();
  UPDATE private.push_outbox SET status='failed',last_error='RETRY_LIMIT',lease_token=NULL,lease_until=NULL
    WHERE status='processing' AND lease_until<=clock_timestamp() AND attempts>=5;
  FOR j IN SELECT * FROM private.push_outbox
    WHERE expires_at>clock_timestamp() AND attempts<5
      AND ((status='pending' AND available_at<=clock_timestamp())
        OR (status='processing' AND lease_until<=clock_timestamp()))
    ORDER BY available_at,id LIMIT 20 FOR UPDATE SKIP LOCKED
  LOOP
    token:=gen_random_uuid();
    UPDATE private.push_outbox SET status='processing',attempts=attempts+1,
      lease_token=token,lease_until=clock_timestamp()+interval '30 seconds',claimed_at=NULL
      WHERE id=j.id;
    BEGIN
      -- A short-lived, single-use job capability is the worker's custom auth.
      -- Only service-role RPCs can consume it. No server secret is stored in SQL.
      SELECT net.http_post(
        url:='https://rzjyvxmfqnnxglmgnvma.supabase.co/functions/v1/deliver-push',
        body:=jsonb_build_object('job_id',j.id,'lease_token',token),
        headers:='{"Content-Type":"application/json"}'::jsonb,
        timeout_milliseconds:=10000) INTO http_id;
      UPDATE private.push_outbox SET http_request_id=http_id WHERE id=j.id;
      kicked:=kicked+1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE private.push_outbox SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
        available_at=clock_timestamp()+interval '10 seconds',lease_token=NULL,lease_until=NULL,
        last_error='HTTP_ENQUEUE_FAILED' WHERE id=j.id;
    END;
  END LOOP;
  DELETE FROM private.push_outbox
    WHERE status IN ('sent','failed','skipped') AND created_at<clock_timestamp()-interval '7 days';
  RETURN kicked;
END $function$

CREATE OR REPLACE FUNCTION private.driver_documents_ready(p_driver uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.drivers d JOIN public.companies c ON c.id=d.company_id LEFT JOIN public.vehicles v ON v.id=d.vehicle_id
 WHERE d.id=p_driver
 AND (c.permit_expires_on IS NULL OR c.permit_expires_on>=(now() AT TIME ZONE 'Europe/Sofia')::date)
 AND (v.insurance_expiry_date IS NULL OR v.insurance_expiry_date>=(now() AT TIME ZONE 'Europe/Sofia')::date)
 AND (v.inspection_expiry_date IS NULL OR v.inspection_expiry_date>=(now() AT TIME ZONE 'Europe/Sofia')::date)
 AND NOT EXISTS(SELECT 1 FROM public.driver_documents x WHERE x.driver_id=d.id AND x.type IN ('license','insurance') AND x.status='approved'
  AND x.expires_at<(now() AT TIME ZONE 'Europe/Sofia')::date
  AND NOT EXISTS(SELECT 1 FROM public.driver_documents y WHERE y.driver_id=d.id AND y.type=x.type AND y.status='approved' AND y.expires_at>=(now() AT TIME ZONE 'Europe/Sofia')::date))
 AND (NOT(c.document_checks_required OR d.document_verification_required) OR NOT EXISTS(
  SELECT 1 FROM unnest(ARRAY['license','insurance']) required(type)
  WHERE NOT EXISTS(SELECT 1 FROM public.driver_documents x WHERE x.driver_id=d.id AND x.type::text=required.type AND x.status='approved' AND x.expires_at>=(now() AT TIME ZONE 'Europe/Sofia')::date AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='driver-documents' AND x.file_url='storage://driver-documents/'||o.name)))));
$function$

CREATE OR REPLACE FUNCTION private.driver_verification_report(p_driver uuid, p_vehicle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE d public.drivers; c public.companies; v public.vehicles; doc public.driver_documents;
 blockers jsonb:='[]'; warnings jsonb:='[]'; documents jsonb:='{}'; kind text; label text; state text;
 today date:=(now() AT TIME ZONE 'Europe/Sofia')::date;
BEGIN
 SELECT * INTO d FROM public.drivers WHERE id=p_driver;
 IF NOT FOUND THEN RETURN jsonb_build_object('driver_id',p_driver,'can_verify',false,'blockers',jsonb_build_array(jsonb_build_object('code','profile','message','Няма шофьорски профил.')),'warnings','[]'::jsonb,'documents','{}'::jsonb); END IF;
 SELECT * INTO c FROM public.companies WHERE id=d.company_id;
 SELECT * INTO v FROM public.vehicles WHERE id=p_vehicle AND company_id=d.company_id;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=d.user_id AND role='DRIVER' AND company_id=d.company_id AND is_active) THEN
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','profile','message','Шофьорският профил не е активен към тази фирма.')); END IF;
 IF c.id IS NULL OR NOT c.is_active THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','company','message','Фирмата не е активна.')); END IF;
 IF v.id IS NULL OR NOT v.is_active OR NOT EXISTS(SELECT 1 FROM public.vehicle_types WHERE id=v.vehicle_type_id AND company_id=d.company_id AND is_active) THEN
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','vehicle','message','Назначете активен автомобил с активна категория от същата фирма.')); END IF;
 FOREACH kind IN ARRAY ARRAY['license','insurance'] LOOP
  label:=CASE kind WHEN 'license' THEN 'Шофьорска книжка' ELSE 'Застраховка' END;
  SELECT x.* INTO doc FROM public.driver_documents x WHERE x.driver_id=d.id AND x.type::text=kind
   ORDER BY (x.status='approved' AND x.expires_at>=today) DESC NULLS LAST,x.created_at DESC,x.id DESC LIMIT 1;
  state:=CASE WHEN NOT FOUND THEN 'missing' WHEN doc.expires_at IS NULL THEN 'missing_expiry'
   WHEN doc.expires_at<today THEN 'expired' WHEN doc.status='rejected' THEN 'rejected'
   WHEN doc.status<>'approved' THEN 'pending'
   WHEN NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='driver-documents' AND doc.file_url='storage://driver-documents/'||o.name) THEN 'missing_file'
   ELSE 'approved' END;
  documents:=documents||jsonb_build_object(kind,jsonb_build_object('state',state,'expires_at',doc.expires_at));
  IF state<>'approved' THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code',kind,'message',label||': '||CASE state
   WHEN 'missing' THEN 'няма качен документ.' WHEN 'missing_expiry' THEN 'липсва срок на валидност.'
   WHEN 'expired' THEN 'срокът е изтекъл.' WHEN 'rejected' THEN 'документът е отхвърлен.'
   WHEN 'pending' THEN 'чака одобрение от фирмата.' ELSE 'защитеният файл липсва.' END)); END IF;
 END LOOP;
 IF c.permit_expires_on<today THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','company_permit','message','Срокът на разрешението на фирмата е изтекъл.'));
 ELSIF c.id IS NOT NULL AND c.permit_expires_on IS NULL THEN warnings:=warnings||jsonb_build_array(jsonb_build_object('code','company_permit','message','Не е въведен срок на разрешението на фирмата. Проверете го в „Настройки“.')); END IF;
 IF v.insurance_expiry_date<today THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','vehicle_insurance','message','Срокът на застраховката на автомобила е изтекъл. Обновете го в „Автомобили“.'));
 ELSIF v.id IS NOT NULL AND v.insurance_expiry_date IS NULL THEN warnings:=warnings||jsonb_build_array(jsonb_build_object('code','vehicle_insurance','message','Не е въведен срок на застраховката на автомобила.')); END IF;
 IF v.inspection_expiry_date<today THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','vehicle_inspection','message','Срокът на техническия преглед на автомобила е изтекъл. Обновете го в „Автомобили“.'));
 ELSIF v.id IS NOT NULL AND v.inspection_expiry_date IS NULL THEN warnings:=warnings||jsonb_build_array(jsonb_build_object('code','vehicle_inspection','message','Не е въведен срок на техническия преглед на автомобила.')); END IF;
 RETURN jsonb_build_object('driver_id',d.id,'is_verified',d.is_verified,'can_verify',jsonb_array_length(blockers)=0,'blockers',blockers,'warnings',warnings,'documents',documents);
END $function$

CREATE OR REPLACE FUNCTION private.eligible_drivers(p_company uuid, p_type uuid, p_lat double precision, p_lng double precision, p_user uuid DEFAULT NULL::uuid)
 RETURNS TABLE(driver_id uuid, user_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT d.id, d.user_id
  FROM public.drivers d
  JOIN public.profiles p ON p.id=d.user_id AND p.role='DRIVER' AND p.is_active
  JOIN public.companies c ON c.id=d.company_id AND c.is_active
  JOIN public.vehicles v ON v.id=d.vehicle_id AND v.company_id=d.company_id AND v.is_active
  JOIN public.vehicle_types vt ON vt.id=v.vehicle_type_id AND vt.company_id=d.company_id AND vt.is_active
  JOIN public.driver_locations l ON l.driver_id=d.id AND l.company_id=d.company_id
  WHERE d.company_id=p_company AND v.vehicle_type_id=p_type
    AND (p_user IS NULL OR d.user_id=p_user) AND d.is_online AND d.is_verified AND private.driver_documents_ready(d.id)
    AND l.updated_at > clock_timestamp()-interval '45 seconds'
    AND l.position_at > clock_timestamp()-interval '45 seconds'
    AND l.accuracy BETWEEN 0 AND 100
    AND l.position_at <= clock_timestamp()+interval '30 seconds'
    AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
    AND c.dispatch_radius_km > 0
    AND public.st_dwithin(l.geo,
      public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography,
      c.dispatch_radius_km::double precision*1000)
    AND NOT EXISTS(SELECT 1 FROM public.taxi_requests r
      WHERE r.driver_id=d.id AND r.status IN ('accepted','arrived','in_progress'));
$function$

CREATE OR REPLACE FUNCTION private.enqueue_request_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE recipient uuid; recipients uuid[]; kind text; title text; message text; role_name text;
  payload jsonb; deadline timestamptz; notification_type text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' AND NEW.status<>'pending' THEN RETURN NEW; END IF;
  kind:=CASE WHEN NEW.status='pending' THEN 'new_request' ELSE NEW.status::text END;
  IF kind='new_request' THEN
    SELECT array_agg(user_id) INTO recipients FROM public.request_push_recipients(NEW.id);
    title:='Нова заявка'; message:=NEW.pickup_address||' → '||NEW.destination_address;
    deadline:=COALESCE(NEW.expires_at,NEW.created_at+interval '2 minutes');
  ELSE
    recipients:=ARRAY[NEW.customer_id];
    IF kind='cancelled' AND NEW.driver_id IS NOT NULL THEN
      SELECT array_append(recipients,d.user_id) INTO recipients FROM public.drivers d WHERE d.id=NEW.driver_id;
    END IF;
    title:=CASE kind WHEN 'accepted' THEN 'Шофьор прие заявката'
      WHEN 'arrived' THEN 'Шофьорът пристигна' WHEN 'in_progress' THEN 'Курсът започна'
      WHEN 'completed' THEN 'Курсът приключи'
      WHEN 'cancelled' THEN CASE WHEN NEW.cancel_reason='no_driver' THEN 'Няма наличен шофьор' ELSE 'Заявката е отказана' END END;
    message:=CASE kind WHEN 'accepted' THEN 'Отвори приложението за подробности.'
      WHEN 'arrived' THEN 'Шофьорът те очаква на мястото за вземане.'
      WHEN 'in_progress' THEN 'Можеш да следиш курса в приложението.'
      WHEN 'completed' THEN 'Благодарим ти. Виж подробностите в приложението.'
      WHEN 'cancelled' THEN CASE WHEN NEW.cancel_reason='no_driver' THEN 'Опитай отново след малко.' ELSE 'Виж актуалния статус в приложението.' END END;
    deadline:=clock_timestamp()+interval '5 minutes';
  END IF;
  notification_type:=CASE WHEN kind='new_request' THEN 'new_request'
    WHEN kind='cancelled' AND NEW.cancel_reason='no_driver' THEN 'no_driver' ELSE 'trip_status' END;
  FOREACH recipient IN ARRAY COALESCE(recipients,ARRAY[]::uuid[]) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=recipient AND is_active) THEN CONTINUE; END IF;
    role_name:=CASE WHEN recipient=NEW.customer_id THEN 'CUSTOMER' ELSE 'DRIVER' END;
    payload:=jsonb_build_object('title',title,'body',CASE WHEN kind='new_request' THEN 'Има заявка близо до теб. Отвори приложението за подробности.' ELSE message END,'icon','/icon-192.png','badge','/badge-72.png',
      'tag','request-'||NEW.id||'-'||kind,'renotify',false,'requireInteraction',kind IN ('new_request','arrived'),
      'data',jsonb_build_object('request_id',NEW.id,'type',notification_type,'role',role_name,
        'status',NEW.status,'reason',NEW.cancel_reason,'expires_at',deadline));
    INSERT INTO private.push_outbox(request_id,recipient_id,event_type,payload,expires_at)
      VALUES(NEW.id,recipient,kind,payload,deadline) ON CONFLICT DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.notifications(user_id,company_id,type,title,message,data,is_read)
        VALUES(recipient,NEW.company_id,notification_type,title,message,payload->'data',false);
    END IF;
  END LOOP;
  PERFORM private.dispatch_push_outbox();
  RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_bulgaria_coordinates()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF TG_TABLE_NAME='driver_locations' THEN
  IF NOT private.in_bulgaria(NEW.latitude,NEW.longitude) THEN
   RAISE EXCEPTION 'Услугата е достъпна само на територията на България.' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='ride_quotes' THEN
  IF NOT private.in_bulgaria((NEW.payload->>'pickup_latitude')::float8,(NEW.payload->>'pickup_longitude')::float8)
   OR NOT private.in_bulgaria((NEW.payload->>'destination_latitude')::float8,(NEW.payload->>'destination_longitude')::float8) THEN
   RAISE EXCEPTION 'Услугата е достъпна само на територията на България.' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT private.in_bulgaria(NEW.pickup_latitude,NEW.pickup_longitude)
   OR NOT private.in_bulgaria(NEW.destination_latitude,NEW.destination_longitude) THEN
   RAISE EXCEPTION 'Услугата е достъпна само на територията на България.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_bulgaria_online()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.is_online AND (TG_OP='INSERT' OR NOT OLD.is_online) AND NOT EXISTS(
  SELECT 1 FROM public.driver_locations l WHERE l.driver_id=NEW.id
   AND private.in_bulgaria(l.latitude,l.longitude)
   AND l.position_at BETWEEN clock_timestamp()-interval '45 seconds' AND clock_timestamp()+interval '30 seconds'
   AND l.accuracy BETWEEN 0 AND 100) THEN
  RAISE EXCEPTION 'За онлайн режим е необходима точна, актуална GPS позиция в България.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_carrier_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE requested boolean;
BEGIN
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 requested:=NEW.legal_verified_at IS NOT NULL AND (TG_OP='INSERT' OR NEW.legal_verified_at IS DISTINCT FROM OLD.legal_verified_at);
 IF TG_OP='UPDATE' AND (NEW.legal_name,NEW.registration_id,NEW.address,NEW.permit_number,NEW.permit_expires_on) IS DISTINCT FROM
 (OLD.legal_name,OLD.registration_id,OLD.address,OLD.permit_number,OLD.permit_expires_on) THEN
  NEW.legal_verified_at:=NULL; NEW.legal_verified_by:=NULL;
 END IF;
 IF requested THEN
   IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Only the platform administrator can verify carrier identity' USING ERRCODE='42501'; END IF;
   IF nullif(btrim(NEW.legal_name),'') IS NULL OR NEW.registration_id IS NULL OR nullif(btrim(NEW.address),'') IS NULL
    OR nullif(btrim(NEW.permit_number),'') IS NULL OR NEW.permit_expires_on IS NULL OR NEW.permit_expires_on<(clock_timestamp() AT TIME ZONE 'Europe/Sofia')::date THEN RAISE EXCEPTION 'Complete valid carrier identity before verification'; END IF;
   NEW.legal_verified_at:=clock_timestamp(); NEW.legal_verified_by:=auth.uid();
 ELSIF NEW.legal_verified_at IS NULL THEN NEW.legal_verified_by:=NULL;
 ELSIF NEW.legal_verified_by IS DISTINCT FROM OLD.legal_verified_by THEN RAISE EXCEPTION 'Verification fields are protected' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_cash_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.payment_method IS DISTINCT FROM 'cash'::public.payment_method THEN
    RAISE EXCEPTION 'Only cash payment is available';
  END IF;
  RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_dispatch_documents()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF TG_TABLE_NAME='drivers' THEN
  IF NEW.is_online AND (TG_OP='INSERT' OR NOT OLD.is_online) AND NOT private.driver_documents_ready(NEW.id) THEN RAISE EXCEPTION 'Документите или сроковете на автомобила изискват проверка.'; END IF;
 ELSE
  IF OLD.status='pending' AND NEW.status='accepted' AND NOT private.driver_documents_ready(NEW.driver_id) THEN RAISE EXCEPTION 'Driver documents require review'; END IF;
 END IF;
 RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_document_file()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE owner_id uuid;
BEGIN
 -- Only approval is gated: legacy pending imports remain reviewable but cannot be approved without an actual private object.
 IF NEW.status='approved' AND (TG_OP='INSERT' OR (NEW.status,NEW.file_url,NEW.expires_at) IS DISTINCT FROM (OLD.status,OLD.file_url,OLD.expires_at)) THEN
  SELECT user_id INTO owner_id FROM public.drivers WHERE id=NEW.driver_id AND company_id=NEW.company_id;
  IF owner_id IS NULL OR NEW.file_url IS NULL OR NEW.file_url !~ ('^storage://driver-documents/'||owner_id::text||'/'||NEW.id::text||'\.(jpg|png|webp|pdf)$')
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=substr(NEW.file_url,length('storage://driver-documents/')+1)) THEN
   RAISE EXCEPTION 'Качете реалния документ в защитеното хранилище преди одобрение.'; END IF;
 END IF;
 RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_document_validity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND NOT(public.is_company_admin(NEW.company_id) OR public.is_super_admin()) THEN NEW.status:='pending'; NEW.reviewed_at:=NULL; NEW.reviewed_by:=NULL; END IF;
 IF TG_OP='UPDATE' AND (NEW.driver_id,NEW.company_id,NEW.type) IS DISTINCT FROM (OLD.driver_id,OLD.company_id,OLD.type) THEN RAISE EXCEPTION 'Document ownership is immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND NEW.file_url IS DISTINCT FROM OLD.file_url THEN NEW.status:='pending'; NEW.reviewed_by:=NULL; END IF;
 IF NEW.status='approved' THEN
  IF NOT(public.is_company_admin(NEW.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Company administrator required' USING ERRCODE='42501'; END IF;
  IF NEW.type IN ('license','insurance') AND (NEW.expires_at IS NULL OR NEW.expires_at<(now() AT TIME ZONE 'Europe/Sofia')::date) THEN RAISE EXCEPTION 'A valid expiry date is required'; END IF;
  IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
   NEW.reviewed_at:=clock_timestamp(); NEW.reviewed_by:=auth.uid();
  ELSE NEW.reviewed_at:=OLD.reviewed_at; NEW.reviewed_by:=OLD.reviewed_by; END IF;
 ELSE NEW.reviewed_at:=NULL; NEW.reviewed_by:=NULL; END IF;
 RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_driver()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
  IF NOT (public.is_super_admin() OR public.is_company_admin(OLD.company_id)) AND
    (to_jsonb(NEW)-ARRAY['is_online','status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_online','status','updated_at']) THEN
    RAISE EXCEPTION 'Driver administrative fields are protected' USING ERRCODE='42501'; END IF;
  NEW.status := CASE WHEN EXISTS(SELECT 1 FROM public.taxi_requests WHERE driver_id=NEW.id AND status IN ('accepted','arrived','in_progress'))
    THEN 'busy'::public.driver_status WHEN NEW.is_online THEN 'available'::public.driver_status ELSE 'offline'::public.driver_status END;
  RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_driver_verification()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE report jsonb; reason text;
BEGIN
 -- Trusted maintenance/test fixtures do not represent a client verification action.
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.user_id,NEW.company_id) IS DISTINCT FROM (OLD.user_id,OLD.company_id) THEN RAISE EXCEPTION 'Принадлежността на шофьора не може да се променя директно.' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.user_id AND role='DRIVER' AND company_id=NEW.company_id AND is_active) THEN
   RAISE EXCEPTION 'Шофьорът трябва да има активен профил към същата фирма.'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.document_verification_required IS DISTINCT FROM OLD.document_verification_required AND NOT NEW.document_verification_required THEN
  RAISE EXCEPTION 'Проверката на документите не може да бъде изключена.' USING ERRCODE='42501'; END IF;
 IF NEW.is_verified AND (TG_OP='INSERT' OR NOT OLD.is_verified) THEN
  IF NOT(public.is_company_admin(NEW.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Нямате право да верифицирате шофьор.' USING ERRCODE='42501'; END IF;
  report:=private.driver_verification_report(NEW.id,NEW.vehicle_id);
  IF NOT (report->>'can_verify')::boolean THEN
   SELECT string_agg(item->>'message',' ') INTO reason FROM jsonb_array_elements(report->'blockers') item;
   RAISE EXCEPTION '%',reason;
  END IF;
  NEW.document_verification_required:=true;
 END IF;
 IF TG_OP='UPDATE' AND NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
  IF EXISTS(SELECT 1 FROM public.taxi_requests WHERE driver_id=NEW.id AND status IN ('accepted','arrived','in_progress')) THEN
   RAISE EXCEPTION 'Автомобилът не може да се сменя по време на активен курс.'; END IF;
  IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=NEW.vehicle_id AND company_id=NEW.company_id AND is_active) THEN
   RAISE EXCEPTION 'Изберете активен автомобил от същата фирма.'; END IF;
 END IF;
 IF NEW.is_online AND (TG_OP='INSERT' OR NOT OLD.is_online) AND NOT NEW.is_verified THEN
  RAISE EXCEPTION 'Профилът очаква верификация от администратор.'; END IF;
 RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_legacy_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE c public.companies; v public.vehicle_types; b numeric; k numeric; m numeric;
BEGIN
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 IF NEW.customer_id IS DISTINCT FROM auth.uid() OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role='CUSTOMER') THEN
 RAISE EXCEPTION 'Active customer required' USING ERRCODE='42501'; END IF;
 IF NEW.status<>'pending' OR NEW.driver_id IS NOT NULL OR NEW.payment_status<>'pending'
 OR NEW.final_price IS NOT NULL THEN RAISE EXCEPTION 'A new ride must be pending and unassigned'; END IF;
 IF NOT (NEW.pickup_latitude BETWEEN -90 AND 90 AND NEW.pickup_longitude BETWEEN -180 AND 180
 AND NEW.destination_latitude BETWEEN -90 AND 90 AND NEW.destination_longitude BETWEEN -180 AND 180)
 OR NEW.destination_latitude IS NULL OR NEW.destination_longitude IS NULL
 OR NEW.estimated_distance_km IS NULL OR NOT(NEW.estimated_distance_km BETWEEN 0 AND 3000)
 OR NEW.estimated_duration_min IS NULL OR NOT(NEW.estimated_duration_min BETWEEN 0 AND 3000) THEN RAISE EXCEPTION 'Invalid route'; END IF;
 SELECT * INTO c FROM public.companies WHERE id=NEW.company_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company unavailable'; END IF;
 SELECT * INTO v FROM public.vehicle_types WHERE id=NEW.vehicle_type_id AND company_id=c.id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle type unavailable'; END IF;
 b:=round(c.base_fare*v.multiplier,2);k:=round(c.price_per_km*v.multiplier,2);m:=round(c.price_per_minute*v.multiplier,2);
 NEW.estimated_price:=b+round(NEW.estimated_distance_km::numeric*k,2)+round(NEW.estimated_duration_min*m,2);
 NEW.fare_breakdown:=jsonb_build_object('source','legacy_client_route','total',NEW.estimated_price);
 NEW.created_at:=now();NEW.requested_at:=now();NEW.updated_at:=now();
 NEW.accepted_at:=NULL;NEW.arrived_at:=NULL;NEW.started_at:=NULL;NEW.completed_at:=NULL;NEW.cancelled_at:=NULL;NEW.cancelled_by:=NULL;NEW.cancel_reason:=NULL;
 RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_location()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT (NEW.latitude BETWEEN -90 AND 90 AND NEW.longitude BETWEEN -180 AND 180)
    OR NEW.accuracy < 0 OR NEW.accuracy > 1000 THEN RAISE EXCEPTION 'Invalid GPS coordinates or accuracy'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=NEW.driver_id AND company_id=NEW.company_id) THEN
    RAISE EXCEPTION 'Driver/company mismatch' USING ERRCODE='42501'; END IF;
  NEW.position_at := COALESCE(NEW.position_at,clock_timestamp());
  IF NEW.position_at > clock_timestamp()+interval '30 seconds' OR NEW.position_at < clock_timestamp()-interval '60 seconds' THEN
    RAISE EXCEPTION 'GPS fix is stale'; END IF;
  IF TG_OP='UPDATE' AND OLD.position_at > NEW.position_at THEN RETURN NULL; END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;
  IF public.is_company_admin(OLD.company_id) THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.id <> OLD.id
      OR (NEW.role IS DISTINCT FROM OLD.role AND NEW.role NOT IN ('CUSTOMER','DRIVER'))
      OR OLD.role = 'SUPER_ADMIN' THEN RAISE EXCEPTION 'Forbidden profile administration' USING ERRCODE='42501'; END IF;
  ELSIF (to_jsonb(NEW) - ARRAY['first_name','last_name','phone','avatar_url','language','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['first_name','last_name','phone','avatar_url','language','updated_at']) THEN
    RAISE EXCEPTION 'Only personal profile fields may be edited' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE d public.drivers;
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','driver_id','accepted_at','arrived_at','started_at','completed_at','cancelled_at','cancelled_by','cancel_reason','final_price','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','driver_id','accepted_at','arrived_at','started_at','completed_at','cancelled_at','cancelled_by','cancel_reason','final_price','updated_at']) THEN
    RAISE EXCEPTION 'Ride identity, route and quote are immutable' USING ERRCODE='42501'; END IF;
  IF NEW.status = OLD.status THEN
    IF (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN RAISE EXCEPTION 'No ride transition requested'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'Ride is already closed'; END IF;
  IF NEW.status='cancelled' THEN
    IF OLD.status='in_progress' AND NOT(public.is_super_admin() OR public.is_company_admin(OLD.company_id)) THEN
      RAISE EXCEPTION 'An active trip must be completed by the driver'; END IF;
    NEW.driver_id:=OLD.driver_id;
    NEW.cancelled_at:=now();
    NEW.cancelled_by:=CASE WHEN auth.uid()=OLD.customer_id THEN 'customer'::public.cancelled_by
      WHEN public.is_driver(OLD.driver_id) THEN 'driver'::public.cancelled_by ELSE 'admin'::public.cancelled_by END;
  ELSE
    IF NOT ((OLD.status='pending' AND NEW.status='accepted') OR (OLD.status='accepted' AND NEW.status='arrived')
      OR (OLD.status='arrived' AND NEW.status='in_progress') OR (OLD.status='in_progress' AND NEW.status='completed')) THEN
      RAISE EXCEPTION 'Invalid ride status transition'; END IF;
    IF NOT public.is_driver(NEW.driver_id) THEN RAISE EXCEPTION 'Only the assigned driver can progress this ride' USING ERRCODE='42501'; END IF;
    IF OLD.status='pending' THEN
      SELECT * INTO d FROM public.drivers WHERE id=NEW.driver_id FOR UPDATE;
      IF d.company_id<>NEW.company_id OR NOT d.is_online OR NOT d.is_verified THEN RAISE EXCEPTION 'Driver must be verified and online'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.driver_locations WHERE driver_id=d.id AND updated_at>now()-interval '45 seconds') THEN RAISE EXCEPTION 'Driver location is stale'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=d.vehicle_id AND company_id=d.company_id AND is_active AND vehicle_type_id=NEW.vehicle_type_id) THEN RAISE EXCEPTION 'Assign an active vehicle matching this ride type'; END IF;
      NEW.accepted_at:=now();
    ELSIF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN RAISE EXCEPTION 'Driver reassignment is forbidden'; END IF;
    IF NEW.status='arrived' THEN NEW.arrived_at:=now(); END IF;
    IF NEW.status='in_progress' THEN NEW.started_at:=now(); END IF;
    IF NEW.status='completed' THEN NEW.completed_at:=now(); END IF;
  END IF;
  -- Clients cannot forge timeline, payment or final amount during a transition.
  IF NEW.status<>'accepted' THEN NEW.accepted_at:=OLD.accepted_at; END IF;
  IF NEW.status<>'arrived' THEN NEW.arrived_at:=OLD.arrived_at; END IF;
  IF NEW.status<>'in_progress' THEN NEW.started_at:=OLD.started_at; END IF;
  IF NEW.status<>'completed' THEN NEW.completed_at:=OLD.completed_at; END IF;
  IF NEW.status<>'cancelled' THEN NEW.cancelled_at:=OLD.cancelled_at; NEW.cancelled_by:=OLD.cancelled_by; NEW.cancel_reason:=OLD.cancel_reason; END IF;
  NEW.final_price:=CASE WHEN NEW.status='completed' THEN OLD.estimated_price ELSE OLD.final_price END;
  RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.guard_request_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF OLD.status='pending' AND NEW.status='accepted' THEN
    IF clock_timestamp() >= COALESCE(OLD.expires_at,OLD.created_at+interval '2 minutes') THEN
      RAISE EXCEPTION 'Заявката е изтекла. Обнови списъка.' USING ERRCODE='P0001';
    END IF;
    IF current_user NOT IN ('postgres','service_role','supabase_admin')
      AND NOT private.can_receive_request(OLD.company_id,OLD.vehicle_type_id,OLD.pickup_latitude,OLD.pickup_longitude) THEN
      RAISE EXCEPTION 'Driver is outside the dispatch area or unavailable' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.in_bulgaria(p_lat double precision, p_lng double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 SELECT COALESCE(p_lat BETWEEN 41.2 AND 44.3 AND p_lng BETWEEN 22.3 AND 28.7
 AND public.ST_Covers(public.ST_SetSRID(public.ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[26.333359,41.713036],[26.294911,41.710323],[26.273931,41.714897],[26.261012,41.723062],[26.23445,41.745825],[26.226182,41.749675],[26.211816,41.750476],[26.189905,41.734689],[26.135128,41.733397],[26.108359,41.727893],[26.081488,41.711512],[26.074046,41.709135],[26.067225,41.708851],[26.060507,41.7073],[26.053686,41.701513],[26.048105,41.689084],[26.047485,41.674615],[26.050275,41.660456],[26.055029,41.648751],[26.05949,41.643777],[26.066915,41.635496],[26.081178,41.630457],[26.095234,41.62839],[26.106706,41.624282],[26.115284,41.616634],[26.121072,41.608211],[26.13027,41.582683],[26.130994,41.575138],[26.129443,41.559377],[26.1312,41.552659],[26.136781,41.549196],[26.152491,41.547026],[26.158072,41.542323],[26.163136,41.529146],[26.16448,41.517725],[26.16293,41.50646],[26.159312,41.493799],[26.147634,41.484756],[26.145877,41.478038],[26.156212,41.460416],[26.160449,41.455869],[26.174299,41.445998],[26.177399,41.439952],[26.175642,41.431891],[26.170578,41.429565],[26.164273,41.42786],[26.159002,41.421814],[26.14784,41.396906],[26.132441,41.371533],[26.120865,41.357787],[26.114664,41.355203],[26.107326,41.356598],[26.021853,41.341664],[26.008934,41.336806],[25.982269,41.323267],[25.959635,41.314999],[25.948576,41.313965],[25.93514,41.315929],[25.921187,41.316032],[25.896279,41.306265],[25.882017,41.304043],[25.86269,41.310089],[25.833337,41.334636],[25.811013,41.341044],[25.800781,41.338046],[25.763471,41.319029],[25.728744,41.317066],[25.717479,41.31412],[25.70518,41.307299],[25.698049,41.301925],[25.691227,41.298411],[25.679962,41.29717],[25.670453,41.299186],[25.649576,41.308487],[25.639758,41.311071],[25.551494,41.31567],[25.537955,41.312208],[25.530203,41.302751],[25.523692,41.291693],[25.514907,41.283476],[25.505089,41.280582],[25.497337,41.281202],[25.489482,41.283063],[25.479096,41.283786],[25.453464,41.280427],[25.285722,41.239396],[25.262261,41.238104],[25.23911,41.240895],[25.21968,41.249731],[25.177098,41.293863],[25.157875,41.30611],[25.153847,41.307535],[25.116534,41.320735],[25.112606,41.324145],[25.104855,41.334067],[25.101858,41.336651],[25.096793,41.336703],[25.08036,41.334067],[24.916959,41.386364],[24.886367,41.400627],[24.872931,41.401867],[24.863009,41.400316],[24.842132,41.394735],[24.803271,41.392668],[24.800171,41.379336],[24.802858,41.361921],[24.794279,41.3474],[24.774436,41.348072],[24.752628,41.362748],[24.718728,41.395717],[24.699195,41.408946],[24.680901,41.415509],[24.661264,41.41768],[24.638217,41.41768],[24.644314,41.427653],[24.609484,41.42724],[24.595842,41.429772],[24.580442,41.440521],[24.579719,41.44419],[24.582199,41.455249],[24.581062,41.460209],[24.577238,41.463568],[24.56773,41.468116],[24.564113,41.471062],[24.558738,41.476849],[24.553571,41.480777],[24.549436,41.485428],[24.546543,41.493644],[24.543339,41.521343],[24.530936,41.547543],[24.510162,41.56165],[24.481327,41.553227],[24.459209,41.549506],[24.438849,41.527699],[24.423966,41.525218],[24.402882,41.527854],[24.387483,41.526665],[24.353893,41.519121],[24.345005,41.518397],[24.318236,41.520774],[24.309554,41.519792],[24.303043,41.51695],[24.296119,41.515245],[24.286817,41.517622],[24.28506,41.523151],[24.287334,41.531626],[24.286403,41.54036],[24.26687,41.549765],[24.250747,41.563459],[24.23328,41.561805],[24.214366,41.555759],[24.197698,41.547711],[24.19628,41.547026],[24.181604,41.537362],[24.17747,41.531006],[24.173129,41.515297],[24.170235,41.511576],[24.162793,41.512041],[24.158453,41.51633],[24.154008,41.522118],[24.146257,41.526769],[24.116491,41.533383],[24.076597,41.536019],[24.047348,41.525735],[24.049829,41.493644],[24.052516,41.471475],[24.051999,41.463],[24.045901,41.455455],[24.034739,41.451321],[24.022854,41.453078],[24.000736,41.464137],[23.997119,41.457006],[23.992365,41.454628],[23.986887,41.453698],[23.981306,41.450856],[23.964666,41.43835],[23.949887,41.437575],[23.902861,41.463517],[23.894799,41.464344],[23.867721,41.445482],[23.851598,41.439591],[23.830927,41.435611],[23.80974,41.433803],[23.792067,41.434475],[23.777081,41.429049],[23.754446,41.400678],[23.73822,41.397474],[23.705354,41.403159],[23.672177,41.402952],[23.65285,41.397629],[23.627736,41.378509],[23.624847,41.377094],[23.612439,41.371016],[23.578953,41.371998],[23.513014,41.397733],[23.414519,41.399903],[23.395502,41.395252],[23.365116,41.378561],[23.347236,41.371223],[23.326049,41.369311],[23.31561,41.376855],[23.306205,41.388379],[23.287705,41.398198],[23.269928,41.397268],[23.24657,41.389723],[23.224246,41.379026],[23.209777,41.368587],[23.206366,41.360939],[23.204816,41.342697],[23.199545,41.332982],[23.190656,41.326057],[23.179701,41.321355],[23.15717,41.316342],[23.115209,41.312673],[22.916978,41.335773],[22.940852,41.349829],[22.94447,41.368432],[22.939406,41.389413],[22.937339,41.410755],[22.940542,41.416905],[22.952118,41.427705],[22.954598,41.432408],[22.953358,41.438195],[22.94757,41.448376],[22.946227,41.453233],[22.943599,41.523201],[22.943023,41.538551],[22.94788,41.555139],[22.948707,41.560978],[22.946434,41.567748],[22.936925,41.57891],[22.933721,41.584595],[22.932068,41.597953],[22.932998,41.612345],[22.936098,41.626168],[22.940852,41.63764],[22.945813,41.641077],[22.961523,41.644488],[22.967001,41.647046],[22.970101,41.652032],[22.976613,41.666553],[22.985435,41.677198],[22.998627,41.693115],[23.009582,41.71637],[23.008859,41.739934],[22.991185,41.760992],[22.98054,41.764739],[22.956872,41.765669],[22.945917,41.769338],[22.939716,41.776702],[22.918322,41.814348],[22.907676,41.848584],[22.901372,41.860418],[22.896721,41.864448],[22.885042,41.869151],[22.882088,41.871618],[22.880804,41.872691],[22.878221,41.880261],[22.878634,41.895015],[22.877084,41.902043],[22.866335,41.924884],[22.858894,41.94788],[22.857137,41.971884],[22.85476,41.982632],[22.846905,41.993484],[22.846595,41.993639],[22.845768,42.006869],[22.845621,42.007408],[22.843701,42.014465],[22.838223,42.019478],[22.826958,42.025085],[22.821273,42.025369],[22.805977,42.02139],[22.798949,42.021235],[22.791094,42.025808],[22.787684,42.032578],[22.785306,42.039141],[22.780862,42.043171],[22.77063,42.043998],[22.725052,42.042474],[22.718437,42.044463],[22.713993,42.048623],[22.710272,42.05299],[22.705725,42.055935],[22.675856,42.060612],[22.627177,42.079127],[22.617771,42.082704],[22.531058,42.129109],[22.510181,42.144793],[22.506939,42.148927],[22.494678,42.164559],[22.481449,42.193317],[22.443622,42.214427],[22.345023,42.313439],[22.364144,42.320984],[22.405795,42.321552],[22.423985,42.325893],[22.438454,42.340052],[22.454371,42.376768],[22.46977,42.391703],[22.485066,42.397155],[22.497572,42.399196],[22.508838,42.404932],[22.519483,42.420926],[22.533125,42.45759],[22.536536,42.47839],[22.532505,42.493402],[22.532505,42.493557],[22.524857,42.507665],[22.512145,42.519189],[22.481449,42.535622],[22.429669,42.571408],[22.425328,42.572855],[22.428842,42.592776],[22.441318,42.632891],[22.444552,42.64329],[22.449203,42.667965],[22.442072,42.681685],[22.468116,42.718324],[22.481449,42.727677],[22.482586,42.730675],[22.482896,42.733775],[22.482586,42.736824],[22.481449,42.739821],[22.466566,42.748529],[22.45313,42.763592],[22.429359,42.806122],[22.425845,42.809843],[22.427395,42.813615],[22.430446,42.817077],[22.436801,42.824286],[22.445482,42.830178],[22.470907,42.840125],[22.481449,42.84674],[22.497055,42.864413],[22.506047,42.870123],[22.519793,42.870356],[22.53757,42.868341],[22.544494,42.871389],[22.544785,42.871706],[22.549972,42.877358],[22.563615,42.884283],[22.5909,42.886892],[22.666244,42.871932],[22.69663,42.87741],[22.727015,42.886892],[22.738798,42.897383],[22.739579,42.898858],[22.745516,42.910069],[22.763189,42.958645],[22.76939,42.97128],[22.776418,42.979729],[22.788097,42.984897],[22.815796,42.989703],[22.828818,42.993449],[22.828921,42.993449],[22.829025,42.993501],[22.829025,42.993656],[22.842254,43.007505],[22.884215,43.036651],[22.889486,43.044376],[22.896721,43.062721],[22.901682,43.069749],[22.910157,43.075279],[22.927107,43.081144],[22.935271,43.085562],[22.955632,43.108274],[22.974029,43.141192],[22.984571,43.174627],[22.982902,43.187318],[22.981367,43.198992],[22.964727,43.204418],[22.915531,43.212247],[22.897754,43.220335],[22.883802,43.230592],[22.857343,43.256947],[22.833159,43.274647],[22.826958,43.28139],[22.823857,43.289297],[22.820756,43.307539],[22.817139,43.315497],[22.80453,43.328984],[22.73301,43.381513],[22.724343,43.38606],[22.719367,43.388671],[22.702934,43.394045],[22.693219,43.394872],[22.674202,43.394148],[22.664694,43.396732],[22.658926,43.401295],[22.656529,43.403192],[22.645367,43.420297],[22.637822,43.426369],[22.62852,43.428255],[22.606919,43.427402],[22.596274,43.429159],[22.586766,43.43443],[22.57271,43.44815],[22.565785,43.453344],[22.532609,43.464842],[22.518863,43.474247],[22.509354,43.493341],[22.490647,43.540883],[22.478452,43.559229],[22.477625,43.564164],[22.478658,43.569176],[22.481449,43.574111],[22.482689,43.576695],[22.483103,43.579279],[22.482689,43.581734],[22.481449,43.584137],[22.478142,43.587573],[22.477108,43.591294],[22.478142,43.594911],[22.481449,43.598529],[22.481759,43.598942],[22.481966,43.599459],[22.481759,43.599975],[22.481449,43.600647],[22.473801,43.612998],[22.472871,43.635942],[22.466256,43.64912],[22.455921,43.656406],[22.426465,43.668214],[22.41396,43.676663],[22.404865,43.687179],[22.396906,43.699401],[22.390498,43.712449],[22.386054,43.725498],[22.385848,43.733817],[22.389568,43.750509],[22.388535,43.758286],[22.362593,43.780843],[22.349467,43.807921],[22.354738,43.829703],[22.367554,43.852751],[22.377063,43.883524],[22.379026,43.913496],[22.382024,43.918561],[22.391945,43.931867],[22.394529,43.936337],[22.396803,43.951944],[22.39732,43.980934],[22.399594,43.993336],[22.411789,44.006927],[22.43432,44.013955],[22.465885,44.017624],[22.481449,44.019433],[22.50367,44.019898],[22.514935,44.030285],[22.522583,44.044703],[22.534159,44.057157],[22.554623,44.062428],[22.57519,44.061394],[22.592967,44.063926],[22.604749,44.079378],[22.604646,44.088163],[22.598134,44.109298],[22.597101,44.119065],[22.599065,44.130331],[22.6094,44.159941],[22.607953,44.159993],[22.605989,44.163145],[22.604852,44.168468],[22.606196,44.174566],[22.608573,44.175858],[22.624799,44.189397],[22.639992,44.207329],[22.648777,44.213995],[22.69164,44.228435],[22.906436,44.122889],[22.942609,44.111469],[22.988085,44.107025],[23.008307,44.100446],[23.030976,44.093072],[23.040071,44.062325],[23.023018,44.031629],[22.988085,44.017676],[22.966277,44.015557],[22.926486,44.006152],[22.905816,44.003982],[22.885869,43.994525],[22.874707,43.972046],[22.850522,43.896986],[22.851039,43.874352],[22.863441,43.855412],[22.888763,43.839522],[22.919562,43.834225],[23.052551,43.84282],[23.131849,43.847945],[23.161924,43.857324],[23.196961,43.86275],[23.234478,43.877297],[23.325151,43.886592],[23.484695,43.880604],[23.592699,43.837429],[23.620854,43.83401],[23.636107,43.832158],[23.720753,43.845826],[23.742871,43.8427],[23.799922,43.818463],[24.149606,43.75472],[24.159383,43.752938],[24.336705,43.759251],[24.358234,43.760017],[24.375494,43.763867],[24.431201,43.794176],[24.466341,43.802418],[24.500137,43.799498],[24.661763,43.755657],[24.705603,43.743765],[24.752628,43.738804],[24.963675,43.749605],[25.0816,43.718935],[25.211308,43.711881],[25.252339,43.704646],[25.285405,43.690391],[25.28872,43.688962],[25.323033,43.669713],[25.35962,43.654287],[25.403131,43.65005],[25.426075,43.654391],[25.467417,43.667749],[25.48245,43.669715],[25.488759,43.67054],[25.533821,43.668679],[25.556558,43.670359],[25.575059,43.677387],[25.593869,43.680668],[25.616503,43.687748],[25.637897,43.697282],[25.653503,43.708134],[25.671384,43.717359],[25.732948,43.718781],[25.739596,43.718935],[25.781144,43.732009],[25.804399,43.759914],[25.806259,43.763661],[25.839332,43.788439],[25.869304,43.800893],[25.916433,43.844379],[25.924495,43.858616],[25.934003,43.870321],[26.054306,43.934322],[26.061644,43.949773],[26.079317,43.969049],[26.116214,43.998866],[26.150734,44.012405],[26.231453,44.027495],[26.310518,44.052609],[26.332335,44.054926],[26.415791,44.063789],[26.614168,44.084855],[26.647758,44.093382],[26.667808,44.095087],[26.677317,44.097051],[26.697212,44.106094],[26.708685,44.10811],[26.753695,44.10811],[26.789455,44.115965],[26.884126,44.156531],[27.001535,44.165109],[27.027476,44.177046],[27.100237,44.14449],[27.205553,44.129246],[27.226741,44.120719],[27.251132,44.122373],[27.252662,44.121519],[27.269012,44.112399],[27.26431,44.089765],[27.285342,44.072453],[27.341669,44.053074],[27.353555,44.045271],[27.372882,44.020725],[27.383837,44.015092],[27.574523,44.016281],[27.633434,44.029768],[27.656275,44.023877],[27.676119,43.993543],[27.682515,43.987256],[27.721698,43.94874],[27.787327,43.960419],[27.85647,43.988634],[27.912074,43.993336],[27.912074,43.993233],[27.935845,43.964398],[27.98101,43.84934],[28.014806,43.830039],[28.221254,43.761981],[28.434574,43.735213],[28.57838,43.741278],[28.576182,43.727525],[28.57309,43.606147],[28.575531,43.593329],[28.585704,43.575832],[28.595876,43.563707],[28.602712,43.55272],[28.603526,43.538153],[28.594574,43.512519],[28.578461,43.48078],[28.560313,43.453843],[28.545177,43.442532],[28.535004,43.438625],[28.488617,43.40644],[28.479259,43.396796],[28.473888,43.384263],[28.473155,43.366848],[28.459483,43.380683],[28.414561,43.398871],[28.404959,43.40469],[28.393809,43.414293],[28.368663,43.42178],[28.321625,43.42829],[28.299164,43.425035],[28.261567,43.410956],[28.243175,43.407782],[28.177989,43.40998],[28.157237,43.407782],[28.118826,43.391547],[28.091563,43.363959],[28.087006,43.355251],[28.031098,43.248969],[28.017589,43.232733],[28.000173,43.223212],[27.931977,43.209784],[27.920584,43.204047],[27.913829,43.202338],[27.903982,43.202338],[27.903982,43.195502],[27.938731,43.1765],[27.945567,43.16885],[27.944347,43.157131],[27.925141,43.113593],[27.911388,43.065172],[27.904307,43.055854],[27.895518,43.049262],[27.887706,43.042141],[27.883556,43.030992],[27.885427,43.008612],[27.900401,42.962877],[27.903982,42.942288],[27.898448,42.874661],[27.903982,42.859687],[27.883962,42.848375],[27.883556,42.831936],[27.891612,42.81037],[27.897146,42.784003],[27.897146,42.736233],[27.894705,42.717475],[27.892263,42.710517],[27.841075,42.708319],[27.787364,42.715155],[27.743175,42.716051],[27.732677,42.714504],[27.725597,42.708482],[27.719005,42.694566],[27.715831,42.683743],[27.71697,42.674506],[27.724132,42.666978],[27.739513,42.661078],[27.712738,42.65766],[27.6692,42.643704],[27.646739,42.64057],[27.628429,42.628974],[27.630382,42.602729],[27.641449,42.574774],[27.650157,42.558051],[27.634044,42.563707],[27.540863,42.565497],[27.511485,42.553046],[27.498546,42.532457],[27.491466,42.507758],[27.480154,42.482896],[27.46225,42.489569],[27.452891,42.480129],[27.45338,42.465237],[27.465668,42.455634],[27.462087,42.448717],[27.461111,42.443549],[27.465668,42.42829],[27.468435,42.435777],[27.4699,42.437079],[27.469412,42.437201],[27.465668,42.441352],[27.472667,42.461859],[27.503917,42.437323],[27.514171,42.435126],[27.526378,42.443671],[27.534434,42.455268],[27.544444,42.460028],[27.562022,42.448188],[27.571056,42.458482],[27.5796,42.457221],[27.587738,42.451483],[27.595551,42.448188],[27.60963,42.451158],[27.619477,42.455878],[27.629405,42.458645],[27.643321,42.455634],[27.642833,42.450507],[27.641775,42.44953],[27.639822,42.449774],[27.636485,42.448188],[27.642426,42.430894],[27.652192,42.418524],[27.667735,42.416083],[27.691661,42.42829],[27.693533,42.418891],[27.699067,42.413886],[27.707856,42.412746],[27.719005,42.4147],[27.719005,42.407213],[27.713227,42.405951],[27.698009,42.400377],[27.705414,42.390611],[27.709646,42.388129],[27.719005,42.386705],[27.709483,42.376776],[27.708344,42.363105],[27.714366,42.349189],[27.725841,42.338935],[27.740408,42.334296],[27.752126,42.335395],[27.764496,42.338324],[27.780447,42.338935],[27.780447,42.332709],[27.774587,42.327216],[27.774425,42.321723],[27.779145,42.316311],[27.787852,42.310981],[27.76295,42.2956],[27.75115,42.277045],[27.75587,42.25849],[27.780447,42.243354],[27.776052,42.240668],[27.775645,42.239651],[27.773692,42.235907],[27.809744,42.218411],[27.815278,42.211982],[27.819998,42.204657],[27.831391,42.195014],[27.8449,42.186103],[27.856212,42.181301],[27.854177,42.177924],[27.85141,42.170111],[27.849376,42.16706],[27.87908,42.154242],[27.886729,42.147366],[27.903982,42.119818],[27.957774,42.094306],[27.964366,42.084621],[27.972667,42.075385],[27.986583,42.072089],[27.982432,42.061103],[27.987315,42.051744],[27.996918,42.044013],[28.007009,42.037909],[28.007579,42.032904],[28.006114,42.031562],[28.003429,42.03148],[28.000173,42.030463],[28.011567,42.021389],[28.019054,42.00845],[28.020356,41.994574],[28.013845,41.982652],[28.016775,41.972561],[27.98101,41.978524],[27.96592,41.982141],[27.917035,41.977904],[27.903392,41.981056],[27.876934,41.99072],[27.852232,41.995448],[27.843034,41.995758],[27.824017,41.993484],[27.819935,41.994699],[27.815955,41.995138],[27.811925,41.994699],[27.807997,41.993484],[27.804948,41.983433],[27.804897,41.969894],[27.802726,41.96005],[27.818281,41.952867],[27.815335,41.946795],[27.80283,41.943074],[27.789807,41.942686],[27.776165,41.946123],[27.723971,41.967595],[27.687074,41.968602],[27.609301,41.953487],[27.606873,41.943513],[27.603359,41.93863],[27.598088,41.938604],[27.590543,41.942893],[27.582378,41.934883],[27.572198,41.929845],[27.550752,41.924212],[27.552096,41.921835],[27.554886,41.920336],[27.557935,41.91907],[27.560674,41.917675],[27.55747,41.915505],[27.551269,41.913102],[27.548892,41.91088],[27.562741,41.906435],[27.546411,41.901164],[27.533182,41.908063],[27.509463,41.933178],[27.494321,41.942841],[27.420837,41.973718],[27.39686,41.989324],[27.374845,42.008703],[27.332471,42.057434],[27.305289,42.077588],[27.273353,42.091747],[27.238213,42.097922],[27.216405,42.095623],[27.203796,42.08813],[27.181576,42.065883],[27.178992,42.061878],[27.178165,42.058364],[27.173824,42.057072],[27.149588,42.061826],[27.127212,42.062576],[27.11605,42.061826],[27.10065,42.071102],[27.0837,42.078415],[27.06551,42.082704],[27.047903,42.08292],[27.046545,42.082936],[27.022619,42.073893],[27.000398,42.04281],[26.981071,42.032862],[26.96717,42.028495],[26.95823,42.018237],[26.950065,42.006171],[26.938903,41.996223],[26.930221,41.994518],[26.911463,41.996792],[26.901076,41.993484],[26.890327,41.985423],[26.881129,41.985526],[26.871724,41.988136],[26.860768,41.987903],[26.85002,41.982865],[26.837899,41.97522],[26.827695,41.968783],[26.819427,41.965657],[26.80842,41.967879],[26.78992,41.979945],[26.780566,41.983433],[26.768578,41.980772],[26.746977,41.964494],[26.736745,41.958965],[26.717573,41.957311],[26.623573,41.969041],[26.605693,41.967414],[26.589467,41.958758],[26.560632,41.935684],[26.553293,41.931576],[26.547092,41.926899],[26.542958,41.920362],[26.544715,41.916435],[26.556807,41.91075],[26.559805,41.90734],[26.558978,41.901733],[26.55474,41.892948],[26.553604,41.887703],[26.552895,41.881643],[26.552053,41.874448],[26.547816,41.856283],[26.539548,41.83799],[26.526112,41.824244],[26.478363,41.813289],[26.375527,41.816622],[26.334185,41.789543],[26.320026,41.765462],[26.316305,41.743758],[26.32323,41.723682],[26.333359,41.713036]]]}'),4326),
 public.ST_SetSRID(public.ST_MakePoint(p_lng,p_lat),4326)),false);
$function$

CREATE OR REPLACE FUNCTION private.maintain_dispatch()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.expire_stale_requests();
  PERFORM private.dispatch_push_outbox();
END $function$

CREATE OR REPLACE FUNCTION private.nearby_cars(p_lat double precision, p_lng double precision, p_type uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); company uuid; allowed boolean; result jsonb;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND role='CUSTOMER' AND is_active) THEN RAISE EXCEPTION 'Active customer required' USING ERRCODE='42501'; END IF;
 IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 41 AND 45 OR p_lng NOT BETWEEN 22 AND 29 OR private.in_bulgaria(p_lat,p_lng) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Location outside service area'; END IF;
 INSERT INTO private.nearby_read_limits VALUES(actor,clock_timestamp()) ON CONFLICT(user_id) DO UPDATE SET last_read=EXCLUDED.last_read WHERE private.nearby_read_limits.last_read<clock_timestamp()-interval '8 seconds' RETURNING true INTO allowed;
 IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Retry later' USING ERRCODE='P0001'; END IF;
 SELECT COALESCE(p.company_id,(SELECT c.id FROM public.companies c WHERE c.is_active ORDER BY c.created_at,c.id LIMIT 1)) INTO company FROM public.profiles p WHERE p.id=actor;
 SELECT COALESCE(jsonb_agg(to_jsonb(cars)),'[]'::jsonb) INTO result FROM (
 SELECT md5(d.id::text||actor::text||current_date::text) AS token,
 round(l.latitude::numeric,4)::double precision AS lat,round(l.longitude::numeric,4)::double precision AS lng,
 l.heading,l.speed,greatest(l.accuracy,20) AS accuracy,l.position_at,l.updated_at
 FROM public.drivers d JOIN public.vehicles v ON v.id=d.vehicle_id
 JOIN public.driver_locations l ON l.driver_id=d.id
 CROSS JOIN LATERAL private.eligible_drivers(company,v.vehicle_type_id,p_lat,p_lng,d.user_id) eligible
 WHERE d.company_id=company AND eligible.driver_id=d.id AND (p_type IS NULL OR v.vehicle_type_id=p_type)
 AND public.st_dwithin(l.geo,public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography,1500)
 ORDER BY l.geo OPERATOR(public.<->) public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography LIMIT 12
 ) cars;
 RETURN jsonb_build_object('cars',result,'sampled_at',clock_timestamp());
END $function$

CREATE OR REPLACE FUNCTION private.record_driver_money(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid DEFAULT NULL::uuid, p_reference_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF p_kind='confirmation' AND EXISTS(SELECT 1 FROM public.driver_money_entries WHERE id=p_reference_id AND kind='income') THEN
  RAISE EXCEPTION 'Use the verified confirmation API with an evidence source' USING ERRCODE='42501';
 END IF;
 RETURN private.record_driver_money_core(p_id,p_kind,p_amount,p_note,p_request_id,p_reference_id);
END $function$

CREATE OR REPLACE FUNCTION private.record_driver_money_core(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid DEFAULT NULL::uuid, p_reference_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.drivers; original public.driver_money_entries; existing public.driver_money_entries; uid uuid:=auth.uid(); cid uuid; did uuid; owner_id uuid; amt numeric;
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('income','expense','handover','confirmation','reversal') OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid entry'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO existing FROM public.driver_money_entries WHERE id=p_id;
 IF FOUND THEN
  IF existing.actor_id=uid AND existing.kind=p_kind AND existing.note=btrim(p_note) AND existing.request_id IS NOT DISTINCT FROM p_request_id AND existing.reference_id IS NOT DISTINCT FROM p_reference_id
   AND (p_kind IN ('confirmation','reversal') OR existing.amount=p_amount) THEN RETURN p_id; END IF;
  RAISE EXCEPTION 'Operation ID already used' USING ERRCODE='23505';
 END IF;
 IF p_kind IN ('confirmation','reversal') THEN
  SELECT * INTO original FROM public.driver_money_entries WHERE id=p_reference_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE reference_id=original.id AND kind='reversal') THEN RAISE EXCEPTION 'Entry already reversed'; END IF;
  IF p_kind='confirmation' THEN
   IF original.kind NOT IN ('handover','income') OR original.actor_id=uid OR NOT(public.is_company_admin(original.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Only a different company administrator can confirm receipt' USING ERRCODE='42501'; END IF;
  ELSE
   IF original.actor_id IS DISTINCT FROM uid OR original.kind NOT IN ('income','expense','handover') OR NOT public.is_driver(original.driver_id) THEN RAISE EXCEPTION 'Only your own unconfirmed entry can be reversed' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE reference_id=original.id AND kind='confirmation') THEN RAISE EXCEPTION 'Confirmed handover cannot be reversed'; END IF;
  END IF;
  cid:=original.company_id;did:=original.driver_id;owner_id:=original.driver_user_id;amt:=original.amount;
  IF p_request_id IS NOT NULL THEN RAISE EXCEPTION 'Reference operation cannot set a request'; END IF;
 ELSE
  IF p_reference_id IS NOT NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount>1000000 OR p_amount<>round(p_amount,2) THEN RAISE EXCEPTION 'Invalid amount or reference'; END IF;
  SELECT * INTO d FROM public.drivers WHERE user_id=uid;
  IF NOT FOUND OR NOT public.is_driver(d.id) THEN RAISE EXCEPTION 'Driver account required' USING ERRCODE='42501'; END IF;
  cid:=d.company_id;did:=d.id;owner_id:=uid;amt:=p_amount;
  IF p_request_id IS NOT NULL AND (p_kind<>'income' OR NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=p_request_id AND driver_id=d.id AND company_id=d.company_id AND status='completed')) THEN RAISE EXCEPTION 'Income can only link to your completed ride' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NOT NULL THEN
   PERFORM 1 FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.driver_money_entries e WHERE e.request_id=p_request_id AND e.kind='income' AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal')) THEN RAISE EXCEPTION 'Income already recorded for this ride'; END IF;
  END IF;
 END IF;
 INSERT INTO public.driver_money_entries(id,company_id,driver_id,driver_user_id,actor_id,kind,amount,note,request_id,reference_id) VALUES(p_id,cid,did,owner_id,uid,p_kind,amt,btrim(p_note),p_request_id,p_reference_id);
 RETURN p_id;
END; $function$

CREATE OR REPLACE FUNCTION private.record_driver_money_verified(p_id uuid, p_kind text, p_amount numeric, p_note text, p_actor uuid, p_request_id uuid DEFAULT NULL::uuid, p_reference_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'declaration'::text, p_evidence_ref text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result uuid; previous public.driver_money_entries; ref text:=nullif(btrim(p_evidence_ref),'');
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Account changed' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_source IS NULL OR p_source NOT IN ('declaration','cash_count','cash_book','receipt','bank_record') OR length(ref)>160 THEN RAISE EXCEPTION 'Invalid evidence'; END IF;
 IF p_kind='confirmation' THEN
  IF p_source='declaration' OR (p_source<>'cash_count' AND ref IS NULL) THEN RAISE EXCEPTION 'Confirmation needs a source and reference'; END IF;
 ELSIF p_source<>'declaration' OR ref IS NOT NULL THEN RAISE EXCEPTION 'Only a company confirmation can verify evidence'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO previous FROM public.driver_money_entries WHERE id=p_id;
 IF FOUND AND (previous.evidence_source IS DISTINCT FROM p_source OR previous.evidence_reference IS DISTINCT FROM ref) THEN RAISE EXCEPTION 'Operation ID already used' USING ERRCODE='23505'; END IF;
 result:=private.record_driver_money_core(p_id,p_kind,p_amount,p_note,p_request_id,p_reference_id);
 IF previous.id IS NULL THEN UPDATE public.driver_money_entries SET evidence_source=p_source,evidence_reference=ref WHERE id=result; END IF;
 RETURN result;
END $function$

CREATE OR REPLACE FUNCTION private.record_request_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.status IN ('completed','cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
  INSERT INTO public.request_outcomes(request_id,company_id,driver_id,driver_user_id,vehicle_id,outcome,previous_status,cancelled_by,cancel_reason,actor_id,occurred_at,accepted_at,started_at,booked_amount,estimated_distance_km)
  SELECT NEW.id,NEW.company_id,NEW.driver_id,d.user_id,d.vehicle_id,NEW.status::text,OLD.status::text,
   NEW.cancelled_by::text,left(coalesce(nullif(btrim(NEW.cancel_reason),''),'not_provided'),500),
   CASE WHEN NEW.cancelled_by='system' THEN NULL ELSE auth.uid() END,
   coalesce(NEW.completed_at,NEW.cancelled_at,clock_timestamp()),NEW.accepted_at,NEW.started_at,
   CASE WHEN NEW.status='completed' THEN NEW.final_price ELSE NULL END,NEW.estimated_distance_km
  FROM (SELECT 1) seed LEFT JOIN public.drivers d ON d.id=NEW.driver_id
  ON CONFLICT(request_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION private.request_personal_data(p_kind text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result uuid; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('export','deletion') THEN RAISE EXCEPTION 'Invalid privacy request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||':privacy:'||p_kind,0));
 SELECT id INTO result FROM public.privacy_requests WHERE user_id=uid AND kind=p_kind AND status IN ('pending','in_progress');
 IF result IS NULL THEN INSERT INTO public.privacy_requests(user_id,kind) VALUES(uid,p_kind) RETURNING id INTO result; END IF;
 RETURN result;
END $function$

CREATE OR REPLACE FUNCTION private.reserve_route_request(p_user_id uuid, p_request_id uuid, p_quote boolean, p_origin_lat double precision, p_origin_lng double precision, p_destination_lat double precision, p_destination_lng double precision, p_purpose text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 actor public.profiles; ride public.taxi_requests; driver_user uuid; driver_key uuid;
 cfg private.route_budget_settings;
 day_key date:=(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date;
 until_reset integer; g integer; u integer; r integer:=0; mode text; has_ride boolean:=false;
 user_bucket text:='user:'||p_user_id::text; ride_bucket text;
BEGIN
 -- The caller is exclusively service_role. The Edge Function has already
 -- verified the bearer token with Auth; user-editable JWT metadata is unused.
 SELECT * INTO actor FROM public.profiles WHERE id=p_user_id AND is_active;
 IF NOT FOUND OR actor.role NOT IN ('CUSTOMER','DRIVER') THEN
  RETURN jsonb_build_object('allowed',false,'status',403,'code','ROUTE_ACCESS_DENIED');
 END IF;
 IF p_quote IS NULL OR NOT private.in_bulgaria(p_origin_lat,p_origin_lng)
  OR NOT private.in_bulgaria(p_destination_lat,p_destination_lng)
  OR (p_purpose IS NOT NULL AND p_purpose NOT IN ('pickup','destination','context')) THEN
  RETURN jsonb_build_object('allowed',false,'status',400,'code','INVALID_ROUTE_CONTEXT');
 END IF;
 IF p_request_id IS NOT NULL THEN
  SELECT * INTO ride FROM public.taxi_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'status',403,'code','ROUTE_ACCESS_DENIED'); END IF;
  has_ride:=true;
 ELSE
  -- Infer the active ride for older deployed clients as well, so omitting
  -- request_id cannot bypass the shared ride limit.
  IF actor.role='CUSTOMER' THEN
   SELECT * INTO ride FROM public.taxi_requests WHERE customer_id=p_user_id AND status IN ('pending','accepted','arrived','in_progress') LIMIT 1;
  ELSE
   SELECT id INTO driver_key FROM public.drivers WHERE user_id=p_user_id;
   SELECT * INTO ride FROM public.taxi_requests WHERE driver_id=driver_key AND status IN ('accepted','arrived','in_progress') LIMIT 1;
  END IF;
  has_ride:=FOUND;
 END IF;
 IF p_quote THEN
  IF actor.role<>'CUSTOMER' OR p_request_id IS NOT NULL OR p_purpose IS NOT NULL THEN
   RETURN jsonb_build_object('allowed',false,'status',403,'code','ROUTE_ACCESS_DENIED');
  END IF;
  IF has_ride THEN RETURN jsonb_build_object('allowed',false,'status',409,'code','ACTIVE_REQUEST_EXISTS'); END IF;
  mode:='quote';
 ELSIF has_ride THEN
  SELECT user_id INTO driver_user FROM public.drivers WHERE id=ride.driver_id;
  IF (ride.customer_id IS DISTINCT FROM p_user_id AND driver_user IS DISTINCT FROM p_user_id)
   OR ride.status NOT IN ('accepted','arrived','in_progress') THEN
   RETURN jsonb_build_object('allowed',false,'status',403,'code','ROUTE_ACCESS_DENIED');
  END IF;
  IF ride.pickup_latitude IS NULL OR ride.pickup_longitude IS NULL OR ride.destination_latitude IS NULL OR ride.destination_longitude IS NULL THEN
   RETURN jsonb_build_object('allowed',false,'status',400,'code','INVALID_ROUTE_CONTEXT');
  END IF;
  mode:=p_purpose;
  IF mode IS NULL THEN
   mode:=CASE WHEN abs(p_origin_lat-ride.pickup_latitude)<0.000001 AND abs(p_origin_lng-ride.pickup_longitude)<0.000001
    AND abs(p_destination_lat-ride.destination_latitude)<0.000001 AND abs(p_destination_lng-ride.destination_longitude)<0.000001 THEN 'context'
    WHEN ride.status IN ('accepted','arrived') THEN 'pickup' ELSE 'destination' END;
  END IF;
  IF (mode='context' AND (abs(p_origin_lat-ride.pickup_latitude)>=0.000001 OR abs(p_origin_lng-ride.pickup_longitude)>=0.000001
    OR abs(p_destination_lat-ride.destination_latitude)>=0.000001 OR abs(p_destination_lng-ride.destination_longitude)>=0.000001))
   OR (mode='pickup' AND (ride.status NOT IN ('accepted','arrived') OR abs(p_destination_lat-ride.pickup_latitude)>=0.000001 OR abs(p_destination_lng-ride.pickup_longitude)>=0.000001))
   OR (mode='destination' AND (ride.status<>'in_progress' OR abs(p_destination_lat-ride.destination_latitude)>=0.000001 OR abs(p_destination_lng-ride.destination_longitude)>=0.000001)) THEN
   RETURN jsonb_build_object('allowed',false,'status',400,'code','INVALID_ROUTE_CONTEXT');
  END IF;
  ride_bucket:='ride:'||ride.id::text;
 ELSIF actor.role='DRIVER' OR p_request_id IS NOT NULL OR p_purpose IS NOT NULL THEN
  RETURN jsonb_build_object('allowed',false,'status',403,'code','ROUTE_ACCESS_DENIED');
 ELSE mode:='preview';
 END IF;

 SELECT * INTO STRICT cfg FROM private.route_budget_settings WHERE singleton;
 until_reset:=greatest(1,ceil(extract(epoch FROM ((day_key+1)::timestamp AT TIME ZONE 'America/Los_Angeles')-clock_timestamp()))::integer);
 -- One short transaction serializes the small shared budget. Google is called
 -- only after this transaction commits, never while an advisory lock is held.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('leski-google-routes-budget',0));
 DELETE FROM private.route_budget_usage b WHERE b.budget_day<day_key-7
  OR (b.budget_day='infinity'::date AND b.updated_at<clock_timestamp()-interval '7 days'
   AND NOT EXISTS(SELECT 1 FROM public.taxi_requests q WHERE q.id=CASE WHEN b.bucket LIKE 'ride:%' THEN substring(b.bucket FROM 6)::uuid END AND q.status IN ('accepted','arrived','in_progress')));
 INSERT INTO private.route_budget_usage(bucket,budget_day) VALUES('global',day_key),(user_bucket,day_key) ON CONFLICT DO NOTHING;
 IF ride_bucket IS NOT NULL THEN INSERT INTO private.route_budget_usage(bucket,budget_day) VALUES(ride_bucket,'infinity') ON CONFLICT DO NOTHING; END IF;
 SELECT hits INTO g FROM private.route_budget_usage WHERE bucket='global' AND budget_day=day_key;
 SELECT hits INTO u FROM private.route_budget_usage WHERE bucket=user_bucket AND budget_day=day_key;
 IF ride_bucket IS NOT NULL THEN SELECT hits INTO r FROM private.route_budget_usage WHERE bucket=ride_bucket AND budget_day='infinity'; END IF;
 IF ride_bucket IS NOT NULL AND r>=cfg.ride_limit THEN
  RETURN jsonb_build_object('allowed',false,'status',429,'code','ROUTE_RIDE_LIMIT','retry_after_sec',90000);
 END IF;
 IF u>=cfg.user_daily_limit THEN
  RETURN jsonb_build_object('allowed',false,'status',429,'code','ROUTE_USER_LIMIT','retry_after_sec',until_reset);
 END IF;
 IF g>=cfg.daily_limit OR (mode<>'quote' AND g>=cfg.daily_limit-cfg.quote_reserve) THEN
  RETURN jsonb_build_object('allowed',false,'status',429,'code','ROUTE_DAILY_LIMIT','retry_after_sec',until_reset);
 END IF;
 UPDATE private.route_budget_usage SET hits=hits+1,updated_at=clock_timestamp()
  WHERE (budget_day=day_key AND bucket IN ('global',user_bucket)) OR (budget_day='infinity' AND bucket=ride_bucket);
 RETURN jsonb_build_object('allowed',true,'request_id',CASE WHEN has_ride AND NOT p_quote THEN ride.id ELSE NULL END,'purpose',mode);
END $function$

CREATE OR REPLACE FUNCTION private.resolve_privacy_request(p_id uuid, p_status text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE='42501'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('in_progress','completed','rejected') OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Explain the processing outcome'; END IF;
 UPDATE public.privacy_requests SET status=p_status,resolution=btrim(p_note),resolved_at=CASE WHEN p_status IN ('completed','rejected') THEN clock_timestamp() ELSE NULL END
 WHERE id=p_id AND status IN ('pending','in_progress');
 IF NOT FOUND THEN RAISE EXCEPTION 'Privacy request is already closed or missing'; END IF;
END $function$

CREATE OR REPLACE FUNCTION private.road_tile_cache(p_key text, p_roads jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE tile private.road_tiles; count integer;
BEGIN
 IF p_key IS NULL OR p_key !~ '^[0-9]{4}:[0-9]{4}$' THEN RAISE EXCEPTION 'Invalid tile'; END IF;
 INSERT INTO private.road_tiles(key) VALUES(p_key) ON CONFLICT DO NOTHING;
 SELECT * INTO tile FROM private.road_tiles WHERE key=p_key FOR UPDATE;
 IF p_roads IS NOT NULL THEN
  IF jsonb_typeof(p_roads)<>'array' OR octet_length(p_roads::text)>1500000 THEN RAISE EXCEPTION 'Invalid road data'; END IF;
  UPDATE private.road_tiles SET roads=p_roads,expires_at=clock_timestamp()+interval '7 days',lease_until='-infinity' WHERE key=p_key;
  RETURN jsonb_build_object('roads',p_roads,'fetch',false);
 END IF;
 IF tile.expires_at>clock_timestamp() THEN RETURN jsonb_build_object('roads',tile.roads,'fetch',false); END IF;
 IF tile.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('roads',COALESCE(tile.roads,'[]'::jsonb),'fetch',false); END IF;
 INSERT INTO private.road_fetch_budget VALUES(current_date,1) ON CONFLICT(day) DO UPDATE SET requests=private.road_fetch_budget.requests+1 WHERE private.road_fetch_budget.requests<30 RETURNING requests INTO count;
 IF count IS NULL THEN RETURN jsonb_build_object('roads',COALESCE(tile.roads,'[]'::jsonb),'fetch',false); END IF;
 DELETE FROM private.road_fetch_budget WHERE day<current_date-7;
 UPDATE private.road_tiles SET lease_until=clock_timestamp()+interval '60 seconds' WHERE key=p_key;
 RETURN jsonb_build_object('roads',COALESCE(tile.roads,'[]'::jsonb),'fetch',true);
END $function$

CREATE OR REPLACE FUNCTION public.accept_legal_versions(p_terms text, p_privacy text, p_method text)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.accept_legal_versions(p_terms,p_privacy,p_method); $function$

CREATE OR REPLACE FUNCTION public.accept_taxi_request(p_request_id uuid)
 RETURNS taxi_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r public.taxi_requests; d public.drivers;
BEGIN
  SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.'; END IF;
  SELECT * INTO d FROM public.drivers
    WHERE user_id=auth.uid() AND company_id=r.company_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_driver(d.id) THEN
    RAISE EXCEPTION 'Active driver account required' USING ERRCODE='42501';
  END IF;
  IF r.status='accepted' AND r.driver_id=d.id THEN RETURN r; END IF;
  IF r.status<>'pending' OR clock_timestamp()>=COALESCE(r.expires_at,r.created_at+interval '2 minutes') THEN
    RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.';
  END IF;
  UPDATE public.taxi_requests SET driver_id=d.id,status='accepted'
    WHERE id=r.id AND status='pending' RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.'; END IF;
  RETURN r;
END $function$

CREATE OR REPLACE FUNCTION public.accounting_report(p_from date, p_until date, p_company_id uuid DEFAULT NULL::uuid, p_driver_id uuid DEFAULT NULL::uuid, p_page integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_from IS NULL OR p_until IS NULL OR p_until<=p_from OR p_until-p_from>366 OR p_page IS NULL OR p_page<0 OR p_page>10000 THEN RAISE EXCEPTION 'Invalid report period'; END IF;
 IF p_driver_id IS NULL AND (p_company_id IS NULL OR NOT(public.is_company_admin(p_company_id) OR public.is_super_admin())) THEN RAISE EXCEPTION 'Report scope not allowed' USING ERRCODE='42501'; END IF;
 IF p_driver_id IS NOT NULL AND NOT(public.is_driver(p_driver_id) OR EXISTS(SELECT 1 FROM public.drivers d WHERE d.id=p_driver_id AND (public.is_company_admin(d.company_id) OR public.is_super_admin()))) THEN RAISE EXCEPTION 'Report scope not allowed' USING ERRCODE='42501'; END IF;
 WITH outcomes AS MATERIALIZED (
  SELECT o.*,concat_ws(' ',p.first_name,p.last_name) driver_name FROM public.request_outcomes o LEFT JOIN public.profiles p ON p.id=o.driver_user_id WHERE (p_company_id IS NULL OR o.company_id=p_company_id) AND (p_driver_id IS NULL OR o.driver_id=p_driver_id)
   AND o.occurred_at>=p_from::timestamp AT TIME ZONE 'Europe/Sofia' AND o.occurred_at<p_until::timestamp AT TIME ZONE 'Europe/Sofia'
 ), money AS MATERIALIZED (
  SELECT e.*,concat_ws(' ',p.first_name,p.last_name) driver_name,EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal') reversed,
   EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='confirmation') confirmed
  FROM public.driver_money_entries e LEFT JOIN public.profiles p ON p.id=e.driver_user_id WHERE (p_company_id IS NULL OR e.company_id=p_company_id) AND (p_driver_id IS NULL OR e.driver_id=p_driver_id)
   AND e.recorded_at>=p_from::timestamp AT TIME ZONE 'Europe/Sofia' AND e.recorded_at<p_until::timestamp AT TIME ZONE 'Europe/Sofia'
 ), totals AS (
  SELECT count(*) FILTER(WHERE outcome='completed') completed,count(*) FILTER(WHERE outcome='cancelled') cancelled,
   count(*) FILTER(WHERE outcome='cancelled' AND previous_status='in_progress') interrupted,
   coalesce(sum(booked_amount) FILTER(WHERE outcome='completed'),0) booked,
   count(*) FILTER(WHERE outcome='completed' AND booked_amount IS NULL) missing_amounts FROM outcomes
 ), finances AS (
  SELECT coalesce(sum(amount) FILTER(WHERE kind='income' AND NOT reversed),0) income,
   coalesce(sum(amount) FILTER(WHERE kind='expense' AND NOT reversed),0) expenses,
   coalesce(sum(amount) FILTER(WHERE kind='handover' AND NOT reversed),0) handed_over,
   coalesce(sum(amount) FILTER(WHERE kind='handover' AND NOT reversed AND confirmed),0) confirmed_handover,
   coalesce(sum(amount) FILTER(WHERE kind='income' AND NOT reversed AND confirmed),0) confirmed_income FROM money
 ) SELECT jsonb_build_object('totals',(SELECT to_jsonb(t) FROM totals t),'finances',(SELECT to_jsonb(f) FROM finances f),
 'outcome_count',(SELECT count(*) FROM outcomes),'entry_count',(SELECT count(*) FROM money),
 'reconciliation',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
 SELECT o.request_id,o.booked_amount estimated_amount,e.amount declared_income,e.recorded_at income_recorded_at,
 EXISTS(SELECT 1 FROM public.driver_money_entries conf WHERE conf.reference_id=e.id AND conf.kind='confirmation') company_confirmed,
 e.amount-o.booked_amount difference
 FROM (SELECT * FROM outcomes ORDER BY occurred_at DESC,id LIMIT 25 OFFSET p_page*25) o
 LEFT JOIN LATERAL (SELECT e.* FROM public.driver_money_entries e WHERE e.request_id=o.request_id AND e.kind='income'
  AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal')
  ORDER BY e.recorded_at DESC,e.id LIMIT 1) e ON true
 WHERE o.outcome='completed')x),'[]'::jsonb),
 'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM outcomes ORDER BY occurred_at DESC,id LIMIT 25 OFFSET p_page*25) x),'[]'::jsonb),
 'entries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM money ORDER BY recorded_at DESC,id LIMIT 25 OFFSET p_page*25) x),'[]'::jsonb),
 'drivers',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT driver_id,max(driver_name) driver_name,count(*) FILTER(WHERE outcome='completed') trips,count(*) FILTER(WHERE outcome='cancelled') cancelled,coalesce(sum(booked_amount),0) booked FROM outcomes GROUP BY driver_id ORDER BY sum(booked_amount) DESC NULLS LAST LIMIT 50) x),'[]'::jsonb)) INTO result;
 RETURN result;
END; $function$

CREATE OR REPLACE FUNCTION public.carrier_identity(p_company uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object('id',id,'name',name,'legal_name',legal_name,'registration_id',registration_id,'address',address,'phone',phone,
 'permit_number',permit_number,'permit_expires_on',permit_expires_on,
 'verified',legal_verified_at IS NOT NULL AND permit_expires_on>=(clock_timestamp() AT TIME ZONE 'Europe/Sofia')::date)
 FROM public.companies WHERE id=p_company AND is_active;
$function$

CREATE OR REPLACE FUNCTION public.claim_push_job(p_job_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE j private.push_outbox; r public.taxi_requests;
BEGIN
  SELECT * INTO j FROM private.push_outbox WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND OR j.status<>'processing' OR j.lease_token IS DISTINCT FROM p_lease_token
    OR j.lease_until<=clock_timestamp() OR j.claimed_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.taxi_requests WHERE id=j.request_id;
  IF j.expires_at<=clock_timestamp()
    OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=j.recipient_id AND is_active)
    OR (j.event_type='new_request' AND NOT EXISTS(SELECT 1 FROM public.request_push_recipients(j.request_id) WHERE user_id=j.recipient_id))
    OR (j.event_type<>'new_request' AND r.status::text<>j.event_type) THEN
    UPDATE private.push_outbox SET status='skipped',last_error='NO_LONGER_ELIGIBLE',lease_token=NULL,lease_until=NULL WHERE id=j.id;
    RETURN NULL;
  END IF;
  UPDATE private.push_outbox SET claimed_at=clock_timestamp() WHERE id=j.id;
  RETURN jsonb_build_object('id',j.id,'recipient_id',j.recipient_id,'payload',j.payload,'expires_at',j.expires_at,'lease_until',j.lease_until);
END $function$

CREATE OR REPLACE FUNCTION public.company_customers(p_company uuid, p_search text DEFAULT ''::text, p_page integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE result jsonb; term text:=btrim(coalesce(p_search,''));
BEGIN
 IF p_company IS NULL OR (SELECT auth.uid()) IS NULL OR NOT
   ((SELECT public.is_company_admin(p_company)) OR (SELECT public.is_super_admin())) THEN
   RAISE EXCEPTION 'Customer report scope not allowed' USING ERRCODE='42501';
 END IF;
 IF p_page IS NULL OR p_page<0 OR p_page>10000 OR length(term)>80 THEN
   RAISE EXCEPTION 'Invalid customer report page' USING ERRCODE='22023';
 END IF;
 WITH matching AS MATERIALIZED (
   SELECT p.id,p.first_name,p.last_name,p.phone,p.avatar_url,p.created_at
   FROM public.profiles p WHERE p.company_id=p_company AND p.role='CUSTOMER'
    AND (term='' OR strpos(lower(concat_ws(' ',p.first_name,p.last_name)),lower(term))>0)
 ), page AS (
   SELECT * FROM matching ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET p_page*50
 ), rows AS (
   SELECT p.*,totals.trips AS "totalTrips",totals.amount AS "totalSpent"
   FROM page p CROSS JOIN LATERAL (
     SELECT count(*) trips,coalesce(sum(coalesce(r.final_price,r.estimated_price,0)),0) amount
     FROM public.taxi_requests r WHERE r.company_id=p_company AND r.customer_id=p.id AND r.status='completed'
   ) totals
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM matching),
   'rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.id DESC) FROM rows r),'[]'::jsonb)) INTO result;
 RETURN result;
END $function$

CREATE OR REPLACE FUNCTION public.company_dashboard(p_company_id uuid, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE anchor date:=coalesce(p_day,(current_timestamp AT TIME ZONE 'Europe/Sofia')::date); result jsonb;
BEGIN
 IF p_company_id IS NULL OR (SELECT auth.uid()) IS NULL
  OR NOT ((SELECT public.is_company_admin(p_company_id)) OR (SELECT public.is_super_admin())) THEN
  RAISE EXCEPTION 'Dashboard scope not allowed' USING ERRCODE='42501';
 END IF;
 WITH driver_totals AS (
  SELECT count(*) AS total,count(*) FILTER(WHERE is_online) AS online
  FROM public.drivers WHERE company_id=p_company_id
 ), request_totals AS (
  SELECT count(*) FILTER(WHERE status IN ('accepted','arrived','in_progress')
    OR status='pending' AND coalesce(expires_at,created_at+interval '2 minutes')>current_timestamp) AS active,
   count(*) FILTER(WHERE status='completed') AS completed,count(*) FILTER(WHERE status='cancelled') AS cancelled,
   coalesce(sum(coalesce(final_price,estimated_price,0)) FILTER(WHERE status='completed'),0) AS revenue
  FROM public.taxi_requests WHERE company_id=p_company_id
 ), dates AS (
  SELECT anchor-6+n AS day FROM generate_series(0,6) AS s(n)
 ), daily AS (
  SELECT (completed_at AT TIME ZONE 'Europe/Sofia')::date AS day,count(*) AS orders,
   coalesce(sum(coalesce(final_price,estimated_price,0)),0) AS revenue
  FROM public.taxi_requests WHERE company_id=p_company_id AND status='completed'
   AND completed_at>=((anchor-6)::timestamp AT TIME ZONE 'Europe/Sofia')
   AND completed_at<((anchor+1)::timestamp AT TIME ZONE 'Europe/Sofia')
  GROUP BY 1
 )
 SELECT jsonb_build_object('stats',jsonb_build_object(
  'totalDrivers',d.total,'onlineDrivers',d.online,'activeOrders',r.active,
  'completedOrders',r.completed,'cancelledOrders',r.cancelled,'totalRevenue',r.revenue),
  'days',(SELECT jsonb_agg(jsonb_build_object('day',dates.day,'orders',coalesce(daily.orders,0),
   'revenue',coalesce(daily.revenue,0)) ORDER BY dates.day) FROM dates LEFT JOIN daily USING(day)))
 INTO result FROM driver_totals d CROSS JOIN request_totals r;
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION public.company_fleet(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 IF p_company IS NULL OR (SELECT auth.uid()) IS NULL OR NOT
   ((SELECT public.is_company_admin(p_company)) OR (SELECT public.is_super_admin())) THEN
   RAISE EXCEPTION 'Fleet scope not allowed' USING ERRCODE='42501';
 END IF;
 WITH visible AS MATERIALIZED (
   SELECT d.id,p.first_name,p.last_name,d.is_online,l.latitude,l.longitude,l.updated_at,l.position_at
   FROM public.driver_locations l JOIN public.drivers d ON d.id=l.driver_id AND d.company_id=p_company
   JOIN public.profiles p ON p.id=d.user_id
   WHERE l.company_id=p_company
 ), page AS (
   SELECT * FROM visible ORDER BY is_online DESC,updated_at DESC,id LIMIT 500
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM visible),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.is_online DESC,p.updated_at DESC,p.id) FROM page p),'[]'::jsonb)) INTO result;
 RETURN result;
END $function$

CREATE OR REPLACE FUNCTION public.consume_api_budget(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE n integer;
BEGIN
 INSERT INTO private.api_budget VALUES(p_user_id,now(),1)
 ON CONFLICT(user_id) DO UPDATE SET
 hits=CASE WHEN private.api_budget.window_at<now()-interval '1 minute' THEN 1 ELSE private.api_budget.hits+1 END,
 window_at=CASE WHEN private.api_budget.window_at<now()-interval '1 minute' THEN now() ELSE private.api_budget.window_at END
 RETURNING hits INTO n;
 RETURN n<=60;
END $function$

CREATE OR REPLACE FUNCTION public.create_taxi_request(p_quote_id uuid, p_request_id uuid, p_payment_method payment_method DEFAULT 'cash'::payment_method)
 RETURNS taxi_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE q public.ride_quotes; r public.taxi_requests; b jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='CUSTOMER' AND is_active) THEN
    RAISE EXCEPTION 'Active customer account required' USING ERRCODE='42501'; END IF;
  SELECT * INTO q FROM public.ride_quotes WHERE id=p_quote_id AND customer_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found' USING ERRCODE='42501'; END IF;
  IF q.request_id IS NOT NULL THEN SELECT * INTO r FROM public.taxi_requests WHERE id=q.request_id; RETURN r; END IF;
  IF q.expires_at<now() THEN RAISE EXCEPTION 'Quote expired. Refresh the route and price.'; END IF;
  IF p_request_id IS NULL OR p_payment_method<>'cash' THEN RAISE EXCEPTION 'Only cash payment is available for now'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=q.company_id AND is_active) THEN RAISE EXCEPTION 'Company unavailable'; END IF;
  b:=q.payload;
  INSERT INTO public.taxi_requests(id,company_id,customer_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
    destination_latitude,destination_longitude,destination_address,estimated_distance_km,estimated_duration_min,estimated_price,fare_breakdown,payment_method)
  VALUES(p_request_id,q.company_id,auth.uid(),q.vehicle_type_id,(b->>'pickup_latitude')::float8,(b->>'pickup_longitude')::float8,b->>'pickup_address',
    (b->>'destination_latitude')::float8,(b->>'destination_longitude')::float8,b->>'destination_address',(b->>'distance_km')::float8,
    (b->>'duration_min')::integer,(b->>'total')::numeric,b->'breakdown',p_payment_method) RETURNING * INTO r;
  UPDATE public.ride_quotes SET request_id=r.id WHERE id=q.id;
  RETURN r;
END $function$

CREATE OR REPLACE FUNCTION public.create_trip_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    INSERT INTO public.trips(request_id,company_id,driver_id,customer_id,distance_km,duration_min,total_amount,payment_method,started_at,ended_at)
    VALUES(NEW.id,NEW.company_id,NEW.driver_id,NEW.customer_id,NEW.estimated_distance_km,
      greatest(0,round(extract(epoch FROM (NEW.completed_at-NEW.started_at))/60,1)),NEW.final_price,NEW.payment_method,NEW.started_at,NEW.completed_at)
    ON CONFLICT(request_id) DO NOTHING;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.driver_id IS NOT NULL THEN
    UPDATE public.drivers SET status=CASE WHEN NEW.status IN ('accepted','arrived','in_progress') THEN 'busy'::public.driver_status
      WHEN is_online THEN 'available'::public.driver_status ELSE 'offline'::public.driver_status END WHERE id=NEW.driver_id;
  END IF;
  RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION public.driver_day_summary(p_driver_id uuid, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE anchor date:=coalesce(p_day,(current_timestamp AT TIME ZONE 'Europe/Sofia')::date); result jsonb;
BEGIN
 IF p_driver_id IS NULL OR (SELECT auth.uid()) IS NULL OR NOT (
  (SELECT public.is_driver(p_driver_id)) OR EXISTS(SELECT 1 FROM public.drivers d WHERE d.id=p_driver_id
    AND ((SELECT public.is_company_admin(d.company_id)) OR (SELECT public.is_super_admin())))) THEN
  RAISE EXCEPTION 'Driver summary scope not allowed' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('day',anchor,'trips',count(*),'earnings',coalesce(sum(coalesce(final_price,estimated_price,0)),0))
 INTO result FROM public.taxi_requests WHERE driver_id=p_driver_id AND status='completed'
  AND completed_at>=(anchor::timestamp AT TIME ZONE 'Europe/Sofia')
  AND completed_at<((anchor+1)::timestamp AT TIME ZONE 'Europe/Sofia');
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION public.driver_verification_status(p_driver uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.drivers;
BEGIN
 SELECT * INTO d FROM public.drivers WHERE id=p_driver;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT(public.is_driver(d.id) OR public.is_company_admin(d.company_id) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Нямате достъп до проверката на този шофьор.' USING ERRCODE='42501'; END IF;
 RETURN private.driver_verification_report(d.id,d.vehicle_id);
END $function$

CREATE OR REPLACE FUNCTION public.expire_stale_requests()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.taxi_requests SET status='cancelled',cancelled_at=clock_timestamp(),cancelled_by='system',cancel_reason='no_driver'
    WHERE status='pending' AND COALESCE(expires_at,created_at+interval '2 minutes')<=clock_timestamp();
END $function$

CREATE OR REPLACE FUNCTION public.export_my_basic_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE uid uuid:=auth.uid(); result jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('generated_at',clock_timestamp(),'profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE id=uid),
 'driver_applications',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.driver_applications WHERE user_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'legal_acceptances',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.legal_acceptances WHERE user_id=uid ORDER BY accepted_at DESC LIMIT 1000)x),'[]'::jsonb),
 'privacy_requests',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.privacy_requests WHERE user_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'money_entries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.driver_money_entries WHERE driver_user_id=uid ORDER BY recorded_at DESC LIMIT 1000)x),'[]'::jsonb),
 'requests',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,status,created_at,pickup_address,destination_address,estimated_price FROM public.taxi_requests WHERE customer_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'scope','Basic account data, at most 1000 records per list. Request a full export for additional data.') INTO result;
 RETURN result;
END $function$

CREATE OR REPLACE FUNCTION public.finish_push_job(p_job_id uuid, p_lease_token uuid, p_result text, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE j private.push_outbox; outcome text;
BEGIN
  IF p_result NOT IN ('sent','retry','skipped','failed') THEN RAISE EXCEPTION 'Invalid delivery outcome'; END IF;
  SELECT * INTO j FROM private.push_outbox WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND OR j.status<>'processing' OR j.lease_token IS DISTINCT FROM p_lease_token
    OR j.claimed_at IS NULL OR j.lease_until<=clock_timestamp() THEN RETURN false; END IF;
  outcome:=CASE WHEN p_result='retry' THEN CASE WHEN j.attempts>=5 THEN 'failed'
      WHEN j.expires_at<=clock_timestamp() THEN 'skipped' ELSE 'pending' END ELSE p_result END;
  UPDATE private.push_outbox SET status=outcome,
    available_at=clock_timestamp()+make_interval(secs=>LEAST(30,power(2,j.attempts)::integer)),
    lease_token=NULL,lease_until=NULL,last_error=left(p_error,80) WHERE id=j.id;
  RETURN true;
END $function$

CREATE OR REPLACE FUNCTION public.handle_driver_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.role = 'DRIVER' AND NEW.company_id IS NOT NULL THEN
    INSERT INTO drivers (user_id, company_id, is_online, is_verified, rating, total_trips, status)
    SELECT NEW.id, NEW.company_id, false, false, 5, 0, 'offline'
    WHERE NOT EXISTS (SELECT 1 FROM drivers WHERE user_id = NEW.id);
  END IF;
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE role_name text := COALESCE(NEW.raw_app_meta_data->>'role','CUSTOMER'); company uuid;
BEGIN
  IF role_name NOT IN ('CUSTOMER','DRIVER','COMPANY_ADMIN','SUPER_ADMIN') THEN role_name := 'CUSTOMER'; END IF;
  BEGIN company := (NEW.raw_app_meta_data->>'company_id')::uuid; EXCEPTION WHEN invalid_text_representation THEN company := NULL; END;
  IF company IS NULL AND role_name = 'CUSTOMER' THEN
    SELECT id INTO company FROM public.companies WHERE is_active ORDER BY created_at,id LIMIT 1;
  END IF;
  INSERT INTO public.profiles(id,email,role,company_id,first_name,last_name,phone,is_active)
  VALUES(NEW.id,NEW.email,role_name::public.user_role,company,
    COALESCE(NEW.raw_user_meta_data->>'first_name',split_part(NEW.raw_user_meta_data->>'full_name',' ',1),''),
    COALESCE(NEW.raw_user_meta_data->>'last_name',''),COALESCE(NEW.raw_user_meta_data->>'phone',''),true)
  ON CONFLICT(id) DO NOTHING;
  RETURN NEW;
END $function$

CREATE OR REPLACE FUNCTION public.increment_driver_trip_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') AND NEW.driver_id IS NOT NULL THEN
    UPDATE public.drivers SET total_trips = total_trips + 1 WHERE id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.is_company_admin(target_company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'COMPANY_ADMIN' AND p.company_id = target_company AND p.is_active = true
  );
$function$

CREATE OR REPLACE FUNCTION public.is_company_member(target_company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.company_id = target_company AND p.is_active = true
  );
$function$

CREATE OR REPLACE FUNCTION public.is_driver(target_driver uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.drivers d
    JOIN public.profiles p ON p.id = d.user_id
    WHERE d.id = target_driver AND p.id = auth.uid() AND p.role = 'DRIVER' AND p.is_active = true
  );
$function$

CREATE OR REPLACE FUNCTION public.is_driver_of_company(target_company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'DRIVER' AND p.company_id = target_company AND p.is_active = true
  );
$function$

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'SUPER_ADMIN' AND p.is_active = true
  );
$function$

CREATE OR REPLACE FUNCTION public.log_document_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.audit_log (company_id, actor_id, entity_type, entity_id, action, old_value, new_value)
    VALUES (
      NEW.company_id,
      auth.uid(),
      'driver_document',
      NEW.id,
      CASE NEW.status
        WHEN 'approved' THEN 'document_approved'
        WHEN 'rejected' THEN 'document_rejected'
        ELSE 'document_pending'
      END,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.log_driver_verify_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.is_verified IS DISTINCT FROM NEW.is_verified) THEN
    INSERT INTO public.audit_log (company_id, actor_id, entity_type, entity_id, action, old_value, new_value)
    VALUES (
      NEW.company_id,
      auth.uid(),
      'driver',
      NEW.id,
      CASE WHEN NEW.is_verified THEN 'driver_verified' ELSE 'driver_unverified' END,
      jsonb_build_object('is_verified', OLD.is_verified),
      jsonb_build_object('is_verified', NEW.is_verified)
    );
  END IF;
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.log_taxi_request_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO audit_log (company_id, actor_id, entity_type, entity_id, action, old_value, new_value)
    VALUES (
      NEW.company_id,
      auth.uid(),
      'taxi_request',
      NEW.id,
      'status_change',
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.log_vehicle_assignment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id) THEN
    INSERT INTO public.audit_log (company_id, actor_id, entity_type, entity_id, action, old_value, new_value)
    VALUES (
      NEW.company_id,
      auth.uid(),
      'driver',
      NEW.id,
      CASE WHEN NEW.vehicle_id IS NULL THEN 'vehicle_unassigned' ELSE 'vehicle_assigned' END,
      jsonb_build_object('vehicle_id', OLD.vehicle_id),
      jsonb_build_object('vehicle_id', NEW.vehicle_id)
    );
  END IF;
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.nearby_cars(p_lat double precision, p_lng double precision, p_type uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.nearby_cars(p_lat,p_lng,p_type); $function$

CREATE OR REPLACE FUNCTION public.news_articles_set_updated_at_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.record_driver_money(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid DEFAULT NULL::uuid, p_reference_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.record_driver_money(p_id,p_kind,p_amount,p_note,p_request_id,p_reference_id); $function$

CREATE OR REPLACE FUNCTION public.record_driver_money_verified(p_id uuid, p_kind text, p_amount numeric, p_note text, p_actor uuid, p_request_id uuid DEFAULT NULL::uuid, p_reference_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'declaration'::text, p_evidence_ref text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.record_driver_money_verified(p_id,p_kind,p_amount,p_note,p_actor,p_request_id,p_reference_id,p_source,p_evidence_ref); $function$

CREATE OR REPLACE FUNCTION public.register_driver_document(p_id uuid, p_type document_type, p_expires date, p_path text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.drivers; existing public.driver_documents; uid uuid:=auth.uid(); extension text;
BEGIN
 SELECT x.* INTO d FROM public.drivers x JOIN public.profiles p ON p.id=x.user_id WHERE x.user_id=uid AND p.role='DRIVER' AND p.is_active FOR UPDATE OF x;
 IF uid IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'Изисква се активен шофьорски профил.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_type IS NULL OR p_type NOT IN ('license','insurance') THEN
  RAISE EXCEPTION 'Посочете тип и валиден срок на документа.'; END IF;
 extension:=substring(p_path FROM '\.(jpg|png|webp|pdf)$');
 IF p_path IS NULL OR extension IS NULL OR p_path<>uid::text||'/'||p_id::text||'.'||extension THEN RAISE EXCEPTION 'Невалиден адрес на документ.' USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM public.driver_documents WHERE id=p_id;
 IF FOUND THEN
  IF existing.driver_id<>d.id OR existing.type<>p_type OR existing.file_url<>'storage://driver-documents/'||p_path THEN
   RAISE EXCEPTION 'Документът вече е записан с други данни.'; END IF;
  RETURN existing.id;
 END IF;
 IF p_expires IS NULL OR p_expires<(now() AT TIME ZONE 'Europe/Sofia')::date THEN RAISE EXCEPTION 'Посочете валиден срок на документа.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=p_path) THEN
  RAISE EXCEPTION 'Файлът още не е получен. Проверете качването или изберете файла отново.'; END IF;
 INSERT INTO public.driver_documents(id,driver_id,company_id,type,file_url,status,expires_at)
 VALUES(p_id,d.id,d.company_id,p_type,'storage://driver-documents/'||p_path,'pending',p_expires);
 RETURN p_id;
END $function$

CREATE OR REPLACE FUNCTION public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE owner_id uuid := auth.uid();
BEGIN
  IF owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=owner_id AND is_active) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE='42501';
  END IF;
  IF p_endpoint IS NULL OR length(p_endpoint)>2048 OR p_endpoint NOT LIKE 'https://%'
    OR p_p256dh IS NULL OR length(p_p256dh) NOT BETWEEN 20 AND 256
    OR p_auth IS NULL OR length(p_auth) NOT BETWEEN 16 AND 256 THEN
    RAISE EXCEPTION 'Invalid push subscription';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_endpoint,0));
  UPDATE public.push_subscriptions SET is_active=false
    WHERE endpoint=p_endpoint AND user_id<>owner_id AND is_active;
  INSERT INTO public.push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,is_active,updated_at)
  VALUES(owner_id,p_endpoint,p_p256dh,p_auth,left(p_user_agent,1024),true,now())
  ON CONFLICT(user_id,endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,
    user_agent=EXCLUDED.user_agent,is_active=true,updated_at=now();
END $function$

CREATE OR REPLACE FUNCTION public.request_personal_data(p_kind text)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.request_personal_data(p_kind); $function$

CREATE OR REPLACE FUNCTION public.request_push_recipients(p_request_id uuid)
 RETURNS TABLE(user_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT d.user_id FROM public.taxi_requests r
  CROSS JOIN LATERAL private.eligible_drivers(r.company_id,r.vehicle_type_id,r.pickup_latitude,r.pickup_longitude) d
  WHERE r.id=p_request_id AND r.status='pending'
    AND clock_timestamp()<COALESCE(r.expires_at,r.created_at+interval '2 minutes');
$function$

CREATE OR REPLACE FUNCTION public.reserve_route_request(p_user_id uuid, p_request_id uuid, p_quote boolean, p_origin_lat double precision, p_origin_lng double precision, p_destination_lat double precision, p_destination_lng double precision, p_purpose text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 SELECT private.reserve_route_request(p_user_id,p_request_id,p_quote,p_origin_lat,p_origin_lng,p_destination_lat,p_destination_lng,p_purpose);
$function$

CREATE OR REPLACE FUNCTION public.resolve_privacy_request(p_id uuid, p_status text, p_note text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.resolve_privacy_request(p_id,p_status,p_note); $function$

CREATE OR REPLACE FUNCTION public.review_driver_application(p_id uuid, p_decision text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.driver_applications; p public.profiles; uid uuid:=auth.uid(); target_user uuid;
BEGIN
 -- Same lock order as submission: profile, then application.
 SELECT user_id INTO target_user FROM public.driver_applications WHERE id=p_id;
 SELECT * INTO p FROM public.profiles WHERE id=target_user FOR UPDATE;
 SELECT * INTO a FROM public.driver_applications WHERE id=p_id FOR UPDATE;
 IF uid IS NULL OR NOT FOUND OR NOT(public.is_company_admin(a.company_id) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Нямате права за тази кандидатура.' USING ERRCODE='42501'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected') OR length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION 'Невалидно решение.'; END IF;
 IF a.status=p_decision THEN RETURN a.id; END IF;
 IF a.status<>'pending' THEN RAISE EXCEPTION 'Кандидатурата вече е разгледана. Обновете списъка.'; END IF;
 IF p_decision='approved' THEN
  IF p.role<>'CUSTOMER' OR NOT p.is_active OR EXISTS(SELECT 1 FROM public.drivers WHERE user_id=p.id) THEN RAISE EXCEPTION 'Профилът вече има друга роля или е неактивен.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=a.company_id AND is_active) THEN RAISE EXCEPTION 'Фирмата е неактивна.'; END IF;
  IF EXISTS(SELECT 1 FROM public.taxi_requests WHERE customer_id=p.id AND status IN ('pending','accepted','arrived','in_progress')) THEN
   RAISE EXCEPTION 'Кандидатът има незавършена клиентска заявка. Опитайте след приключването ѝ.'; END IF;
  UPDATE public.profiles SET role='DRIVER',company_id=a.company_id,phone=a.phone,
   first_name=split_part(a.full_name,' ',1),last_name=btrim(substr(a.full_name,length(split_part(a.full_name,' ',1))+1)) WHERE id=p.id;
  -- handle_driver_role creates an unverified, offline driver. Never grant verification here.
 END IF;
 UPDATE public.driver_applications SET status=p_decision,review_note=btrim(coalesce(p_note,'')),reviewed_by=uid,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=a.id;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,new_value)
 VALUES(a.company_id,uid,'driver_application',a.id,'application_'||p_decision,jsonb_build_object('status',p_decision));
 RETURN a.id;
END $function$

CREATE OR REPLACE FUNCTION public.road_tile_cache(p_key text, p_roads jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.road_tile_cache(p_key,p_roads); $function$

CREATE OR REPLACE FUNCTION public.save_driver_vehicle(p_id uuid, p_company uuid, p_driver uuid, p_expected_driver uuid, p_details jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.vehicles; assigned uuid; target public.drivers;
BEGIN
 IF auth.uid() IS NULL OR NOT(public.is_company_admin(p_company) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Нямате права за тази фирма.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.companies WHERE id=p_company FOR UPDATE;
 SELECT * INTO v FROM public.vehicles WHERE id=p_id FOR UPDATE;
 IF FOUND AND v.company_id<>p_company THEN RAISE EXCEPTION 'Автомобилът е от друга фирма.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_details IS NULL OR length(btrim(coalesce(p_details->>'make',''))) NOT BETWEEN 1 AND 80
  OR length(btrim(coalesce(p_details->>'model',''))) NOT BETWEEN 1 AND 80
  OR length(btrim(coalesce(p_details->>'registration_number',''))) NOT BETWEEN 1 AND 30
  OR NOT EXISTS(SELECT 1 FROM public.vehicle_types WHERE id=(p_details->>'vehicle_type_id')::uuid AND company_id=p_company AND is_active)
  THEN RAISE EXCEPTION 'Проверете автомобила, регистрационния номер и активната категория.'; END IF;
 PERFORM 1 FROM public.drivers WHERE vehicle_id=p_id OR id=p_driver ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.drivers WHERE vehicle_id=p_id)>1 THEN RAISE EXCEPTION 'Повече от един шофьор е свързан с автомобила. Нужна е проверка от администратор.'; END IF;
 SELECT id INTO assigned FROM public.drivers WHERE vehicle_id=p_id;
 IF assigned IS DISTINCT FROM p_expected_driver AND assigned IS DISTINCT FROM p_driver THEN
  RAISE EXCEPTION 'Назначението е променено от друг администратор. Обновете списъка.'; END IF;
 IF EXISTS(SELECT 1 FROM public.taxi_requests r JOIN public.drivers d ON d.id=r.driver_id
  WHERE (d.vehicle_id=p_id OR d.id=p_driver) AND r.status IN ('accepted','arrived','in_progress')) THEN
  RAISE EXCEPTION 'Изчакайте активният курс да приключи, преди да променяте автомобила.'; END IF;
 IF p_driver IS NOT NULL THEN
  SELECT d.* INTO target FROM public.drivers d JOIN public.profiles p ON p.id=d.user_id AND p.is_active AND p.role='DRIVER'
  WHERE d.id=p_driver AND d.company_id=p_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Изберете активен шофьор от същата фирма.'; END IF;
 END IF;
 INSERT INTO public.vehicles(id,company_id,make,model,registration_number,vehicle_type_id,year,color,capacity,is_active,insurance_expiry_date,inspection_expiry_date)
 VALUES(p_id,p_company,btrim(p_details->>'make'),btrim(p_details->>'model'),btrim(p_details->>'registration_number'),
  (p_details->>'vehicle_type_id')::uuid,nullif(p_details->>'year','')::integer,nullif(btrim(p_details->>'color'),''),coalesce((p_details->>'capacity')::integer,4),coalesce(v.is_active,true),
  CASE WHEN p_details?'insurance_expiry_date' THEN nullif(p_details->>'insurance_expiry_date','')::date ELSE v.insurance_expiry_date END,
  CASE WHEN p_details?'inspection_expiry_date' THEN nullif(p_details->>'inspection_expiry_date','')::date ELSE v.inspection_expiry_date END)
 ON CONFLICT(id) DO UPDATE SET make=EXCLUDED.make,model=EXCLUDED.model,registration_number=EXCLUDED.registration_number,
  vehicle_type_id=EXCLUDED.vehicle_type_id,year=EXCLUDED.year,color=EXCLUDED.color,capacity=EXCLUDED.capacity,insurance_expiry_date=EXCLUDED.insurance_expiry_date,inspection_expiry_date=EXCLUDED.inspection_expiry_date;
 UPDATE public.drivers SET vehicle_id=NULL WHERE vehicle_id=p_id AND id IS DISTINCT FROM p_driver;
 IF p_driver IS NOT NULL THEN UPDATE public.drivers SET vehicle_id=p_id WHERE id=p_driver; END IF;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,new_value)
 VALUES(p_company,auth.uid(),'vehicle',p_id,'vehicle_saved',jsonb_build_object('driver_id',p_driver));
 RETURN p_id;
END $function$

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.submit_driver_application(p_company uuid, p_full_name text, p_phone text, p_experience text, p_has_vehicle boolean, p_message text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE uid uuid:=auth.uid(); p public.profiles; a public.driver_applications; result uuid;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=uid FOR UPDATE;
 IF uid IS NULL OR NOT FOUND OR NOT p.is_active OR p.role<>'CUSTOMER' THEN
  RAISE EXCEPTION 'Кандидатстването изисква активен клиентски профил.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=p_company AND is_active) THEN RAISE EXCEPTION 'Изберете активна фирма.'; END IF;
 IF p_full_name IS NULL OR length(btrim(p_full_name)) NOT BETWEEN 2 AND 120 OR p_phone IS NULL OR length(btrim(p_phone)) NOT BETWEEN 6 AND 30
  OR p_experience IS NULL OR p_experience NOT IN ('1–3','3–5','5–10','10+') OR p_has_vehicle IS NULL OR length(coalesce(p_message,''))>500
  THEN RAISE EXCEPTION 'Проверете данните в кандидатурата.'; END IF;
 SELECT * INTO a FROM public.driver_applications WHERE user_id=uid FOR UPDATE;
 IF FOUND AND a.status='pending' THEN
  IF (a.company_id,a.full_name,a.phone,a.experience,a.has_vehicle,a.message) IS DISTINCT FROM
    (p_company,btrim(p_full_name),btrim(p_phone),p_experience,p_has_vehicle,btrim(coalesce(p_message,''))) THEN
   RAISE EXCEPTION 'Вече има изпратена кандидатура. Изчакайте решението на фирмата.'; END IF;
  RETURN a.id;
 ELSIF FOUND AND a.status='approved' THEN RAISE EXCEPTION 'Кандидатурата вече е одобрена.';
 END IF;
 INSERT INTO public.driver_applications(user_id,company_id,full_name,phone,email,experience,has_vehicle,message)
 VALUES(uid,p_company,btrim(p_full_name),btrim(p_phone),p.email,p_experience,p_has_vehicle,btrim(coalesce(p_message,'')))
 ON CONFLICT(user_id) DO UPDATE SET company_id=EXCLUDED.company_id,full_name=EXCLUDED.full_name,phone=EXCLUDED.phone,email=EXCLUDED.email,
  experience=EXCLUDED.experience,has_vehicle=EXCLUDED.has_vehicle,message=EXCLUDED.message,status='pending',review_note=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=clock_timestamp()
 RETURNING id INTO result;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action) VALUES(p_company,uid,'driver_application',result,'application_submitted');
 RETURN result;
END $function$

CREATE OR REPLACE FUNCTION public.sweep_stuck_requests(max_age_minutes integer DEFAULT 30)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n integer;
BEGIN
 PERFORM public.expire_stale_requests();
 UPDATE public.drivers d SET is_online=false,status=CASE WHEN EXISTS(SELECT 1 FROM public.taxi_requests WHERE driver_id=d.id AND status IN ('accepted','arrived','in_progress'))
 THEN 'busy'::public.driver_status ELSE 'offline'::public.driver_status END
 WHERE is_online AND NOT EXISTS(SELECT 1 FROM public.driver_locations WHERE driver_id=d.id AND updated_at>now()-interval '90 seconds');
 GET DIAGNOSTICS n=ROW_COUNT;
 DELETE FROM public.ride_quotes WHERE expires_at<now()-interval '1 day';
 RETURN n;
END $function$

CREATE OR REPLACE FUNCTION public.update_driver_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.drivers
  SET rating = COALESCE((
    SELECT ROUND(AVG(r.score)::numeric, 2) FROM public.ratings r WHERE r.driver_id = NEW.driver_id
  ), 5.00)
  WHERE id = NEW.driver_id;
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.wake_request_push(p_request_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.taxi_requests;
BEGIN
  SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active)
    OR NOT (r.customer_id=auth.uid() OR public.is_driver(r.driver_id)
      OR public.is_company_admin(r.company_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Forbidden request' USING ERRCODE='42501';
  END IF;
  RETURN private.dispatch_push_outbox();
END $function$

ALTER TABLE private.api_budget ADD CONSTRAINT api_budget_pkey PRIMARY KEY (user_id);
ALTER TABLE private.legal_versions ADD CONSTRAINT legal_versions_pkey PRIMARY KEY (terms_version, privacy_version);
ALTER TABLE private.nearby_read_limits ADD CONSTRAINT nearby_read_limits_pkey PRIMARY KEY (user_id);
ALTER TABLE private.push_outbox ADD CONSTRAINT push_outbox_attempts_check CHECK (((attempts >= 0) AND (attempts <= 5)));
ALTER TABLE private.push_outbox ADD CONSTRAINT push_outbox_event_type_check CHECK ((event_type = ANY (ARRAY['new_request'::text, 'accepted'::text, 'arrived'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE private.push_outbox ADD CONSTRAINT push_outbox_pkey PRIMARY KEY (id);
ALTER TABLE private.push_outbox ADD CONSTRAINT push_outbox_request_id_event_type_recipient_id_key UNIQUE (request_id, event_type, recipient_id);
ALTER TABLE private.push_outbox ADD CONSTRAINT push_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'skipped'::text])));
ALTER TABLE private.road_fetch_budget ADD CONSTRAINT road_fetch_budget_pkey PRIMARY KEY (day);
ALTER TABLE private.road_tiles ADD CONSTRAINT road_tiles_pkey PRIMARY KEY (key);
ALTER TABLE private.route_budget_settings ADD CONSTRAINT route_budget_settings_check CHECK (((quote_reserve >= 0) AND (quote_reserve < daily_limit)));
ALTER TABLE private.route_budget_settings ADD CONSTRAINT route_budget_settings_check1 CHECK (((user_daily_limit >= 1) AND (user_daily_limit <= daily_limit)));
ALTER TABLE private.route_budget_settings ADD CONSTRAINT route_budget_settings_daily_limit_check CHECK (((daily_limit >= 1) AND (daily_limit <= 100000)));
ALTER TABLE private.route_budget_settings ADD CONSTRAINT route_budget_settings_pkey PRIMARY KEY (singleton);
ALTER TABLE private.route_budget_settings ADD CONSTRAINT route_budget_settings_ride_limit_check CHECK (((ride_limit >= 1) AND (ride_limit <= 1000)));
ALTER TABLE private.route_budget_settings ADD CONSTRAINT route_budget_settings_singleton_check CHECK (singleton);
ALTER TABLE private.route_budget_usage ADD CONSTRAINT route_budget_usage_bucket_check CHECK (((bucket = 'global'::text) OR (bucket ~ '^(user|ride):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)));
ALTER TABLE private.route_budget_usage ADD CONSTRAINT route_budget_usage_hits_check CHECK ((hits >= 0));
ALTER TABLE private.route_budget_usage ADD CONSTRAINT route_budget_usage_pkey PRIMARY KEY (bucket, budget_day);
ALTER TABLE public.app_config ADD CONSTRAINT app_config_id_check CHECK ((id = 1));
ALTER TABLE public.app_config ADD CONSTRAINT app_config_pkey PRIMARY KEY (id);
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE public.companies ADD CONSTRAINT companies_legal_name_check CHECK ((length(legal_name) <= 200));
ALTER TABLE public.companies ADD CONSTRAINT companies_permit_number_check CHECK ((length(permit_number) <= 100));
ALTER TABLE public.companies ADD CONSTRAINT companies_pkey PRIMARY KEY (id);
ALTER TABLE public.companies ADD CONSTRAINT companies_registration_id_check CHECK (((registration_id IS NULL) OR (registration_id ~ '^([0-9]{9}|[0-9]{13})$'::text)));
ALTER TABLE public.companies ADD CONSTRAINT companies_slug_key UNIQUE (slug);
ALTER TABLE public.coupons ADD CONSTRAINT coupons_code_key UNIQUE (code);
ALTER TABLE public.coupons ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_experience_check CHECK ((experience = ANY (ARRAY['1–3'::text, '3–5'::text, '5–10'::text, '10+'::text])));
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_full_name_check CHECK (((length(full_name) >= 2) AND (length(full_name) <= 120)));
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_message_check CHECK ((length(message) <= 500));
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_phone_check CHECK (((length(phone) >= 6) AND (length(phone) <= 30)));
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_review_note_check CHECK ((length(review_note) <= 500));
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_user_id_key UNIQUE (user_id);
ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_pkey PRIMARY KEY (id);
ALTER TABLE public.driver_locations ADD CONSTRAINT driver_locations_pkey PRIMARY KEY (driver_id);
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_amount_check CHECK (((amount > (0)::numeric) AND (amount <= (1000000)::numeric)));
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_check CHECK (((kind = ANY (ARRAY['confirmation'::text, 'reversal'::text])) = (reference_id IS NOT NULL)));
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_currency_check CHECK ((currency = 'EUR'::text));
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_evidence_reference_check CHECK ((length(evidence_reference) <= 160));
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_evidence_source_check CHECK ((evidence_source = ANY (ARRAY['declaration'::text, 'cash_count'::text, 'cash_book'::text, 'receipt'::text, 'bank_record'::text])));
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_kind_check CHECK ((kind = ANY (ARRAY['income'::text, 'expense'::text, 'handover'::text, 'confirmation'::text, 'reversal'::text])));
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_note_check CHECK (((length(btrim(note)) >= 1) AND (length(btrim(note)) <= 500)));
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_pkey PRIMARY KEY (id);
ALTER TABLE public.drivers ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);
ALTER TABLE public.drivers ADD CONSTRAINT drivers_user_id_key UNIQUE (user_id);
ALTER TABLE public.ledger ADD CONSTRAINT ledger_entry_type_check CHECK ((entry_type = ANY (ARRAY['debit'::text, 'credit'::text])));
ALTER TABLE public.ledger ADD CONSTRAINT ledger_pkey PRIMARY KEY (id);
ALTER TABLE public.legal_acceptances ADD CONSTRAINT legal_acceptances_method_check CHECK ((method = ANY (ARRAY['google'::text, 'facebook'::text, 'continue'::text])));
ALTER TABLE public.legal_acceptances ADD CONSTRAINT legal_acceptances_pkey PRIMARY KEY (id);
ALTER TABLE public.legal_acceptances ADD CONSTRAINT legal_acceptances_user_id_terms_version_privacy_version_key UNIQUE (user_id, terms_version, privacy_version);
ALTER TABLE public.news_articles ADD CONSTRAINT news_articles_pkey PRIMARY KEY (id);
ALTER TABLE public.news_articles ADD CONSTRAINT news_articles_slug_key UNIQUE (slug);
ALTER TABLE public.news_articles ADD CONSTRAINT news_articles_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])));
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_pkey PRIMARY KEY (id);
ALTER TABLE public.privacy_requests ADD CONSTRAINT privacy_requests_kind_check CHECK ((kind = ANY (ARRAY['export'::text, 'deletion'::text])));
ALTER TABLE public.privacy_requests ADD CONSTRAINT privacy_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.privacy_requests ADD CONSTRAINT privacy_requests_resolution_check CHECK ((length(resolution) <= 1000));
ALTER TABLE public.privacy_requests ADD CONSTRAINT privacy_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'rejected'::text])));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_user_endpoint_unique UNIQUE (user_id, endpoint);
ALTER TABLE public.ratings ADD CONSTRAINT ratings_pkey PRIMARY KEY (id);
ALTER TABLE public.ratings ADD CONSTRAINT ratings_request_id_key UNIQUE (request_id);
ALTER TABLE public.ratings ADD CONSTRAINT ratings_score_check CHECK (((score >= 1) AND (score <= 5)));
ALTER TABLE public.request_declines ADD CONSTRAINT request_declines_pkey PRIMARY KEY (id);
ALTER TABLE public.request_declines ADD CONSTRAINT request_declines_unique UNIQUE (request_id, driver_id);
ALTER TABLE public.request_outcomes ADD CONSTRAINT request_outcomes_outcome_check CHECK ((outcome = ANY (ARRAY['completed'::text, 'cancelled'::text])));
ALTER TABLE public.request_outcomes ADD CONSTRAINT request_outcomes_pkey PRIMARY KEY (id);
ALTER TABLE public.request_outcomes ADD CONSTRAINT request_outcomes_request_id_key UNIQUE (request_id);
ALTER TABLE public.ride_quotes ADD CONSTRAINT ride_quotes_pkey PRIMARY KEY (id);
ALTER TABLE public.ride_quotes ADD CONSTRAINT ride_quotes_request_id_key UNIQUE (request_id);
ALTER TABLE public.saved_places ADD CONSTRAINT saved_places_pkey PRIMARY KEY (id);
ALTER TABLE public.taxi_requests ADD CONSTRAINT taxi_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.trips ADD CONSTRAINT trips_pkey PRIMARY KEY (id);
ALTER TABLE public.trips ADD CONSTRAINT trips_request_id_key UNIQUE (request_id);
ALTER TABLE public.vehicle_types ADD CONSTRAINT vehicle_types_company_id_name_key UNIQUE (company_id, name);
ALTER TABLE public.vehicle_types ADD CONSTRAINT vehicle_types_pkey PRIMARY KEY (id);
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_registration_number_key UNIQUE (registration_number);
ALTER TABLE private.api_budget ADD CONSTRAINT api_budget_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE private.nearby_read_limits ADD CONSTRAINT nearby_read_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE private.push_outbox ADD CONSTRAINT push_outbox_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE private.push_outbox ADD CONSTRAINT push_outbox_request_id_fkey FOREIGN KEY (request_id) REFERENCES taxi_requests(id) ON DELETE CASCADE;
ALTER TABLE public.companies ADD CONSTRAINT companies_legal_verified_by_fkey FOREIGN KEY (legal_verified_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.driver_locations ADD CONSTRAINT driver_locations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE public.driver_locations ADD CONSTRAINT driver_locations_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_driver_user_id_fkey FOREIGN KEY (driver_user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_reference_id_fkey FOREIGN KEY (reference_id) REFERENCES driver_money_entries(id);
ALTER TABLE public.driver_money_entries ADD CONSTRAINT driver_money_entries_request_id_fkey FOREIGN KEY (request_id) REFERENCES taxi_requests(id) ON DELETE SET NULL;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE public.legal_acceptances ADD CONSTRAINT legal_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_request_id_fkey FOREIGN KEY (request_id) REFERENCES taxi_requests(id) ON DELETE RESTRICT;
ALTER TABLE public.privacy_requests ADD CONSTRAINT privacy_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.ratings ADD CONSTRAINT ratings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE public.ratings ADD CONSTRAINT ratings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.ratings ADD CONSTRAINT ratings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
ALTER TABLE public.ratings ADD CONSTRAINT ratings_request_id_fkey FOREIGN KEY (request_id) REFERENCES taxi_requests(id) ON DELETE RESTRICT;
ALTER TABLE public.request_declines ADD CONSTRAINT request_declines_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
ALTER TABLE public.request_declines ADD CONSTRAINT request_declines_request_id_fkey FOREIGN KEY (request_id) REFERENCES taxi_requests(id) ON DELETE CASCADE;
ALTER TABLE public.request_outcomes ADD CONSTRAINT request_outcomes_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.request_outcomes ADD CONSTRAINT request_outcomes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE public.request_outcomes ADD CONSTRAINT request_outcomes_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;
ALTER TABLE public.request_outcomes ADD CONSTRAINT request_outcomes_driver_user_id_fkey FOREIGN KEY (driver_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.request_outcomes ADD CONSTRAINT request_outcomes_request_id_fkey FOREIGN KEY (request_id) REFERENCES taxi_requests(id) ON DELETE CASCADE;
ALTER TABLE public.request_outcomes ADD CONSTRAINT request_outcomes_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE public.ride_quotes ADD CONSTRAINT ride_quotes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.ride_quotes ADD CONSTRAINT ride_quotes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id);
ALTER TABLE public.ride_quotes ADD CONSTRAINT ride_quotes_request_id_fkey FOREIGN KEY (request_id) REFERENCES taxi_requests(id);
ALTER TABLE public.ride_quotes ADD CONSTRAINT ride_quotes_vehicle_type_id_fkey FOREIGN KEY (vehicle_type_id) REFERENCES vehicle_types(id);
ALTER TABLE public.saved_places ADD CONSTRAINT saved_places_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.taxi_requests ADD CONSTRAINT taxi_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE public.taxi_requests ADD CONSTRAINT taxi_requests_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.taxi_requests ADD CONSTRAINT taxi_requests_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;
ALTER TABLE public.taxi_requests ADD CONSTRAINT taxi_requests_vehicle_type_id_fkey FOREIGN KEY (vehicle_type_id) REFERENCES vehicle_types(id) ON DELETE SET NULL;
ALTER TABLE public.trips ADD CONSTRAINT trips_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE public.trips ADD CONSTRAINT trips_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.trips ADD CONSTRAINT trips_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;
ALTER TABLE public.trips ADD CONSTRAINT trips_request_id_fkey FOREIGN KEY (request_id) REFERENCES taxi_requests(id) ON DELETE CASCADE;
ALTER TABLE public.vehicle_types ADD CONSTRAINT vehicle_types_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_vehicle_type_id_fkey FOREIGN KEY (vehicle_type_id) REFERENCES vehicle_types(id) ON DELETE RESTRICT;
CREATE INDEX carrier_reviewer_lookup ON public.companies USING btree (legal_verified_by) WHERE (legal_verified_by IS NOT NULL);
CREATE INDEX coupons_company_idx ON public.coupons USING btree (company_id);
CREATE INDEX document_reviewer_lookup ON public.driver_documents USING btree (reviewed_by) WHERE (reviewed_by IS NOT NULL);
CREATE INDEX driver_applications_company_status_idx ON public.driver_applications USING btree (company_id, status, created_at);
CREATE INDEX driver_applications_reviewer_idx ON public.driver_applications USING btree (reviewed_by) WHERE (reviewed_by IS NOT NULL);
CREATE INDEX driver_documents_driver_idx ON public.driver_documents USING btree (driver_id);
CREATE INDEX driver_documents_validity ON public.driver_documents USING btree (driver_id, type, status, expires_at);
CREATE INDEX driver_locations_company_idx ON public.driver_locations USING btree (company_id);
CREATE INDEX driver_locations_geo_idx ON public.driver_locations USING gist (geo);
CREATE INDEX drivers_company_online_idx ON public.drivers USING btree (company_id, is_online);
CREATE INDEX idx_audit_log_company_time ON public.audit_log USING btree (company_id, created_at DESC);
CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_ledger_company_time ON public.ledger USING btree (company_id, created_at DESC);
CREATE INDEX idx_ledger_transaction ON public.ledger USING btree (transaction_id);
CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions USING btree (user_id);
CREATE INDEX money_company_time ON public.driver_money_entries USING btree (company_id, recorded_at DESC, id);
CREATE INDEX money_driver_id_time ON public.driver_money_entries USING btree (driver_id, recorded_at DESC, id);
CREATE INDEX money_driver_time ON public.driver_money_entries USING btree (driver_user_id, recorded_at DESC, id);
CREATE INDEX money_income_request_lookup ON public.driver_money_entries USING btree (request_id) WHERE ((kind = 'income'::text) AND (request_id IS NOT NULL));
CREATE INDEX notifications_user_created_idx ON public.notifications USING btree (user_id, created_at DESC, id);
CREATE INDEX notifications_user_read_idx ON public.notifications USING btree (user_id, is_read);
CREATE INDEX outcomes_driver_id_time ON public.request_outcomes USING btree (driver_id, occurred_at DESC, id);
CREATE INDEX payment_transactions_company_idx ON public.payment_transactions USING btree (company_id);
CREATE INDEX payment_transactions_request_idx ON public.payment_transactions USING btree (request_id);
CREATE INDEX pending_requests_company_time ON public.taxi_requests USING btree (company_id, created_at) WHERE (status = 'pending'::request_status);
CREATE INDEX privacy_requests_owner_time ON public.privacy_requests USING btree (user_id, created_at DESC);
CREATE INDEX profiles_company_role_idx ON public.profiles USING btree (company_id, role);
CREATE INDEX push_outbox_due ON private.push_outbox USING btree (available_at) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));
CREATE INDEX push_outbox_recipient ON private.push_outbox USING btree (recipient_id);
CREATE INDEX ratings_company_idx ON public.ratings USING btree (company_id);
CREATE INDEX ratings_customer_id_idx ON public.ratings USING btree (customer_id);
CREATE INDEX ratings_driver_idx ON public.ratings USING btree (driver_id);
CREATE INDEX request_outcomes_company_time ON public.request_outcomes USING btree (company_id, occurred_at DESC, id);
CREATE INDEX request_outcomes_driver_time ON public.request_outcomes USING btree (driver_user_id, occurred_at DESC, id);
CREATE INDEX requests_company_completed_idx ON public.taxi_requests USING btree (company_id, completed_at) WHERE (status = 'completed'::request_status);
CREATE INDEX requests_company_customer_completed_idx ON public.taxi_requests USING btree (company_id, customer_id) WHERE (status = 'completed'::request_status);
CREATE INDEX requests_driver_completed_idx ON public.taxi_requests USING btree (driver_id, completed_at DESC) WHERE (status = 'completed'::request_status);
CREATE INDEX requests_vehicle_type_idx ON public.taxi_requests USING btree (vehicle_type_id);
CREATE INDEX ride_quotes_customer_time ON public.ride_quotes USING btree (customer_id, created_at);
CREATE INDEX route_budget_cleanup ON private.route_budget_usage USING btree (budget_day, updated_at);
CREATE INDEX saved_places_user_id_idx ON public.saved_places USING btree (user_id);
CREATE INDEX taxi_requests_company_created_idx ON public.taxi_requests USING btree (company_id, created_at DESC);
CREATE INDEX taxi_requests_company_status_idx ON public.taxi_requests USING btree (company_id, status);
CREATE INDEX taxi_requests_customer_idx ON public.taxi_requests USING btree (customer_id);
CREATE INDEX taxi_requests_driver_idx ON public.taxi_requests USING btree (driver_id);
CREATE INDEX taxi_requests_status_idx ON public.taxi_requests USING btree (status);
CREATE INDEX trips_company_created_idx ON public.trips USING btree (company_id, created_at DESC);
CREATE INDEX trips_driver_idx ON public.trips USING btree (driver_id);
CREATE INDEX vehicles_company_active_idx ON public.vehicles USING btree (company_id, is_active);
CREATE UNIQUE INDEX legal_current_unique ON private.legal_versions USING btree (is_current) WHERE is_current;
CREATE UNIQUE INDEX money_reference_kind_unique ON public.driver_money_entries USING btree (reference_id, kind) WHERE (reference_id IS NOT NULL);
CREATE UNIQUE INDEX one_active_ride_per_customer ON public.taxi_requests USING btree (customer_id) WHERE (status = ANY (ARRAY['pending'::request_status, 'accepted'::request_status, 'arrived'::request_status, 'in_progress'::request_status]));
CREATE UNIQUE INDEX one_active_ride_per_driver ON public.taxi_requests USING btree (driver_id) WHERE (status = ANY (ARRAY['accepted'::request_status, 'arrived'::request_status, 'in_progress'::request_status]));
CREATE UNIQUE INDEX privacy_open_unique ON public.privacy_requests USING btree (user_id, kind) WHERE (status = ANY (ARRAY['pending'::text, 'in_progress'::text]));
CREATE UNIQUE INDEX push_one_active_owner ON public.push_subscriptions USING btree (endpoint) WHERE is_active;
CREATE TRIGGER audit_document_validity AFTER UPDATE OF expires_at, file_url ON public.driver_documents FOR EACH ROW EXECUTE FUNCTION private.audit_document_validity_change();
CREATE TRIGGER enqueue_request_push AFTER INSERT OR UPDATE OF status ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.enqueue_request_push();
CREATE TRIGGER guard_accept_documents BEFORE UPDATE OF status ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.guard_dispatch_documents();
CREATE TRIGGER guard_bulgaria_coordinates BEFORE INSERT OR UPDATE OF latitude, longitude ON public.driver_locations FOR EACH ROW EXECUTE FUNCTION private.guard_bulgaria_coordinates();
CREATE TRIGGER guard_bulgaria_coordinates BEFORE INSERT OR UPDATE OF payload ON public.ride_quotes FOR EACH ROW EXECUTE FUNCTION private.guard_bulgaria_coordinates();
CREATE TRIGGER guard_bulgaria_coordinates BEFORE INSERT OR UPDATE OF pickup_latitude, pickup_longitude, destination_latitude, destination_longitude ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.guard_bulgaria_coordinates();
CREATE TRIGGER guard_bulgaria_online BEFORE INSERT OR UPDATE OF is_online ON public.drivers FOR EACH ROW EXECUTE FUNCTION private.guard_bulgaria_online();
CREATE TRIGGER guard_carrier_identity BEFORE INSERT OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION private.guard_carrier_identity();
CREATE TRIGGER guard_cash_request BEFORE INSERT ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.guard_cash_request();
CREATE TRIGGER guard_document_validity BEFORE INSERT OR UPDATE ON public.driver_documents FOR EACH ROW EXECUTE FUNCTION private.guard_document_validity();
CREATE TRIGGER guard_driver BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION private.guard_driver();
CREATE TRIGGER guard_driver_verification BEFORE INSERT OR UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION private.guard_driver_verification();
CREATE TRIGGER guard_legacy_insert BEFORE INSERT ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.guard_legacy_insert();
CREATE TRIGGER guard_location BEFORE INSERT OR UPDATE ON public.driver_locations FOR EACH ROW EXECUTE FUNCTION private.guard_location();
CREATE TRIGGER guard_online_documents BEFORE UPDATE OF is_online ON public.drivers FOR EACH ROW EXECUTE FUNCTION private.guard_dispatch_documents();
CREATE TRIGGER guard_profile BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.guard_profile();
CREATE TRIGGER guard_request BEFORE UPDATE ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.guard_request();
CREATE TRIGGER guard_request_dispatch BEFORE UPDATE ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.guard_request_dispatch();
CREATE TRIGGER news_articles_set_updated_at BEFORE UPDATE ON public.news_articles FOR EACH ROW EXECUTE FUNCTION news_articles_set_updated_at_fn();
CREATE TRIGGER record_request_outcome AFTER UPDATE ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.record_request_outcome();
CREATE TRIGGER taxi_request_audit_trigger AFTER UPDATE ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION log_taxi_request_status_change();
CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_create_trip_on_complete AFTER UPDATE ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION create_trip_on_complete();
CREATE TRIGGER trg_document_status_audit AFTER UPDATE ON public.driver_documents FOR EACH ROW EXECUTE FUNCTION log_document_status_change();
CREATE TRIGGER trg_driver_verify_audit AFTER UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION log_driver_verify_change();
CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_handle_new_user AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER trg_increment_driver_trip_count AFTER UPDATE ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION increment_driver_trip_count();
CREATE TRIGGER trg_profiles_driver_role AFTER INSERT OR UPDATE OF role, company_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION handle_driver_role();
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_taxi_requests_updated_at BEFORE UPDATE ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_update_driver_rating AFTER INSERT ON public.ratings FOR EACH ROW EXECUTE FUNCTION update_driver_rating();
CREATE TRIGGER trg_vehicle_assignment_audit AFTER UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION log_vehicle_assignment_change();
CREATE TRIGGER trg_vehicle_types_updated_at BEFORE UPDATE ON public.vehicle_types FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_vehicles_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER zz_guard_document_file BEFORE INSERT OR UPDATE ON public.driver_documents FOR EACH ROW EXECUTE FUNCTION private.guard_document_file();
ALTER TABLE private.api_budget DISABLE ROW LEVEL SECURITY;
ALTER TABLE private.legal_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.nearby_read_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.push_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.road_fetch_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.road_tiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.route_budget_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.route_budget_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_money_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_declines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxi_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_config_deny_all ON public.app_config AS PERMISSIVE FOR ALL TO public USING (false);
CREATE POLICY applications_read ON public.driver_applications AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY audit_log_select_admin ON public.audit_log AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND p.is_active AND ((p.role = 'SUPER_ADMIN'::user_role) OR ((p.role = 'COMPANY_ADMIN'::user_role) AND (p.company_id = audit_log.company_id)))))));
CREATE POLICY companies_insert_super_admin ON public.companies AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY companies_select_active ON public.companies AS PERMISSIVE FOR SELECT TO authenticated USING (((is_active = true) OR is_company_admin(id) OR is_super_admin()));
CREATE POLICY companies_update_admin ON public.companies AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_company_admin(id) OR is_super_admin())) WITH CHECK ((is_company_admin(id) OR is_super_admin()));
CREATE POLICY coupons_delete_admin ON public.coupons AS PERMISSIVE FOR DELETE TO authenticated USING ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY coupons_insert_admin ON public.coupons AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY coupons_select_member ON public.coupons AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_member(company_id) OR is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY coupons_update_admin ON public.coupons AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_company_admin(company_id) OR is_super_admin())) WITH CHECK ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY driver_documents_files_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'driver-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'::text) AND (EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.user_id = ( SELECT auth.uid() AS uid)) AND is_driver(d.id))))));
CREATE POLICY driver_documents_files_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'driver-documents'::text) AND private.can_read_driver_document(name)));
CREATE POLICY driver_documents_insert_driver ON public.driver_documents AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_driver(driver_id) AND (EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = driver_documents.driver_id) AND (d.company_id = driver_documents.company_id))))));
CREATE POLICY driver_documents_select_admin ON public.driver_documents AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY driver_documents_select_driver ON public.driver_documents AS PERMISSIVE FOR SELECT TO authenticated USING (is_driver(driver_id));
CREATE POLICY driver_documents_update_admin ON public.driver_documents AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_company_admin(company_id) OR is_super_admin())) WITH CHECK ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY driver_locations_insert_own ON public.driver_locations AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((driver_id = ( SELECT private.current_driver_id() AS current_driver_id)));
CREATE POLICY driver_locations_select_admin ON public.driver_locations AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY driver_locations_select_customer ON public.driver_locations AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM taxi_requests tr
  WHERE ((tr.driver_id = driver_locations.driver_id) AND (tr.customer_id = ( SELECT auth.uid() AS uid)) AND (tr.status <> ALL (ARRAY['completed'::request_status, 'cancelled'::request_status]))))));
CREATE POLICY driver_locations_select_driver ON public.driver_locations AS PERMISSIVE FOR SELECT TO authenticated USING ((driver_id = ( SELECT private.current_driver_id() AS current_driver_id)));
CREATE POLICY driver_locations_update_own ON public.driver_locations AS PERMISSIVE FOR UPDATE TO authenticated USING ((driver_id = ( SELECT private.current_driver_id() AS current_driver_id))) WITH CHECK ((driver_id = ( SELECT private.current_driver_id() AS current_driver_id)));
CREATE POLICY drivers_delete_admin ON public.drivers AS PERMISSIVE FOR DELETE TO authenticated USING ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY drivers_insert_admin ON public.drivers AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY drivers_select_admin ON public.drivers AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY drivers_select_authenticated ON public.drivers AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM taxi_requests r
  WHERE ((r.driver_id = drivers.id) AND (r.customer_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (r.status = ANY (ARRAY['accepted'::request_status, 'arrived'::request_status, 'in_progress'::request_status]))))));
CREATE POLICY drivers_select_own ON public.drivers AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY drivers_update_admin ON public.drivers AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin))) WITH CHECK ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY drivers_update_own ON public.drivers AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY ledger_select_admin ON public.ledger AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND p.is_active AND ((p.role = 'SUPER_ADMIN'::user_role) OR ((p.role = 'COMPANY_ADMIN'::user_role) AND (p.company_id = ledger.company_id)))))));
CREATE POLICY legal_acceptances_owner ON public.legal_acceptances AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY money_read ON public.driver_money_entries AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_admin(company_id) OR is_super_admin() OR ((driver_user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND p.is_active AND (p.role = 'DRIVER'::user_role)))))));
CREATE POLICY news_articles_admin_all ON public.news_articles AS PERMISSIVE FOR ALL TO public USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY news_articles_select_published ON public.news_articles AS PERMISSIVE FOR SELECT TO public USING (((status = 'published'::text) AND (published_at IS NOT NULL) AND (published_at <= now())));
CREATE POLICY notifications_insert_admin ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY notifications_select_admin ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY notifications_select_own ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY notifications_update_own ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY outcomes_read ON public.request_outcomes AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_admin(company_id) OR is_super_admin() OR ((driver_user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND p.is_active AND (p.role = 'DRIVER'::user_role)))))));
CREATE POLICY payment_transactions_insert_admin ON public.payment_transactions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY payment_transactions_select_admin ON public.payment_transactions AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY payment_transactions_select_customer ON public.payment_transactions AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM taxi_requests tr
  WHERE ((tr.id = payment_transactions.request_id) AND (tr.customer_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY payment_transactions_select_driver ON public.payment_transactions AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM taxi_requests tr
  WHERE ((tr.id = payment_transactions.request_id) AND is_driver(tr.driver_id)))));
CREATE POLICY privacy_requests_read ON public.privacy_requests AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY profiles_select_admin_company ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY profiles_select_own ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY profiles_select_trip_party ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (taxi_requests r
     JOIN drivers d ON ((d.id = r.driver_id)))
  WHERE (((r.customer_id = ( SELECT auth.uid() AS uid)) AND (d.user_id = profiles.id)) OR ((d.user_id = ( SELECT auth.uid() AS uid)) AND (r.customer_id = profiles.id))))));
CREATE POLICY profiles_update_admin_company ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin))) WITH CHECK ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY profiles_update_own ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY push_subscriptions_delete_own ON public.push_subscriptions AS PERMISSIVE FOR DELETE TO public USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY push_subscriptions_insert_own ON public.push_subscriptions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY push_subscriptions_select_own ON public.push_subscriptions AS PERMISSIVE FOR SELECT TO public USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY push_subscriptions_update_own ON public.push_subscriptions AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY quote_owner ON public.ride_quotes AS PERMISSIVE FOR SELECT TO authenticated USING ((customer_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY ratings_insert_customer ON public.ratings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((customer_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM taxi_requests r
  WHERE ((r.id = ratings.request_id) AND (r.customer_id = ratings.customer_id) AND (r.driver_id = ratings.driver_id) AND (r.company_id = ratings.company_id) AND (r.status = 'completed'::request_status))))));
CREATE POLICY ratings_select_admin ON public.ratings AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY ratings_select_customer ON public.ratings AS PERMISSIVE FOR SELECT TO authenticated USING ((customer_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY ratings_select_driver ON public.ratings AS PERMISSIVE FOR SELECT TO authenticated USING (is_driver(driver_id));
CREATE POLICY request_declines_delete ON public.request_declines AS PERMISSIVE FOR DELETE TO public USING (is_driver(driver_id));
CREATE POLICY request_declines_insert ON public.request_declines AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_driver(driver_id));
CREATE POLICY request_declines_select ON public.request_declines AS PERMISSIVE FOR SELECT TO public USING (is_driver(driver_id));
CREATE POLICY route_settings_service_read ON private.route_budget_settings AS PERMISSIVE FOR SELECT TO service_role USING (true);
CREATE POLICY route_usage_service_only ON private.route_budget_usage AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY saved_places_delete_own ON public.saved_places AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY saved_places_insert_own ON public.saved_places AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY saved_places_select_own ON public.saved_places AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY saved_places_update_own ON public.saved_places AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY taxi_requests_select_customer ON public.taxi_requests AS PERMISSIVE FOR SELECT TO authenticated USING ((customer_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY taxi_requests_select_driver ON public.taxi_requests AS PERMISSIVE FOR SELECT TO authenticated USING (((driver_id = ( SELECT private.current_driver_id() AS current_driver_id)) OR is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin) OR ((status = 'pending'::request_status) AND (clock_timestamp() < COALESCE(expires_at, (created_at + '00:02:00'::interval))) AND private.can_receive_request(company_id, vehicle_type_id, pickup_latitude, pickup_longitude))));
CREATE POLICY taxi_requests_update_admin ON public.taxi_requests AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin))) WITH CHECK ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY taxi_requests_update_customer ON public.taxi_requests AS PERMISSIVE FOR UPDATE TO authenticated USING ((customer_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((customer_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY taxi_requests_update_driver ON public.taxi_requests AS PERMISSIVE FOR UPDATE TO authenticated USING (((driver_id = ( SELECT private.current_driver_id() AS current_driver_id)) OR ((status = 'pending'::request_status) AND (clock_timestamp() < COALESCE(expires_at, (created_at + '00:02:00'::interval))) AND private.can_receive_request(company_id, vehicle_type_id, pickup_latitude, pickup_longitude)))) WITH CHECK (((driver_id = ( SELECT private.current_driver_id() AS current_driver_id)) OR is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY trips_select_admin ON public.trips AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
CREATE POLICY trips_select_customer ON public.trips AS PERMISSIVE FOR SELECT TO authenticated USING ((customer_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY trips_select_driver ON public.trips AS PERMISSIVE FOR SELECT TO authenticated USING ((driver_id = ( SELECT private.current_driver_id() AS current_driver_id)));
CREATE POLICY vehicle_types_delete_admin ON public.vehicle_types AS PERMISSIVE FOR DELETE TO authenticated USING ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY vehicle_types_insert_admin ON public.vehicle_types AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY vehicle_types_select_active ON public.vehicle_types AS PERMISSIVE FOR SELECT TO authenticated USING ((is_active = true));
CREATE POLICY vehicle_types_select_member ON public.vehicle_types AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_member(company_id) OR is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY vehicle_types_update_admin ON public.vehicle_types AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_company_admin(company_id) OR is_super_admin())) WITH CHECK ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY vehicles_delete_admin ON public.vehicles AS PERMISSIVE FOR DELETE TO authenticated USING ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY vehicles_insert_admin ON public.vehicles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY vehicles_select_member ON public.vehicles AS PERMISSIVE FOR SELECT TO authenticated USING ((is_company_member(company_id) OR is_company_admin(company_id) OR is_super_admin()));
CREATE POLICY vehicles_select_trip_party ON public.vehicles AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (drivers d
     JOIN taxi_requests r ON ((r.driver_id = d.id)))
  WHERE ((d.vehicle_id = vehicles.id) AND (r.customer_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY vehicles_update_admin ON public.vehicles AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_company_admin(company_id) OR is_super_admin())) WITH CHECK ((is_company_admin(company_id) OR is_super_admin()));
REVOKE ALL ON FUNCTION private.accept_legal_versions(p_terms text, p_privacy text, p_method text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.audit_document_validity_change() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.can_read_driver_document(p_name text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.can_receive_request(p_company uuid, p_type uuid, p_lat double precision, p_lng double precision) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.current_driver_id() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.dispatch_push_outbox() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.driver_documents_ready(p_driver uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.driver_verification_report(p_driver uuid, p_vehicle uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.eligible_drivers(p_company uuid, p_type uuid, p_lat double precision, p_lng double precision, p_user uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.enqueue_request_push() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_bulgaria_coordinates() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_bulgaria_online() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_carrier_identity() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_cash_request() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_dispatch_documents() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_document_file() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_document_validity() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_driver() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_driver_verification() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_legacy_insert() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_location() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_profile() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_request() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_request_dispatch() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.in_bulgaria(p_lat double precision, p_lng double precision) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.maintain_dispatch() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.nearby_cars(p_lat double precision, p_lng double precision, p_type uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.record_driver_money(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid, p_reference_id uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.record_driver_money_core(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid, p_reference_id uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.record_driver_money_verified(p_id uuid, p_kind text, p_amount numeric, p_note text, p_actor uuid, p_request_id uuid, p_reference_id uuid, p_source text, p_evidence_ref text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.record_request_outcome() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.request_personal_data(p_kind text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.reserve_route_request(p_user_id uuid, p_request_id uuid, p_quote boolean, p_origin_lat double precision, p_origin_lng double precision, p_destination_lat double precision, p_destination_lng double precision, p_purpose text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.resolve_privacy_request(p_id uuid, p_status text, p_note text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.road_tile_cache(p_key text, p_roads jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.accept_legal_versions(p_terms text, p_privacy text, p_method text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.accept_taxi_request(p_request_id uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.accounting_report(p_from date, p_until date, p_company_id uuid, p_driver_id uuid, p_page integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.carrier_identity(p_company uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_push_job(p_job_id uuid, p_lease_token uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.company_customers(p_company uuid, p_search text, p_page integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.company_dashboard(p_company_id uuid, p_day date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.company_fleet(p_company uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.consume_api_budget(p_user_id uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_taxi_request(p_quote_id uuid, p_request_id uuid, p_payment_method payment_method) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_trip_on_complete() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.driver_day_summary(p_driver_id uuid, p_day date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.driver_verification_status(p_driver uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.expire_stale_requests() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.export_my_basic_data() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.finish_push_job(p_job_id uuid, p_lease_token uuid, p_result text, p_error text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.handle_driver_role() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.increment_driver_trip_count() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.is_company_admin(target_company uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.is_company_member(target_company uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.is_driver(target_driver uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.is_driver_of_company(target_company uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.log_document_status_change() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.log_driver_verify_change() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.log_taxi_request_status_change() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.log_vehicle_assignment_change() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.nearby_cars(p_lat double precision, p_lng double precision, p_type uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.news_articles_set_updated_at_fn() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_driver_money(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid, p_reference_id uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_driver_money_verified(p_id uuid, p_kind text, p_amount numeric, p_note text, p_actor uuid, p_request_id uuid, p_reference_id uuid, p_source text, p_evidence_ref text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.register_driver_document(p_id uuid, p_type document_type, p_expires date, p_path text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.request_personal_data(p_kind text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.request_push_recipients(p_request_id uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.reserve_route_request(p_user_id uuid, p_request_id uuid, p_quote boolean, p_origin_lat double precision, p_origin_lng double precision, p_destination_lat double precision, p_destination_lng double precision, p_purpose text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.resolve_privacy_request(p_id uuid, p_status text, p_note text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.review_driver_application(p_id uuid, p_decision text, p_note text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.road_tile_cache(p_key text, p_roads jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.save_driver_vehicle(p_id uuid, p_company uuid, p_driver uuid, p_expected_driver uuid, p_details jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.submit_driver_application(p_company uuid, p_full_name text, p_phone text, p_experience text, p_has_vehicle boolean, p_message text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.sweep_stuck_requests(max_age_minutes integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.update_driver_rating() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.wake_request_push(p_request_id uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON private.api_budget FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON private.legal_versions FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON private.nearby_read_limits FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON private.push_outbox FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON private.road_fetch_budget FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON private.road_tiles FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON private.route_budget_settings FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON private.route_budget_usage FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.app_config FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.audit_log FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.companies FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.coupons FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.driver_applications FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.driver_documents FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.driver_locations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.driver_money_entries FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.drivers FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.ledger FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.legal_acceptances FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.news_articles FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.notifications FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.payment_transactions FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.privacy_requests FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.profiles FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.ratings FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.request_declines FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.request_outcomes FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.ride_quotes FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.saved_places FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.taxi_requests FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.trips FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.vehicle_types FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.vehicles FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE ON private.route_budget_usage TO service_role;
GRANT DELETE ON public.app_config TO authenticated;
GRANT DELETE ON public.app_config TO service_role;
GRANT DELETE ON public.audit_log TO authenticated;
GRANT DELETE ON public.audit_log TO service_role;
GRANT DELETE ON public.companies TO authenticated;
GRANT DELETE ON public.companies TO service_role;
GRANT DELETE ON public.coupons TO authenticated;
GRANT DELETE ON public.coupons TO service_role;
GRANT DELETE ON public.driver_applications TO service_role;
GRANT DELETE ON public.driver_documents TO authenticated;
GRANT DELETE ON public.driver_documents TO service_role;
GRANT DELETE ON public.driver_locations TO authenticated;
GRANT DELETE ON public.driver_locations TO service_role;
GRANT DELETE ON public.driver_money_entries TO service_role;
GRANT DELETE ON public.drivers TO authenticated;
GRANT DELETE ON public.drivers TO service_role;
GRANT DELETE ON public.ledger TO authenticated;
GRANT DELETE ON public.ledger TO service_role;
GRANT DELETE ON public.legal_acceptances TO service_role;
GRANT DELETE ON public.news_articles TO authenticated;
GRANT DELETE ON public.news_articles TO service_role;
GRANT DELETE ON public.notifications TO authenticated;
GRANT DELETE ON public.notifications TO service_role;
GRANT DELETE ON public.payment_transactions TO authenticated;
GRANT DELETE ON public.payment_transactions TO service_role;
GRANT DELETE ON public.privacy_requests TO service_role;
GRANT DELETE ON public.profiles TO authenticated;
GRANT DELETE ON public.profiles TO service_role;
GRANT DELETE ON public.push_subscriptions TO authenticated;
GRANT DELETE ON public.push_subscriptions TO service_role;
GRANT DELETE ON public.ratings TO authenticated;
GRANT DELETE ON public.ratings TO service_role;
GRANT DELETE ON public.request_declines TO authenticated;
GRANT DELETE ON public.request_declines TO service_role;
GRANT DELETE ON public.request_outcomes TO service_role;
GRANT DELETE ON public.ride_quotes TO service_role;
GRANT DELETE ON public.saved_places TO authenticated;
GRANT DELETE ON public.saved_places TO service_role;
GRANT DELETE ON public.taxi_requests TO authenticated;
GRANT DELETE ON public.taxi_requests TO service_role;
GRANT DELETE ON public.trips TO service_role;
GRANT DELETE ON public.vehicle_types TO authenticated;
GRANT DELETE ON public.vehicle_types TO service_role;
GRANT DELETE ON public.vehicles TO authenticated;
GRANT DELETE ON public.vehicles TO service_role;
GRANT EXECUTE ON FUNCTION private.accept_legal_versions(p_terms text, p_privacy text, p_method text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_driver_document(p_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_receive_request(p_company uuid, p_type uuid, p_lat double precision, p_lng double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_driver_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.driver_documents_ready(p_driver uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.driver_verification_report(p_driver uuid, p_vehicle uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.in_bulgaria(p_lat double precision, p_lng double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION private.in_bulgaria(p_lat double precision, p_lng double precision) TO service_role;
GRANT EXECUTE ON FUNCTION private.nearby_cars(p_lat double precision, p_lng double precision, p_type uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.record_driver_money(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid, p_reference_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.record_driver_money_verified(p_id uuid, p_kind text, p_amount numeric, p_note text, p_actor uuid, p_request_id uuid, p_reference_id uuid, p_source text, p_evidence_ref text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.request_personal_data(p_kind text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.reserve_route_request(p_user_id uuid, p_request_id uuid, p_quote boolean, p_origin_lat double precision, p_origin_lng double precision, p_destination_lat double precision, p_destination_lng double precision, p_purpose text) TO service_role;
GRANT EXECUTE ON FUNCTION private.resolve_privacy_request(p_id uuid, p_status text, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.road_tile_cache(p_key text, p_roads jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_legal_versions(p_terms text, p_privacy text, p_method text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_legal_versions(p_terms text, p_privacy text, p_method text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_taxi_request(p_request_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_taxi_request(p_request_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_report(p_from date, p_until date, p_company_id uuid, p_driver_id uuid, p_page integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_report(p_from date, p_until date, p_company_id uuid, p_driver_id uuid, p_page integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.carrier_identity(p_company uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carrier_identity(p_company uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_push_job(p_job_id uuid, p_lease_token uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.company_customers(p_company uuid, p_search text, p_page integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_customers(p_company uuid, p_search text, p_page integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.company_dashboard(p_company_id uuid, p_day date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_fleet(p_company uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_fleet(p_company uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_api_budget(p_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_taxi_request(p_quote_id uuid, p_request_id uuid, p_payment_method payment_method) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_taxi_request(p_quote_id uuid, p_request_id uuid, p_payment_method payment_method) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_trip_on_complete() TO service_role;
GRANT EXECUTE ON FUNCTION public.driver_day_summary(p_driver_id uuid, p_day date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_verification_status(p_driver uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_verification_status(p_driver uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_requests() TO service_role;
GRANT EXECUTE ON FUNCTION public.export_my_basic_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_basic_data() TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_push_job(p_job_id uuid, p_lease_token uuid, p_result text, p_error text) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_driver_role() TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_driver_trip_count() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_company_admin(target_company uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_admin(target_company uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_company_admin(target_company uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_admin(target_company uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_company_member(target_company uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_member(target_company uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_company_member(target_company uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_member(target_company uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_driver(target_driver uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_driver(target_driver uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_driver(target_driver uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_driver(target_driver uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_driver_of_company(target_company uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_driver_of_company(target_company uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_driver_of_company(target_company uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_driver_of_company(target_company uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.log_document_status_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.log_driver_verify_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.log_taxi_request_status_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.log_vehicle_assignment_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.nearby_cars(p_lat double precision, p_lng double precision, p_type uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nearby_cars(p_lat double precision, p_lng double precision, p_type uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.news_articles_set_updated_at_fn() TO service_role;
GRANT EXECUTE ON FUNCTION public.record_driver_money(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid, p_reference_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_driver_money(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid, p_reference_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_driver_money_verified(p_id uuid, p_kind text, p_amount numeric, p_note text, p_actor uuid, p_request_id uuid, p_reference_id uuid, p_source text, p_evidence_ref text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_driver_money_verified(p_id uuid, p_kind text, p_amount numeric, p_note text, p_actor uuid, p_request_id uuid, p_reference_id uuid, p_source text, p_evidence_ref text) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_driver_document(p_id uuid, p_type document_type, p_expires date, p_path text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_driver_document(p_id uuid, p_type document_type, p_expires date, p_path text) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_personal_data(p_kind text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_personal_data(p_kind text) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_push_recipients(p_request_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_route_request(p_user_id uuid, p_request_id uuid, p_quote boolean, p_origin_lat double precision, p_origin_lng double precision, p_destination_lat double precision, p_destination_lng double precision, p_purpose text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_privacy_request(p_id uuid, p_status text, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_privacy_request(p_id uuid, p_status text, p_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_driver_application(p_id uuid, p_decision text, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_driver_application(p_id uuid, p_decision text, p_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.road_tile_cache(p_key text, p_roads jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_driver_vehicle(p_id uuid, p_company uuid, p_driver uuid, p_expected_driver uuid, p_details jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_driver_vehicle(p_id uuid, p_company uuid, p_driver uuid, p_expected_driver uuid, p_details jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_driver_application(p_company uuid, p_full_name text, p_phone text, p_experience text, p_has_vehicle boolean, p_message text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_driver_application(p_company uuid, p_full_name text, p_phone text, p_experience text, p_has_vehicle boolean, p_message text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_stuck_requests(max_age_minutes integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_driver_rating() TO service_role;
GRANT EXECUTE ON FUNCTION public.wake_request_push(p_request_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wake_request_push(p_request_id uuid) TO service_role;
GRANT INSERT ON private.route_budget_usage TO service_role;
GRANT INSERT ON public.app_config TO authenticated;
GRANT INSERT ON public.app_config TO service_role;
GRANT INSERT ON public.audit_log TO authenticated;
GRANT INSERT ON public.audit_log TO service_role;
GRANT INSERT ON public.companies TO authenticated;
GRANT INSERT ON public.companies TO service_role;
GRANT INSERT ON public.coupons TO authenticated;
GRANT INSERT ON public.coupons TO service_role;
GRANT INSERT ON public.driver_applications TO service_role;
GRANT INSERT ON public.driver_documents TO service_role;
GRANT INSERT ON public.driver_locations TO authenticated;
GRANT INSERT ON public.driver_locations TO service_role;
GRANT INSERT ON public.driver_money_entries TO service_role;
GRANT INSERT ON public.drivers TO authenticated;
GRANT INSERT ON public.drivers TO service_role;
GRANT INSERT ON public.ledger TO authenticated;
GRANT INSERT ON public.ledger TO service_role;
GRANT INSERT ON public.legal_acceptances TO service_role;
GRANT INSERT ON public.news_articles TO authenticated;
GRANT INSERT ON public.news_articles TO service_role;
GRANT INSERT ON public.notifications TO authenticated;
GRANT INSERT ON public.notifications TO service_role;
GRANT INSERT ON public.payment_transactions TO authenticated;
GRANT INSERT ON public.payment_transactions TO service_role;
GRANT INSERT ON public.privacy_requests TO service_role;
GRANT INSERT ON public.profiles TO authenticated;
GRANT INSERT ON public.profiles TO service_role;
GRANT INSERT ON public.push_subscriptions TO service_role;
GRANT INSERT ON public.ratings TO authenticated;
GRANT INSERT ON public.ratings TO service_role;
GRANT INSERT ON public.request_declines TO authenticated;
GRANT INSERT ON public.request_declines TO service_role;
GRANT INSERT ON public.request_outcomes TO service_role;
GRANT INSERT ON public.ride_quotes TO service_role;
GRANT INSERT ON public.saved_places TO authenticated;
GRANT INSERT ON public.saved_places TO service_role;
GRANT INSERT ON public.taxi_requests TO service_role;
GRANT INSERT ON public.trips TO service_role;
GRANT INSERT ON public.vehicle_types TO authenticated;
GRANT INSERT ON public.vehicle_types TO service_role;
GRANT INSERT ON public.vehicles TO authenticated;
GRANT INSERT ON public.vehicles TO service_role;
GRANT MAINTAIN ON public.app_config TO anon;
GRANT MAINTAIN ON public.app_config TO authenticated;
GRANT MAINTAIN ON public.app_config TO service_role;
GRANT MAINTAIN ON public.audit_log TO anon;
GRANT MAINTAIN ON public.audit_log TO authenticated;
GRANT MAINTAIN ON public.audit_log TO service_role;
GRANT MAINTAIN ON public.companies TO anon;
GRANT MAINTAIN ON public.companies TO authenticated;
GRANT MAINTAIN ON public.companies TO service_role;
GRANT MAINTAIN ON public.coupons TO anon;
GRANT MAINTAIN ON public.coupons TO authenticated;
GRANT MAINTAIN ON public.coupons TO service_role;
GRANT MAINTAIN ON public.driver_applications TO service_role;
GRANT MAINTAIN ON public.driver_documents TO anon;
GRANT MAINTAIN ON public.driver_documents TO authenticated;
GRANT MAINTAIN ON public.driver_documents TO service_role;
GRANT MAINTAIN ON public.driver_locations TO anon;
GRANT MAINTAIN ON public.driver_locations TO authenticated;
GRANT MAINTAIN ON public.driver_locations TO service_role;
GRANT MAINTAIN ON public.driver_money_entries TO service_role;
GRANT MAINTAIN ON public.drivers TO anon;
GRANT MAINTAIN ON public.drivers TO authenticated;
GRANT MAINTAIN ON public.drivers TO service_role;
GRANT MAINTAIN ON public.ledger TO anon;
GRANT MAINTAIN ON public.ledger TO authenticated;
GRANT MAINTAIN ON public.ledger TO service_role;
GRANT MAINTAIN ON public.legal_acceptances TO service_role;
GRANT MAINTAIN ON public.news_articles TO anon;
GRANT MAINTAIN ON public.news_articles TO authenticated;
GRANT MAINTAIN ON public.news_articles TO service_role;
GRANT MAINTAIN ON public.notifications TO anon;
GRANT MAINTAIN ON public.notifications TO authenticated;
GRANT MAINTAIN ON public.notifications TO service_role;
GRANT MAINTAIN ON public.payment_transactions TO anon;
GRANT MAINTAIN ON public.payment_transactions TO authenticated;
GRANT MAINTAIN ON public.payment_transactions TO service_role;
GRANT MAINTAIN ON public.privacy_requests TO service_role;
GRANT MAINTAIN ON public.profiles TO anon;
GRANT MAINTAIN ON public.profiles TO authenticated;
GRANT MAINTAIN ON public.profiles TO service_role;
GRANT MAINTAIN ON public.push_subscriptions TO anon;
GRANT MAINTAIN ON public.push_subscriptions TO authenticated;
GRANT MAINTAIN ON public.push_subscriptions TO service_role;
GRANT MAINTAIN ON public.ratings TO anon;
GRANT MAINTAIN ON public.ratings TO authenticated;
GRANT MAINTAIN ON public.ratings TO service_role;
GRANT MAINTAIN ON public.request_declines TO anon;
GRANT MAINTAIN ON public.request_declines TO authenticated;
GRANT MAINTAIN ON public.request_declines TO service_role;
GRANT MAINTAIN ON public.request_outcomes TO service_role;
GRANT MAINTAIN ON public.ride_quotes TO service_role;
GRANT MAINTAIN ON public.saved_places TO anon;
GRANT MAINTAIN ON public.saved_places TO authenticated;
GRANT MAINTAIN ON public.saved_places TO service_role;
GRANT MAINTAIN ON public.taxi_requests TO anon;
GRANT MAINTAIN ON public.taxi_requests TO authenticated;
GRANT MAINTAIN ON public.taxi_requests TO service_role;
GRANT MAINTAIN ON public.trips TO anon;
GRANT MAINTAIN ON public.trips TO authenticated;
GRANT MAINTAIN ON public.trips TO service_role;
GRANT MAINTAIN ON public.vehicle_types TO anon;
GRANT MAINTAIN ON public.vehicle_types TO authenticated;
GRANT MAINTAIN ON public.vehicle_types TO service_role;
GRANT MAINTAIN ON public.vehicles TO anon;
GRANT MAINTAIN ON public.vehicles TO authenticated;
GRANT MAINTAIN ON public.vehicles TO service_role;
GRANT REFERENCES ON public.app_config TO service_role;
GRANT REFERENCES ON public.audit_log TO service_role;
GRANT REFERENCES ON public.companies TO service_role;
GRANT REFERENCES ON public.coupons TO service_role;
GRANT REFERENCES ON public.driver_applications TO service_role;
GRANT REFERENCES ON public.driver_documents TO service_role;
GRANT REFERENCES ON public.driver_locations TO service_role;
GRANT REFERENCES ON public.driver_money_entries TO service_role;
GRANT REFERENCES ON public.drivers TO service_role;
GRANT REFERENCES ON public.ledger TO service_role;
GRANT REFERENCES ON public.legal_acceptances TO service_role;
GRANT REFERENCES ON public.news_articles TO service_role;
GRANT REFERENCES ON public.notifications TO service_role;
GRANT REFERENCES ON public.payment_transactions TO service_role;
GRANT REFERENCES ON public.privacy_requests TO service_role;
GRANT REFERENCES ON public.profiles TO service_role;
GRANT REFERENCES ON public.push_subscriptions TO service_role;
GRANT REFERENCES ON public.ratings TO service_role;
GRANT REFERENCES ON public.request_declines TO service_role;
GRANT REFERENCES ON public.request_outcomes TO service_role;
GRANT REFERENCES ON public.ride_quotes TO service_role;
GRANT REFERENCES ON public.saved_places TO service_role;
GRANT REFERENCES ON public.taxi_requests TO service_role;
GRANT REFERENCES ON public.trips TO service_role;
GRANT REFERENCES ON public.vehicle_types TO service_role;
GRANT REFERENCES ON public.vehicles TO service_role;
GRANT SELECT ON private.route_budget_settings TO service_role;
GRANT SELECT ON private.route_budget_usage TO service_role;
GRANT SELECT ON public.app_config TO anon;
GRANT SELECT ON public.app_config TO authenticated;
GRANT SELECT ON public.app_config TO service_role;
GRANT SELECT ON public.audit_log TO anon;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT ON public.audit_log TO service_role;
GRANT SELECT ON public.companies TO anon;
GRANT SELECT ON public.companies TO authenticated;
GRANT SELECT ON public.companies TO service_role;
GRANT SELECT ON public.coupons TO anon;
GRANT SELECT ON public.coupons TO authenticated;
GRANT SELECT ON public.coupons TO service_role;
GRANT SELECT ON public.driver_applications TO authenticated;
GRANT SELECT ON public.driver_applications TO service_role;
GRANT SELECT ON public.driver_documents TO anon;
GRANT SELECT ON public.driver_documents TO authenticated;
GRANT SELECT ON public.driver_documents TO service_role;
GRANT SELECT ON public.driver_locations TO anon;
GRANT SELECT ON public.driver_locations TO authenticated;
GRANT SELECT ON public.driver_locations TO service_role;
GRANT SELECT ON public.driver_money_entries TO authenticated;
GRANT SELECT ON public.driver_money_entries TO service_role;
GRANT SELECT ON public.drivers TO anon;
GRANT SELECT ON public.drivers TO authenticated;
GRANT SELECT ON public.drivers TO service_role;
GRANT SELECT ON public.ledger TO anon;
GRANT SELECT ON public.ledger TO authenticated;
GRANT SELECT ON public.ledger TO service_role;
GRANT SELECT ON public.legal_acceptances TO authenticated;
GRANT SELECT ON public.legal_acceptances TO service_role;
GRANT SELECT ON public.news_articles TO anon;
GRANT SELECT ON public.news_articles TO authenticated;
GRANT SELECT ON public.news_articles TO service_role;
GRANT SELECT ON public.notifications TO anon;
GRANT SELECT ON public.notifications TO authenticated;
GRANT SELECT ON public.notifications TO service_role;
GRANT SELECT ON public.payment_transactions TO anon;
GRANT SELECT ON public.payment_transactions TO authenticated;
GRANT SELECT ON public.payment_transactions TO service_role;
GRANT SELECT ON public.privacy_requests TO authenticated;
GRANT SELECT ON public.privacy_requests TO service_role;
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO service_role;
GRANT SELECT ON public.push_subscriptions TO anon;
GRANT SELECT ON public.push_subscriptions TO authenticated;
GRANT SELECT ON public.push_subscriptions TO service_role;
GRANT SELECT ON public.ratings TO anon;
GRANT SELECT ON public.ratings TO authenticated;
GRANT SELECT ON public.ratings TO service_role;
GRANT SELECT ON public.request_declines TO anon;
GRANT SELECT ON public.request_declines TO authenticated;
GRANT SELECT ON public.request_declines TO service_role;
GRANT SELECT ON public.request_outcomes TO authenticated;
GRANT SELECT ON public.request_outcomes TO service_role;
GRANT SELECT ON public.ride_quotes TO authenticated;
GRANT SELECT ON public.ride_quotes TO service_role;
GRANT SELECT ON public.saved_places TO anon;
GRANT SELECT ON public.saved_places TO authenticated;
GRANT SELECT ON public.saved_places TO service_role;
GRANT SELECT ON public.taxi_requests TO anon;
GRANT SELECT ON public.taxi_requests TO authenticated;
GRANT SELECT ON public.taxi_requests TO service_role;
GRANT SELECT ON public.trips TO anon;
GRANT SELECT ON public.trips TO authenticated;
GRANT SELECT ON public.trips TO service_role;
GRANT SELECT ON public.vehicle_types TO anon;
GRANT SELECT ON public.vehicle_types TO authenticated;
GRANT SELECT ON public.vehicle_types TO service_role;
GRANT SELECT ON public.vehicles TO anon;
GRANT SELECT ON public.vehicles TO authenticated;
GRANT SELECT ON public.vehicles TO service_role;
GRANT TRIGGER ON public.app_config TO service_role;
GRANT TRIGGER ON public.audit_log TO service_role;
GRANT TRIGGER ON public.companies TO service_role;
GRANT TRIGGER ON public.coupons TO service_role;
GRANT TRIGGER ON public.driver_applications TO service_role;
GRANT TRIGGER ON public.driver_documents TO service_role;
GRANT TRIGGER ON public.driver_locations TO service_role;
GRANT TRIGGER ON public.driver_money_entries TO service_role;
GRANT TRIGGER ON public.drivers TO service_role;
GRANT TRIGGER ON public.ledger TO service_role;
GRANT TRIGGER ON public.legal_acceptances TO service_role;
GRANT TRIGGER ON public.news_articles TO service_role;
GRANT TRIGGER ON public.notifications TO service_role;
GRANT TRIGGER ON public.payment_transactions TO service_role;
GRANT TRIGGER ON public.privacy_requests TO service_role;
GRANT TRIGGER ON public.profiles TO service_role;
GRANT TRIGGER ON public.push_subscriptions TO service_role;
GRANT TRIGGER ON public.ratings TO service_role;
GRANT TRIGGER ON public.request_declines TO service_role;
GRANT TRIGGER ON public.request_outcomes TO service_role;
GRANT TRIGGER ON public.ride_quotes TO service_role;
GRANT TRIGGER ON public.saved_places TO service_role;
GRANT TRIGGER ON public.taxi_requests TO service_role;
GRANT TRIGGER ON public.trips TO service_role;
GRANT TRIGGER ON public.vehicle_types TO service_role;
GRANT TRIGGER ON public.vehicles TO service_role;
GRANT TRUNCATE ON public.app_config TO service_role;
GRANT TRUNCATE ON public.audit_log TO service_role;
GRANT TRUNCATE ON public.companies TO service_role;
GRANT TRUNCATE ON public.coupons TO service_role;
GRANT TRUNCATE ON public.driver_applications TO service_role;
GRANT TRUNCATE ON public.driver_documents TO service_role;
GRANT TRUNCATE ON public.driver_locations TO service_role;
GRANT TRUNCATE ON public.driver_money_entries TO service_role;
GRANT TRUNCATE ON public.drivers TO service_role;
GRANT TRUNCATE ON public.ledger TO service_role;
GRANT TRUNCATE ON public.legal_acceptances TO service_role;
GRANT TRUNCATE ON public.news_articles TO service_role;
GRANT TRUNCATE ON public.notifications TO service_role;
GRANT TRUNCATE ON public.payment_transactions TO service_role;
GRANT TRUNCATE ON public.privacy_requests TO service_role;
GRANT TRUNCATE ON public.profiles TO service_role;
GRANT TRUNCATE ON public.push_subscriptions TO service_role;
GRANT TRUNCATE ON public.ratings TO service_role;
GRANT TRUNCATE ON public.request_declines TO service_role;
GRANT TRUNCATE ON public.request_outcomes TO service_role;
GRANT TRUNCATE ON public.ride_quotes TO service_role;
GRANT TRUNCATE ON public.saved_places TO service_role;
GRANT TRUNCATE ON public.taxi_requests TO service_role;
GRANT TRUNCATE ON public.trips TO service_role;
GRANT TRUNCATE ON public.vehicle_types TO service_role;
GRANT TRUNCATE ON public.vehicles TO service_role;
GRANT UPDATE ON private.route_budget_usage TO service_role;
GRANT UPDATE ON public.app_config TO authenticated;
GRANT UPDATE ON public.app_config TO service_role;
GRANT UPDATE ON public.audit_log TO authenticated;
GRANT UPDATE ON public.audit_log TO service_role;
GRANT UPDATE ON public.companies TO authenticated;
GRANT UPDATE ON public.companies TO service_role;
GRANT UPDATE ON public.coupons TO authenticated;
GRANT UPDATE ON public.coupons TO service_role;
GRANT UPDATE ON public.driver_applications TO service_role;
GRANT UPDATE ON public.driver_documents TO authenticated;
GRANT UPDATE ON public.driver_documents TO service_role;
GRANT UPDATE ON public.driver_locations TO authenticated;
GRANT UPDATE ON public.driver_locations TO service_role;
GRANT UPDATE ON public.driver_money_entries TO service_role;
GRANT UPDATE ON public.drivers TO authenticated;
GRANT UPDATE ON public.drivers TO service_role;
GRANT UPDATE ON public.ledger TO authenticated;
GRANT UPDATE ON public.ledger TO service_role;
GRANT UPDATE ON public.legal_acceptances TO service_role;
GRANT UPDATE ON public.news_articles TO authenticated;
GRANT UPDATE ON public.news_articles TO service_role;
GRANT UPDATE ON public.notifications TO authenticated;
GRANT UPDATE ON public.notifications TO service_role;
GRANT UPDATE ON public.payment_transactions TO authenticated;
GRANT UPDATE ON public.payment_transactions TO service_role;
GRANT UPDATE ON public.privacy_requests TO service_role;
GRANT UPDATE ON public.profiles TO authenticated;
GRANT UPDATE ON public.profiles TO service_role;
GRANT UPDATE ON public.push_subscriptions TO service_role;
GRANT UPDATE ON public.ratings TO authenticated;
GRANT UPDATE ON public.ratings TO service_role;
GRANT UPDATE ON public.request_declines TO authenticated;
GRANT UPDATE ON public.request_declines TO service_role;
GRANT UPDATE ON public.request_outcomes TO service_role;
GRANT UPDATE ON public.ride_quotes TO service_role;
GRANT UPDATE ON public.saved_places TO authenticated;
GRANT UPDATE ON public.saved_places TO service_role;
GRANT UPDATE ON public.taxi_requests TO authenticated;
GRANT UPDATE ON public.taxi_requests TO service_role;
GRANT UPDATE ON public.trips TO service_role;
GRANT UPDATE ON public.vehicle_types TO authenticated;
GRANT UPDATE ON public.vehicle_types TO service_role;
GRANT UPDATE ON public.vehicles TO authenticated;
GRANT UPDATE ON public.vehicles TO service_role;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
INSERT INTO private.legal_versions(terms_version,privacy_version,source_digest,is_current) VALUES('2026-10-03-draft.2','2026-10-04.2','7ef2efe56f86edb88aa1c75ec5f9f538ea224f022dfbe58b67544b1674ea5a75','t');
INSERT INTO private.route_budget_settings(singleton) VALUES(true);

INSERT INTO storage.buckets(id,name,public) VALUES('driver-documents','driver-documents',false) ON CONFLICT DO NOTHING;
