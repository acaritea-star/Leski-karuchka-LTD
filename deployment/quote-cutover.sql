DROP POLICY IF EXISTS taxi_requests_insert_customer ON public.taxi_requests;
REVOKE INSERT ON public.taxi_requests FROM anon,authenticated;
