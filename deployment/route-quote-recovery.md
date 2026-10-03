# Route/quote recovery

The mobile booking screen could load map pins but failed to calculate the route/price. Production logs showed POSTs to `ride_quotes` rejected with SQLSTATE 42501 inside `private.guard_bulgaria_coordinates`. The Edge `service_role` had EXECUTE on the Bulgaria helper but no USAGE on schema `private`.

Grant schema USAGE to the server-only role; leave anonymous access denied and keep `private` outside the Data API. Quote ownership, cash payment rules and Bulgaria checks remain unchanged. Add a role-specific quote writer test because administrator-only fixtures can conceal schema-access failures, including when PL/pgSQL plans have already been compiled under another role.

Separately, Readdy's frontend-only build cannot resolve a runtime import into the omitted `supabase` directory. Store an identical self-contained geography helper in `src/lib/serviceArea.ts`; test byte-for-byte parity with the backend copy. No runtime frontend import crosses into backend files.

Validation: 151 tests, lint, TypeScript, full build and a build workspace without the entire Supabase folder pass. Rollback-only live integration suites include direct service-role geography access and quote insertion. No fixtures survive. A real authenticated phone booking should be rechecked by refreshing its route; this release does not claim a completed passenger booking test.
