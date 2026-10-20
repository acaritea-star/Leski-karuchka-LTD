# First customer login welcome

Show a brief welcome only to a new active CUSTOMER entering a /customer/ page.
Explain pickup/destination, choosing a company's offer, live order tracking and
the existing 112 button at the top right of the customer map.

The deployment backfills existing customer profiles as already welcomed. They
must not receive a new introduction on their next login. Future customer
profiles have no entry until the first claim.

Use one small authenticated RPC. An atomic INSERT ... ON CONFLICT DO NOTHING
in a private RLS-enabled table returns true to one caller only, including
simultaneous devices/tabs. The account ID comes from auth.uid(), never a client
argument. Callers cannot read, insert, delete or reset the private record.

The claim is saved before displaying the modal. Dismissing, signing out,
reloading, clearing browser storage and using another device cannot reset it.
As with any at-most-once acknowledgement, a lost response after the server
commits can suppress the introduction; it must never block booking or loop.
No permission request, new interval, Realtime channel or production dependency.

The modal uses the existing accessible dialog (focus handling, Escape/backdrop,
scroll lock and short-screen scrolling). Its UI chunk loads only after a
successful first claim. Tests cover account/role isolation, repeat calls,
concurrent claims, StrictMode, stale responses, reloads and mobile layout.

Production migration: `20261020083638`. Existing customer accounts were recorded as
`existing_customer`; this is an exemption, not a claim that they viewed this new
modal. Native Supabase verified 12 simultaneous connections produce exactly one
first claim. UI checks cover 360 × 640 screens with the continue button visible.

The private-table [RLS-without-policy informational lint](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
is intentional: app roles have no table grants and only the scoped function can
insert their own claim. Anonymous RPC access and client resets are denied.
