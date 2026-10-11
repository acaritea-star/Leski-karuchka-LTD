# Invited company and driver access

Customers retain Google and Facebook. Partner login links sit inside the collapsed
“За фирми и шофьори” disclosure. Personal invitations open the relevant login directly.
OAuth authenticates the account; Postgres authorizes membership using the confirmed
email in `auth.users`, never profile email, editable metadata or a client-selected role.

## Company

The platform administrator invites a representative by email only. On first matching
login, a single transaction creates an inactive draft company and binds the account.
The representative enters legal/contact data, service city, permit expiry and explicit
EUR tariffs after login. Setup validates and returns the actual persisted record.
It does not mark the carrier legally verified. Vehicles and driver invitations are
then managed in the existing company dashboard. Existing companies are grandfathered;
their tariffs and current administrator roles are not changed.

An existing unassigned company administrator can be linked by sending a named
invitation from the correct existing company's “Покани представител” button. A contact
email alone grants no access. We intentionally do not guess which company an orphaned
administrator owns. Super administrators remain global and can manage selected firms.

The service city is descriptive metadata. Dispatch continues to use current GPS,
company dispatch radius, eligibility, Bulgaria checks and existing dispatch rules.
This change does not introduce a municipal polygon or promise city-only dispatch.

## Driver

The firm invites a specific email. The candidate stays CUSTOMER until the existing
atomic verification operation approves the complete package. Preparation is accessible
only after login. Existing pending/rejected applications remain finishable.
New public applications require an accepted named invitation; the former company UUID
in a shared URL is not sufficient. Current training includes the 8–12% service fee;
this release does not start billing, invoicing or automatic financial deductions.

For an own car, the candidate supplies licence, insurance, registration and vehicle
details. For a company car, the candidate supplies licence; the firm supplies insurance
and assigns its valid vehicle during the same review. Saved preparation receipts and
private files survive reloads; validation/verification requirements are unchanged.

## Transactional invitations

`partner-invitation-email` validates every POST with Supabase Auth, active profile and
the existing API budget. Only administrators of the invitation's firm (or the platform)
can cause a delivery. Recipients and content come from the database, not request input.
The delivery lease prevents concurrent sends. Retrying an ambiguous send reuses a stable
Resend key for 23 hours. Permanent errors are not retried; transient errors have a bounded
retry and timeout. Mail failure leaves the invitation usable with its personal link.
An invitation has a separate pending/accepted/revoked status and email delivery status.
“sent” means provider acceptance, not proven inbox delivery. No tracking scripts/pixels.

Required Edge Function secret: `RESEND_API_KEY`. Optional nonsecret overrides:
`RESEND_INVITES_FROM_EMAIL` (default `Лески Каручка <pokani@leskikaruchka.com>`) and
`RESEND_REPLY_TO_EMAIL` (default `support@leskikaruchka.com`). The root sending domain
was verified in Resend. This is not a webmail inbox and does not implement incoming
support messages or password login. The public GET readiness returns one boolean only.

## Validation and rollback

The migration adds tables/columns/functions and two guards. It replaces no existing
RPC, policies or profile permissions. The saved preflight records existing grants,
triggers and counts. SQL fixtures own rollback transactions and send no emails or
Google requests. UI tests intercept all backend and external traffic.
`restore-invited-access.sql` preserves all business data and restores compatibility
with the old frontend, but reopens the former public candidacy flow. It is for emergency
rollback after diagnosing a regression, not a routine migration. Republish the prior
frontend together with it. Do not delete accepted memberships as part of a rollback.

Real Google/Facebook OAuth still requires an invited operator testing with their own
provider account. Automated browser flows test application state with mocked OAuth
sessions; database tests use real Postgres roles and confirmed synthetic identities.
