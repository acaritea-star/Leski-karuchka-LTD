CREATE TABLE private.api_budget(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,window_at timestamptz NOT NULL,hits integer NOT NULL);
CREATE OR REPLACE FUNCTION public.consume_api_budget(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 INSERT INTO private.api_budget VALUES(p_user_id,now(),1)
 ON CONFLICT(user_id) DO UPDATE SET
 hits=CASE WHEN private.api_budget.window_at<now()-interval '1 minute' THEN 1 ELSE private.api_budget.hits+1 END,
 window_at=CASE WHEN private.api_budget.window_at<now()-interval '1 minute' THEN now() ELSE private.api_budget.window_at END
 RETURNING hits INTO n;
 RETURN n<=60;
END $$;
REVOKE ALL ON FUNCTION public.consume_api_budget(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_budget(uuid) TO service_role;
