-- The Edge quote writer calls a schema-qualified geography helper through a
-- trigger. EXECUTE on the helper also requires USAGE on its private schema.
-- Do not expose private through the Data API or grant this access to anon.
GRANT USAGE ON SCHEMA private TO service_role;
